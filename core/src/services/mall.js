/**
 * 商城服务 - 化肥购买、免费礼包领取
 *
 * 功能：
 * - 获取商城商品列表
 * - 购买商品（含价格/限购解析）
 * - 自动购买有机/无机化肥（按余额自适应）
 * - 每日免费礼包领取
 * - 根据化肥容器剩余时间阈值自动补货
 */
const { Buffer } = require('node:buffer');
const { sendMsgAsync, getUserState } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum, log, sleep } = require('../utils/utils');

// ---- 商品 ID 常量 ----

const ORGANIC_FERTILIZER_MALL_GOODS_ID = 1002;   // 有机化肥
const INORGANIC_FERTILIZER_MALL_GOODS_ID = 1003;  // 无机化肥

// 两次购买最小间隔：10分钟
const BUY_COOLDOWN_MS = 10 * 60 * 1000;

// 购买轮次：100轮（防止无限循环）
const MAX_ROUNDS = 100;

// 每轮购买数量：10个
const BUY_PER_ROUND = 10;

// 每日免费礼包 Key
const FREE_GIFTS_DAILY_KEY = 'mall_free_gifts';

// ---- 状态追踪 ----

let lastBuyAt = 0;
let buyDoneDateKey = '';
let buyLastSuccessAt = 0;
let buyPausedNoGoldDateKey = '';

let freeGiftDoneDateKey = '';
let freeGiftLastAt = 0;
let freeGiftLastCheckAt = 0;

// ---- 日期工具 ----

function getDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ---- RPC 调用 ----

async function getMallListBySlotType(slotType = 1) {
  const request = types.GetMallListBySlotTypeRequest.encode(
    types.GetMallListBySlotTypeRequest.create({ slot_type: Number(slotType) || 1 })
  ).finish();
  const { body } = await sendMsgAsync('gamepb.mallpb.MallService', 'GetMallListBySlotType', request);
  return types.GetMallListBySlotTypeResponse.decode(body);
}

async function purchaseMallGoods(goodsId, count = 1) {
  const request = types.PurchaseRequest.encode(
    types.PurchaseRequest.create({
      goods_id: Number(goodsId) || 0,
      count: Number(count) || 1,
    })
  ).finish();
  const { body } = await sendMsgAsync('gamepb.mallpb.MallService', 'Purchase', request);
  return types.PurchaseResponse.decode(body);
}

/**
 * 获取指定槽位的商品列表
 */
async function getMallGoodsList(slotType = 1) {
  const reply = await getMallListBySlotType(slotType);
  const rawList = Array.isArray(reply && reply.goods_list) ? reply.goods_list : [];
  const goodsList = [];
  for (const raw of rawList) {
    try {
      goodsList.push(types.MallGoods.decode(raw));
    } catch {
      // 跳过解码失败的
    }
  }
  return goodsList;
}

// ---- 字节解析工具 ----

function bytesToBuffer(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array || (value.constructor && value.constructor.name === 'Uint8Array')) {
    return Buffer.from(value);
  }
  if (Array.isArray(value)) return Buffer.from(value);
  if (value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
  if (typeof value === 'object') {
    const numKeys = Object.keys(value).filter((k) => /^\d+$/.test(k));
    numKeys.sort((a, b) => Number(a) - Number(b));
    if (numKeys.length === 0) return null;
    return Buffer.from(numKeys.map((k) => value[k]));
  }
  return null;
}

/** 解析 corepb.Item；管理进程无需初始化账号工作进程的 types。 */
function parseMallRewardItem(raw) {
  const buffer = bytesToBuffer(raw);
  if (!buffer?.length) return null;
  try {
    const reader = require('protobufjs').Reader.create(buffer);
    let itemId = 0;
    let count = 0;
    while (reader.pos < reader.len) {
      const tag = reader.uint32();
      if (tag === 8) itemId = toNum(reader.int64());
      else if (tag === 16) count = toNum(reader.int64());
      else reader.skipType(tag & 7);
    }
    return itemId > 0 ? { itemId, count } : null;
  } catch {
    return null;
  }
}

/**
 * 解析商城价格字段（corepb.Item: field 1 为货币 ID，field 2 为数量）
 */
function parseMallPriceInfo(raw) {
  const empty = { currencyId: 0, price: 0 };
  if (raw == null) return empty;
  if (typeof raw === 'number') return { currencyId: 0, price: Math.max(0, Math.floor(raw)) };

  const buf = bytesToBuffer(raw);
  if (!buf || !buf.length) return empty;

  let pos = 0; let currencyId = 0; let price = 0;
  while (pos < buf.length) {
    const byte = buf[pos++];
    const fieldNum = byte >> 3;
    const wireType = byte & 0x7;
    if (wireType !== 0) break;
    let value = 0; let shift = 0;
    while (pos < buf.length) {
      const b = buf[pos++];
      value |= (b & 0x7F) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    if (fieldNum === 1) currencyId = value;
    else if (fieldNum === 2) price = value;
  }
  return {
    currencyId: Math.max(0, Math.floor(currencyId || 0)),
    price: Math.max(0, Math.floor(price || 0)),
  };
}

function parseMallPriceValue(raw) {
  return parseMallPriceInfo(raw).price;
}

/**
 * 解析限购信息
 */
function parseMallLimitInfo(raw) {
  const empty = { limitType: 0, limitCount: 0, boughtNum: 0 };
  if (raw == null) return empty;

  const buf = bytesToBuffer(raw);
  if (!buf || !buf.length) return empty;

  let pos = 0; let limitType = 0; let limitCount = 0; let boughtNum = 0;
  while (pos < buf.length) {
    const byte = buf[pos++];
    const fieldNum = byte >> 3;
    const wireType = byte & 0x7;
    if (wireType !== 0) break;
    let value = 0; let shift = 0;
    while (pos < buf.length) {
      const b = buf[pos++];
      value |= (b & 0x7F) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    if (fieldNum === 1) limitType = value;
    else if (fieldNum === 2) boughtNum = value;
    else if (fieldNum === 3) limitCount = value;
  }
  return {
    limitType: Math.max(0, limitType),
    limitCount: Math.max(0, limitCount),
    boughtNum: Math.max(0, boughtNum),
  };
}

/**
 * 解析商城物品 ID 列表
 */
function parseMallItemIds(raw) {
  if (raw == null) return [];
  const buf = bytesToBuffer(raw);
  if (!buf || !buf.length) return [];

  const ids = [];
  let pos = 0;
  while (pos < buf.length) {
    const byte = buf[pos++];
    const fieldNum = byte >> 3;
    const wireType = byte & 0x7;
    if (wireType !== 0) break;
    let value = 0; let shift = 0;
    while (pos < buf.length) {
      const b = buf[pos++];
      value |= (b & 0x7F) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    if (fieldNum === 1) ids.push(value);
  }
  return ids;
}

// ---- 商品查找 ----

function findOrganicFertilizerMallGoods(goodsList) {
  const list = Array.isArray(goodsList) ? goodsList : [];
  return list.find((g) => toNum(g && g.goods_id) === ORGANIC_FERTILIZER_MALL_GOODS_ID) || null;
}

function findInorganicFertilizerMallGoods(goodsList) {
  const list = Array.isArray(goodsList) ? goodsList : [];
  return list.find((g) => toNum(g && g.goods_id) === INORGANIC_FERTILIZER_MALL_GOODS_ID) || null;
}

function findFertilizerMallGoods(goodsList, type = 'organic') {
  if (type === 'normal') return findInorganicFertilizerMallGoods(goodsList);
  return findOrganicFertilizerMallGoods(goodsList);
}

// ---- 自动购买 ----

/**
 * 通过商城自动购买有机化肥
 */
async function autoBuyOrganicFertilizerViaMall() {
  const goodsList = await getMallGoodsList(1);
  const goods = findOrganicFertilizerMallGoods(goodsList);
  if (!goods) return 0;

  const goodsId = toNum(goods.goods_id);
  if (goodsId <= 0) return 0;

  const price = parseMallPriceValue(goods.price);
  let ticket = Math.max(0, toNum((getUserState() || {}).ticket));
  let totalBought = 0;
  let perRound = BUY_PER_ROUND;

  // 根据余额调整每轮购买量
  if (price > 0 && ticket > 0) {
    perRound = Math.max(1, Math.min(BUY_PER_ROUND, Math.floor(ticket / price) || 1));
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (price > 0 && ticket > 0 && ticket < price) {
      buyPausedNoGoldDateKey = getDateKey();
      break;
    }

    try {
      await purchaseMallGoods(goodsId, perRound);
      totalBought += perRound;

      if (price > 0 && ticket > 0) {
        ticket = Math.max(0, ticket - price * perRound);
        if (ticket < price) break;
      }
      await sleep(300);
    } catch (err) {
      const msg = String(err && err.message || '');
      log('商城', `购买化肥失败: ${msg}`, {
        module: 'warehouse', event: '购买化肥', result: 'error', error: msg,
      });

      if (msg.includes('余额不足') || msg.includes('点券不足') || msg.includes('code=1000019')) {
        if (perRound > 1) {
          perRound = 1;
          continue;
        }
        buyPausedNoGoldDateKey = getDateKey();
      }
      break;
    }
  }

  if (totalBought > 0) {
    log('商城', `购买化肥成功，共购买 ${totalBought} 个`, {
      module: 'warehouse', event: '购买化肥', result: 'ok', count: totalBought, type: 'organic',
    });
  }
  return totalBought;
}

/**
 * 通过商城自动购买指定类型化肥
 */
async function autoBuyFertilizerViaMall(type = 'organic', targetCount = 0) {
  const typeLabel = type === 'normal' ? '无机化肥' : '有机化肥';
  log('商城', `开始购买化肥, 类型: ${typeLabel}, 数量: ${targetCount || '不限'}`, {
    module: 'warehouse', event: '购买化肥', type, targetCount,
  });

  const goodsList = await getMallGoodsList(1);
  const goods = findFertilizerMallGoods(goodsList, type);
  if (!goods) {
    log('商城', '未找到化肥商品', {
      module: 'warehouse', event: '购买化肥', result: 'error', type, error: '商品不存在',
    });
    return 0;
  }

  const goodsId = toNum(goods.goods_id);
  if (goodsId <= 0) return 0;

  const price = parseMallPriceValue(goods.price);
  let ticket = Math.max(0, toNum((getUserState() || {}).ticket));
  let totalBought = 0;
  let perRound = BUY_PER_ROUND;

  if (price > 0 && ticket > 0) {
    perRound = Math.max(1, Math.min(BUY_PER_ROUND, Math.floor(ticket / price) || 1));
  }

  log('商城', `准备购买化肥: goodsId=${goodsId}, 单价=${price}`, {
    module: 'warehouse', event: '购买化肥', goodsId, singlePrice: price, ticket, perRound,
  });

  const limit = targetCount > 0 ? targetCount : Infinity;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (targetCount > 0 && totalBought >= limit) break;

    if (price > 0 && ticket > 0 && ticket < price) {
      buyPausedNoGoldDateKey = getDateKey();
      break;
    }

    const buyCount = targetCount > 0 ? Math.min(perRound, limit - totalBought) : perRound;

    try {
      await purchaseMallGoods(goodsId, buyCount);
      totalBought += buyCount;

      if (price > 0 && ticket > 0) {
        ticket = Math.max(0, ticket - price * buyCount);
        if (ticket < price) break;
      }
      await sleep(300);
    } catch (err) {
      const msg = String(err && err.message || '');
      log('商城', `购买化肥失败: ${msg}`, {
        module: 'warehouse', event: '购买化肥', result: 'error', error: msg, type,
      });

      if (msg.includes('余额不足') || msg.includes('点券不足') || msg.includes('code=1000019')) {
        if (perRound > 1) {
          perRound = 1;
          continue;
        }
        buyPausedNoGoldDateKey = getDateKey();
      }
      break;
    }
  }

  if (totalBought > 0) {
    log('商城', `购买化肥成功，共购买 ${totalBought} 个`, {
      module: 'warehouse', event: '购买化肥', result: 'ok', count: totalBought, type,
    });
  }

  return totalBought;
}

/**
 * 自动购买有机化肥（带冷却检查）
 */
async function autoBuyOrganicFertilizer(force = false) {
  const now = Date.now();
  if (!force && now - lastBuyAt < BUY_COOLDOWN_MS) return 0;

  lastBuyAt = now;

  try {
    const bought = await autoBuyOrganicFertilizerViaMall();
    if (bought > 0) {
      buyDoneDateKey = getDateKey();
      buyLastSuccessAt = Date.now();
      log('商城', `自动购买有机化肥 x${bought}`, {
        module: 'warehouse', event: '购买化肥', result: 'ok', count: bought,
      });
    }
    return bought;
  } catch {
    return 0;
  }
}

/**
 * 自动购买化肥（带冷却检查，通用版）
 */
async function autoBuyFertilizer(force = false, type = 'organic', targetCount = 0) {
  const now = Date.now();
  if (!force && now - lastBuyAt < BUY_COOLDOWN_MS) return 0;

  lastBuyAt = now;

  try {
    const bought = await autoBuyFertilizerViaMall(type, targetCount);
    if (bought > 0) {
      buyDoneDateKey = getDateKey();
      buyLastSuccessAt = Date.now();
      const label = type === 'normal' ? '无机化肥' : '有机化肥';
      log('商城', `自动购买${label} x${bought}`, {
        module: 'warehouse', event: '购买化肥', result: 'ok', count: bought, type,
      });
    }
    return bought;
  } catch {
    return 0;
  }
}

// ---- 免费礼包 ----

function isDoneTodayByKey(dateKey) {
  return String(dateKey || '') === getDateKey();
}

/**
 * 自动购买免费礼包
 */
async function buyFreeGifts(force = false) {
  const now = Date.now();

  if (!force && isDoneTodayByKey(freeGiftDoneDateKey)) return 0;
  if (!force && now - freeGiftLastCheckAt < BUY_COOLDOWN_MS) return 0;

  freeGiftLastCheckAt = now;

  try {
    // 抓包显示“每日福利”(goodsId=1001)位于 slot_type=1。
    // 旧实现请求 slot_type=2，导致自动任务无法找到免费商品。
    const reply = await getMallListBySlotType(1);
    const rawList = Array.isArray(reply && reply.goods_list) ? reply.goods_list : [];
    const goodsList = [];

    for (const raw of rawList) {
      try {
        goodsList.push(types.MallGoods.decode(raw));
      } catch {
        // skip
      }
    }

    const freeGoods = goodsList.filter(
      (g) => !!g && g.is_free === true && Number(g.goods_id || 0) > 0
    );

    if (!freeGoods.length) {
      freeGiftDoneDateKey = getDateKey();
      log('商城', '今日暂无可领取免费礼包', {
        module: 'task', event: FREE_GIFTS_DAILY_KEY, result: 'none',
      });
      return 0;
    }

    let claimed = 0;
    for (const goods of freeGoods) {
      try {
        await purchaseMallGoods(Number(goods.goods_id || 0), 1);
        claimed += 1;
      } catch {
        // skip failed
      }
    }

    freeGiftDoneDateKey = getDateKey();

    if (claimed > 0) {
      freeGiftLastAt = Date.now();
      log('商城', `自动购买免费礼包 x${claimed}`, {
        module: 'task', event: FREE_GIFTS_DAILY_KEY, result: 'ok', count: claimed,
      });
    } else {
      log('商城', '今日暂无可领取免费礼包', {
        module: 'task', event: FREE_GIFTS_DAILY_KEY, result: 'none',
      });
    }

    return claimed;
  } catch (err) {
    log('商城', `领取免费礼包失败: ${err.message}`, {
      module: 'task', event: FREE_GIFTS_DAILY_KEY, result: 'error',
    });
    return 0;
  }
}

// ---- 按阈值补货 ----

/**
 * 根据化肥容器剩余时间阈值自动补货
 */
async function checkAndBuyFertilizerByThreshold(type, count, thresholdHours) {
  const { getBag, getBagItems, getContainerHoursFromBagItems } = require('./warehouse');

  if (count <= 0 || thresholdHours <= 0) {
    return { bought: 0, message: '参数无效' };
  }

  try {
    const bag = await getBag();
    const items = getBagItems(bag);
    const hours = getContainerHoursFromBagItems(items);
    const currentHours = type === 'normal' ? hours.normal : hours.organic;
    const label = type === 'normal' ? '无机化肥' : '有机化肥';

    log('商城', `检测${label}容器: 剩余 ${currentHours.toFixed(1)} 小时，阈值 ${thresholdHours} 小时`, {
      module: 'mall', event: 'check_fertilizer', type, currentHours, thresholdHours,
    });

    if (currentHours < thresholdHours) {
      const bought = await autoBuyFertilizer(true, type, count);
      return { bought, currentHours, thresholdHours, needed: true };
    }

    return { bought: 0, currentHours, thresholdHours, needed: false };
  } catch (err) {
    log('商城', `检测化肥容器失败: ${err.message}`, {
      module: 'mall', event: 'check_fertilizer', result: 'error', error: err.message,
    });
    return { bought: 0, error: err.message };
  }
}

/**
 * 同时检查并补充两种化肥
 */
async function checkAndBuyFertilizerBoth(options = {}) {
  const { getBag, getBagItems, getContainerHoursFromBagItems } = require('./warehouse');

  const {
    buyOrganic = false,
    buyNormal = false,
    organicCount = 0,
    organicThresholdHours = 0,
    normalCount = 0,
    normalThresholdHours = 0,
  } = options || {};

  const result = { organicBought: 0, normalBought: 0, organicCurrentHours: 0, normalCurrentHours: 0 };

  if (!buyOrganic && !buyNormal) return result;

  try {
    const bag = await getBag();
    const items = getBagItems(bag);
    const hours = getContainerHoursFromBagItems(items);

    result.organicCurrentHours = hours.organic;
    result.normalCurrentHours = hours.normal;

    // 有机化肥
    if (buyOrganic && organicCount > 0 && organicThresholdHours > 0) {
      log('商城', `检测有机化肥容器: 剩余 ${hours.organic.toFixed(1)} 小时，阈值 ${organicThresholdHours} 小时`, {
        module: 'mall', event: 'check_fertilizer_organic', currentHours: hours.organic, thresholdHours: organicThresholdHours,
      });

      if (hours.organic < organicThresholdHours) {
        result.organicBought = await autoBuyFertilizer(true, 'organic', organicCount);
      }
    }

    // 两次购买之间随机间隔 1~3 秒
    if (buyOrganic && buyNormal && result.organicBought > 0) {
      const delay = 1000 + Math.random() * 2000;
      await sleep(delay);
    }

    // 无机化肥
    if (buyNormal && normalCount > 0 && normalThresholdHours > 0) {
      log('商城', `检测无机化肥容器: 剩余 ${hours.normal.toFixed(1)} 小时，阈值 ${normalThresholdHours} 小时`, {
        module: 'mall', event: 'check_fertilizer_normal', currentHours: hours.normal, thresholdHours: normalThresholdHours,
      });

      if (hours.normal < normalThresholdHours) {
        result.normalBought = await autoBuyFertilizer(true, 'normal', normalCount);
      }
    }

    return result;
  } catch (err) {
    log('商城', `检测化肥容器失败: ${err.message}`, {
      module: 'mall', event: 'check_fertilizer', result: 'error', error: err.message,
    });
    return { ...result, error: err.message };
  }
}

// ---- 导出 ----

module.exports = {
  autoBuyOrganicFertilizer,
  autoBuyFertilizer,
  checkAndBuyFertilizerByThreshold,
  checkAndBuyFertilizerBoth,
  buyFreeGifts,
  getMallGoodsList,
  getAllMallGoods: async () => {
    const lists = await Promise.all([getMallGoodsList(1), getMallGoodsList(5)]);
    return [...new Map(lists.flat().map(goods => [Number(goods.goods_id), goods])).values()];
  },
  purchaseMallGoods,
  parseMallRewardItem,
  parseMallPriceValue,
  parseMallPriceInfo,
  parseMallLimitInfo,
  parseMallItemIds,

  getFertilizerBuyDailyState: () => ({
    key: 'fertilizer_buy',
    doneToday: buyDoneDateKey === getDateKey(),
    pausedNoGoldToday: buyPausedNoGoldDateKey === getDateKey(),
    lastSuccessAt: buyLastSuccessAt,
  }),

  getFreeGiftDailyState: () => ({
    key: FREE_GIFTS_DAILY_KEY,
    doneToday: freeGiftDoneDateKey === getDateKey(),
    lastCheckAt: freeGiftLastCheckAt,
    lastClaimAt: freeGiftLastAt,
  }),
};
