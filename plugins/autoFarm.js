// plugins/autoFarm.js
const { GoalBlock } = require('mineflayer-pathfinder').goals;

module.exports = (bot) => {
  const logger = require('../utils/logger');

  const TARGET_X = 21;
  const TARGET_Y = 67;
  const TARGET_Z = 92;

  // Listen for warp confirmation
  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString().trim().toLowerCase();

    if (text.includes('you were warped to afk.')) {
      logger.info('[AutoFarm] Detected warp to AFK — starting delay before moving');

      // Random delay between 7 and 20 seconds
      const delayMs = Math.floor(Math.random() * (20000 - 7000 + 1)) + 7000;

      setTimeout(() => {
        const pos = bot.entity.position;

        // Check if already very close (tolerance 1.5 blocks)
        const isAtSpot =
          Math.abs(pos.x - TARGET_X) < 1.5 &&
          Math.abs(pos.y - TARGET_Y) < 1.5 &&
          Math.abs(pos.z - TARGET_Z) < 1.5;

        if (isAtSpot) {
          logger.info(`[AutoFarm] Already at target (${TARGET_X}, ${TARGET_Y}, ${TARGET_Z}) — skipping pathfinding`);
          return;
        }

        logger.info(`[AutoFarm] Moving to target: ${TARGET_X}, ${TARGET_Y}, ${TARGET_Z}`);

        // Set pathfinding goal
        bot.pathfinder.setGoal(new GoalBlock(TARGET_X, TARGET_Y, TARGET_Z));

        // Jump once right after starting to move
        setTimeout(() => {
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 300); // jump for ~0.3s
          logger.info('[AutoFarm] Performed one jump');
        }, 500); // small delay so it starts moving first

      }, delayMs);
    }
  });
};