const logger = require('../utils/logger');

/**
 * Automatically sends /spawn on connection, but skips if already in an AFK area.
 * Waits longer (15 seconds) to allow server to send teleport message.
 * @param {object} bot The mineflayer bot instance
 */
module.exports = function autoLobby(bot) {
  let detectedAfk = false;

  // Pattern to match AFK area messages (very flexible)
  const afkPattern = /(?:you teleported to the|the|in the|to the|afk|ᴀꜰᴋ)\s*(?:area|zone)?\s*ᴀꜰᴋ?\s*\d+|afk\s*\d+|ᴀꜰᴋ\s*\d+/i;

  // Listen for messages
  const listener = (jsonMsg) => {
    const text = jsonMsg.toString().toLowerCase();

    if (afkPattern.test(text)) {
      detectedAfk = true;
      logger.info(`[AutoLobby] AFK detected in chat: "${text}" → will skip /spawn`);
      bot.off('message', listener);
    }
  };

  bot.on('message', listener);

  // Wait **15 seconds** for the AFK message to arrive
  setTimeout(() => {
    if (detectedAfk) {
      logger.info('[AutoLobby] Bot is already in AFK area — /spawn skipped');
    } else {
      const cmd = '/spawn';
      logger.info(`[AutoLobby] No AFK message after 15s — sending ${cmd}`);
      bot.chat(cmd);
    }

    // Cleanup
    bot.off('message', listener);
  }, 15000); // ← Increased to 15 seconds (15000 ms)
};