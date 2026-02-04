const logger = require('../utils/logger');

/**
 * Automatically sends /warp afk on connection, but skips if already in an AFK area.
 * Specifically detects messages like "you teleported to the ᴀꜰᴋ 11", "you teleported to the ᴀꜰᴋ 52", etc.
 * @param {object} bot The mineflayer bot instance
 */
module.exports = function autoLobby(bot) {
  let detectedAfk = false;

  // Exact pattern match for "you teleported to the ᴀꜰᴋ" followed by a number
  // This matches case-insensitively and allows for minor variations in spacing
  const afkPattern = /you teleported to the ᴀꜰᴋ\s*\d+/i;

  // Listen for chat messages and store them for debugging
  bot.locationChatLog = []; // Reset log

  const afkListener = (jsonMsg) => {
    const text = jsonMsg.toString().trim();

    // Store every raw message for visibility
    bot.locationChatLog.push(text);

    // Debug: show every message being checked
    console.log('[AFK DEBUG] Raw chat checked:', text);

    // Check if this is the AFK teleport message
    if (afkPattern.test(text)) {
      detectedAfk = true;
      logger.info(`[AutoLobby] AFK teleport DETECTED: "${text}" → skipping /warp afk`);
      bot.off('message', afkListener);
    }
  };

  bot.on('message', afkListener);

  // Wait 15 seconds for the AFK message to arrive
  setTimeout(() => {
    if (detectedAfk) {
      logger.info('[AutoLobby] Bot already in AFK area (teleport message detected) — /warp afk skipped');
    } else {
      const cmd = '/warp afk';
      logger.info(`[AutoLobby] No AFK teleport message detected after 15s — sending ${cmd}`);
      bot.chat(cmd);
    }

    // Show all raw chat messages seen during the check (for easy debugging)
    if (bot.locationChatLog.length > 0) {
      logger.info('[AutoLobby] Full RAW chat log during location check:');
      bot.locationChatLog.forEach((msg, i) => {
        console.log(`  ${i + 1}. ${msg}`);
      });
    } else {
      logger.info('[AutoLobby] No chat messages received during location check.');
    }

    // Clean up
    bot.off('message', afkListener);
  }, 30000); // 15 seconds
};