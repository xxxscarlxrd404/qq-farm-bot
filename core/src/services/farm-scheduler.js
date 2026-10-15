/**
 * 农场调度辅助模块
 * 负责化肥自动购买检测定时器
 */
const { log, logWarn } = require('../utils/utils');
const {
  isAutomationOn,
  getFertilizerBuyOrganicCount,
  getFertilizerBuyOrganicThresholdHours,
  getFertilizerBuyNormalCount,
  getFertilizerBuyNormalThresholdHours,
  getFertilizerBuyCheckIntervalMinutes
} = require('../models/store');
const { checkAndBuyFertilizerBoth } = require('./mall');
const { createScheduler } = require('./scheduler');
const { checkAndAutoPet } = require('./auto-pet');

const fertilizerScheduler = createScheduler('fertilizer_buy');

/** 启动化肥与宠物自动巡查检测定时器 */
function startFertilizerBuyCheckTimer() {
  fertilizerScheduler.clear('check');

  const hasFertilizer = isAutomationOn('fertilizer_buy_organic') || isAutomationOn('fertilizer_buy_normal');
  const hasPet = isAutomationOn('auto_buy_dog_food') || isAutomationOn('auto_feed_dog');

  if (!hasFertilizer && !hasPet) return;

  const intervalMinutes = hasFertilizer ? getFertilizerBuyCheckIntervalMinutes() : 30;
  const intervalMs = intervalMinutes * 60 * 1000;

  fertilizerScheduler.setIntervalTask('check', intervalMs, checkFertilizerBuyOnce, {
    preventOverlap: true
  });

  log('农场', `化肥自动购买检测定时器已启动，间隔 ${intervalMinutes} 分钟`, {
    module: 'farm',
    event: '购买化肥计时器',
    result: 'start',
    intervalMinutes
  });
}

/** 停止化肥自动购买检测定时器 */
function stopFertilizerBuyCheckTimer() {
  fertilizerScheduler.clear('check');
  log('农场', '化肥自动购买检测定时器已停止', {
    module: 'farm',
    event: '购买化肥计时器',
    result: 'stop'
  });
}

/** 执行一次化肥购买检测 */
async function checkFertilizerBuyOnce() {
  const currentAccountId = process.env.FARM_ACCOUNT_ID || '';
  if (currentAccountId) {
    checkAndAutoPet(currentAccountId).catch(() => null);
  }
  if (!isAutomationOn('fertilizer_buy_organic') && !isAutomationOn('fertilizer_buy_normal')) return;

  try {
    const config = {
      buyOrganic: isAutomationOn('fertilizer_buy_organic'),
      buyNormal: isAutomationOn('fertilizer_buy_normal'),
      organicCount: getFertilizerBuyOrganicCount(),
      organicThresholdHours: getFertilizerBuyOrganicThresholdHours(),
      normalCount: getFertilizerBuyNormalCount(),
      normalThresholdHours: getFertilizerBuyNormalThresholdHours()
    };
    await checkAndBuyFertilizerBoth(config);
  } catch (err) {
    logWarn('农场', `化肥自动购买检测失败: ${err.message}`, {
      module: 'farm',
      event: 'fertilizer_auto_buy',
      result: 'error',
      error: err.message
    });
  }
}

module.exports = {
  startFertilizerBuyCheckTimer,
  stopFertilizerBuyCheckTimer
};
