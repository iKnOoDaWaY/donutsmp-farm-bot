const logger = require('../utils/logger');

/**
 * Automatically sends /spawn on connection, but skips if already in AFK area.
 * Checks raw chat for "you teleported to the ᴀꜰᴋ" + number.
 * @param {object} bot The mineflayer bot instance
 */
module.exports = function autoLobby(bot) {
  let alreadyInAfk = false;

  // Listen for AFK teleport message
  const afkListener = (jsonMsg) => {
    const text = jsonMsg.toString().toLowerCase();
    if (text.includes('you teleported to the') && text.includes('ᴀꜰᴋ') && /\d/.test(text)) {
      alreadyInAfk = true;
      logger.info(`[AutoLobby] Detected AFK teleport: "${text}" → skipping /spawn`);
      bot.off('message', afkListener); // Clean up
    }
  };

  bot.on('message', afkListener);

  // Wait ~6 seconds for possible AFK message
  setTimeout(() => {
    if (alreadyInAfk) {
      logger.info('[AutoLobby] Already in AFK area — no /spawn needed');
    } else {
      const cmd = '/spawn';
      logger.info(`[AutoLobby] No AFK message detected — sending ${cmd}`);
      bot.chat(cmd);
    }

    // Cleanup listener
    bot.off('message', afkListener);
  }, 6000);
};
