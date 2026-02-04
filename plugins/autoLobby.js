const logger = require('../utils/logger');

/**
 * Automatically sends /warp afk on connection, but skips if already in an AFK area.
 * Checks raw chat for the exact pattern: "you teleported to the ᴀꜰᴋ" followed by a number.
 * @param {object} bot The mineflayer bot instance
 */
module.exports = function autoLobby(bot) {
  let detectedAfk = false;

  // Exact pattern match for "you teleported to the ᴀꜰᴋ 11", "you teleported to the ᴀꜰᴋ 52", etc.
  const afkPattern = /you teleported to the ᴀꜰᴋ\s*\d+/i;

  // Listen for chat messages
  const afkListener = (jsonMsg) => {
    const text = jsonMsg.toString();

    // Debug: show every raw chat message checked
    console.log('[AFK DEBUG] Raw chat checked:', text);

    if (afkPattern.test(text)) {
      detectedAfk = true;
      logger.info(`[AutoLobby] Detected AFK teleport: "${text}" → skipping /warp afk`);
      bot.off('message', afkListener);
    }
  };

  // Start listening immediately
  bot.on('message', afkListener);

  // Wait 15 seconds for the AFK message to appear
  setTimeout(() => {
    if (detectedAfk) {
      logger.info('[AutoLobby] Bot is already in AFK area — /warp afk skipped');
    } else {
      const cmd = '/warp afk';
      logger.info(`[AutoLobby] No AFK teleport message detected after 15s — sending ${cmd}`);
      bot.chat(cmd);
    }

    // Clean up listener
    bot.off('message', afkListener);
  }, 15000); // 15 seconds
};