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

// Store all active bots keyed by their username.
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

  // Chat parser for shards
  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString().trim();
    const patterns = [
      /you have (\d+) shards/i,
      /shards:\s*(\d+)/i,
      /balance.*shards.*(\d+)/i,
      /you currently have (\d+) shards/i,
      /(\d+) shards/i
    ];
    for (const regex of patterns) {
      const match = text.match(regex);
      if (match && match[1]) {
        const count = parseInt(match[1], 10);
        if (!isNaN(count)) {
          bot.shards = count;
          console.log(`[SHARDS UPDATE] ${bot.username}: ${count}`);
          return;
        }
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
    // Initial shard query
    setTimeout(() => bot.chat('/shards'), 5000);
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

  // Auto-query shards for all bots every 15 min
  setInterval(() => {
    Object.values(bots).forEach(bot => {
      if (bot.entity) {
        bot.chat('/shards');
      }
    });
  }, 15 * 60 * 1000);
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
