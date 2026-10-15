const { PlantPhase } = require('../config/config');
const { getCapitalMode } = require('../models/store');
const { getServerTimeSec, log, toNum, toTimeSec } = require('../utils/utils');
const { createScheduler } = require('./scheduler');
const { deployDog, getPetOverview, withdrawDog } = require('./pets');

const scheduler = createScheduler('capital-mode');
const state = { phase: 'idle', autoDogId: 0, lastAttemptAt: 0 };

function findNearestMatureSeconds(lands, analysis) {
  if (analysis && Array.isArray(analysis.harvestable) && analysis.harvestable.length) return 0;
  const now = getServerTimeSec();
  let nearest = Infinity;
  for (const land of Array.isArray(lands) ? lands : []) {
    const phases = Array.isArray(land && land.plant && land.plant.phases) ? land.plant.phases : [];
    const mature = phases.find(phase => toNum(phase && phase.phase) === PlantPhase.MATURE);
    const at = toTimeSec(mature && mature.begin_time);
    if (at > now) nearest = Math.min(nearest, at - now);
  }
  return Number.isFinite(nearest) ? nearest : null;
}

function clearOwnership() {
  scheduler.clear('withdraw_after_harvest');
  scheduler.clear('withdraw_safety');
  state.phase = 'idle';
  state.autoDogId = 0;
}

function releaseForManualCommand() { clearOwnership(); }

async function prepareForFarmOperation({ lands, analysis, opType }) {
  if (opType !== 'all') return false;
  const config = getCapitalMode();
  if (!config.enabled || !config.dogId || state.phase !== 'idle') return false;
  const matureIn = findNearestMatureSeconds(lands, analysis);
  if (matureIn === null || matureIn > config.leadSeconds || Date.now() - state.lastAttemptAt < 5000) return false;
  state.lastAttemptAt = Date.now();
  state.phase = 'deploying';
  try {
    const overview = await getPetOverview();
    if (overview.deployedId) { state.phase = 'idle'; return false; }
    const dog = overview.dogs.find(item => item.id === config.dogId && item.owned);
    if (!dog) { state.phase = 'idle'; return false; }
    await deployDog(config.dogId);
    state.autoDogId = config.dogId;
    state.phase = 'deployed';
    scheduler.setTimeoutTask('withdraw_safety', 120000, async () => {
      if (!state.autoDogId || state.phase !== 'deployed') return;
      const dogId = state.autoDogId;
      state.phase = 'withdrawing';
      try {
        const latest = await getPetOverview();
        if (latest.deployedId === dogId) await withdrawDog();
      } catch (error) {
        log('宠物', `资本模式安全召回失败: ${error.message}`, { module: 'pet', event: '资本模式召回', result: 'error', dogId });
      } finally { clearOwnership(); }
    });
    log('宠物', `资本模式已派出${dog.name}`, { module: 'pet', event: '资本模式派出', result: 'ok', matureIn });
    return true;
  } catch (error) {
    clearOwnership();
    log('宠物', `资本模式派出失败: ${error.message}`, { module: 'pet', event: '资本模式派出', result: 'error' });
    return false;
  }
}

function handleFarmHarvested() {
  if (!state.autoDogId || state.phase !== 'deployed') return;
  scheduler.setTimeoutTask('withdraw_after_harvest', 5000, async () => {
    const dogId = state.autoDogId;
    state.phase = 'withdrawing';
    try {
      const overview = await getPetOverview();
      if (overview.deployedId === dogId) await withdrawDog();
      log('宠物', '资本模式已在收获后召回宠物', { module: 'pet', event: '资本模式召回', result: 'ok', dogId });
    } catch (error) {
      log('宠物', `资本模式召回失败: ${error.message}`, { module: 'pet', event: '资本模式召回', result: 'error', dogId });
    } finally { clearOwnership(); }
  });
}

async function reconcileConfigChange(previous, next) {
  if (!state.autoDogId || (next.enabled === true && Number(next.dogId) === state.autoDogId)) return;
  try {
    const overview = await getPetOverview();
    if (overview.deployedId === state.autoDogId) await withdrawDog();
  } finally { clearOwnership(); }
}

module.exports = { findNearestMatureSeconds, prepareForFarmOperation, handleFarmHarvested, reconcileConfigChange, releaseForManualCommand, _state: state };
