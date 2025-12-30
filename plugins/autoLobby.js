const logger = require('../utils/logger');

/**
 * Automatically sends /spawn on connection.
 * @param {object} bot The mineflayer bot instance
 */
module.exports = function autoLobby(bot) {
  const cmd = '/spawn';
  logger.info(`[AutoLobby] Sending ${cmd}`);
  bot.chat(cmd);
};
