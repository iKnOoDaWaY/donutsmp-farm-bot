const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const serverConfig = require('./config/bot.config');
const logger = require('./utils/logger');
const { getConfig } = require('./utils/configLoader');
const { getBotStatus } = require('./utils/status');

// Plugins
const antiAfk = require('./plugins/antiAfk');
const randomMove = require('./plugins/randomMove');
const chatLogger = require('./plugins/chatLogger');
const autoReconnect = require('./plugins/autoReconnect');
const autoLobby = require('./plugins/autoLobby');

// Discord integration
const startDiscordBot = require('./discord/bot');

// Store all active bots keyed by their username (config key = email/account identifier)
const bots = {};

// Create the web server and socket.io instance.
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the web/public folder
app.use(express.static(__dirname + '/web/public'));

// Start the HTTP server on the configured port.
if (getConfig().web && getConfig().web.enabled) {
  server.listen(getConfig().web.port, () => {
    logger.success(`Web dashboard running on port ${getConfig().web.port}`);
  });
}

/**
 * Broadcast the status of all bots to connected web clients.
 */
function broadcastBotsStatus() {
  const cfg = getConfig();
  if (!cfg.web || !cfg.web.enabled) return;
  const statuses = {};
  for (const name of Object.keys(bots)) {
    const status = getBotStatus(bots[name], cfg);
    status.allowWebChat = cfg.web && cfg.web.allowWebChat;
    if (bots[name].username) {
      status.botUsername = bots[name].username;
    }
    statuses[name] = status;
  }
  io.emit('bots', statuses);
}

/**
 * Create and initialise a bot for the given account.
 * @param {object} accountConfig An entry from config/config.json.accounts
 */
function createBot(accountConfig) {
  const cfgBot = serverConfig.server;
  logger.info(`Starting bot for ${accountConfig.username}…`);

  const bot = mineflayer.createBot({
    host: cfgBot.host,
    port: cfgBot.port,
    version: cfgBot.version,
    username: accountConfig.username,
    auth: accountConfig.auth
  });

  bots[accountConfig.username] = bot;

  bot.shards = null; // Shard count storage

  // Improved chat parser for shards (handles "your shards: 2.62k" and similar)
  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString().trim().toLowerCase();

    // Debug: log every chat message temporarily
    console.log('[CHAT RAW]', text);

    // Priority 1: Catch formatted "your shards: 2.62k" / "shards : 2.62K" / etc.
    const formattedRegex = /(?:your\s*shards\s*[:=-]\s*|shards\s*[:=-]\s*|\b)([\d.]+)([kmb]?)/i;
    const formattedMatch = text.match(formattedRegex);

    if (formattedMatch && formattedMatch[1]) {
      let numStr = formattedMatch[1];
      let multiplier = 1;

      const suffix = formattedMatch[2].toLowerCase();
      if (suffix === 'k') multiplier = 1000;
      else if (suffix === 'm') multiplier = 1000000;
      else if (suffix === 'b') multiplier = 1000000000;

      const number = parseFloat(numStr);
      if (!isNaN(number)) {
        const final = Math.round(number * multiplier);
        bot.shards = final;
        console.log(`[SHARDS UPDATE] Formatted match: ${final} (from "${formattedMatch[0]}") for ${bot.username || accountConfig.username}`);
        return; // Stop here - we have the correct value
      }
    }

    // Priority 2: Only fallback to plain number if no formatted match (and skip very small numbers)
    const plainMatch = text.match(/\b(\d+)\b/);
    if (plainMatch && plainMatch[1]) {
      const count = parseInt(plainMatch[1], 10);
      // Ignore tiny numbers like "2" or "57" that are likely not the real balance
      if (count >= 100 && count < 10000000) {
        bot.shards = count;
        console.log(`[SHARDS UPDATE] Plain fallback: ${count} for ${bot.username || accountConfig.username}`);
      }
    }
  });

  bot.once('spawn', () => {
    logger.success(`Bot ${bot.username} spawned`);
    const cfg = getConfig();

    if (cfg.plugins && cfg.plugins.antiAfk) antiAfk(bot);
    if (cfg.plugins && cfg.plugins.randomMove) randomMove(bot);
    if (cfg.plugins && cfg.plugins.chatLogger) chatLogger(bot);

    if (cfg.plugins && cfg.plugins.autoLobby) {
      setTimeout(() => autoLobby(bot), 2000);
    } else if (cfg.plugins && cfg.plugins.autoSpawnCommand) {
      setTimeout(() => {
        bot.chat('/spawn');
        setTimeout(() => bot.chat('/lobby'), 3000);
      }, 5000);
    }

    broadcastBotsStatus();

    // Shard query: only on login/spawn
    setTimeout(() => {
      if (bot.entity) {
        bot.chat('/shards');
        console.log(`[SHARDS] Login query sent for ${bot.username || accountConfig.username}`);
      }
    }, 8000); // delay for full login
  });

  bot.on('death', () => {
    const cfg = getConfig();
    if (cfg.plugins && cfg.plugins.autoRespawn) {
      logger.info(`Bot ${bot.username} died, respawning…`);
      setTimeout(() => bot.respawn(), 1500);
    }
  });

  bot.on('chat', (username, message) => {
    if (getConfig().web && getConfig().web.enabled) {
      io.emit('chat', {
        username: accountConfig.username,
        botUsername: bot.username,
        chatUsername: username,
        message
      });
    }
  });

  if (getConfig().plugins && getConfig().plugins.autoReconnect) {
    autoReconnect(bot, () => {
      logger.info(`Recreating bot for ${accountConfig.username}…`);
      createBot(accountConfig);
      broadcastBotsStatus();
    });
  }

  bot.on('end', () => {
    broadcastBotsStatus();
  });

  bot.on('error', err => {
    logger.error(err);
  });

  // 3-hour periodic shard query (per bot)
  setInterval(() => {
    if (bot?.entity) {
      bot.chat('/shards');
      console.log(`[SHARDS] 3-hour query sent for ${bot.username || accountConfig.username}`);
    }
  }, 3 * 60 * 60 * 1000); // 10800000 ms = 3 hours
}

/**
 * Iterate over the accounts defined in config/config.json and create a
 * bot for each one.
 */
function startBots() {
  const cfg = getConfig();
  let accounts = cfg.accounts;
  if (!accounts || accounts.length === 0) {
    if (cfg.account) {
      accounts = [cfg.account];
    } else {
      logger.error('No accounts configured in config/config.json');
      return;
    }
  }
  accounts.forEach(acc => createBot(acc));
}

// Socket.io connection handling
io.on('connection', socket => {
  broadcastBotsStatus();

  socket.on('sendMessage', data => {
    const cfg = getConfig();
    if (!cfg.web || !cfg.web.allowWebChat) return;
    if (!data || typeof data.message !== 'string' || data.message.trim().length === 0) return;
    const targetName = data.username || Object.keys(bots)[0];
    const targetBot = bots[targetName];
    if (!targetBot || !targetBot.player) return;
    if (data.message.length > 100) return;
    targetBot.chat(data.message.trim());
  });
});

// Start everything
startBots();
startDiscordBot(() => bots);
