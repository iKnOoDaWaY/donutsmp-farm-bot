const logger = require('../utils/logger');

/**
 * Automatically sends /warp afk on connection, but skips if already in an AFK area.
 * Stores ALL raw chat messages received during the check for easy location debugging.
 * @param {object} bot The mineflayer bot instance
 */
module.exports = function autoLobby(bot) {
  let detectedAfk = false;

  // Reset location chat log at the start of each check
  bot.locationChatLog = [];

  // Strict pattern for the exact AFK teleport message your server sends
  const afkPattern = /you teleported to the ᴀꜰᴋ\s*\d+/i;

  // Listen for chat messages and store every one
  const afkListener = (jsonMsg) => {
    const text = jsonMsg.toString().trim();

    // Store EVERY raw message received
    bot.locationChatLog.push(text);

    // Debug: show message being checked
    console.log('[AFK DEBUG] Raw chat checked:', text);

    if (afkPattern.test(text)) {
      detectedAfk = true;
      logger.info(`[AutoLobby] Detected exact AFK teleport: "${text}" → skipping /warp afk`);
      bot.off('message', afkListener);
    }
  };

  bot.on('message', afkListener);

  // Wait 15 seconds for the AFK message
  setTimeout(() => {
    if (detectedAfk) {
      logger.info('[AutoLobby] Bot is already in AFK area — /warp afk skipped');
    } else {
      const cmd = '/warp afk';
      logger.info(`[AutoLobby] No AFK teleport message detected after 15s — sending ${cmd}`);
      bot.chat(cmd);
    }

    // Print all raw chat messages the bot saw during the check
    if (bot.locationChatLog.length > 0) {
      logger.info('[AutoLobby] Raw chat messages seen during location check:');
      bot.locationChatLog.forEach((msg, i) => {
        console.log(`  ${i + 1}. ${msg}`);
      });
    } else {
      logger.info('[AutoLobby] No chat messages received during location check.');
    }

    // Clean up
    bot.off('message', afkListener);
    // Keep the log for later reference (e.g. web dashboard or manual check)
  }, 15000);
};