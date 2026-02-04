const logger = require('../utils/logger');

/**
 * Automatically sends /warp afk on connection, but skips if already in an AFK area.
 * ONLY checks for the exact server message: "you teleported to the ᴀꜰᴋ" + number.
 * @param {object} bot The mineflayer bot instance
 */
module.exports = function autoLobby(bot) {
  let detectedAfk = false;

  // STRICT pattern: ONLY matches "you teleported to the ᴀꜰᴋ" followed by a number
  // Examples that match: "you teleported to the ᴀꜰᴋ 11", "You teleported to the ᴀꜰᴋ 52"
  // Examples that DO NOT match: "you were warped to afk.", "teleported to afk", etc.
  const afkPattern = /^you teleported to the ᴀꜰᴋ\s*\d+/i;

  // Listen for chat messages
  const afkListener = (jsonMsg) => {
    const text = jsonMsg.toString().trim();

    // Debug: show every raw chat message being checked
    console.log('[AFK DEBUG] Raw chat checked:', text);

    if (afkPattern.test(text)) {
      detectedAfk = true;
      logger.info(`[AutoLobby] Detected exact AFK teleport message: "${text}" → skipping /warp afk`);
      bot.off('message', afkListener);
    }
  };

  bot.on('message', afkListener);

  // Wait 15 seconds for the specific AFK message
  setTimeout(() => {
    if (detectedAfk) {
      logger.info('[AutoLobby] Bot is already in AFK area (exact message detected) — /warp afk skipped');
    } else {
      const cmd = '/warp afk';
      logger.info(`[AutoLobby] No exact AFK teleport message detected after 15s — sending ${cmd}`);
      bot.chat(cmd);
    }

    // Clean up listener
    bot.off('message', afkListener);
  }, 15000); // 15 seconds
};