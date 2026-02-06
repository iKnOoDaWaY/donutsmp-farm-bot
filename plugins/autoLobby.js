// plugins/autoFarm.js
const { GoalBlock } = require('mineflayer-pathfinder').goals;

module.exports = (bot) => {
  const logger = require('../utils/logger');

  logger.info('[AutoFarm] Plugin loaded for ' + (bot.username || 'unnamed bot'));

  if (!bot.pathfinder) {
    logger.error('[AutoFarm] Pathfinder plugin not loaded — movement disabled!');
    return;
  }

  logger.info('[AutoFarm] Pathfinder ready — listening for AFK confirmation');

  const TARGET_X = 21;
  const TARGET_Y = 67;
  const TARGET_Z = 92;

  let detectedAfk = false; // Flag to prevent repeated actions

  // Chat listener — active from the beginning
  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString().trim().toLowerCase();
    logger.info('[AutoFarm] RAW CHAT RECEIVED: "' + text + '"');

    // Only act once — when we first detect the confirmation message
    if (!detectedAfk && text.includes('you teleported to the ᴀꜰᴋ')) {
      detectedAfk = true;
      bot.isAfkFarming = true; // For dashboard green label
      logger.success('[AutoFarm] AFK TELEPORT CONFIRMED — farming active');

      // Update dashboard immediately
      if (typeof broadcastBotsStatus === 'function') {
        broadcastBotsStatus();
      }

      // Optional: Remove listener after first detection to save resources
      // bot.off('message', arguments.callee); // Uncomment if you want to stop listening completely

      // Start the movement sequence
      const delayMs = Math.floor(Math.random() * (20000 - 7000 + 1)) + 7000;
      logger.info(`[AutoFarm] Starting random delay: ${delayMs / 1000}s`);

      setTimeout(() => {
        if (!bot.entity) {
          logger.warn('[AutoFarm] Bot entity missing — cannot move');
          return;
        }

        const pos = bot.entity.position;
        logger.info(`[AutoFarm] Current pos: x=${pos.x.toFixed(2)}, y=${pos.y.toFixed(2)}, z=${pos.z.toFixed(2)}`);

        const isAtSpot =
          Math.abs(pos.x - TARGET_X) < 1.5 &&
          Math.abs(pos.y - TARGET_Y) < 1.5 &&
          Math.abs(pos.z - TARGET_Z) < 1.5;

        if (isAtSpot) {
          logger.info('[AutoFarm] Already at target spot — no movement needed');
          return;
        }

        logger.info(`[AutoFarm] Pathfinding to ${TARGET_X}, ${TARGET_Y}, ${TARGET_Z}`);
        bot.pathfinder.setGoal(new GoalBlock(TARGET_X, TARGET_Y, TARGET_Z));

        // Jump once after short delay
        setTimeout(() => {
          logger.info('[AutoFarm] Performing single jump');
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 300);
        }, 800);
      }, delayMs);
    }
  });

  // Pathfinding feedback
  bot.on('goal_reached', () => {
    logger.success('[AutoFarm] Reached target spot!');
  });

  bot.on('path_update', (r) => {
    logger.info(`[AutoFarm] Path status: ${r.status} (${r.visitedNodes} nodes)`);
    if (r.status === 'noPath') {
      logger.warn('[AutoFarm] NO PATH — blocked or unreachable?');
    }
  });

  logger.info('[AutoFarm] Listener active — waiting for "you teleported to the ᴀꜰᴋ"');
};