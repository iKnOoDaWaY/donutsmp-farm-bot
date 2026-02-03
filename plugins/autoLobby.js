const logger = require('../utils/logger');

/**
 * Automatically sends /spawn on connection, but skips if already in an AFK area.
 * Checks raw chat for messages containing "ᴀꜰᴋ" + number (e.g. "ᴀꜰᴋ 52")
 * @param {object} bot The mineflayer bot instance
 */
module.exports = function autoLobby(bot) {
  let detectedAfk = false;

  // Pattern to match any AFK area teleport message
  // Examples: "you teleported to the ᴀꜰᴋ 52", "ᴀꜰᴋ 1", "AFK 99", etc.
  const afkPattern = /ᴀꜰᴋ\s*\d+|afk\s*\d+|the\s*ᴀꜰᴋ\s*\d+|afk\s*area/i;

  // Listen for chat messages
  const afkListener = (jsonMsg) => {
    const text = jsonMsg.toString().toLowerCase();

    console.log('[CHAT RAW]', text); // Temporary debug

    if (afkPattern.test(text)) {
      detectedAfk = true;
      logger.info(`[AutoLobby] Detected AFK area message: "${text}" → skipping /spawn`);
      // Stop listening once confirmed
      bot.off('message', afkListener);
    }
  };

  // Start listening immediately after spawn
  bot.on('message', afkListener);

  // Wait 15 seconds — enough time for the server to send the message
  setTimeout(() => {
    if (detectedAfk) {
      logger.info('[AutoLobby] Bot is already in AFK area — no /spawn needed');
    } else {
      const cmd = '/spawn';
      logger.info(`[AutoLobby] No AFK message detected after 15s — sending ${cmd}`);
      bot.chat(cmd);
    }

    // Cleanup listener
    bot.off('message', afkListener);
  }, 15000);
};