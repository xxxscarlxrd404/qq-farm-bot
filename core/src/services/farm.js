/**
 * 农场服务聚合模块（Barrel）
 * 统一导出所有子模块的公开 API
 */
const farmApi = require('./farm-api');
const { getCurrentPhase, buildLandMap, getDisplayLandContext, isOccupiedSlaveLand, getLandsDetail } = require('./farm-land-analyzer');
const { runManualFertilize, runManualOrganicFertilize, runFertilizerByConfig } = require('./farm-fertilizer');
const { getAvailableSeeds } = require('./planting-service');
const { checkFarm, startFarmCheckLoop, stopFarmCheckLoop, refreshFarmCheckLoop, runFarmOperation } = require('./farming-orchestrator');

module.exports = {
  // 巡田
  checkFarm,
  startFarmCheckLoop,
  stopFarmCheckLoop,
  refreshFarmCheckLoop,
  runFarmOperation,

  // 土地分析
  getCurrentPhase,
  getLandsDetail,
  buildLandMap,
  getDisplayLandContext,
  isOccupiedSlaveLand,

  // 种子/商店
  getAvailableSeeds,
  getShopInfo: farmApi.getShopInfo,
  buyGoods: farmApi.buyGoods,

  // 操作
  setOperationLimitsCallback: farmApi.setOperationLimitsCallback,
  runManualFertilize,
  runManualOrganicFertilize,
  runFertilizerByConfig,
  farming: farmApi.farming,
  NORMAL_FERTILIZER_ID: farmApi.NORMAL_FERTILIZER_ID,
  ORGANIC_FERTILIZER_ID: farmApi.ORGANIC_FERTILIZER_ID,
  fertilize: farmApi.fertilize,
  removePlant: farmApi.removePlant
};
