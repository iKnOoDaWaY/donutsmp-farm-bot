const logger = require('../utils/logger');

/**
 * Automatically sends /spawn on connection, but skips if already in an AFK area.
 * Checks raw chat for messages containing "ᴀꜰᴋ" + number (e.g. "ᴀꜰᴋ 52")
 * @param {object} bot The mineflayer bot instance
 */
module.exports = function autoLobby(bot) {
  let detectedAfk = false;

  // Pattern to match AFK area messages
  const afkPattern = /ᴀꜰᴋ\s*\d+|afk\s*\d+|teleported to the ᴀꜰᴋ|to the ᴀꜰᴋ|in ᴀꜰᴋ|afk area|afk zone/i;

  // Listen for chat messages
  const afkListener = (jsonMsg) => {
    const text = jsonMsg.toString().toLowerCase();

    // Debug: log every chat message
    console.log('[AFK DEBUG] Raw chat checked:', text);

    if (afkPattern.test(text)) {
      detectedAfk = true;
      logger.info(`[AutoLobby] Detected AFK area message: "${text}" → skipping /spawn`);
      bot.off('message', afkListener);
    }
  };

  bot.on('message', afkListener);

  // Wait 15 seconds for possible AFK message
  setTimeout(() => {
    if (detectedAfk) {
      logger.info('[AutoLobby] Bot is already in AFK area — /spawn skipped');
    } else {
      const cmd = '/spawn';
      logger.info(`[AutoLobby] No AFK message detected after 15s — sending ${cmd}`);
      bot.chat(cmd);
    }

    // Clean up listener
    bot.off('message', afkListener);
  }, 15000);
};