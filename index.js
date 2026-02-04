const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { SocksProxyAgent } = require('socks-proxy-agent');

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

// Store all active bots
const bots = {};

// Web server + socket.io
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + '/web/public'));

if (getConfig().web && getConfig().web.enabled) {
  server.listen(getConfig().web.port, () => {
    logger.success(`Web dashboard running on port ${getConfig().web.port}`);
  });
}

/**
 * Broadcast the status of all bots to connected web clients (with live stats).
 */
function broadcastBotsStatus() {
  const cfg = getConfig();
  if (!cfg.web || !cfg.web.enabled) return;

  const statuses = {};
  for (const name of Object.keys(bots)) {
    const bot = bots[name];
    const status = getBotStatus(bot, cfg) || {};

    statuses[name] = {
      configUsername: name,
      minecraftUsername: bot?.username || 'Offline',
      online: !!bot?.entity,
      statusColor: bot?.entity ? '#00ff00' : '#ff0000',
      shards: bot.shards ?? 'Unknown',
      keys: bot.keys ?? 'Unknown',
      uptime: bot?.entity ? Math.floor((Date.now() - bot.sessionStart) / 1000) : 0,
      health: bot?.health ?? 'N/A',
      food: bot?.food ?? 'N/A',
      dimension: bot?.game?.dimension ?? 'N/A',
      position: bot?.entity?.position ? `${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}` : 'N/A',
      proxy: bot?.options?.agent ? 'Yes' : 'No'
    };
  }

  io.emit('bots', statuses);
}

/**
 * Create and initialise a bot for the given account.
 */
function createBot(accountConfig) {
  const cfgBot = serverConfig.server;
  logger.info(`Starting bot for ${accountConfig.username}…`);

  const botOptions = {
    host: cfgBot.host,
    port: cfgBot.port,
    version: cfgBot.version,
    username: accountConfig.username,
    auth: accountConfig.auth,
    skipValidation: true, // Helps with PartialReadError
  };

  if (accountConfig.proxy) {
    try {
      botOptions.agent = new SocksProxyAgent(accountConfig.proxy, {
        timeout: 60000,
        keepAlive: true,
        keepAliveMsecs: 2000,
        retries: 3
      });
      logger.info(`Proxy enabled for ${accountConfig.username}: ${accountConfig.proxy}`);
    } catch (proxyErr) {
      logger.error(`Failed to set proxy for ${accountConfig.username}: ${proxyErr.message}`);
    }
  } else {
    logger.info(`No proxy for ${accountConfig.username} — direct connection`);
  }

  const bot = mineflayer.createBot(botOptions);
  bot.sessionStart = Date.now(); // For uptime
  bots[accountConfig.username] = bot;

  bot.shards = null;
  bot.keys = null;

  // Chat parser for shards AND keys
  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString().trim().toLowerCase();
    console.log('[CHAT RAW]', text);

    // Shard detection
    const shardRegex = /(?:your\s*shards\s*[:=-]\s*|shards\s*[:=-]\s*|\b)([\d.]+)([kmb]?)/i;
    const shardMatch = text.match(shardRegex);
    if (shardMatch && shardMatch[1]) {
      let numStr = shardMatch[1];
      let multiplier = 1;
      const suffix = shardMatch[2].toLowerCase();
      if (suffix === 'k') multiplier = 1000;
      else if (suffix === 'm') multiplier = 1000000;
      else if (suffix === 'b') multiplier = 1000000000;
      const number = parseFloat(numStr);
      if (!isNaN(number)) {
        const final = Math.round(number * multiplier);
        bot.shards = final;
        console.log(`[SHARDS] ${bot.username} → ${final}`);
        return;
      }
    }

    // Key detection
    const keyRegex = /(?:received|got|claimed|earned)\s*(\d+)\s*(?:crate\s*key|key)/i;
    const keyMatch = text.match(keyRegex);
    if (keyMatch && keyMatch[1]) {
      const keyCount = parseInt(keyMatch[1], 10);
      bot.keys = (bot.keys || 0) + keyCount;
      console.log(`[KEYS] ${bot.username} +${keyCount} keys (total: ${bot.keys})`);
      return;
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
        bot.chat('/warp afk');
        setTimeout(() => bot.chat('/lobby'), 3000);
      }, 5000);
    }

    broadcastBotsStatus();

    setTimeout(() => {
      if (bot.entity) {
        bot.chat('/shards');
        logger.info(`[SHARDS] Login query sent for ${bot.username || accountConfig.username}`);
      }
    }, 8000);
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

  setInterval(() => {
    if (bot?.entity) {
      bot.chat('/shards');
      logger.info(`[SHARDS] 3-hour query sent for ${bot.username || accountConfig.username}`);
    }
  }, 3 * 60 * 60 * 1000);
}

/**
 * Launch bots with staggered random delays.
 */
function startBots() {
  const cfg = getConfig();
  let accounts = cfg.accounts;
  if (!accounts || accounts.length === 0) {
    if (cfg.account) accounts = [cfg.account];
    else {
      logger.error('No accounts in config/config.json');
      return;
    }
  }

  console.log('🚀 Starting bots with staggered random delays...');

  const delayRanges = [
    { min: 5, max: 20 },
    { min: 15, max: 40 },
    { min: 25, max: 60 },
    { min: 40, max: 90 },
    { min: 60, max: 120 }
  ];

  accounts.forEach((acc, index) => {
    const range = delayRanges[index] || { min: 10, max: 60 };
    const randomSec = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
    const delayMs = randomSec * 1000;

    console.log(`[DELAY] ${acc.username} scheduled in ~${randomSec}s (range ${range.min}–${range.max}s)`);

    setTimeout(() => {
      console.log(`[DELAY] Launching ${acc.username} now`);
      createBot(acc);
    }, delayMs);
  });
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