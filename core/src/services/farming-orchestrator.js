const { CONFIG } = require('../config/config');
const { getUserState, isConnected, networkEvents } = require('../utils/network');
const { toNum, log, logWarn, randomDelay } = require('../utils/utils');
const { isAutomationOn, getAutomation, getPrioritize2x2Crops } = require('../models/store');
const { recordOperation } = require('./stats');
const { createScheduler } = require('./scheduler');
const { getAllLands, harvest, farming, unlockLand, upgradeLand } = require('./farm-api');
const { analyzeLands, resolveRemovableHarvestedLands } = require('./farm-land-analyzer');
const { runFertilizerByConfig } = require('./farm-fertilizer');
const { autoPlantEmptyLands } = require('./planting-service');
const { startFertilizerBuyCheckTimer, stopFertilizerBuyCheckTimer } = require('./farm-scheduler');

// ─── 状态标记 ───

let isCheckingFarm = false;
let isFirstFarmCheck = true;
let farmLoopRunning = false;
let externalSchedulerMode = false;
let lastPushTime = 0;
let shouldRefresh2x2Plan = true;

const farmScheduler = createScheduler('farm');

// ─── 辅助函数 ───

/** 判断是否为临时性网络错误 */
function isTransientNetworkError(err) {
  const msg = String(err && err.message || '');
  if (!msg) return false;
  return [
    '连接未打开', '请求超时', '请求已中断',
    '连接关闭', '发送失败', '请求队列已满'
  ].some(pattern => msg.includes(pattern));
}

// ─── 核心巡田逻辑 ───

/**
 * 检查并执行农场操作
 * @returns {boolean} 是否有需要执行的操作
 */
async function checkFarm() {
  const userState = getUserState();
  if (isCheckingFarm || !userState.gid || !isAutomationOn('farm') || !isConnected()) {
    return false;
  }

  isCheckingFarm = true;
  try {
    const result = await runFarmOperation('all');
    isFirstFarmCheck = false;
    return !!(result && result.hadWork);
  } catch (err) {
    if (!isTransientNetworkError(err)) {
      logWarn('巡田', `检查失败: ${err.message}`);
    }
    return false;
  } finally {
    isCheckingFarm = false;
  }
}

/**
 * 执行农场操作
 * @param {string} opType - 操作类型：'all' | 'harvest' | 'plant' | 'clear' | 'upgrade'
 */
async function runFarmOperation(opType) {
  const landsReply = await getAllLands();
  if (!landsReply.lands || landsReply.lands.length === 0) {
    if (opType !== 'all') log('农场', '没有土地数据');
    return { hadWork: false, actions: [] };
  }

  const lands = landsReply.lands;
  const analysis = analyzeLands(lands, isFirstFarmCheck);
  await require('./capital-mode').prepareForFarmOperation({ lands, analysis, opType });
  const labels = [];

  // 构建状态标签
  if (analysis.growing.length) labels.push(`作物:${analysis.growing.length}`);
  if (analysis.harvestable.length) labels.push(`待收:${analysis.harvestable.length}`);
  if (analysis.needWeed.length) labels.push(`长草:${analysis.needWeed.length}`);
  if (analysis.needBug.length) labels.push(`有虫:${analysis.needBug.length}`);
  if (analysis.needGoldenBug.length) labels.push(`黄金虫:${analysis.needGoldenBug.length}`);
  if (analysis.needWater.length) labels.push(`缺水:${analysis.needWater.length}`);
  if (analysis.dead.length) labels.push(`枯萎:${analysis.dead.length}`);
  if (analysis.empty.length) labels.push(`空地:${analysis.empty.length}`);
  if (analysis.unlockable.length) labels.push(`可解锁:${analysis.unlockable.length}`);
  if (analysis.upgradable.length) labels.push(`可升级:${analysis.upgradable.length}`);

  const actions = [];

  // ── 一键务农（浇水/除草/除虫）──
  if (opType === 'all' || opType === 'clear') {
    const skipOwnWeedBug = opType === 'all' && isAutomationOn('skip_own_weed_bug');
    const ordinaryLandIds = skipOwnWeedBug
      ? [...analysis.needWater]
      : [...analysis.needWeed, ...analysis.needBug, ...analysis.needWater];
    const goldenBugLandIds = isAutomationOn('golden_bug_clear')
      ? analysis.needGoldenBug
      : [];
    const farmingLandIds = [...new Set([...ordinaryLandIds, ...goldenBugLandIds])];

    if (farmingLandIds.length > 0) {
      try {
        await farming(farmingLandIds);
        const parts = [];
        if (!skipOwnWeedBug && analysis.needWeed.length > 0) {
          parts.push(`除草${analysis.needWeed.length}`);
          recordOperation('weed', analysis.needWeed.length);
        }
        if (!skipOwnWeedBug && analysis.needBug.length > 0) {
          parts.push(`杀虫${analysis.needBug.length}`);
          recordOperation('bug', analysis.needBug.length);
        }
        if (analysis.needWater.length > 0) {
          parts.push(`浇水${analysis.needWater.length}`);
          recordOperation('water', analysis.needWater.length);
        }
        if (goldenBugLandIds.length > 0) {
          parts.push(`清黄金虫${goldenBugLandIds.length}`);
          recordOperation('goldenBugClear', goldenBugLandIds.length);
        }
        actions.push(parts.length > 0 ? `一键务农:${parts.join('/')}` : '一键务农');
        recordOperation('farming', farmingLandIds.length);
      } catch (err) { logWarn('一键务农', err.message); }
    }
  }

  // ── 收获 ──
  let harvestedLands = [];
  let harvestResult = null;
  let removeResult = null;

  if (opType === 'all' || opType === 'harvest') {
    if (analysis.harvestable.length > 0) {
      try {
        harvestResult = await harvest(analysis.harvestable);
        log('收获', `收获完成 ${analysis.harvestable.length} 块土地`, {
          module: 'farm', event: '收获作物', result: 'ok',
          count: analysis.harvestable.length, landIds: [...analysis.harvestable]
        });
        actions.push(`收获${  analysis.harvestable.length}`);
        recordOperation('harvest', analysis.harvestable.length);
        harvestedLands = [...analysis.harvestable];

        networkEvents.emit('farmHarvested', {
          count: analysis.harvestable.length,
          landIds: [...analysis.harvestable],
          opType
        });
        require('./capital-mode').handleFarmHarvested();
      } catch (err) {
        logWarn('收获', err.message, { module: 'farm', event: '收获作物', result: 'error' });
      }
    }
  }

  // ── 种植 ──
  if (opType === 'all' || opType === 'plant') {
    const emptyLands = [...new Set(analysis.empty)];
    let deadLands = [...new Set(analysis.dead)];

    // 收获后检查可铲除的地块
    if (opType === 'all' && harvestedLands.length > 0) {
      await randomDelay(200, 800);
      removeResult = await resolveRemovableHarvestedLands(harvestedLands, harvestResult);
      deadLands = [...new Set([...deadLands, ...removeResult.removable])];
    }

    const shouldRefresh2x2 = shouldRefresh2x2Plan && getPrioritize2x2Crops();
    if (deadLands.length > 0 || emptyLands.length > 0 || shouldRefresh2x2) {
      try {
        const plantResult = await autoPlantEmptyLands(deadLands, emptyLands, lands);
        const removedCount = Number(plantResult && plantResult.removedCount) || 0;
        const plantedCount = Number(plantResult && (plantResult.occupiedCount || plantResult.plantedCount)) || 0;
        if (removedCount > 0) {
          actions.push(`铲除${  removedCount}`);
        }
        if (plantedCount > 0) {
          actions.push(`种植${  plantedCount}`);
          recordOperation('plant', plantedCount);
        }
      } catch (err) {
        logWarn('种植', err.message);
      } finally {
        shouldRefresh2x2Plan = false;
      }
    }
  }

  // ── 多季作物补肥 ──
  if (opType === 'all' && removeResult && Array.isArray(removeResult.growing) &&
      removeResult.growing.length > 0 && isAutomationOn('fertilizer_multi_season') &&
      (getAutomation().fertilizer || 'none') !== 'final_normal') {
    const multiSeasonLands = [...new Set(
      removeResult.growing.map(id => toNum(id)).filter(Boolean)
    )];
    if (multiSeasonLands.length > 0) {
      log('施肥', `检测到多季作物进入后续季，准备执行多季补肥，目标地块 ${multiSeasonLands.length} 块`, {
        module: 'farm', event: '多季节施肥', result: 'trigger',
        count: multiSeasonLands.length, landIds: multiSeasonLands
      });
      try {
        await runFertilizerByConfig(multiSeasonLands, { reason: 'multi_season' });
      } catch (err) {
        logWarn('施肥', `多季补肥执行失败: ${err.message}`, {
          module: 'farm', event: '多季节施肥', result: 'error'
        });
      }
    }
  }

  // ── 土地升级/解锁 ──
  const shouldUpgrade = opType === 'all' && isAutomationOn('land_upgrade');
  if (shouldUpgrade || opType === 'upgrade') {
    // 解锁土地
    if (analysis.unlockable.length > 0) {
      let unlockedCount = 0;
      for (const landId of analysis.unlockable) {
        try {
          await unlockLand(landId, false);
          log('解锁', `土地#${landId} 解锁成功`, {
            module: 'farm', event: '解锁土地', result: 'ok', landId
          });
          unlockedCount++;
        } catch (err) {
          logWarn('解锁', `土地#${landId} 解锁失败: ${err.message}`, {
            module: 'farm', event: '解锁土地', result: 'error', landId
          });
        }
        await randomDelay(200, 500);
      }
      if (unlockedCount > 0) actions.push(`解锁${  unlockedCount}`);
    }

    // 升级土地
    if (analysis.upgradable.length > 0) {
      let upgradedCount = 0;
      for (const landId of analysis.upgradable) {
        try {
          const result = await upgradeLand(landId);
          const newLevel = result.land ? toNum(result.land.level) : '?';
          log('升级', `土地#${landId} 升级成功 → 等级${newLevel}`, {
            module: 'farm', event: '升级土地', result: 'ok', landId, level: newLevel
          });
          upgradedCount++;
        } catch (err) {
          log('升级', `土地#${landId} 升级失败: ${err.message}`, {
            module: 'farm', event: '升级土地', result: 'error', landId
          });
        }
        await randomDelay(200, 500);
      }
      if (upgradedCount > 0) {
        actions.push(`升级${  upgradedCount}`);
        recordOperation('upgrade', upgradedCount);
      }
    }
  }

  // ── 智能施肥（巡田时触发）──
  if (opType === 'all') {
    const fertilizerMode = getAutomation().fertilizer || 'none';
    if (fertilizerMode === 'smart' || fertilizerMode === 'smart_only' || fertilizerMode === 'smart_normal' ||
        fertilizerMode === 'final_normal' || fertilizerMode === 'final_organic') {
      try {
        const fertResult = await runFertilizerByConfig([], { skipNormal: true });
        if (fertResult.organic > 0) actions.push(`有机肥${  fertResult.organic}`);
        else if (fertResult.normal > 0) actions.push(`普通肥${  fertResult.normal}`);
      } catch (err) {
        logWarn('施肥', `巡田时施肥失败: ${err.message}`);
      }
    }
  }

  // ── 日志输出 ──
  const summary = actions.length > 0 ? ` → ${actions.join('/')}` : '';
  if (actions.length > 0) {
    log('农场', `[${labels.join(' ')}]${summary}`, {
      module: 'farm', event: '农场循环', opType, actions
    });
  }

  return { hadWork: actions.length > 0, actions };
}

// ── 定时巡田循环 ──

function scheduleNextFarmCheck(intervalMs = CONFIG.farmCheckInterval) {
  if (externalSchedulerMode) return;
  if (!farmLoopRunning) return;
  farmScheduler.setTimeoutTask('farm_check_loop', Math.max(0, intervalMs), async () => {
    if (!farmLoopRunning) return;
    await checkFarm();
    if (!farmLoopRunning) return;
    scheduleNextFarmCheck(CONFIG.farmCheckInterval);
  });
}

function startFarmCheckLoop(options = {}) {
  if (farmLoopRunning) return;
  externalSchedulerMode = !!options.externalScheduler;
  farmLoopRunning = true;
  shouldRefresh2x2Plan = true;
  networkEvents.on('landsChanged', onLandsChangedPush);
  if (!externalSchedulerMode) scheduleNextFarmCheck(1000); // 1 秒后首次检查
  startFertilizerBuyCheckTimer();
}

/** 收到地块变化推送时的响应 */
function onLandsChangedPush(lands) {
  if (!isAutomationOn('farm_push')) return;
  shouldRefresh2x2Plan = true;
  if (isCheckingFarm) return;
  const now = Date.now();
  if (now - lastPushTime < 500) return; // 500ms 去抖
  lastPushTime = now;
  log('农场', `收到推送: ${lands.length}块土地变化，检查中...`, {
    module: 'farm', event: '土地推送通知', result: 'trigger_check', count: lands.length
  });
  farmScheduler.setTimeoutTask('farm_push_check', 1000, async () => {
    if (!isCheckingFarm) await checkFarm();
  });
}

function stopFarmCheckLoop() {
  farmLoopRunning = false;
  externalSchedulerMode = false;
  farmScheduler.clearAll();
  networkEvents.removeListener('landsChanged', onLandsChangedPush);
  stopFertilizerBuyCheckTimer();
}

function refreshFarmCheckLoop(delayMs = 0) {
  if (!farmLoopRunning) return;
  shouldRefresh2x2Plan = true;
  scheduleNextFarmCheck(delayMs);
}

module.exports = {
  checkFarm,
  runFarmOperation,
  startFarmCheckLoop,
  stopFarmCheckLoop,
  refreshFarmCheckLoop
};
