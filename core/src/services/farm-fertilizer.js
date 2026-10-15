const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { PlantPhase } = require('../config/config');
const { toNum, toTimeSec, getServerTimeSec, log, logWarn, randomDelay } = require('../utils/utils');
const { getAutomation } = require('../models/store');
const { recordOperation } = require('./stats');
const { getAllLands, fertilize, NORMAL_FERTILIZER_ID, ORGANIC_FERTILIZER_ID } = require('./farm-api');
const { getCurrentPhase } = require('./farm-land-analyzer');

// ─── 常量 ───

/** 全部可施肥土地类型 */
const ALL_FERTILIZER_LAND_TYPES = ['purple', 'gold', 'black', 'red', 'normal'];

/** 土地类型中文标签 */
const FERTILIZER_LAND_TYPE_LABELS = {
  purple: '紫土地',
  gold: '金土地',
  black: '黑土地',
  red: '红土地',
  normal: '普通土地'
};

// ─── 辅助函数 ───

function isTransientNetworkError(err) {
  const msg = String(err && err.message || '');
  if (!msg) return false;
  return [
    '连接未打开', '请求超时', '请求已中断',
    '连接关闭', '发送失败', '请求队列已满'
  ].some(pattern => msg.includes(pattern));
}

/**
 * 有机化肥循环施肥（逐块施肥直到失败）
 * @param {number[]} landIds - 地块 ID 列表
 * @returns {number} 成功施肥次数
 */
async function fertilizeOrganicLoop(landIds) {
  const ids = (Array.isArray(landIds) ? landIds : []).filter(Boolean);
  if (ids.length === 0) return 0;

  let successCount = 0;
  let index = 0;
  while (true) {
    const landId = ids[index];
    try {
      const payload = types.FertilizeRequest.encode(types.FertilizeRequest.create({
        land_ids: [toNum(landId)],
        fertilizer_id: toNum(ORGANIC_FERTILIZER_ID)
      })).finish();
      await sendMsgAsync('gamepb.plantpb.PlantService', 'Fertilize', payload);
      successCount++;
    } catch {
      break;
    }
    index = (index + 1) % ids.length;
    await randomDelay(200, 300);
  }
  return successCount;
}

/**
 * 从地块列表获取可施有机肥的目标
 * @param {Array} lands - 地块数据列表
 * @returns {number[]} 可施有机肥的地块 ID
 */
function getOrganicFertilizerTargetsFromLands(lands) {
  const list = Array.isArray(lands) ? lands : [];
  const targets = [];
  for (const land of list) {
    if (!land || !land.unlocked) continue;
    const landId = toNum(land.id);
    if (!landId) continue;

    const plant = land.plant;
    if (!plant || !plant.phases || plant.phases.length === 0) continue;

    const currentPhase = getCurrentPhase(plant.phases, false, '', plant.id);
    if (!currentPhase) continue;
    if (currentPhase.phase === PlantPhase.DEAD) continue;

    // 检查剩余有机肥次数
    if (Object.hasOwn(plant, 'left_inorc_fert_times')) {
      const remaining = toNum(plant.left_inorc_fert_times);
      if (remaining <= 0) continue;
    }
    targets.push(landId);
  }
  return targets;
}

/**
 * 获取即将成熟的地块（用于智能施肥）
 * @param {Array} lands - 地块数据
 * @param {number} thresholdSec - 距成熟时间阈值（秒），默认 3600（1小时）
 */
function getFastMatureLands(lands, thresholdSec = 3600) {
  const list = Array.isArray(lands) ? lands : [];
  const result = [];
  const serverTime = getServerTimeSec();
  const threshold = Math.max(0, toNum(thresholdSec) || 3600);

  for (const land of list) {
    if (!land || !land.unlocked) continue;
    const landId = toNum(land.id);
    if (!landId) continue;

    const plant = land.plant;
    if (!plant || !plant.phases || plant.phases.length === 0) continue;

    const currentPhase = getCurrentPhase(plant.phases, false, '', plant.id);
    if (!currentPhase) continue;
    if (currentPhase.phase === PlantPhase.DEAD) continue;
    if (currentPhase.phase === PlantPhase.MATURE) continue;

    // 查找成熟阶段
    const maturePhase = plant.phases
      .filter(p => p && toTimeSec(p.begin_time) > 0)
      .sort((left, right) => toTimeSec(right.begin_time) - toTimeSec(left.begin_time))[0];
    if (!maturePhase) continue;

    const matureTime = toTimeSec(maturePhase.begin_time);
    if (matureTime <= 0) continue;

    const remaining = matureTime - serverTime;
    if (remaining <= threshold && remaining >= 0) {
      // 检查剩余有机肥次数
      if (Object.hasOwn(plant, 'left_inorc_fert_times')) {
        const left = toNum(plant.left_inorc_fert_times);
        if (left <= 0) continue;
      }
      result.push(landId);
    }
  }
  return result;
}

/**
 * 获取处于成熟前最后一个生长阶段的地块（用于最终阶段施肥）
 * @param {Array} lands - 地块数据
 * @param {object} options - { organicOnly }
 * @returns {number[]} 最终阶段地块 ID
 */
function getFinalStageLands(lands, options = {}) {
  const list = Array.isArray(lands) ? lands : [];
  const result = [];
  const organicOnly = !!options.organicOnly;

  for (const land of list) {
    if (!land || !land.unlocked) continue;
    const landId = toNum(land.id);
    if (!landId) continue;

    const plant = land.plant;
    if (!plant || !Array.isArray(plant.phases) || plant.phases.length === 0) continue;

    const currentPhase = getCurrentPhase(plant.phases, false, '', plant.id);
    if (!currentPhase) continue;

    const currentPhaseValue = toNum(currentPhase.phase);
    if (currentPhaseValue === PlantPhase.DEAD) continue;
    if (currentPhaseValue === PlantPhase.MATURE) continue;

    const orderedPhases = plant.phases
      .map((phase, index) => ({
        phase,
        index,
        beginTime: toTimeSec(phase && phase.begin_time)
      }))
      .filter(item => item.beginTime > 0)
      .sort((a, b) => (a.beginTime - b.beginTime) || (a.index - b.index));

    const matureIndex = orderedPhases.findIndex(item => toNum(item.phase && item.phase.phase) === PlantPhase.MATURE);
    if (matureIndex <= 0) continue;

    const currentIndex = orderedPhases.findIndex(item => item.phase === currentPhase);
    if (currentIndex !== matureIndex - 1) continue;

    if (organicOnly && Object.hasOwn(plant, 'left_inorc_fert_times')) {
      const left = toNum(plant.left_inorc_fert_times);
      if (left <= 0) continue;
    }

    result.push(landId);
  }

  return result;
}

/** 根据等级获取土地类型 */
function getLandTypeByLevel(level) {
  const lv = toNum(level);
  if (lv === 5) return 'purple';   // 紫土地
  if (lv === 4) return 'gold';     // 金土地
  if (lv === 3) return 'black';    // 黑土地
  if (lv === 2) return 'red';      // 红土地
  return 'normal';
}

/** 标准化施肥土地类型列表 */
function normalizeFertilizerLandTypes(types) {
  const input = Array.isArray(types) ? types : ALL_FERTILIZER_LAND_TYPES;
  const result = [];
  for (const t of input) {
    const normalized = String(t || '').trim().toLowerCase();
    if (!ALL_FERTILIZER_LAND_TYPES.includes(normalized)) continue;
    if (result.includes(normalized)) continue;
    result.push(normalized);
  }
  return result;
}

/** 按土地类型过滤地块 ID */
function filterLandIdsByTypes(landIds, landTypeMap, allowedTypes) {
  const ids = Array.isArray(landIds) ? landIds : [];
  const typeSet = new Set(normalizeFertilizerLandTypes(allowedTypes));
  if (typeSet.size === 0) return [];
  if (typeSet.size === ALL_FERTILIZER_LAND_TYPES.length) return [...ids];

  const result = [];
  for (const landId of ids) {
    const landType = String(landTypeMap.get(landId) || '');
    if (!landType) continue;
    if (typeSet.has(landType)) result.push(landId);
  }
  return result;
}

/** 格式化土地类型为中文标签 */
function formatFertilizerLandTypes(types) {
  return normalizeFertilizerLandTypes(types).map(t => FERTILIZER_LAND_TYPE_LABELS[t] || t);
}

// ─── 核心施肥逻辑 ───

/**
 * 根据配置执行施肥
 * @param {number[]} explicitLandIds - 指定地块 ID（空数组则自动获取）
 * @param {object} options - { reason, skipNormal }
 * @returns {{ normal: number, organic: number }}
 */
async function runFertilizerByConfig(explicitLandIds = [], options = {}) {
  const automation = getAutomation() || {};
  const mode = automation.fertilizer || 'none';
  const reason = String(options.reason || '').trim().toLowerCase() === 'multi_season' ? 'multi_season' : 'normal';
  const label = reason === 'multi_season' ? '多季补肥' : '常规施肥';
  const eventLabel = reason === 'multi_season' ? '多季节施肥' : '常规施肥';
  const landTypes = normalizeFertilizerLandTypes(automation.fertilizer_land_types);
  const landTypeLabels = formatFertilizerLandTypes(landTypes);

  if (reason === 'multi_season' && mode === 'final_normal') {
    log('施肥', '多季补肥：当前策略为最终阶段普通肥，跳过本轮多季补肥', {
      module: 'farm', event: eventLabel, result: 'skip', reason, type: 'normal'
    });
    return { normal: 0, organic: 0 };
  }

  const explicitIds = [...new Set(
    (Array.isArray(explicitLandIds) ? explicitLandIds : [])
      .map(id => toNum(id))
      .filter(Boolean)
  )];

  // 没有选中土地类型 → 跳过
  if (landTypes.length === 0) {
    log('施肥', `${label}：未勾选施肥范围，跳过本轮施肥`, {
      module: 'farm', event: eventLabel, result: 'skip', reason, scope: 'none'
    });
    return { normal: 0, organic: 0 };
  }

  const { skipNormal = false } = options;

  // 没有指定地块且非有机模式 → 空返回
  if (explicitIds.length === 0 &&
      mode !== 'organic' && mode !== 'both' &&
      mode !== 'smart' && mode !== 'smart_only' && mode !== 'smart_normal' &&
      mode !== 'final_normal' && mode !== 'final_organic') {
    return { normal: 0, organic: 0 };
  }

  // 获取全农场土地信息构建类型映射
  let allLands = [];
  const landTypeMap = new Map();
  try {
    const landsReply = await getAllLands();
    allLands = Array.isArray(landsReply && landsReply.lands) ? landsReply.lands : [];
    for (const land of allLands) {
      if (!land) continue;
      const landId = toNum(land.id);
      if (!landId) continue;
      landTypeMap.set(landId, getLandTypeByLevel(land.level));
    }
  } catch (err) {
    if (!isTransientNetworkError(err)) {
      logWarn('施肥', `${label}：获取土地信息失败，按已知地块继续: ${err.message}`, {
        module: 'farm', event: eventLabel, result: 'error', reason
      });
    }
  }

  const isAllTypes = landTypes.length === ALL_FERTILIZER_LAND_TYPES.length;

  if (landTypeMap.size === 0 && !isAllTypes) {
    logWarn('施肥', `${label}：无法确认土地类型，已跳过本轮施肥`, {
      module: 'farm', event: eventLabel, result: 'skip', reason, landTypes
    });
    return { normal: 0, organic: 0 };
  }

  let targetIds = explicitIds;
  if (landTypeMap.size > 0) {
    targetIds = filterLandIdsByTypes(explicitIds, landTypeMap, landTypes);
  }

  let normalCount = 0;
  let organicCount = 0;

  // 普通化肥
  if (!skipNormal && (mode === 'normal' || mode === 'both' || mode === 'smart') && targetIds.length > 0) {
    normalCount = await fertilize(targetIds, NORMAL_FERTILIZER_ID);
    if (normalCount > 0) {
      log('施肥', `${label}：已为 ${normalCount}/${targetIds.length} 块地施普通化肥（范围: ${landTypeLabels.join('、')}）`, {
        module: 'farm', event: eventLabel, result: 'ok', reason, type: 'normal',
        count: normalCount, landTypes
      });
      recordOperation('fertilize', normalCount);
    }
  }

  // 有机化肥
  if (mode === 'organic' || mode === 'both') {
    let organicTargets = explicitIds;
    if (allLands.length > 0) {
      organicTargets = getOrganicFertilizerTargetsFromLands(allLands);
    }
    if (landTypeMap.size > 0) {
      organicTargets = filterLandIdsByTypes(organicTargets, landTypeMap, landTypes);
    }
    organicCount = await fertilizeOrganicLoop(organicTargets);
    if (organicCount > 0) {
      log('施肥', `${label}：有机化肥循环施肥完成，共施 ${organicCount} 次（范围: ${landTypeLabels.join('、')}）`, {
        module: 'farm', event: eventLabel, result: 'ok', reason, type: 'organic',
        count: organicCount, landTypes
      });
      recordOperation('fertilize', organicCount);
    }
  } else if (mode === 'smart' || mode === 'smart_only' || mode === 'smart_normal' ||
      mode === 'final_normal' || mode === 'final_organic') {
    // 智能/最终阶段施肥：寻找目标作物施肥
    let targetFertilizerLands = [];
    const isFinalStageMode = mode === 'final_normal' || mode === 'final_organic';
    const explicitIdSet = new Set(explicitIds);

    if (isFinalStageMode) {
      targetFertilizerLands = getFinalStageLands(allLands, { organicOnly: mode === 'final_organic' });
      if (explicitIdSet.size > 0) {
        targetFertilizerLands = targetFertilizerLands.filter(id => explicitIdSet.has(id));
      }
    } else {
      const smartSeconds = toNum(automation.fertilizer_smart_seconds) || 3600;

      try {
        const landsReply = await getAllLands();
        targetFertilizerLands = getFastMatureLands(landsReply && landsReply.lands, smartSeconds);
      } catch (err) {
        if (!isTransientNetworkError(err)) {
          logWarn('施肥', `获取全农场地块失败: ${err.message}`);
        }
      }
    }

    if (landTypeMap.size > 0) {
      targetFertilizerLands = filterLandIdsByTypes(targetFertilizerLands, landTypeMap, landTypes);
    }

    if (targetFertilizerLands.length > 0) {
      const useOrganic = mode === 'smart' || mode === 'smart_only' || mode === 'final_organic';
      const typeLabel = useOrganic ? '有机' : '普通';
      const fertId = useOrganic ? ORGANIC_FERTILIZER_ID : NORMAL_FERTILIZER_ID;
      const modeLabel = isFinalStageMode ? '最终阶段' : '快成熟';

      if (useOrganic) {
        organicCount = await fertilizeOrganicLoop(targetFertilizerLands);
      } else {
        normalCount = await fertilize(targetFertilizerLands, fertId);
      }

      const totalCount = useOrganic ? organicCount : normalCount;
      if (totalCount > 0) {
        log('施肥', `${typeLabel}化肥${modeLabel}施肥完成，共施 ${totalCount} 次（范围: ${landTypeLabels.join('、')}）`, {
          module: 'farm', event: '施肥', result: 'ok',
          type: useOrganic ? 'organic' : 'normal', count: totalCount
        });
        recordOperation('fertilize', totalCount);
      }
    }
  }

  return { normal: normalCount, organic: organicCount };
}

async function runManualFertilize() {
  log('施肥', '一键施肥开始', {
    module: 'farm', event: 'manual_fertilize', result: 'start'
  });
  try {
    const landsReply = await getAllLands();
    const lands = Array.isArray(landsReply && landsReply.lands) ? landsReply.lands : [];
    const landIds = lands
      .filter((land) => {
        if (!land || !land.unlocked || !land.plant || !Array.isArray(land.plant.phases)) {
          return false;
        }
        const currentPhase = getCurrentPhase(land.plant.phases, false, "", land.plant.id);
        return currentPhase &&
          currentPhase.phase !== PlantPhase.DEAD &&
          currentPhase.phase !== PlantPhase.MATURE;
      })
      .map(land => toNum(land.id))
      .filter(Boolean);

    log('施肥', `一键施肥：找到 ${landIds.length} 块可施肥土地`, {
      module: 'farm', event: 'manual_fertilize', result: 'targets', count: landIds.length
    });
    const result = await runFertilizerByConfig(landIds);
    log('施肥', `一键施肥完成：普通肥 ${result.normal} 次，有机肥 ${result.organic} 次`, {
      module: 'farm',
      event: 'manual_fertilize',
      result: 'ok',
      normal: result.normal,
      organic: result.organic
    });
    return result;
  } catch (error) {
    logWarn('施肥', `一键施肥失败：${error.message}`, {
      module: 'farm', event: 'manual_fertilize', result: 'error'
    });
    throw error;
  }
}

async function runManualOrganicFertilize() {
  log('施肥', '一键有机开始', {
    module: 'farm', event: 'manual_organic_fertilize', result: 'start'
  });
  try {
    const landsReply = await getAllLands();
    const lands = Array.isArray(landsReply && landsReply.lands) ? landsReply.lands : [];
    const automation = getAutomation() || {};
    const landTypes = normalizeFertilizerLandTypes(automation.fertilizer_land_types);
    const landTypeLabels = formatFertilizerLandTypes(landTypes);
    const landTypeMap = new Map(
      lands
        .filter(land => land && toNum(land.id))
        .map(land => [toNum(land.id), getLandTypeByLevel(land.level)])
    );
    const targets = filterLandIdsByTypes(
      getOrganicFertilizerTargetsFromLands(lands),
      landTypeMap,
      landTypes
    );

    log('施肥', `一键有机：找到 ${targets.length} 块可施有机肥土地`, {
      module: 'farm', event: 'manual_organic_fertilize', result: 'targets', count: targets.length,
      landTypes
    });
    const count = await fertilizeOrganicLoop(targets);
    if (count > 0) {
      recordOperation('fertilize', count);
    }
    log('施肥', `一键有机完成：有机肥 ${count} 次（范围: ${landTypeLabels.join('、') || '无'}）`, {
      module: 'farm',
      event: 'manual_organic_fertilize',
      result: 'ok',
      count,
      landTypes
    });
    return { organic: count };
  } catch (error) {
    logWarn('施肥', `一键有机失败：${error.message}`, {
      module: 'farm', event: 'manual_organic_fertilize', result: 'error'
    });
    throw error;
  }
}

module.exports = {
  ALL_FERTILIZER_LAND_TYPES,
  FERTILIZER_LAND_TYPE_LABELS,
  runManualFertilize,
  runManualOrganicFertilize,
  runFertilizerByConfig
};
