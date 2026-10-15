const { createModuleLogger } = require('./logger');
const logger = createModuleLogger('pet');

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12小时检测一次
const lastCheckMap = new Map(); // accountId -> timestamp

async function checkAndAutoPet(accountId) {
  if (!accountId) return;
  const now = Date.now();
  const lastCheck = lastCheckMap.get(accountId) || 0;
  if (now - lastCheck < CHECK_INTERVAL_MS) {
    return;
  }
  lastCheckMap.set(accountId, now);

  try {
    const store = require('../models/store');
    const autoCfg = store.getAutomation ? store.getAutomation(accountId) : {};
    const autoBuyFood = autoCfg.auto_buy_dog_food === true;
    const autoFeedDog = autoCfg.auto_feed_dog === true;

    if (!autoBuyFood && !autoFeedDog) return;

    const pets = require('./pets');
    const overview = await pets.getPetOverview();
    if (!overview || !overview.deployedId) return;

    const remainingSec = Number(overview.foodSeconds) || 0;
    const remainingHours = Math.floor(remainingSec / 3600);

    // 1. 自动喂食检查：守护时长不足24小时
    if (autoFeedDog && remainingSec < 24 * 3600) {
      const foods = Array.isArray(overview.foods) ? overview.foods : [];
      // 优先吃 1天狗粮(90004)，其次 3天(90005)，再 5天(90006)
      const availableFood = foods.find(f => f.count > 0 && f.id === 90004) ||
                            foods.find(f => f.count > 0 && f.id === 90005) ||
                            foods.find(f => f.count > 0 && f.id === 90006);

      if (availableFood) {
        await pets.feedDog(availableFood.id, 1);
        logger.info(`守护剩余不足24小时(当前${remainingHours}小时)，已自动喂食【${availableFood.name}】x1`);
      } else if (autoBuyFood) {
        // 背包没粮，触发自动买粮
        const mall = require('./mall');
        try {
          await mall.purchaseMallGoods(1006, 1); // 购买狗粮礼包
          logger.info(`背包狗粮已耗尽，已自动在商城购买【狗粮礼包】`);
          // 重新拉取背包再喂食
          const nextOverview = await pets.getPetOverview();
          const nextFoods = Array.isArray(nextOverview.foods) ? nextOverview.foods : [];
          const nextAvailable = nextFoods.find(f => f.count > 0);
          if (nextAvailable) {
            await pets.feedDog(nextAvailable.id, 1);
            logger.info(`已自动喂食新购【${nextAvailable.name}】x1`);
          }
        } catch (mallErr) {
          logger.warn(`自动买狗粮失败: ${mallErr.message}`);
        }
      }
    }
  } catch (err) {
    logger.warn(`12小时宠物守护巡查异常: ${err.message}`);
  }
}

module.exports = {
  checkAndAutoPet,
  resetPetPacing: (id) => lastCheckMap.delete(id)
};
