const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const pathfinder = require('mineflayer-pathfinder');
const { GoalBlock } = require('mineflayer-pathfinder').goals;

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

const cfg = getConfig();
if (cfg.web && cfg.web.enabled) {
  server.listen(cfg.web.port, () => {
    logger.success(`Web dashboard running on port ${cfg.web.port}`);
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
      proxy: bot?.hasProxy ? 'Yes' : 'No', // Now reliable
      viewerPort: bot?.viewerPort || null,
      viewerRunning: bot?.viewerRunning || false,
      isAfkFarming: bot?.isAfkFarming || false
	  isMaintenance: bot?.isMaintenance || false
    };
  }
  io.emit('bots', statuses);
}

/**
 * Start viewer for a bot
 */
function startViewerForBot(bot) {
  if (bot.viewerRunning) {
    console.log(`[VIEWER] Already running for ${bot.username} (port ${bot.viewerPort})`);
    return;
  }
  console.log(`[VIEWER] Attempting to start viewer for ${bot.username} on port ${bot.viewerPort}`);
  let started = false;
  const forceStart = () => {
    if (started) return;
    started = true;
    console.log(`[VIEWER] Chunk timeout — forcing viewer start`);
    try {
      const viewer = mineflayerViewer(bot, {
        port: bot.viewerPort,
        firstPerson: false,
        viewDistance: 6
      });
      bot.viewerInstance = viewer;
      bot.viewerRunning = true;
      console.log(`[VIEWER] Forced start success on http://localhost:${bot.viewerPort}`);
      broadcastBotsStatus();
    } catch (err) {
      console.error(`[VIEWER] Forced start failed:`, err.message);
      console.error(err.stack);
      bot.viewerRunning = false;
    }
  };
  const timeoutId = setTimeout(forceStart, 15000);
  bot.waitForChunksToLoad(() => {
    clearTimeout(timeoutId);
    if (started) return;
    started = true;
    console.log(`[VIEWER] Chunks loaded — normal start`);
    try {
      const viewer = mineflayerViewer(bot, {
        port: bot.viewerPort,
        firstPerson: false,
        viewDistance: 6
      });
      bot.viewerInstance = viewer;
      bot.viewerRunning = true;
      console.log(`[VIEWER] Normal start success on http://localhost:${bot.viewerPort}`);
      broadcastBotsStatus();
    } catch (err) {
      console.error(`[VIEWER] Normal start failed:`, err.message);
      console.error(err.stack);
      bot.viewerRunning = false;
    }
  });
}

/**
 * Stop viewer for a bot
 */
function stopViewerForBot(bot) {
  if (!bot.viewerRunning || !bot.viewerInstance) {
    console.log(`[VIEWER] No active viewer to stop for ${bot.username}`);
    return;
  }
  console.log(`[VIEWER] Attempting to stop viewer for ${bot.username}`);
  try {
    bot.viewerInstance.close();
    console.log(`[VIEWER] Viewer closed successfully`);
    bot.viewerInstance = null;
    bot.viewerRunning = false;
    logger.success(`[VIEWER] Stopped for ${bot.username}`);
    broadcastBotsStatus();
  } catch (err) {
    console.error(`[VIEWER] Stop failed:`, err.message);
    console.error(err.stack);
    bot.viewerInstance = null;
    bot.viewerRunning = false;
    broadcastBotsStatus();
  }
}

/**
 * Create and initialise a bot for the given account.
 */
function createBot(accountConfig) {
  const cfgBot = serverConfig.server;
  const cfg = getConfig();
  logger.info(`Starting bot for ${accountConfig.username}…`);

  const botOptions = {
    host: cfgBot.host,
    port: cfgBot.port,
    version: cfgBot.version,
    username: accountConfig.username,
    auth: accountConfig.auth,
    skipValidation: true,
    compress: false,
  };

  botOptions.hasProxy = false; // Initialize flag

  if (accountConfig.proxy) {
    try {
      botOptions.agent = new SocksProxyAgent(accountConfig.proxy, {
        timeout: 60000,
        keepAlive: true,
        keepAliveMsecs: 2000,
        retries: 3
      });
      logger.info(`Proxy enabled for ${accountConfig.username}: ${accountConfig.proxy}`);
      botOptions.hasProxy = true; // Set flag
    } catch (proxyErr) {
      logger.error(`Failed to set proxy for ${accountConfig.username}: ${proxyErr.message}`);
    }
  } else {
    logger.info(`No proxy for ${accountConfig.username} — direct connection`);
  }

  const bot = mineflayer.createBot(botOptions);

  // NOW set the flag (bot exists)
  bot.hasProxy = botOptions.hasProxy;

  bot.loadPlugin(pathfinder.pathfinder);
  console.log('[Pathfinder] Loaded for', bot.username);

  bot.sessionStart = Date.now();
  bots[accountConfig.username] = bot;
  bot.accountConfig = accountConfig;
  bot.shards = null;
  bot.keys = null;
  bot.isAfkFarming = false;

  bot.viewerPort = 3001 + Object.keys(bots).length - 1;
  bot.viewerRunning = false;
  bot.viewerInstance = null;

  bot.on('message', function earlyAfkCheck(jsonMsg) {
    const text = jsonMsg.toString().trim().toLowerCase();
    if (text.includes('you teleported to the ᴀꜰᴋ')) {
      logger.success('[Early] Caught "you teleported to the ᴀꜰᴋ" — AFK confirmed');
      bot.isAfkFarming = true;
      broadcastBotsStatus();
      bot.off('message', earlyAfkCheck);
    }
  });

  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString().trim().toLowerCase();
    console.log('[CHAT RAW]', text);

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
	if (text.includes('we are under maintenance') || text.includes('server under maintenance')) {
  logger.warn('[Maintenance] Server maintenance detected — pausing bot for 15-30 min');
  bot.isMaintenance = true;
  broadcastBotsStatus(); // Update dashboard to show popup

  const pauseMs = Math.floor(Math.random() * (30000 - 15000 + 1)) + 15000; // 15-30 min in ms
  setTimeout(() => {
    bot.isMaintenance = false;
    broadcastBotsStatus();
    logger.info('[Maintenance] Pause ended — reconnecting');
    bot.end(); // Trigger reconnect via autoReconnect
  }, pauseMs);
}

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

    if (cfg.plugins && cfg.plugins.antiAfk) antiAfk(bot);
    if (cfg.plugins && cfg.plugins.randomMove) randomMove(bot);
    if (cfg.plugins && cfg.plugins.chatLogger) chatLogger(bot);

    require('./plugins/autoFarm')(bot);

    if (cfg.plugins && cfg.plugins.autoLobby) {
      setTimeout(() => autoLobby(bot), 2000);
    } else if (cfg.plugins && cfg.plugins.autoSpawnCommand) {
      setTimeout(() => {
        bot.chat('/warp afk');
      }, 5000);
    }

    broadcastBotsStatus();

    setTimeout(() => {
      if (bot.entity) {
        logger.info(`[SHARDS] Login query sent for ${bot.username || accountConfig.username}`);
      }
    }, 8000);
  });

  bot.on('death', () => {
    if (cfg.plugins && cfg.plugins.autoRespawn) {
      logger.info(`Bot ${bot.username} died, respawning…`);
      setTimeout(() => bot.respawn(), 1500);
    }
  });

  bot.on('chat', (username, message) => {
    if (cfg.web && cfg.web.enabled) {
      io.emit('chat', {
        username: accountConfig.username,
        botUsername: bot.username,
        chatUsername: username,
        message
      });
    }
  });

  if (cfg.plugins && cfg.plugins.autoReconnect) {
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
  console.log(`[Socket] New client connected: ${socket.id}`);
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

  socket.on('startViewer', (data) => {
    console.log(`[Socket] startViewer requested for ${data.username}`);
    const bot = bots[data.username];
    if (bot) startViewerForBot(bot);
  });

  socket.on('stopViewer', (data) => {
    console.log(`[Socket] stopViewer requested for ${data.username}`);
    const bot = bots[data.username];
    if (bot) stopViewerForBot(bot);
  });

  socket.on('maintenance', (data) => {
    const action = data.action;
    const botName = data.bot;
    console.log(`[Maintenance] ${action} requested for ${botName}`);
    const bot = bots[botName];
    if (!bot) {
      console.warn(`[Maintenance] Bot not found: ${botName}`);
      socket.emit('maintenance-result', { message: `Bot ${botName} not found` });
      return;
    }
    if (action === 'disconnect') {
      console.log(`[Maintenance] Disconnecting bot ${botName}`);
      bot.end();
      socket.emit('maintenance-result', { message: `Disconnected ${botName}` });
    } else if (action === 'reconnect') {
      console.log(`[Maintenance] Reconnecting bot ${botName}`);
      bot.end();
      if (bot.accountConfig) {
        setTimeout(() => {
          createBot(bot.accountConfig);
          console.log(`[Maintenance] Recreated bot ${botName}`);
          socket.emit('maintenance-result', { message: `Reconnected ${botName}` });
        }, 2000);
      } else {
        console.error(`[Maintenance] No stored config for ${botName}`);
        socket.emit('maintenance-result', { message: `Reconnect failed: config missing` });
      }
    }
  });
});

// Start everything
startBots();
startDiscordBot(() => bots);