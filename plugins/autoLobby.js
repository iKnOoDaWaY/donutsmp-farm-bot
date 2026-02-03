const logger = require('../utils/logger');

/**
 * Automatically sends /spawn on connection, but skips if already in an AFK area.
 * Waits longer (15 seconds) to give server time to send the message.
 * @param {object} bot The mineflayer bot instance
 */
module.exports = function autoLobby(bot) {
  let detectedAfk = false;

  // Flexible pattern for AFK messages
  const afkPattern = /You teleported to the.*ᴀꜰᴋ\s*\d+/i;

  const listener = (jsonMsg) => {
    const text = jsonMsg.toString().toLowerCase();
    if (afkPattern.test(text)) {
      detectedAfk = true;
      logger.info(`[AutoLobby] AFK detected: "${text}" → skipping /spawn`);
      bot.off('message', listener);
    }
  };

  bot.on('message', listener);

  setTimeout(() => {
    if (detectedAfk) {
      logger.info('[AutoLobby] Already in AFK area — /spawn skipped');
    } else {
      const cmd = '/spawn';
      logger.info(`[AutoLobby] No AFK message after 15s — sending ${cmd}`);
      bot.chat(cmd);
    }

    bot.off('message', listener);
  }, 15000); // 15 seconds - increased from 8s
};