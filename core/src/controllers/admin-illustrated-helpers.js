const {
  getFruitLayerByFruitId,
  getItemById,
  getItemImageById,
  getPlantByFruitId,
} = require("../config/gameConfig");
const { getNongmeSeedImageUrl } = require("../services/nongme-plant-data");
const { toNum } = require("../utils/utils");

const SEED_SHOP_TYPE = 2;
const SEED_SHOP_WARNING_INTERVAL_MS = 10 * 60 * 1000;
const seedShopWarningTimes = new Map();

function getUserLevel(provider, accountId) {
  const status = provider.getStatus(accountId);
  return status?.status?.level || 0;
}

async function getSeedShopGoodsMap({
  provider,
  accountId,
  adminLogger,
  tolerateFailure = false,
}) {
  try {
    const shopInfo = await provider.getShopInfo(accountId, SEED_SHOP_TYPE);
    const goodsList = shopInfo?.goods_list || [];
    const seedGoodsMap = new Map();

    for (const goods of goodsList) {
      const itemId = toNum(goods.item_id) || 0;
      const goodsId = toNum(goods.id) || 0;
      const price = toNum(goods.price) || 0;

      if (itemId > 0 && goodsId > 0) {
        seedGoodsMap.set(itemId, {
          goodsId,
          price,
        });
      }
    }

    seedShopWarningTimes.delete(String(accountId));
    return seedGoodsMap;
  } catch (err) {
    if (!tolerateFailure) throw err;

    const key = String(accountId);
    const now = Date.now();
    const lastWarning = seedShopWarningTimes.get(key);
    if (lastWarning === undefined || now - lastWarning >= SEED_SHOP_WARNING_INTERVAL_MS) {
      adminLogger.warn("图鉴可购买判断暂不可用", {
        accountId,
        error: err.message,
      });
      seedShopWarningTimes.set(key, now);
    }
    return new Map();
  }
}

function getPlantSeedInfo(fruitId, nongmePlant) {
  const plant = getPlantByFruitId(fruitId);
  const seedId = plant?.seed_id || nongmePlant?.seed_id || 0;
  const seedLevel =
    (seedId > 0 ? getItemById(seedId)?.level || 0 : 0) ||
    toNum(nongmePlant?.level) ||
    0;

  return {
    seedId,
    seedLevel,
  };
}

function buildIllustratedItem(
  rawItem,
  { seedGoodsMap, userLevel, nongmeFruitMap },
) {
  const fruitId = toNum(rawItem.seed_id) || 0;
  const fruitConfig = getItemById(fruitId);
  const nongmePlant = nongmeFruitMap?.get(fruitId);
  const { seedId, seedLevel } = getPlantSeedInfo(fruitId, nongmePlant);
  const unlocked = !!rawItem.unlocked;
  const seedGoods = seedGoodsMap.get(seedId);
  const goodsId = seedGoods?.goodsId || 0;
  const price = seedGoods?.price || 0;
  const canBuy =
    !unlocked &&
    seedId > 0 &&
    seedLevel > 0 &&
    userLevel >= seedLevel &&
    !!seedGoods;
  const rawGuaranteeInfo = rawItem.guarantee_info ?? rawItem.guaranteeInfo;
  const wishProgress = rawGuaranteeInfo
    ? {
        type: toNum(rawGuaranteeInfo.progress_type ?? rawGuaranteeInfo.progressType) || 0,
        current: toNum(rawGuaranteeInfo.current) || 0,
        total: toNum(rawGuaranteeInfo.total) || 0,
      }
    : null;

  return {
    seedId: fruitId,
    illustratedTier: toNum(rawItem.illustrated_tier ?? rawItem.illustratedTier) || 0,
    unlocked,
    plantedCount: toNum(rawItem.planted_count) || 0,
    harvestCount: toNum(rawItem.harvest_count) || 0,
    wishProgress: wishProgress?.total > 0 ? wishProgress : null,
    name: fruitConfig?.name || nongmePlant?.name || `果实${  fruitId}`,
    image: getItemImageById(fruitId) || getNongmeSeedImageUrl(seedId),
    level: Number(fruitConfig?.level) || Number(nongmePlant?.level) || 0,
    layer: getFruitLayerByFruitId(fruitId),
    canBuy,
    goodsId,
    price,
    seedLevel,
  };
}

function sortIllustratedItems(items) {
  return [...(items || [])].sort((left, right) => {
    const tierDiff =
      (toNum(left.illustratedTier) || Number.MAX_SAFE_INTEGER) -
      (toNum(right.illustratedTier) || Number.MAX_SAFE_INTEGER);
    if (tierDiff !== 0) return tierDiff;
    return (toNum(left.seedId) || 0) - (toNum(right.seedId) || 0);
  });
}

function summarizeIllustratedItems(items) {
  return {
    total: items.length,
    unlocked: items.filter(item => item.unlocked).length,
    locked: items.filter(item => !item.unlocked).length,
    canBuy: items.filter(item => item.canBuy).length,
  };
}

function collectBuyableIllustratedItems(
  rawItems,
  { seedGoodsMap, userLevel, nongmeFruitMap },
) {
  const buyableItems = [];

  for (const rawItem of rawItems || []) {
    const fruitId = toNum(rawItem.seed_id) || 0;
    if (rawItem.unlocked) continue;

    const nongmePlant = nongmeFruitMap?.get(fruitId);
    const { seedId, seedLevel } = getPlantSeedInfo(fruitId, nongmePlant);
    if (seedId <= 0 || seedLevel <= 0 || userLevel < seedLevel) continue;

    const seedGoods = seedGoodsMap.get(seedId);
    if (!seedGoods) continue;

    buyableItems.push({
      fruitId,
      seedId,
      goodsId: seedGoods.goodsId,
      price: seedGoods.price,
      name: getItemById(fruitId)?.name || nongmePlant?.name || `果实${  fruitId}`,
    });
  }

  return buyableItems;
}

module.exports = {
  collectBuyableIllustratedItems,
  getSeedShopGoodsMap,
  getUserLevel,
  buildIllustratedItem,
  sortIllustratedItems,
  summarizeIllustratedItems,
};
