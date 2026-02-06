// plugins/autoFarm.js
const { GoalBlock } = require('mineflayer-pathfinder').goals;

module.exports = (bot) => {
  const logger = require('../utils/logger');

  logger.success('[AutoFarm] Plugin LOADED for bot: ' + (bot.username || 'unnamed bot'));

  if (!bot.pathfinder) {
    logger.error('[AutoFarm] CRITICAL: Pathfinder plugin NOT loaded — movement will fail!');
    return;
  }

  logger.info('[AutoFarm] Pathfinder is available — registering chat listener');

  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString().trim();
    logger.info(`[AutoFarm] RAW MESSAGE RECEIVED: "${text}"`);

    const lowerText = text.toLowerCase();

    if (lowerText.includes('you were warped to afk.')) {
      logger.success('[AutoFarm] WARP TO AFK DETECTED — starting random delay');

      const delayMs = Math.floor(Math.random() * (20000 - 7000 + 1)) + 7000;
      logger.info(`[AutoFarm] Random delay: ${delayMs / 1000} seconds`);

      setTimeout(() => {
        if (!bot.entity) {
          logger.warn('[AutoFarm] Bot entity missing — cannot move');
          return;
        }

        const pos = bot.entity.position;
        //logger.info(`[AutoFarm] Current pos: x=${pos.x.toFixed(2)}, y=${pos.y.toFixed(2)}, z=${pos.z.toFixed(2)}`);

        const isAtSpot =
          Math.abs(pos.x - 21) < 1.5 &&
          Math.abs(pos.y - 67) < 1.5 &&
          Math.abs(pos.z - 92) < 1.5;

        if (isAtSpot) {
          logger.info('[AutoFarm] Already at target spot — skipping');
          return;
        }

        logger.info('[AutoFarm] Setting pathfinding goal to 21, 67, 92');
        bot.pathfinder.setGoal(new GoalBlock(21, 67, 92));

        setTimeout(() => {
          logger.info('[AutoFarm] Performing single jump');
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 300);
        }, 800);
      }, delayMs);
    }

    if (lowerText.includes('you teleported to the ᴀꜰᴋ')) {
      logger.success('[AutoFarm] AFK TELEPORT CONFIRMED — farming active');
      bot.isAfkFarming = true;
      // Update dashboard
      if (typeof broadcastBotsStatus === 'function') {
        broadcastBotsStatus();
      }
    }
  });

  bot.on('goal_reached', () => {
    logger.success('[AutoFarm] Target reached!');
  });

  bot.on('path_update', (r) => {
    //logger.info(`[AutoFarm] Path status: ${r.status} - ${r.visitedNodes} nodes`);
    if (r.status === 'noPath') {
      logger.warn('[AutoFarm] NO PATH FOUND — check if spot is reachable');
    }
  });

  logger.info('[AutoFarm] Chat listener registered — waiting for warp message');
};