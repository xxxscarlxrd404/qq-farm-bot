/**
 * 活动服务 - 活动商店与限时抽奖
 *
 * 功能：
 * - 获取活动分组信息
 * - 操作活动（购买/刷新随机商店）
 * - 解析随机商店与活动抽奖数据
 * - 原始 protobuf 回退解码
 */
const protobuf = require('protobufjs/minimal');
const path = require('node:path');
const { sendMsgAsync, getUserState, isConnected } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum } = require('../utils/utils');
const { getItemImageById, getItemById } = require('../config/gameConfig');
const { getDataDir } = require('../config/runtime-paths');
const { createModuleLogger } = require('./logger');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');
const { getBag, getBagItems, useItem } = require('./warehouse');
const solarTermNames = new Map(require('../gameConfig/SolarTerms.json').terms.map(term => [term.id, term.name]));
const wishSignRewards = require('../gameConfig/WishSignRewards.json');

const activityLogger = createModuleLogger('activity');

const HELU_DRAW_REQUEST_GAP_MS = 450;
const HELU_DRAW_REFRESH_DELAY_MS = 350;
const QINGMEI_WINE_STEP_DELAY_MS = 1000;
const qingmeiClaimedDateByAccount = new Map();
const qixiDewLimitDateByAccount = new Map();
const QIXI_DEW_DAILY_LIMIT = 15;
const RAIN_POEM_ACTIVITY_UID = 'WeatherBottleUI';
const RAIN_POEM_ACTIVITY_ID = 2026070300;
const RAIN_POEM_SHOP_ACTIVITY_ID = 2026070301;
const RAIN_POEM_PRANK_ACTIVITY_ID = 2026070302;
const RAIN_POEM_COLLECTION_ACTIVITY_ID = 2026070303;
const RAIN_POEM_COLLECTION_CMD = 9;
const RAIN_POEM_RESEARCH_ACTIVITY_ID = 2026070304;
const RAIN_POEM_TASK_ACTIVITY_ID = 2026070305;
const RAIN_POEM_RESEARCH_UNLOCK_CMD = 40;
const RAIN_POEM_BOTTLE_ITEM_ID = 5001;
const RAIN_POEM_SUMMON_ITEM_ID = 5002;
const RAIN_POEM_FROG_PRANK_ITEM_ID = 5005;
const RAIN_POEM_CLOUD_PRANK_ITEM_ID = 5006;
const RAIN_POEM_BADGE_ITEM_ID = 1027;
const RAIN_POEM_START_TIME = 1787709600;
const RAIN_POEM_END_TIME = 1788883199;
const LIGHTNING_MUTANT_TYPE = 12;
const RAIN_POEM_SUMMON_DAILY_LIMIT = 50;
const CHARITY_FLOWER_ACTIVITY_UID = 'CharityRedFlower';
const CHARITY_FLOWER_GROUP_ACTIVITY_ID = 2026090900;
const CHARITY_FLOWER_ACTIVITY_ID = 2026090901;
const CHARITY_FLOWER_START_TIME = 1788192000;
const CHARITY_FLOWER_END_TIME = 1788969599;
const CHARITY_FLOWER_CLAIM_SHARE_CMD = 35;
const CHARITY_FLOWER_DONATE_ALL_CMD = 36;
const CHARITY_FLOWER_CLAIM_REWARD_CMD = 37;
const CHARITY_FLOWER_CLAIM_XHH_CMD = 38;
const WISH_SIGN_GROUP_ID = 2026092400;
const WISH_SIGN_ACTIVITY_ID = 2026092401;
const WISH_SIGN_ACTIVITY_UID = 'WishSignMainUI';
const WISH_SIGN_START_TIME = 1790179200;
const WISH_SIGN_END_TIME = 1791388799;
const SHARE_REWARD_GROUP_ID = 2026092500;
const SHARE_REWARD_ACTIVITY_ID = 2026092501;
const SHARE_REWARD_ACTIVITY_UID = 'HappySharePanel';
const SHARE_REWARD_START_TIME = 1790179200;
const SHARE_REWARD_END_TIME = 1791820799;
const WISH_SIGN_CHOICES = ['财运', '感情', '前程', '生活', '农耕', '人际'];
// 萌宠日记（S3 比熊萌宠主题赛季）。协议字段与文案来自 2026-09-10 官方客户端
// List/Operate 明文响应，详见 core/docs/pet-diary-protocol-recovery.md。
const PET_DIARY_ACTIVITY_UID = 'SEASON_BEAR_CAMPAIGN';
const PET_DIARY_GROUP_ACTIVITY_ID = 2026090100;
const PET_DIARY_ACTIVITY_ID = 2026090101;       // 比熊主体，承载 ActivityNode 字段 115
const PET_DIARY_GIFT_ACTIVITY_ID = 2026090102;  // 比熊赠礼（star_record）
const PET_DIARY_SHOP_ACTIVITY_ID = 2026090103;  // 拾物小铺（exchange_shop）
const PET_DIARY_START_TIME = 1789005600;
const PET_DIARY_END_TIME = 1791820799;
const PET_DIARY_ITEM_IDS = { cake: 1028, star: 1029 };
const PET_DIARY_ITEM_NAMES = new Map([
  [1028, '萌宠元气糕'], [1029, '幸运星'], [1030, '待护送宝藏'],
]);

function getPetDiaryItemName(itemId) {
  const id = toNum(itemId);
  if (!id) return '';
  return PET_DIARY_ITEM_NAMES.get(id) || '';
}

function normalizePetDiaryItem(item) {
  if (!item) return null;
  const id = toNum(item.id);
  const count = toNum(item.count);
  if (!id && !count) return null;
  return { itemId: id, count, name: getPetDiaryItemName(id) };
}

function parsePetDiaryPhotoContent(content) {
  if (typeof content !== 'string' || !content) return { photo: '', say: '' };
  try {
    const parsed = JSON.parse(content);
    return {
      photo: String(parsed?.photo || ''),
      say: String(parsed?.say || ''),
    };
  } catch {
    return { photo: '', say: '' };
  }
}
const RAIN_POEM_ITEM_NAMES = new Map([
  [1027, '雷电徽章'], [5001, '天气采集瓶'], [5002, '雷雨召唤瓶'],
  [5005, '青蛙使坏瓶'], [5006, '乌云使坏瓶'],
  [80013, '有机化肥（8小时）'], [100003, '化肥礼包'],
  [4002, '闪电感应'], [4003, '闪电感应'], [2159, '雨落成诗头像框'],
]);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function getLocalDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getQingmeiClaimStateKey() {
  const state = getUserState();
  return String(state?.gid || state?.openid || 'current');
}

function getQixiDewLimitStateKey() {
  const state = getUserState();
  return String(state?.gid || state?.openid || 'current');
}

function getRainPoemSummonUsageFile() {
  const state = getUserState();
  const accountKey = String(state?.gid || 'current').replace(/[^\w-]/gi, '_');
  return path.join(getDataDir(), 'rain_poem_summon_usage', `${accountKey}.json`);
}

function getRainPoemSummonUsedToday() {
  const usage = readJsonFile(getRainPoemSummonUsageFile(), () => ({}));
  return usage?.date === getLocalDateKey() ? Math.max(0, toNum(usage.count)) : 0;
}

function incrementRainPoemSummonUsedToday() {
  const count = Math.min(RAIN_POEM_SUMMON_DAILY_LIMIT, getRainPoemSummonUsedToday() + 1);
  writeJsonFileAtomic(getRainPoemSummonUsageFile(), { date: getLocalDateKey(), count });
  return count;
}

function mergeRainPoemTaskUsage(activity, summonUsedToday) {
  const collectionLimit = Math.max(0, toNum(activity?.collection?.dailyUseLimit));
  const collectionRemaining = Math.min(collectionLimit, Math.max(0, toNum(activity?.collection?.remainingUseCount)));
  const collectionTask = activity.tasks.find(item => toNum(item?.itemId) === RAIN_POEM_BOTTLE_ITEM_ID);
  if (collectionTask) {
    collectionTask.progress = collectionLimit - collectionRemaining;
    collectionTask.target = collectionLimit;
  }

  const count = Math.min(RAIN_POEM_SUMMON_DAILY_LIMIT, Math.max(0, toNum(summonUsedToday)));
  activity.summon.usedToday = count;
  const task = activity.tasks.find(item => toNum(item?.itemId) === RAIN_POEM_SUMMON_ITEM_ID);
  if (task) {
    task.progress = Math.max(toNum(task.progress), count);
    task.target = RAIN_POEM_SUMMON_DAILY_LIMIT;
  }
  return activity;
}

function isQixiDewLimitReachedToday() {
  return qixiDewLimitDateByAccount.get(getQixiDewLimitStateKey()) === getLocalDateKey();
}

function markQixiDewLimitReachedToday() {
  qixiDewLimitDateByAccount.set(getQixiDewLimitStateKey(), getLocalDateKey());
}

function isQixiDewDailyLimitError(err) {
  const message = String(err?.message || '');
  return Number(err?.code) === 1003008
    || message.includes('1003008')
    || message.includes('item use daily limit')
    || message.includes('今日使用次数已达上限');
}

function markQingmeiClaimedToday() {
  qingmeiClaimedDateByAccount.set(getQingmeiClaimStateKey(), getLocalDateKey());
}

function isQingmeiClaimedToday() {
  return qingmeiClaimedDateByAccount.get(getQingmeiClaimStateKey()) === getLocalDateKey();
}

function assertActivityConnection(action) {
  if (!isConnected()) {
    throw new Error(`${action || '活动操作'}失败: 连接已断开，请等待自动重连后重试`);
  }
}

// ---- 活动常量 ----

// 南瓜活动标识
const NANGUA_ACTIVITY_UID = 'NanGua';
const HELU_ACTIVITY_UID = 'SAIJI';
const QINGMEI_ACTIVITY_UID = 'QingMeiActivity';

// 活动 ID（通过 proto 文件 reflect，脱混淆为可读命名）
const NANGUA_SHOP_ACTIVITY_ID = 2026030200;
const NANGUA_RANDOM_SHOP_ACTIVITY_ID = 2026030201;
const HELU_ACTIVITY_ID = 2026060100;
const HELU_DRAW_ACTIVITY_ID = 2026060101;
const HELU_EXCHANGE_ACTIVITY_ID = 2026060102;
const HELU_JOURNEY_ACTIVITY_ID = 2026060103;
const HELU_NOTES_ACTIVITY_ID = 2026060104;
const HELU_CURRENCY_ITEM_ID = 1018;
const STAR_ACTIVITY_UID = 'SAIJI_MEGA_EVENT';
const STAR_ACTIVITY_ID = 2026072700;
const STAR_RECORD_ACTIVITY_ID = 2026072701;
const STAR_SHOP_ACTIVITY_ID = 2026072702;
const STAR_SAND_ITEM_ID = 1023;
const STAR_RECORD_CLAIM_CMD = 21;
const STAR_SHOP_OPEN_CMD = 7;
const STAR_SHOP_EXCHANGE_CMD = 1;
const QINGMEI_ACTIVITY_ID = 2026081200;
const QINGMEI_SEED_CLAIM_ACTIVITY_ID = 2026081201;
const QINGMEI_WINE_ACTIVITY_ID = 2026081202;
const QINGMEI_SEED_CLAIM_CMD = 4;
const QINGMEI_SEED_CLAIM_TYPE = 3;
const QINGMEI_WINE_PREVIEW_CMD = 14;
const QINGMEI_WINE_BREW_CMD = 15;
const QINGMEI_WINE_SELL_CMD = 16;
const QINGMEI_SEED_ITEM_ID = 21221;
const QINGMEI_FRUIT_ITEM_ID = 41221;
const QINGMEI_SEED_REWARD_COUNT = 24;
const QINGMEI_FINE_BREW_STEPS = 3;
const QINGMEI_SEED_CLAIM_END_TIME = 1786809599;
const QINGMEI_WINE_END_TIME = 1786895999;
const QIXI_ACTIVITY_UID = 'QiXiActivity';
const QIXI_ACTIVITY_ID = 2026081800;
const QIXI_BRIDGE_ACTIVITY_ID = 2026081801;
const QIXI_GIFT_ACTIVITY_ID = 2026081802;
const QIXI_BRIDGE_CMD = 25;
const QIXI_GIFT_OPEN_CMD = 7;
const QIXI_GIFT_SEND_CMD = 26;
const QIXI_FEATHER_ITEM_ID = 1024;
const QIXI_SACHET_ITEM_ID = 1025;
const QIXI_DEW_ITEM_ID = 301103;
const HELU_PASSPORT_UID = 'SAIJI_PASSPORT';
const HELU_TITLE = '荷风十里蝉初鸣';
const HELU_SUB_ACTIVITY_KEYS = {
  giftLotus: 'giftLotus',
  shop: 'shop',
  journey: 'journey',
  notes: 'notes',
};
const HELU_SUB_ACTIVITY_DEFS = [
  { key: HELU_SUB_ACTIVITY_KEYS.giftLotus, title: '奇遇礼莲', icon: 'i-carbon-gift' },
  { key: HELU_SUB_ACTIVITY_KEYS.shop, title: '荷露商店', icon: 'i-carbon-store' },
  { key: HELU_SUB_ACTIVITY_KEYS.journey, title: '荷风游记', icon: 'i-carbon-map' },
  { key: HELU_SUB_ACTIVITY_KEYS.notes, title: '节令小札', icon: 'i-carbon-notebook' },
];

// 操作命令
const NANGUA_SHOP_BUY_CMD = 2;     // 购买
const NANGUA_SHOP_REFRESH_CMD = 3; // 刷新
const HELU_EXCHANGE_CMD = 1;
const HELU_DRAW_CMD = 9;

// ---- RPC 调用 ----

/**
 * 获取活动分组信息
 */
async function getActivityGroup(activityId = NANGUA_SHOP_ACTIVITY_ID, uid = NANGUA_ACTIVITY_UID) {
  const request = types.ActivityGetGroupRequest.encode(
    types.ActivityGetGroupRequest.create({
      id: Number(activityId) || NANGUA_SHOP_ACTIVITY_ID,
      uid: String(uid || ''),
    })
  ).finish();

  const { body } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'GetGroup', request);
  const decoded = types.ActivityGetGroupReply.decode(body);

  // 附加原始字节供回退解析
  Object.defineProperty(decoded, '__rawBody', {
    value: Buffer.from(body || []),
    enumerable: false,
  });

  return decoded;
}

async function listActivityGroups() {
  const request = types.ActivityListRequest.encode(
    types.ActivityListRequest.create({})
  ).finish();
  const { body } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'List', request);
  return types.ActivityListReply.decode(body);
}

function normalizeDiscoveryActivity(node) {
  const raw = node?.activity || node || {};
  const weatherTasks = node?.weather_tasks || raw.weather_tasks;
  const weatherResearch = node?.weather_research || raw.weather_research;
  const qixiBridge = node?.qixi_bridge || raw.qixi_bridge;
  const qixiGift = node?.qixi_gift || raw.qixi_gift;
  const payloadText = String(raw.payload || '').trim();
  let payload = null;
  if (payloadText) {
    try {
      payload = JSON.parse(payloadText);
    } catch {
      payload = { text: payloadText.slice(0, 2000) };
    }
  }
  return {
    id: toNum(raw.id),
    parentId: toNum(raw.parent_id),
    type: toNum(raw.type),
    title: String(raw.title || ''),
    startTime: toNum(raw.start_time),
    endTime: toNum(raw.end_time),
    sort: toNum(raw.sort),
    visible: !!raw.visible,
    enabled: !!raw.enabled,
    status: toNum(raw.status),
    payload,
    features: {
      randomShop: !!(node?.random_shop || raw.random_shop),
      exchangeShop: !!(node?.exchange_shop || raw.exchange_shop),
      draw: !!(node?.draw_info || raw.draw_info),
      starRecord: !!node?.star_record,
      qixiBridge: !!qixiBridge,
      qixiGift: !!qixiGift,
      weatherTasks: !!weatherTasks,
      weatherResearch: !!weatherResearch,
    },
    children: (node?.children || []).map(normalizeDiscoveryActivity),
  };
}

function flattenDiscoveryActivities(nodes, output = []) {
  for (const node of nodes || []) {
    const activity = normalizeDiscoveryActivity(node);
    if (activity.id > 0) output.push({ ...activity, children: undefined });
    flattenDiscoveryActivities(node?.children, output);
  }
  return output;
}

async function getActivityDiscoveryList() {
  const reply = await listActivityGroups();
  return flattenDiscoveryActivities(reply?.groups).sort((a, b) => b.id - a.id);
}

async function getActivityDiscoverySnapshot() {
  const reply = await listActivityGroups();
  return {
    activities: flattenDiscoveryActivities(reply?.groups).sort((a, b) => b.id - a.id),
    activityWindows: (reply?.activity_windows || []).map(item => ({
      id: toNum(item?.id),
      title: String(item?.name || ''),
      startTime: toNum(item?.begin_time),
      endTime: toNum(item?.end_time),
    })).filter(item => item.id > 0),
  };
}

async function getActivityGroupSnapshot(activityId, uid = '') {
  const reply = await getActivityGroup(activityId, uid);
  return normalizeDiscoveryActivity(reply?.group);
}

/**
 * 操作活动
 */
async function operateActivity(activityId, cmd, options = {}) {
  assertActivityConnection('活动操作');

  const payload = {
    id: Number(activityId) || NANGUA_SHOP_ACTIVITY_ID,
    cmd: Number(cmd) || 0,
  };

  if (options?.randomShopOperate && typeof options.randomShopOperate === 'object') {
    payload.random_shop_operate = {
      id: Number(options.randomShopOperate.id) || 0,
      count: Number(options.randomShopOperate.count) || 1,
    };
  } else if (options?.exchangeShopOperate && typeof options.exchangeShopOperate === 'object') {
    payload.exchange_shop_operate = {
      id: Number(options.exchangeShopOperate.id) || 0,
      count: Number(options.exchangeShopOperate.count) || 1,
    };
  } else if (options?.draw && typeof options.draw === 'object') {
    payload.draw = options.draw;
  }
  if (options?.helu_paid_draw && typeof options.helu_paid_draw === 'object') {
    payload.helu_paid_draw = options.helu_paid_draw;
  }
  if (options?.qingmeiClaim && typeof options.qingmeiClaim === 'object') {
    payload.qingmei_claim_params = {
      type: Math.max(0, toNum(options.qingmeiClaim.type)),
    };
  }
  if (options?.qingmeiWineStart && typeof options.qingmeiWineStart === 'object') {
    payload.qingmei_wine_start = {
      items: (options.qingmeiWineStart.items || []).map(item => ({
        id: toNum(item?.id),
        count: toNum(item?.count),
      })),
    };
  }
  if (options?.qingmeiWineBrew) {
    payload.qingmei_wine_brew = {};
  }
  if (options?.qingmeiWineSell && typeof options.qingmeiWineSell === 'object') {
    payload.qingmei_wine_sell = {
      multiple: Math.max(1, toNum(options.qingmeiWineSell.multiple) || 1),
    };
  }
  if (options?.qixiGift && typeof options.qixiGift === 'object') {
    payload.qixi_gift = {
      friend_gid: toNum(options.qixiGift.friendGid),
      gift_id: Math.max(1, toNum(options.qixiGift.giftId)),
    };
  }
  if (options?.techTreeSubmitNode && typeof options.techTreeSubmitNode === 'object') {
    payload.tech_tree_submit_node = {
      node_id: Math.max(0, toNum(options.techTreeSubmitNode.nodeId)),
    };
  }
  if (options?.charityFlowerClaimShare) payload.charity_flower_claim_share = {};
  if (options?.charityFlowerDonateAll) payload.charity_flower_donate_all = {};
  if (options?.charityFlowerClaimReward && typeof options.charityFlowerClaimReward === 'object') {
    payload.charity_flower_claim_reward = {
      need_personal_score: Math.max(0, toNum(options.charityFlowerClaimReward.needPersonalScore)),
    };
  }
  if (options?.charityFlowerClaimXhh) payload.charity_flower_claim_xhh = {};
  if (options?.wishSignDraw) payload.wish_sign_draw = { choose_id: toNum(options.wishSignDraw.chooseId) };
  if (options?.wishSignClaim) payload.wish_sign_claim = { choose_id: toNum(options.wishSignClaim.chooseId) };
  if (options?.shareRewardShare) payload.share_reward_share = {};
  if (options?.shareRewardClaimMilestones) payload.share_reward_claim_milestones = {};
  if (options?.shareRewardClaimDaily) payload.share_reward_claim_daily = {};

  const request = types.ActivityOperateRequest.encode(
    types.ActivityOperateRequest.create(payload)
  ).finish();

  activityLogger.info('活动操作请求', {
    activityId: payload.id,
    cmd: payload.cmd,
    draw: payload.draw,
    exchangeShopOperate: payload.exchange_shop_operate,
    randomShopOperate: payload.random_shop_operate,
    heluPaidDraw: payload.helu_paid_draw,
    qingmeiClaim: payload.qingmei_claim_params,
    qingmeiWineStartCount: payload.qingmei_wine_start?.items?.length || 0,
    qingmeiWineBrew: !!payload.qingmei_wine_brew,
    qingmeiWineSell: payload.qingmei_wine_sell,
    qixiGift: payload.qixi_gift,
    techTreeSubmitNode: payload.tech_tree_submit_node,
    charityFlowerAction: payload.charity_flower_claim_share ? 'claim_share'
      : payload.charity_flower_donate_all ? 'donate_all'
        : payload.charity_flower_claim_reward ? 'claim_reward'
          : payload.charity_flower_claim_xhh ? 'claim_xhh' : '',
    // 用于和官方抓包的明文 protobuf 对照；请求中不含登录凭据。
    requestBytes: request.length,
    requestHex: Buffer.from(request).toString('hex'),
  });

  try {
    const { body } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'Operate', request);
    return body;
  } catch (err) {
    activityLogger.error('活动操作请求失败', {
      activityId: payload.id,
      cmd: payload.cmd,
      requestBytes: request.length,
      requestHex: Buffer.from(request).toString('hex'),
      error: err?.message || String(err),
    });
    throw err;
  }
}

function normalizeQixiItem(item, fallbackId = 0, fallbackName = '') {
  const normalized = normalizeCoreItem(item || { id: fallbackId, count: 0 });
  if (fallbackName && (!normalized.itemName || normalized.itemName.startsWith('物品#'))) {
    normalized.itemName = fallbackName;
  }
  return normalized;
}

function findActivityNodeById(nodes, id) {
  for (const node of nodes || []) {
    if (toNum(node?.activity?.id) === id) return node;
    const found = findActivityNodeById(node?.children, id);
    if (found) return found;
  }
  return null;
}

function normalizeQixiActivity(reply) {
  const root = reply?.group || null;
  const bridgeNode = findActivityNodeById([root], QIXI_BRIDGE_ACTIVITY_ID);
  const giftNode = findActivityNodeById([root], QIXI_GIFT_ACTIVITY_ID);
  const bridge = bridgeNode?.qixi_bridge || bridgeNode?.qixiBridge || {};
  const gift = giftNode?.qixi_gift || giftNode?.qixiGift || {};
  const balances = (bridge?.balances || []).map(item => normalizeQixiItem(item));
  const balanceById = new Map(balances.map(item => [item.itemId, item.itemCount]));
  const stages = (bridge?.stages || []).map(stage => ({
    id: toNum(stage?.id),
    status: toNum(stage?.status),
    claimed: toNum(stage?.status) >= 2,
    cost: normalizeQixiItem(stage?.cost, QIXI_FEATHER_ITEM_ID, '鹊羽'),
    rewards: (stage?.rewards || []).map(item => normalizeQixiItem(item)),
  }));
  const nextStage = stages.find(stage => !stage.claimed) || null;
  const giftRule = gift?.rule || {};
  return {
    uid: QIXI_ACTIVITY_UID,
    title: String(root?.activity?.title || bridgeNode?.activity?.title || '鹊桥寄情'),
    activityId: QIXI_ACTIVITY_ID,
    startTime: toNum(root?.activity?.start_time || bridgeNode?.activity?.start_time),
    endTime: toNum(root?.activity?.end_time || bridgeNode?.activity?.end_time),
    active: !!bridgeNode?.activity?.visible && bridgeNode?.activity?.enabled !== false,
    items: {
      feather: normalizeQixiItem({ id: QIXI_FEATHER_ITEM_ID, count: balanceById.get(QIXI_FEATHER_ITEM_ID) || 0 }, QIXI_FEATHER_ITEM_ID, '鹊羽'),
      sachet: normalizeQixiItem({ id: QIXI_SACHET_ITEM_ID, count: balanceById.get(QIXI_SACHET_ITEM_ID) || 0 }, QIXI_SACHET_ITEM_ID, '鹊羽香囊'),
      dew: normalizeQixiItem({ id: QIXI_DEW_ITEM_ID, count: balanceById.get(QIXI_DEW_ITEM_ID) || 0 }, QIXI_DEW_ITEM_ID, '鹊羽灵露'),
    },
    bridge: {
      activityId: QIXI_BRIDGE_ACTIVITY_ID,
      command: QIXI_BRIDGE_CMD,
      stages,
      completedCount: stages.filter(stage => stage.claimed).length,
      lastBuiltStageId: toNum(bridge?.last_built_stage_id),
      nextStage,
      canBuild: !!nextStage && nextStage.cost.itemCount > 0
        && (balanceById.get(nextStage.cost.itemId) || 0) >= nextStage.cost.itemCount,
    },
    gift: {
      activityId: QIXI_GIFT_ACTIVITY_ID,
      command: QIXI_GIFT_SEND_CMD,
      sentCount: toNum(gift?.sent_count),
      receivedCount: toNum(gift?.received_count),
      maxCount: toNum(gift?.max_count),
      remainingCount: Math.max(0, toNum(gift?.max_count) - toNum(gift?.sent_count)),
      cost: normalizeQixiItem(giftRule?.cost, QIXI_SACHET_ITEM_ID, '鹊羽香囊'),
      reward: normalizeQixiItem(giftRule?.reward, 0, '获赠香囊'),
      enabled: giftRule?.enabled !== false,
    },
  };
}

async function getQixiActivity() {
  const activity = normalizeQixiActivity(await getActivityGroup(QIXI_ACTIVITY_ID, QIXI_ACTIVITY_UID));
  const counts = await Promise.all([
    getBagItemCount(QIXI_FEATHER_ITEM_ID),
    getBagItemCount(QIXI_SACHET_ITEM_ID),
    getBagItemCount(QIXI_DEW_ITEM_ID),
  ]);
  // 活动节点中的 balances 会保留阶段奖励/配置值，真实可用库存以背包为准。
  activity.items.feather.itemCount = counts[0];
  activity.items.sachet.itemCount = counts[1];
  activity.items.dew.itemCount = counts[2];
  activity.dewUsage = {
    dailyLimit: QIXI_DEW_DAILY_LIMIT,
    limitReached: isQixiDewLimitReachedToday(),
  };
  if (activity.bridge.nextStage) {
    activity.bridge.canBuild = activity.bridge.nextStage.cost.itemCount > 0
      && activity.items.feather.itemCount >= activity.bridge.nextStage.cost.itemCount;
  }
  return activity;
}

function normalizeRainPoemActivity(reply, nowSeconds = Math.floor(Date.now() / 1000)) {
  const root = reply?.group || null;
  const shopNode = findActivityNodeById([root], RAIN_POEM_SHOP_ACTIVITY_ID);
  const drawNode = findActivityNodeById([root], RAIN_POEM_COLLECTION_ACTIVITY_ID);
  const researchNode = findActivityNodeById([root], RAIN_POEM_RESEARCH_ACTIVITY_ID);
  const taskNode = findActivityNodeById([root], RAIN_POEM_TASK_ACTIVITY_ID);
  const startTime = toNum(root?.activity?.start_time) || RAIN_POEM_START_TIME;
  const endTime = toNum(root?.activity?.end_time) || RAIN_POEM_END_TIME;
  // type=3 天气商店的数据位于 ActivityInfo 内；部分旧响应则直接挂在 ActivityNode。
  const shopInfo = shopNode?.exchange_shop || shopNode?.activity?.exchange_shop || {};
  const shopItem = (shopInfo?.items || [])[0] || {};
  const draw = drawNode?.draw_info || drawNode?.activity?.draw_info || {};
  const research = (researchNode?.weather_research || researchNode?.activity?.weather_research)?.progress || {};
  const weatherTasks = taskNode?.weather_tasks || taskNode?.activity?.weather_tasks || {};
  const tasks = (weatherTasks?.tasks || []).map(task => ({
    id: toNum(task?.id), itemId: toNum(task?.item_id), desc: String(task?.desc || ''),
    target: toNum(task?.target), progress: toNum(task?.progress),
    reward: normalizeRainPoemItem(task?.reward, RAIN_POEM_BADGE_ITEM_ID),
  }));
  const lightningHarvestTask = tasks.find(task => /雷电|闪电/.test(task.desc) && /变异/.test(task.desc) && /收集|收获/.test(task.desc));
  const lightningHarvestTarget = Math.max(0, toNum(lightningHarvestTask?.target));
  const lightningHarvestProgress = Math.max(0, toNum(lightningHarvestTask?.progress));
  return {
    uid: RAIN_POEM_ACTIVITY_UID,
    title: String(root?.activity?.title || '雨落成诗'),
    activityId: RAIN_POEM_ACTIVITY_ID,
    startTime,
    endTime,
    active: nowSeconds >= startTime && nowSeconds <= endTime && root?.activity?.visible !== false,
    shop: {
      activityId: RAIN_POEM_SHOP_ACTIVITY_ID,
      slotId: toNum(shopItem?.id) || 200,
      item: normalizeRainPoemItem(shopItem?.item, RAIN_POEM_BOTTLE_ITEM_ID),
      cost: normalizeQixiItem(shopItem?.cost, 1005, '金豆豆'),
      purchasedToday: !!shopItem?.owned,
      available: toNum(shopItem?.status) === 1 && !shopItem?.owned,
      dailyLimit: 1,
    },
    collection: {
      remainingUseCount: toNum(draw?.paid_remaining_count),
      dailyUseLimit: toNum(draw?.max_paid_count) || 10,
      bottleItemId: toNum(draw?.paid_currency_id) || RAIN_POEM_BOTTLE_ITEM_ID,
      bottleCost: toNum(draw?.paid_price) || 1,
      reward: normalizeRainPoemItem(draw?.rewards?.[0]?.item, RAIN_POEM_SUMMON_ITEM_ID),
    },
    summon: {
      itemId: RAIN_POEM_SUMMON_ITEM_ID,
      dailyUseLimit: RAIN_POEM_SUMMON_DAILY_LIMIT,
      durationSeconds: 2 * 60 * 60,
    },
    tasks,
    lightningHarvest: {
      progress: lightningHarvestProgress,
      target: lightningHarvestTarget,
      remaining: Math.max(0, lightningHarvestTarget - lightningHarvestProgress),
      complete: lightningHarvestTarget > 0 && lightningHarvestProgress >= lightningHarvestTarget,
      confirmed: !!lightningHarvestTask,
    },
    research: {
      currentStage: toNum(research?.current_stage),
      stages: (research?.stages || []).map(stage => ({
        id: toNum(stage?.id), status: toNum(stage?.status),
        available: toNum(stage?.status) === 2,
        completed: toNum(stage?.status) === 4,
        claimed: toNum(stage?.status) === 4,
        cost: normalizeRainPoemItem(stage?.cost, RAIN_POEM_BADGE_ITEM_ID), reward: normalizeRainPoemItem(stage?.reward),
        repeatable: !!stage?.repeatable, limit: toNum(stage?.limit),
      })),
    },
  };
}

function normalizeRainPoemItem(item, fallbackId = 0) {
  const itemId = toNum(item?.id) || fallbackId;
  return normalizeQixiItem(item, itemId, RAIN_POEM_ITEM_NAMES.get(itemId) || '未知物品');
}

function normalizeWeatherStatus(weather, nowSeconds = Math.floor(Date.now() / 1000)) {
  // 字段 1 是雷雨阶段而非天气 ID。兼容修复前按 weather_id 解码的对象，
  // 避免测试夹具或运行中的旧对象在热更新期间被误判。
  const type = toNum(weather?.type ?? weather?.weather_id);
  const status = toNum(weather?.status);
  const startTime = toNum(weather?.start_time);
  const endTime = toNum(weather?.end_time);
  return {
    type, status, startTime, endTime,
    // type=1（30 分钟）和 type=2（2 小时）是同一次雷雨的两个有效阶段。
    rainstorm: (type === 1 || type === 2) && status > 0
      && (!startTime || nowSeconds >= startTime) && (!endTime || nowSeconds <= endTime),
  };
}

function isLightningMutantPlant(plant) {
  return (plant?.mutant_config_ids || []).map(toNum).includes(LIGHTNING_MUTANT_TYPE);
}

async function getOwnWeatherStatus() {
  const request = types.GetWeatherStatusRequest.encode(types.GetWeatherStatusRequest.create({})).finish();
  const { body } = await sendMsgAsync('gamepb.weatherpb.WeatherService', 'GetWeatherStatus', request);
  return normalizeWeatherStatus(types.GetWeatherStatusReply.decode(body)?.weather);
}

async function getRainPoemActivity() {
  const activity = normalizeRainPoemActivity(await getActivityGroup(RAIN_POEM_ACTIVITY_ID, RAIN_POEM_ACTIVITY_UID));
  const [collectionBottles, summonBottles, frogPrankBottles, cloudPrankBottles, badges] = await Promise.all([
    getBagItemCount(RAIN_POEM_BOTTLE_ITEM_ID), getBagItemCount(RAIN_POEM_SUMMON_ITEM_ID),
    getBagItemCount(RAIN_POEM_FROG_PRANK_ITEM_ID), getBagItemCount(RAIN_POEM_CLOUD_PRANK_ITEM_ID),
    getBagItemCount(RAIN_POEM_BADGE_ITEM_ID),
  ]);
  activity.items = { collectionBottles, summonBottles, frogPrankBottles, cloudPrankBottles, badges };
  mergeRainPoemTaskUsage(activity, getRainPoemSummonUsedToday());
  try {
    activity.weather = await getOwnWeatherStatus();
  } catch (err) {
    activity.weather = { type: 0, status: 0, rainstorm: false, error: err.message };
  }
  return activity;
}

async function buyRainPoemCollectionBottle() {
  const before = await getRainPoemActivity();
  if (!before.active) throw new Error('雨落成诗活动当前不在有效期内');
  if (before.shop.purchasedToday || !before.shop.available) {
    return { ok: true, purchased: false, reason: 'daily_limit', activity: before };
  }
  await operateActivityReply(RAIN_POEM_SHOP_ACTIVITY_ID, 1, {
    exchangeShopOperate: { id: 200, count: 1 },
  });
  return { ok: true, purchased: true, count: 1, activity: await getRainPoemActivity() };
}

function encodeRainPoemSummonUseRequest(gid, itemUid) {
  const writer = protobuf.Writer.create();
  writer.uint32(10).fork().uint32(8).int64(RAIN_POEM_SUMMON_ITEM_ID)
    .uint32(16).int64(1).uint32(48).int64(toNum(itemUid)).ldelim();
  writer.uint32(18).fork().uint32(8).int64(toNum(gid)).uint32(24).int64(0).ldelim();
  return writer.finish();
}


async function useRainPoemSummonBottle() {
  const before = await getRainPoemActivity();
  if (!before.active) throw new Error('雨落成诗活动当前不在有效期内');
  if (before.weather?.rainstorm) return { ok: true, used: false, reason: 'already_rainstorm', activity: before };
  if (before.summon.usedToday >= RAIN_POEM_SUMMON_DAILY_LIMIT) {
    return { ok: true, used: false, reason: 'daily_limit', activity: before };
  }
  if (before.items.summonBottles < 1) throw new Error('雷雨召唤瓶不足');
  const bag = await getBag();
  const bottle = getBagItems(bag).find(item => toNum(item?.id) === RAIN_POEM_SUMMON_ITEM_ID && toNum(item?.count) > 0);
  if (!bottle) throw new Error('雷雨召唤瓶不足');
  const gid = toNum(getUserState()?.gid);
  if (!gid) throw new Error('尚未获取当前账号 GID');
  await sendMsgAsync('gamepb.itempb.ItemService', 'Use', encodeRainPoemSummonUseRequest(gid, bottle.uid));
  incrementRainPoemSummonUsedToday();
  return { ok: true, used: true, activity: await getRainPoemActivity() };
}

async function collectRainPoemWeather() {
  const before = await getRainPoemActivity();
  if (!before.active) throw new Error('雨落成诗活动当前不在有效期内');
  if (before.items.collectionBottles < 1) throw new Error('天气采集瓶不足');
  if (before.collection.remainingUseCount <= 0) throw new Error('天气采集瓶今日使用次数已达上限');

  const { enterFriendFarm, leaveFriendFarm } = require('./friend-api');
  const { getFriendsList } = require('./friend-land-analyzer');
  const friends = await getFriendsList();
  let checkedCount = 0;
  let visitFailureCount = 0;

  for (const friend of friends) {
    const gid = toNum(friend?.gid);
    if (!gid) continue;
    let entered = false;
    try {
      const visit = await enterFriendFarm(gid);
      entered = true;
      checkedCount++;
      const weather = normalizeWeatherStatus(visit?.weather);
      if (!weather.rainstorm) continue;
      await operateActivityReply(RAIN_POEM_COLLECTION_ACTIVITY_ID, RAIN_POEM_COLLECTION_CMD, {
        // 抓包确认 field 107.3 承载目标好友 GID；沿用现有消息字段名 item_uid。
        helu_paid_draw: { item_uid: gid },
      });
      return {
        ok: true, friendGid: gid, friendName: String(friend?.name || ''), weather,
        checkedCount, visitFailureCount, activity: await getRainPoemActivity(),
      };
    } catch (err) {
      if (entered) throw err;
      visitFailureCount++;
      activityLogger.warn('检查好友雷雨天气失败，继续下一位', { friendGid: gid, error: err.message });
    } finally {
      if (entered) await leaveFriendFarm(gid);
    }
  }
  return { ok: true, collected: false, reason: 'no_rainstorm_friend', checkedCount, visitFailureCount, activity: await getRainPoemActivity() };
}

async function unlockRainPoemResearch() {
  const before = await getRainPoemActivity();
  if (!before.active) throw new Error('雨落成诗活动当前不在有效期内');
  const stage = before.research.stages.find(item => item.available);
  if (!stage) return { ok: true, unlocked: false, reason: 'no_available_stage', activity: before };
  if (before.items.badges < stage.cost.itemCount) {
    throw new Error(`雷电徽章不足，需要 ${stage.cost.itemCount}，当前 ${before.items.badges}`);
  }
  try {
    await operateActivityReply(RAIN_POEM_RESEARCH_ACTIVITY_ID, RAIN_POEM_RESEARCH_UNLOCK_CMD, {
      techTreeSubmitNode: { nodeId: stage.id },
    });
  } catch (err) {
    // 并发任务可能已经推进该节点，刷新后将该错误视为状态竞争。
    if (!String(err?.message || '').includes('code=1034101')) throw err;
    const refreshed = await getRainPoemActivity();
    const stillAvailable = (refreshed?.research?.stages || []).some(item => item.available);
    if (stillAvailable) throw err;
    return { ok: true, unlocked: false, reason: 'state_already_advanced', activity: refreshed };
  }
  return {
    ok: true, unlocked: true, stageId: stage.id, cost: stage.cost, reward: stage.reward,
    activity: await getRainPoemActivity(),
  };
}

function isQixiDewLandCandidate(land) {
  return !!land?.plantId
    && ['growing', 'harvestable'].includes(land.status)
    && land?.qixiDew?.applied !== true;
}

async function useQixiDew(options = {}) {
  const activity = await getQixiActivity();
  if (activity.dewUsage.limitReached) {
    return { ok: true, usedCount: 0, reason: 'daily_limit', activity };
  }
  const available = activity.items.dew.itemCount;
  if (available <= 0) return { ok: true, usedCount: 0, reason: 'no_dew', activity };
  const { getLandsDetail } = require('./farm-land-analyzer');
  const lands = (await getLandsDetail())?.lands || [];
  const candidates = lands.filter(isQixiDewLandCandidate);
  const limit = Math.min(available, Math.max(1, toNum(options.limit) || available), candidates.length);
  if (limit <= 0) return { ok: true, usedCount: 0, reason: 'no_eligible_land', activity };
  let usedCount = 0;
  let dailyLimitReached = false;
  for (const land of candidates.slice(0, limit)) {
    try {
      await useQixiDewOnLand(land.id);
      usedCount++;
    } catch (err) {
      if (isQixiDewDailyLimitError(err)) {
        markQixiDewLimitReachedToday();
        dailyLimitReached = true;
        activityLogger.info('鹊羽灵露今日使用次数已达上限', {
          itemId: QIXI_DEW_ITEM_ID,
          dailyLimit: QIXI_DEW_DAILY_LIMIT,
        });
        break;
      }
      activityLogger.warn('鹊羽灵露使用失败', { landId: land.id, error: err.message });
      break;
    }
    if (usedCount < limit) await delay(450);
  }
  return {
    ok: true,
    usedCount,
    reason: dailyLimitReached ? 'daily_limit' : undefined,
    activity: await getQixiActivity(),
  };
}

async function useQixiDewOnLand(landId) {
  const bag = await getBag();
  const dew = (getBagItems(bag) || []).find(item =>
    toNum(item?.id) === QIXI_DEW_ITEM_ID && toNum(item?.count) > 0
  );
  if (!dew) throw new Error('鹊羽灵露不足');
  const gid = toNum(getUserState()?.gid);
  if (!gid) throw new Error('尚未获取当前账号 GID');

  // 官方 UseRequest：field 1 为带 UID 的物品，field 2 为账号及目标土地。
  const writer = protobuf.Writer.create();
  writer.uint32(10).fork()
    .uint32(8).int64(QIXI_DEW_ITEM_ID)
    .uint32(16).int64(1)
    .uint32(48).int64(toNum(dew.uid))
    .ldelim();
  writer.uint32(18).fork()
    .uint32(8).int64(gid)
    .uint32(18).fork().int64(toNum(landId)).ldelim()
    .ldelim();
  const { body } = await sendMsgAsync('gamepb.itempb.ItemService', 'Use', writer.finish());
  return types.UseReply.decode(body);
}

async function buildQixiBridge() {
  const before = await getQixiActivity();
  if (!before.bridge.nextStage) return { ok: true, completed: true, built: false, activity: before };
  if (!before.bridge.canBuild) throw new Error('鹊羽不足，暂时无法驻建鹊桥');
  await operateActivityReply(QIXI_BRIDGE_ACTIVITY_ID, QIXI_BRIDGE_CMD);
  return { ok: true, built: true, stageId: before.bridge.nextStage.id, activity: await getQixiActivity() };
}

async function sendQixiSachet(friendGid, count = 1) {
  const gid = toNum(friendGid);
  const sendCount = Math.max(1, Math.floor(toNum(count) || 1));
  if (!gid) throw new Error('请选择有效好友');
  const before = await getQixiActivity();
  if (!before.gift.enabled || before.gift.remainingCount <= 0) throw new Error('今日香囊赠送次数已用完');
  const actual = Math.min(sendCount, before.gift.remainingCount, before.items.sachet.itemCount || sendCount);
  if (actual <= 0) throw new Error('鹊羽香囊不足');
  for (let i = 0; i < actual; i++) {
    // 官方界面没有款式选项，抓包中该内部编号由客户端在 1-13 间自动选择。
    const giftId = 1 + Math.floor(Math.random() * 13);
    await operateActivityReply(QIXI_GIFT_ACTIVITY_ID, QIXI_GIFT_SEND_CMD, {
      qixiGift: { friendGid: gid, giftId },
    });
    if (i + 1 < actual) await delay(450);
  }
  return { ok: true, friendGid: gid, sentCount: actual, activity: await getQixiActivity() };
}

async function operateActivityReply(activityId, cmd, options = {}) {
  const body = await operateActivity(activityId, cmd, options);
  return types.ActivityOperateReply.decode(body);
}

function normalizeCoreItem(item) {
  const itemId = toNum(item?.id);
  const count = toNum(item?.count);
  const info = getItemById(itemId);
  return {
    itemId,
    itemCount: count,
    count,
    itemName: info?.name || (itemId ? `物品#${itemId}` : ''),
    image: getItemImageById(itemId) || '',
  };
}

function isCharityFlowerActive(nowSeconds = Math.floor(Date.now() / 1000)) {
  return nowSeconds >= CHARITY_FLOWER_START_TIME && nowSeconds <= CHARITY_FLOWER_END_TIME;
}

function isWishSignActive(nowSeconds = Math.floor(Date.now() / 1000)) {
  return nowSeconds >= WISH_SIGN_START_TIME && nowSeconds <= WISH_SIGN_END_TIME;
}

function isShareRewardActive(nowSeconds = Math.floor(Date.now() / 1000)) {
  return nowSeconds >= SHARE_REWARD_START_TIME && nowSeconds <= SHARE_REWARD_END_TIME;
}

function normalizeWishSignActivity(node, nowSeconds = Math.floor(Date.now() / 1000)) {
  const body = node?.wish_sign || {};
  const pending = body.pending;
  return {
    title: '秋祈良愿', activityId: WISH_SIGN_ACTIVITY_ID,
    startTime: WISH_SIGN_START_TIME, endTime: WISH_SIGN_END_TIME,
    active: isWishSignActive(nowSeconds),
    remainingCount: toNum(body.remaining_count),
    activityDay: toNum(body.activity_day),
    pending: pending ? {
      chooseId: toNum(pending.choose_id), textId: toNum(pending.text_id),
      dayId: toNum(pending.day_id), rewards: (pending.rewards || []).map(normalizeCoreItem),
    } : null,
    choices: WISH_SIGN_CHOICES.map((name, index) => ({ id: index + 1, name })),
    rewardPool: wishSignRewards.map(({ dayId, itemId, count }) => ({
      dayId, ...normalizeCoreItem({ id: itemId, count }),
    })),
  };
}

function normalizeShareRewardActivity(node, nowSeconds = Math.floor(Date.now() / 1000)) {
  const summary = node?.share_reward?.summary || {};
  const daily = summary.daily || {};
  return {
    title: '快乐不独享', activityId: SHARE_REWARD_ACTIVITY_ID,
    startTime: SHARE_REWARD_START_TIME, endTime: SHARE_REWARD_END_TIME,
    active: isShareRewardActive(nowSeconds),
    scoreItemId: toNum(summary.score_item_id), currentScore: toNum(summary.current_score),
    daily: {
      claimedCount: toNum(daily.claimed_count), claimLimit: toNum(daily.claim_limit),
      rewardClaimed: !!daily.daily_reward_claimed,
      firstShareAwarded: !!daily.first_share_awarded,
      dailyReward: toNum(summary.daily_reward), firstShareReward: toNum(summary.first_share_reward),
      poolClaimed: toNum(summary.my_pool?.claimed_count), poolLimit: toNum(summary.my_pool?.claim_limit),
    },
    milestones: (summary.milestones || []).map(tier => ({
      id: toNum(tier.tier_id), threshold: toNum(tier.threshold), state: toNum(tier.state),
      rewards: (tier.rewards || []).map(normalizeCoreItem),
    })),
  };
}

async function getWishSignActivity() {
  const group = await getActivityGroup(WISH_SIGN_GROUP_ID, WISH_SIGN_ACTIVITY_UID);
  const node = findActivityNodeById([group?.group], WISH_SIGN_ACTIVITY_ID);
  if (!node?.wish_sign) throw new Error('秋祈良愿活动数据未下发');
  return normalizeWishSignActivity(node);
}

async function getShareRewardActivity() {
  const group = await getActivityGroup(SHARE_REWARD_GROUP_ID, SHARE_REWARD_ACTIVITY_UID);
  const node = findActivityNodeById([group?.group], SHARE_REWARD_ACTIVITY_ID);
  if (!node?.share_reward?.summary) throw new Error('快乐不独享活动数据未下发');
  return normalizeShareRewardActivity(node);
}

async function operateWishSign(action, chooseId) {
  if (!isWishSignActive()) throw new Error('秋祈良愿未开始或已结束');
  const choice = Number(chooseId);
  if (!Number.isInteger(choice) || choice < 1 || choice > WISH_SIGN_CHOICES.length) throw new Error('祈愿选择无效');
  const before = await getWishSignActivity();
  if (action === 'draw') {
    if (before.pending || before.remainingCount <= 0) throw new Error('当前没有可祈愿次数，或尚有奖励待领取');
  } else if (action === 'claim') {
    if (!before.pending || before.pending.chooseId !== choice) throw new Error('没有与该签文匹配的待领奖励');
  } else throw new Error('不支持的祈愿操作');
  const reply = await operateActivityReply(WISH_SIGN_ACTIVITY_ID, action === 'draw' ? 51 : 52,
    action === 'draw' ? { wishSignDraw: { chooseId: choice } } : { wishSignClaim: { chooseId: choice } });
  const rewards = action === 'draw' ? reply.wish_sign_draw?.rewards : reply.wish_sign_claim?.awards;
  return { ok: true, rewards: (rewards || []).map(normalizeCoreItem) };
}

async function operateShareReward(action) {
  if (!isShareRewardActive()) throw new Error('快乐不独享未开始或已结束');
  const before = await getShareRewardActivity();
  if (action === 'daily' && before.daily.rewardClaimed) throw new Error('今日快乐值已领取');
  if (action === 'share' && before.daily.firstShareAwarded) throw new Error('今日首次分享奖励已领取');
  if (action === 'milestones' && !before.milestones.some(tier => tier.state === 2 && before.currentScore >= tier.threshold)) {
    throw new Error('没有可领取的快乐值档位');
  }
  const commands = { daily: 73, share: 69, milestones: 70 };
  if (!commands[action]) throw new Error('不支持的快乐不独享操作');
  const reply = await operateActivityReply(SHARE_REWARD_ACTIVITY_ID, commands[action]);
  const result = action === 'daily' ? reply.share_reward_claim_daily
    : action === 'share' ? reply.share_reward_share : reply.share_reward_claim_milestones;
  return {
    ok: true, grantedScore: toNum(result?.granted_score),
    claimedTierIds: (result?.claimed_tier_ids || []).map(toNum),
    rewards: (result?.rewards || []).map(normalizeCoreItem),
  };
}

function normalizeCharityFlowerActivity(node, nowSeconds = Math.floor(Date.now() / 1000)) {
  const body = node?.charity_flower || {};
  const activity = node?.activity || {};
  const personalScore = toNum(body.personal_score);
  const globalScore = toNum(body.global_score);
  return {
    uid: CHARITY_FLOWER_ACTIVITY_UID,
    title: String(activity.title || '公益小红花'),
    activityId: toNum(activity.id) || CHARITY_FLOWER_ACTIVITY_ID,
    startTime: toNum(activity.start_time) || CHARITY_FLOWER_START_TIME,
    endTime: toNum(activity.end_time) || CHARITY_FLOWER_END_TIME,
    active: isCharityFlowerActive(nowSeconds),
    love: {
      itemId: toNum(body.love_item_id),
      count: toNum(body.love_count),
      personalScore,
      canDonate: !!body.can_donate,
    },
    global: {
      score: globalScore,
      target: toNum(body.max_global_score),
      amountYuan: globalScore / 100,
      targetYuan: toNum(body.max_global_score) / 100,
      reached: globalScore >= toNum(body.max_global_score) && toNum(body.max_global_score) > 0,
    },
    share: {
      status: toNum(body.share_status),
      claimable: toNum(body.share_status) === 2,
      claimed: toNum(body.share_status) === 3,
      rewards: (body.share_reward || []).map(normalizeCoreItem),
    },
    personalRewards: (body.personal_rewards || []).map(item => ({
      needScore: toNum(item.need_personal_score),
      reached: !!item.reached || personalScore >= toNum(item.need_personal_score),
      claimed: !!item.claimed,
      rewards: (item.reward || []).map(normalizeCoreItem),
    })),
    finalReward: {
      threshold: toNum(body.final_pack_threshold),
      settlementTime: toNum(body.settlement_time),
      settled: !!body.settled,
      eligible: !!body.final_reward_eligible,
      rewards: (body.final_reward || []).map(normalizeCoreItem),
    },
    publicFund: {
      status: toNum(body.xhh_status),
      claimable: toNum(body.xhh_status) === 2,
      claimed: toNum(body.xhh_status) === 3,
      complianceAgreed: !!body.compliance_agreed,
      rewards: (body.xhh_reward || []).map(normalizeCoreItem),
      successCount: (body.xhh_success_orders || []).length,
    },
  };
}

async function getCharityFlowerActivity() {
  const reply = await listActivityGroups();
  const node = findActivityNodeById(reply?.groups, CHARITY_FLOWER_ACTIVITY_ID);
  if (!node) throw new Error('公益小红花活动数据未下发');
  return normalizeCharityFlowerActivity(node);
}

function assertCharityFlowerActive(action) {
  if (!isCharityFlowerActive()) throw new Error(`${action}失败: 公益小红花活动未开始或已结束`);
}

async function claimCharityFlowerShareReward() {
  assertCharityFlowerActive('领取分享奖励');
  const reply = await operateActivityReply(CHARITY_FLOWER_ACTIVITY_ID, CHARITY_FLOWER_CLAIM_SHARE_CMD, { charityFlowerClaimShare: true });
  return { ok: true, awards: (reply?.charity_flower_claim_share?.awards || []).map(normalizeCoreItem) };
}

async function donateCharityFlowerLove() {
  assertCharityFlowerActive('送出爱心');
  const reply = await operateActivityReply(CHARITY_FLOWER_ACTIVITY_ID, CHARITY_FLOWER_DONATE_ALL_CMD, { charityFlowerDonateAll: true });
  const result = reply?.charity_flower_donate_all || {};
  return { ok: true, consumedLoveCount: toNum(result.consumed_love_count), scoreAdded: toNum(result.score_added) };
}

async function claimCharityFlowerReward(needPersonalScore) {
  assertCharityFlowerActive('领取爱心档位奖励');
  const threshold = Math.max(1, toNum(needPersonalScore));
  const reply = await operateActivityReply(CHARITY_FLOWER_ACTIVITY_ID, CHARITY_FLOWER_CLAIM_REWARD_CMD, {
    charityFlowerClaimReward: { needPersonalScore: threshold },
  });
  return { ok: true, needScore: threshold, awards: (reply?.charity_flower_claim_reward?.awards || []).map(normalizeCoreItem) };
}

async function claimCharityFlowerPublicFund() {
  assertCharityFlowerActive('送出公益金');
  const before = await getCharityFlowerActivity();
  if (!before.publicFund.complianceAgreed) throw new Error('送出公益金失败: 尚未同意腾讯公益平台协议');
  if (!before.publicFund.claimable) return { ok: true, claimed: false, reason: 'not_claimable' };
  const reply = await operateActivityReply(CHARITY_FLOWER_ACTIVITY_ID, CHARITY_FLOWER_CLAIM_XHH_CMD, { charityFlowerClaimXhh: true });
  return { ok: true, claimed: true, awards: (reply?.charity_flower_claim_xhh?.awards || []).map(normalizeCoreItem) };
}

// ---- 萌宠日记（S3 比熊萌宠赛季）—— 只读状态查询 ----
// 本节只做只读归一化：活动体字段号已由官方明文响应确认，子字段语义为推断，
// 因此不在此处臆造 Operate 命令字。协议证据见 core/docs/pet-diary-protocol-recovery.md。

function isPetDiaryWithinWindow(nowSeconds) {
  const now = typeof nowSeconds === 'number' && Number.isFinite(nowSeconds)
    ? Math.floor(nowSeconds)
    : Math.floor(Date.now() / 1000);
  return now >= PET_DIARY_START_TIME && now <= PET_DIARY_END_TIME;
}

function normalizePetDiaryPet(pet) {
  return {
    stage: toNum(pet?.stage),
    progress: toNum(pet?.progress),
    state: toNum(pet?.state),
  };
}

function normalizePetDiaryEscort(escort) {
  return {
    guard: toNum(escort?.guard),
    cake: normalizePetDiaryItem(escort?.cake),
  };
}

function normalizePetDiaryPouch(pouch) {
  const slot = pouch?.slot || {};
  return {
    flag: String(pouch?.flag || ''),
    state: toNum(pouch?.state),
    slot: {
      id: toNum(slot?.id),
      type: toNum(slot?.type),
      count: toNum(slot?.count),
    },
  };
}

function normalizePetDiaryPhotoWall(wall) {
  const entries = Array.isArray(wall?.entries) ? wall.entries : [];
  const slots = entries
    .map((entry) => {
      const content = parsePetDiaryPhotoContent(entry?.content);
      const unlocked = toNum(entry?.unlocked) > 0;
      const claimed = toNum(entry?.claimed) > 0;
      return {
        id: toNum(entry?.id),
        unlocked,
        claimed,
        claimable: unlocked && !claimed,
        progress: toNum(entry?.progress),
        photo: content.photo,
        say: content.say,
      };
    })
    .filter((slot) => slot.id > 0 || slot.unlocked);

  return {
    slots,
    totalCount: slots.length,
    unlockedCount: slots.filter((slot) => slot.unlocked).length,
    claimedCount: slots.filter((slot) => slot.claimed).length,
    claimableCount: slots.filter((slot) => slot.claimable).length,
  };
}

function normalizePetDiaryShop(shopNode) {
  const shop = shopNode?.exchange_shop
    || shopNode?.exchangeShop
    || shopNode?.activity?.exchange_shop
    || shopNode?.activity?.exchangeShop
    || null;
  const items = Array.isArray(shop?.items) ? shop.items : [];
  return items
    .map(normalizeExchangeShopItem)
    .filter(Boolean)
    .map((item) => ({
      ...item,
      currencyName: item.currencyId === PET_DIARY_ITEM_IDS.star ? '幸运星' : item.currencyName,
    }));
}

function emptyPetDiaryActivity(warning) {
  return {
    uid: PET_DIARY_ACTIVITY_UID,
    title: 'S3 萌宠',
    activityId: PET_DIARY_ACTIVITY_ID,
    groupActivityId: PET_DIARY_GROUP_ACTIVITY_ID,
    startTime: PET_DIARY_START_TIME,
    endTime: PET_DIARY_END_TIME,
    active: false,
    pet: normalizePetDiaryPet(null),
    home: { state: 0 },
    escort: normalizePetDiaryEscort(null),
    photoWall: normalizePetDiaryPhotoWall(null),
    pouch: normalizePetDiaryPouch(null),
    gifts: normalizeStarRecord(null),
    shop: [],
    balances: { cake: 0, star: 0 },
    items: { cake: PET_DIARY_ITEM_IDS.cake, star: PET_DIARY_ITEM_IDS.star },
    summary: {
      photoUnlocked: 0,
      photoTotal: 0,
      photoClaimable: 0,
      giftClaimable: 0,
      shopCount: 0,
    },
    warning: warning || '',
  };
}

// ==================== 萌宠成长日记（S3）====================
// 上游 activity-center/pet-diary.ts 的本地装配。旧的只读 getPetDiaryActivity 暂时保留，
// 待前端切到新接口后再移除，避免一次性改动过大。
const petDiaryHelpers = require('./activity-center-helpers');
const { createPetDiaryService } = require('./activity-pet-diary');

let petDiaryServiceInstance = null;

function getPetDiaryService() {
  if (petDiaryServiceInstance) return petDiaryServiceInstance;
  const { getServerTimeSec } = require('../utils/utils');
  petDiaryServiceInstance = createPetDiaryService({
    types,
    sendMsgAsync,
    getBag,
    getBagItems,
    getServerTimeSec,
    itemDto: petDiaryHelpers.itemDto,
    int64String: petDiaryHelpers.int64String,
    int64Number: petDiaryHelpers.int64Number,
    textContent: petDiaryHelpers.textContent,
    businessError: petDiaryHelpers.businessError,
    positiveDecimal: petDiaryHelpers.positiveDecimal,
    serializeMutation: petDiaryHelpers.serializeMutation,
    // 本地节令模型字段为 claimable / 数字 id，适配成上游期望的 canClaim / 字符串 id
    getCurrentSolarTerms: async () => {
      const info = await getSolarTermsInfo();
      return {
        ...info,
        terms: (Array.isArray(info?.terms) ? info.terms : []).map(term => ({
          ...term,
          id: String(term.id),
          canClaim: term.claimable === true,
          // 上游页面按 name / statusCode 取值，本地模型是 title / status，补别名避免改页面。
          // statusCode 必须是字符串：页面里是 term.statusCode === '1' / '3' 的严格比较。
          name: String(term.title || ''),
          statusCode: String(term.status),
        })),
      };
    },
    claimSolarTerm: async (termId) => claimSolarTermsReward(Number(termId)),
  });
  return petDiaryServiceInstance;
}

const getPetDiary = () => getPetDiaryService().getPetDiary();
const operatePetDiary = (action, params, options) => getPetDiaryService().operatePetDiary(action, params, options);
const getPetDiaryRecords = (kind) => getPetDiaryService().getPetDiaryRecords(kind);
const getPetDiaryFriend = (gid) => getPetDiaryService().getPetDiaryFriend(gid);

async function getPetDiaryActivity() {
  if (!getUserState()) {
    return emptyPetDiaryActivity('runtime connection is not open');
  }

  const listed = await listActivityGroups();
  const rootNode = findActivityNodeById(listed?.groups, PET_DIARY_ACTIVITY_ID);
  if (!rootNode) {
    throw new Error('未在活动列表中找到“萌宠日记”');
  }

  const giftNode = findActivityNodeById(listed?.groups, PET_DIARY_GIFT_ACTIVITY_ID);
  const shopNode = findActivityNodeById(listed?.groups, PET_DIARY_SHOP_ACTIVITY_ID);
  const body = rootNode.pet_diary || rootNode.petDiary || {};
  const startTime = toNum(rootNode?.activity?.start_time) || PET_DIARY_START_TIME;
  const endTime = toNum(rootNode?.activity?.end_time) || PET_DIARY_END_TIME;

  const [cake, star] = await Promise.all([
    getBagItemCount(PET_DIARY_ITEM_IDS.cake).catch(() => 0),
    getBagItemCount(PET_DIARY_ITEM_IDS.star).catch(() => 0),
  ]);

  const photoWall = normalizePetDiaryPhotoWall(body?.photo_wall || body?.photoWall);
  const pouch = normalizePetDiaryPouch(body?.pouch);
  const gifts = normalizeStarRecord(giftNode);
  const shop = normalizePetDiaryShop(shopNode);

  return {
    uid: PET_DIARY_ACTIVITY_UID,
    title: String(rootNode?.activity?.title || 'S3 萌宠'),
    activityId: PET_DIARY_ACTIVITY_ID,
    groupActivityId: PET_DIARY_GROUP_ACTIVITY_ID,
    giftActivityId: PET_DIARY_GIFT_ACTIVITY_ID,
    shopActivityId: PET_DIARY_SHOP_ACTIVITY_ID,
    startTime,
    endTime,
    active: isPetDiaryWithinWindow(),
    pet: normalizePetDiaryPet(body?.pet),
    home: { state: toNum(body?.home?.state) },
    escort: normalizePetDiaryEscort(body?.escort),
    photoWall,
    pouch,
    gifts,
    shop,
    balances: { cake, star },
    items: { cake: PET_DIARY_ITEM_IDS.cake, star: PET_DIARY_ITEM_IDS.star },
    summary: {
      photoUnlocked: photoWall.unlockedCount,
      photoTotal: photoWall.totalCount,
      photoClaimable: photoWall.claimableCount,
      giftClaimable: gifts.claimableCount,
      shopCount: shop.length,
    },
  };
}

function normalizeQingmeiPreviewResult(result) {
  if (!result) return null;
  return {
    price: toNum(result?.price),
  };
}

function normalizeQingmeiBrewResult(result) {
  if (!result) return null;
  return {
    wineType: toNum(result?.wine_type ?? result?.wineType),
    cost: toNum(result?.cost),
    price: toNum(result?.price),
    canDouble: !!(result?.can_double ?? result?.canDouble),
  };
}

function normalizeQingmeiSellResult(result) {
  if (!result) return null;
  const item = normalizeCoreItem(result?.item || {});
  return {
    multiple: toNum(result?.multiple),
    gold: toNum(result?.gold) || item.itemCount,
    item,
  };
}

function normalizeQingmeiClaimResult(result) {
  const items = (Array.isArray(result?.items) ? result.items : [])
    .map(normalizeCoreItem)
    .filter(item => item.itemId > 0 && item.itemCount > 0);
  const seed = items.find(item => item.itemId === QINGMEI_SEED_ITEM_ID);
  return {
    items,
    claimedCount: seed?.itemCount || 0,
  };
}

function isAlreadyClaimedError(err) {
  const message = String(err?.message || err || '');
  return message.includes('已领取')
    || message.includes('已经领取')
    || message.includes('重复领取')
    || message.includes('already')
    || message.includes('1009001');
}

function createQingmeiWineError(stage, message, cause) {
  const err = new Error(message || cause?.message || '青梅酿操作失败');
  err.stage = stage;
  err.cause = cause;
  err.qingmeiWine = true;
  return err;
}

function isNoOngoingQingmeiBrewError(err) {
  const message = String(err?.message || err || '');
  return message.includes('1034027') || message.includes('无进行中的酿造记录');
}

async function reportQingmeiShareForDouble() {
  const checkRequest = types.CheckCanShareRequest.encode(
    types.CheckCanShareRequest.create({})
  ).finish();
  const { body: checkBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'CheckCanShare', checkRequest);
  const checkResult = types.CheckCanShareReply.decode(checkBody);

  if (!checkResult?.can_share) {
    throw new Error('当前不可分享，无法执行青梅酿售卖翻倍');
  }

  const reportRequest = types.ReportShareRequest.encode(
    types.ReportShareRequest.create({ shared: true })
  ).finish();
  const { body: reportBody } = await sendMsgAsync('gamepb.sharepb.ShareService', 'ReportShare', reportRequest);
  const reportResult = types.ReportShareReply.decode(reportBody);

  if (reportResult && Object.hasOwn(reportResult, 'success') && !reportResult.success) {
    throw new Error('青梅酿分享上报失败');
  }

  return {
    canShare: !!checkResult?.can_share,
    shared: true,
    success: reportResult?.success !== false,
  };
}

async function getSeasonInfoRaw() {
  const { body } = await sendMsgAsync('gamepb.seasonpb.SeasonService', 'GetSeasonInfo', Buffer.alloc(0));
  return Buffer.from(body || []);
}

async function claimSeasonRewardsRaw() {
  assertActivityConnection('荷风游记领取');
  const { body } = await sendMsgAsync('gamepb.seasonpb.SeasonService', 'ClaimBattlePassRewards', Buffer.alloc(0));
  return Buffer.from(body || []);
}

async function getSolarTermsRaw() {
  const { body } = await sendMsgAsync('gamepb.solartermspb.SolarTermsService', 'GetSolarTerms', Buffer.alloc(0));
  return Buffer.from(body || []);
}

async function claimSolarTermsRaw(termId) {
  assertActivityConnection('节令小札领取');
  const request = protobuf.Writer.create()
    .uint32((1 << 3) | 0)
    .uint32(Math.max(0, Number(termId) || 0))
    .finish();
  const { body } = await sendMsgAsync('gamepb.solartermspb.SolarTermsService', 'ClaimSolarTerms', request);
  return Buffer.from(body || []);
}

// ---- 商品购买 ----

/**
 * 购买南瓜商店商品
 */
async function buyNanguaShopItem(slotId, defaultCount = 1) {
  const slotIdNum = Number(slotId) || 0;
  if (slotIdNum <= 0) throw new Error('缺少有效的活动商店槽位');

  const shop = await getNanguaShop();
  const slotItems = Array.isArray(shop?.randomShop) ? shop.randomShop : [];
  const slot = slotItems.find((item) => toNum(item?.id) === slotIdNum);

  if (!slot) throw new Error(`活动商店未找到槽位: ${slotIdNum}`);
  if (!slot.purchasable) throw new Error(`活动商店槽位不可购买: ${slot.statusLabel || '不可购买'}`);

  const price = toNum(slot?.price) || Number(defaultCount) || 0;
  if (price <= 0) throw new Error('缺少有效的活动商店价格');

  const remaining = Math.max(0,
    toNum(slot?.remainingCount) ||
    toNum(slot?.stockCount) - toNum(slot?.boughtCount) ||
    0
  );

  try {
    await operateActivity(NANGUA_RANDOM_SHOP_ACTIVITY_ID, NANGUA_SHOP_BUY_CMD, {
      randomShopOperate: { id: slotIdNum, count: remaining },
    });
  } catch (err) {
    throw new Error(
      `活动商店购买失败: activityId=${NANGUA_RANDOM_SHOP_ACTIVITY_ID}, slotId=${slotIdNum}, count=${remaining}, cost=${price}: ${err.message}`
    );
  }

  return getNanguaShop();
}

/**
 * 刷新南瓜商店
 */
async function refreshNanguaShop() {
  const before = await getNanguaShop();
  await operateActivity(NANGUA_RANDOM_SHOP_ACTIVITY_ID, NANGUA_SHOP_REFRESH_CMD);
  const after = await getNanguaShop();

  if (getRandomShopStateSignature(before) === getRandomShopStateSignature(after)) {
    throw new Error('活动商店刷新请求已返回，但商店内容和刷新次数未变化，请检查剩余刷新次数或协议字段');
  }

  return after;
}

// ---- 数据解析 ----

/**
 * 生成随机商店状态签名（用于检测刷新是否生效）
 */
function getRandomShopStateSignature(group) {
  const refresh = group?.randomShopRefresh || {};
  const items = Array.isArray(group?.randomShop) ? group.randomShop : [];
  return JSON.stringify({
    nextRefreshTime: toNum(refresh.nextRefreshTime),
    manualRefreshUsedCount: toNum(refresh.manualRefreshUsedCount),
    items: items.map((it) => [
      toNum(it?.id),
      toNum(it?.itemId),
      toNum(it?.stockCount),
      toNum(it?.boughtCount),
      !!it?.special,
    ]),
  });
}

/**
 * 解析活动 payload（JSON 字符串）
 */
function getField(raw, ...names) {
  if (!raw) return undefined;
  for (const name of names) {
    if (raw[name] !== undefined) return raw[name];
    const numeric = String(name).replace(/^field_/, '');
    if (/^\d+$/.test(numeric) && raw[numeric] !== undefined) return raw[numeric];
  }
  return undefined;
}

function parsePayload(rawPayload) {
  if (!rawPayload) return null;
  if (typeof rawPayload === 'object') return rawPayload;
  if (typeof rawPayload !== 'string') return null;
  const text = rawPayload.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function decodeItemHex(raw) {
  if (typeof raw !== 'string' || !/^[0-9a-f]+$/i.test(raw) || raw.length < 4) return null;
  try {
    return types.CoreItem ? types.CoreItem.decode(Buffer.from(raw, 'hex')) : null;
  } catch {
    return null;
  }
}

function readProtoFields(rawBytes) {
  const buf = Buffer.from(rawBytes || []);
  const reader = protobuf.Reader.create(buf);
  const entries = [];

  while (reader.pos < reader.len) {
    let tag = 0;
    try {
      tag = reader.uint32();
    } catch {
      break;
    }

    const field = tag >>> 3;
    const wire = tag & 0x7;
    try {
      if (wire === 0) {
        entries.push({ field, wire, value: toNum(reader.uint64()) });
      } else if (wire === 2) {
        entries.push({ field, wire, value: Buffer.from(reader.bytes()) });
      } else if (wire === 5) {
        entries.push({ field, wire, value: reader.uint32() });
      } else if (wire === 1) {
        entries.push({ field, wire, value: reader.fixed64() });
      } else {
        reader.skipType(wire);
      }
    } catch {
      break;
    }
  }

  return entries;
}

function getProtoNumber(entries, field, fallback = 0) {
  const hit = (entries || []).find((entry) => entry.field === field && entry.wire === 0);
  return hit ? toNum(hit.value) : fallback;
}

function getProtoBytes(entries, field) {
  const hit = (entries || []).find((entry) => entry.field === field && entry.wire === 2);
  return hit ? Buffer.from(hit.value || []) : null;
}

function getProtoBytesAll(entries, field) {
  return (entries || [])
    .filter((entry) => entry.field === field && entry.wire === 2)
    .map((entry) => Buffer.from(entry.value || []));
}

function getProtoString(entries, field, fallback = '') {
  const bytes = getProtoBytes(entries, field);
  if (!bytes || bytes.length === 0) return fallback;
  try {
    return bytes.toString('utf8');
  } catch {
    return fallback;
  }
}

function parseActivityItemMessage(rawBytes) {
  const entries = readProtoFields(rawBytes);
  const itemId = getProtoNumber(entries, 1);
  const count = Math.max(0, getProtoNumber(entries, 2) || 1);
  if (itemId <= 0) return null;

  const info = getItemById(itemId);
  return {
    itemId,
    itemCount: count,
    count,
    itemName: (info && info.name) || `物品${itemId}`,
    name: (info && info.name) || `物品${itemId}`,
    image: getItemImageById(itemId) || '',
  };
}

function getSubActivityKey(activity) {
  const id = toNum(activity?.id);
  const title = String(activity?.title || '');
  if (id === HELU_DRAW_ACTIVITY_ID) return HELU_SUB_ACTIVITY_KEYS.giftLotus;
  if (id === HELU_EXCHANGE_ACTIVITY_ID) return HELU_SUB_ACTIVITY_KEYS.shop;
  if (id === HELU_JOURNEY_ACTIVITY_ID) return HELU_SUB_ACTIVITY_KEYS.journey;
  if (id === HELU_NOTES_ACTIVITY_ID) return HELU_SUB_ACTIVITY_KEYS.notes;
  if (/奇遇礼莲/.test(title)) return HELU_SUB_ACTIVITY_KEYS.giftLotus;
  if (/荷露商店/.test(title)) return HELU_SUB_ACTIVITY_KEYS.shop;
  if (/荷风游记/.test(title)) return HELU_SUB_ACTIVITY_KEYS.journey;
  if (/节令小札/.test(title)) return HELU_SUB_ACTIVITY_KEYS.notes;
  return '';
}

function summarizeActivityPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  return Object.entries(payload)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 8)
    .map(([key, value]) => ({
      key,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    }));
}

function normalizeHeluSubActivities(activities) {
  const byKey = new Map();
  for (const activity of activities || []) {
    const key = getSubActivityKey(activity);
    if (!key || byKey.has(key)) continue;
    const payload = parsePayload(activity?.payload);
    byKey.set(key, {
      key,
      id: toNum(activity?.id),
      parentId: toNum(activity?.parent_id ?? activity?.parentId),
      title: String(activity?.title || ''),
      type: toNum(activity?.type),
      sort: toNum(activity?.sort),
      status: toNum(activity?.status),
      visible: activity?.visible !== false,
      enabled: activity?.enabled !== false,
      startTime: toNum(activity?.start_time ?? activity?.startTime),
      endTime: toNum(activity?.end_time ?? activity?.endTime),
      payload,
      payloadSummary: summarizeActivityPayload(payload),
      hasDraw: !!(activity?.draw_info || activity?.drawInfo),
      hasExchangeShop: !!(activity?.exchange_shop || activity?.exchangeShop),
      source: 'activity_tree',
    });
  }

  return HELU_SUB_ACTIVITY_DEFS.map((def) => {
    const found = byKey.get(def.key);
    return {
      ...def,
      id: found?.id || 0,
      parentId: found?.parentId || 0,
      type: found?.type || 0,
      sort: found?.sort || 0,
      status: found?.status || 0,
      visible: found?.visible ?? true,
      enabled: found?.enabled ?? true,
      startTime: found?.startTime || 0,
      endTime: found?.endTime || 0,
      payload: found?.payload || null,
      payloadSummary: found?.payloadSummary || [],
      hasDraw: found?.hasDraw || def.key === HELU_SUB_ACTIVITY_KEYS.giftLotus,
      hasExchangeShop: found?.hasExchangeShop || def.key === HELU_SUB_ACTIVITY_KEYS.shop,
      available: !!found || def.key === HELU_SUB_ACTIVITY_KEYS.giftLotus || def.key === HELU_SUB_ACTIVITY_KEYS.shop,
      source: found?.source || 'configured',
    };
  });
}

/**
 * 标准化活动物品
 */
function normalizeActivityItem(raw) {
  if (!raw) return null;
  const decoded = decodeItemHex(raw) || raw;
  const itemId = toNum(getField(decoded, 'id', 'field_1', 1));
  const count = Math.max(0, toNum(getField(decoded, 'count', 'field_2', 2)) || 1);
  if (itemId <= 0) return null;

  const info = getItemById(itemId);
  const image = getItemImageById(itemId) || '';

  return {
    itemId,
    count,
    name: (info && info.name) || `物品${itemId}`,
    image,
  };
}

function normalizeDrawPoolItem(raw) {
  const item = normalizeActivityItem(getField(raw, 'item', 'field_3', 3));
  if (!item) return null;
  return {
    id: toNum(getField(raw, 'id', 'field_1', 1)),
    rarity: toNum(getField(raw, 'rarity', 'field_2', 2)),
    itemId: item.itemId,
    itemCount: item.count,
    itemName: item.name,
    image: item.image || '',
    probability: String(getField(raw, 'probability', 'field_6', 6) || ''),
  };
}

function normalizeDrawReward(raw) {
  const item = normalizeActivityItem(getField(raw, 'item', 'field_2', 2));
  if (!item) return null;
  return {
    slotId: toNum(getField(raw, 'slot_id', 'slotId', 'field_1', 1)),
    rarityFlag: toNum(getField(raw, 'flag', 'field_4', 4)),
    itemId: item.itemId,
    itemCount: item.count,
    itemName: item.name,
    image: item.image || '',
  };
}

function normalizeDrawInfo(raw) {
  if (!raw) return null;

  const freeMax = toNum(getField(raw, 'max_free_count', 'maxFreeCount', 'field_2', 2)) || 4;
  const paidMax = toNum(getField(raw, 'max_paid_count', 'maxPaidCount', 'field_4', 4)) || 4;
  const freeRemainingRaw = getField(raw, 'free_remaining_count', 'freeRemainingCount', 'field_1', 1);
  const paidRemainingRaw = getField(raw, 'paid_remaining_count', 'paidRemainingCount', 'free_used_count', 'freeUsedCount', 'field_3', 3);
  const hasFreeRemaining = freeRemainingRaw !== undefined;
  const hasPaidRemaining = paidRemainingRaw !== undefined;
  const freeRemaining = Math.max(0, Math.min(freeMax,
    hasFreeRemaining ? toNum(freeRemainingRaw) : hasPaidRemaining ? 0 : freeMax
  ));
  // 抓包显示：field_3 是点券剩余次数；点券 4 次全部用完后 field_3 会直接省略。
  // 初始配置也会省略 field_3，但此时免费次数未用完，所以仍应展示点券上限。
  const paidRemaining = Math.max(0, Math.min(paidMax,
    hasPaidRemaining ? toNum(paidRemainingRaw) : freeRemaining <= 0 ? 0 : paidMax
  ));
  const freeUsed = Math.max(0, freeMax - freeRemaining);
  const paidUsed = Math.max(0, paidMax - paidRemaining);
  const paidCurrencyId = toNum(getField(raw, 'paid_currency_id', 'paidCurrencyId', 'field_5', 5)) || 1002;
  const paidPrice = toNum(getField(raw, 'paid_price', 'paidPrice', 'field_6', 6)) || 30;
  const fallbackPrice = toNum(getField(raw, 'fallback_price', 'fallbackPrice', 'field_7', 7)) || paidPrice;
  const rewardPoolRaw = getField(raw, 'rewards', 'field_8', 8);
  const rewardPool = (Array.isArray(rewardPoolRaw) ? rewardPoolRaw : [])
    .map(normalizeDrawPoolItem)
    .filter(Boolean);

  return {
    freeMax,
    freeUsed,
    freeRemaining,
    paidMax,
    paidUsed,
    paidRemaining,
    paidCurrencyId,
    paidPrice,
    fallbackPrice,
    rewardPool,
    _hasFreeRemaining: hasFreeRemaining,
    _hasPaidRemaining: hasPaidRemaining,
  };
}

function normalizeDrawResult(raw) {
  if (!raw) return null;
  const rewardsRaw = getField(raw, 'rewards', 'field_1', 1);
  const itemsRaw = getField(raw, 'items', 'field_2', 2);
  const costRaw = getField(raw, 'cost', 'field_3', 3);
  return {
    rewards: (Array.isArray(rewardsRaw) ? rewardsRaw : [])
      .map(normalizeDrawReward)
      .filter(Boolean),
    items: (Array.isArray(itemsRaw) ? itemsRaw : [])
      .map(normalizeActivityItem)
      .filter(Boolean),
    cost: normalizeActivityItem(costRaw),
  };
}

/**
 * 标准化随机商店单品
 */
function normalizeRandomShopItem(raw) {
  const item = normalizeActivityItem(raw?.item);
  const cost = normalizeActivityItem(raw?.cost);
  if (!item) return null;

  const name = String(raw?.name || item.name || '').trim() || item.name;
  const stockCount = toNum(raw?.stock_count ?? raw?.stockCount ?? raw?.limit_count ?? raw?.limitCount);
  const boughtCount = toNum(raw?.bought_count ?? raw?.boughtCount);
  const hasStock = stockCount > 0;
  const isSpecial = !!raw?.special;
  const noStock = !isSpecial;
  const soldOut = isSpecial && hasStock && boughtCount >= stockCount;
  const purchasable = isSpecial && hasStock && !soldOut;
  const remainingCount = purchasable ? Math.max(0, stockCount - boughtCount) : 0;

  return {
    id: toNum(raw?.id),
    name,
    itemId: item.itemId,
    itemCount: item.count,
    itemName: item.name,
    image: item.image || '',
    currencyId: cost?.itemId || 1001,
    price: cost?.count || 0,
    priceUnitId: cost?.itemId || 1001,
    stockCount,
    boughtCount,
    remainingCount,
    special: !!raw?.special,
    stockStatus: noStock ? 'no_stock' : soldOut ? 'sold_out' : 'available',
    noStock,
    soldOut,
    purchasable,
    statusLabel: noStock ? '无库存' : soldOut ? '售罄' : purchasable ? '可购买' : '不可购买',
    source: 'random',
  };
}

/**
 * 标准化随机商店信息
 */
function normalizeRandomShopInfo(raw) {
  if (!raw) return null;

  const items = (Array.isArray(raw?.items) ? raw.items : [])
    .map(normalizeRandomShopItem)
    .filter(Boolean);

  return {
    items,
    nextRefreshTime: toNum(raw?.next_refresh_time ?? raw?.nextRefreshTime),
    manualRefreshCost: toNum(raw?.manual_refresh_cost ?? raw?.manualRefreshCost),
    manualRefreshCurrencyId: toNum(raw?.manual_refresh_currency_id ?? raw?.manualRefreshCurrencyId),
    manualRefreshExtraValue: toNum(
      raw?.manual_refresh_extra_value ??
      raw?.manualRefreshExtraValue ??
      raw?.fallback_refresh_cost ??
      raw?.fallbackRefreshCost ??
      raw?.manual_refresh_count ??
      raw?.manualRefreshCount ??
      0
    ),
    maxManualRefreshCount: 6,
    manualRefreshUsedCount: toNum(raw?.manual_refresh_used_count ?? raw?.manualRefreshUsedCount),
  };
}

/**
 * 标准化兑换商店单品
 */
function normalizeExchangeShopItem(raw) {
  if (!raw) return null;

  const item = normalizeActivityItem(raw?.item);
  const cost = normalizeActivityItem(raw?.cost);
  if (!item) return null;

  const itemInfo = getItemById(item.itemId) || {};
  const itemType = toNum(itemInfo.type);
  const interactionType = String(itemInfo.interaction_type || itemInfo.interactionType || '');
  const name = String(raw?.name || item.name || '').trim() || item.name;
  const status = toNum(raw?.status);
  const owned = raw?.owned === true;
  const isRepeatable = itemType === 7 || interactionType === 'fertilizer' || interactionType === 'fertilizerpro';
  const exchangeLimit = isRepeatable && status > 1 ? status : 0;
  const ownedBlocksExchange = owned && !isRepeatable;
  const isDecoration = itemType === 18
    || /装扮/.test(String(itemInfo.desc || ''))
    || /装扮/.test(String(itemInfo.effectDesc || ''))
    || /(?:小屋|街道|狗屋|木牌|仓库|栅栏|围栏|头像框)$/.test(name)
    || name.startsWith('枕水听荷');

  return {
    id: toNum(raw?.id),
    sort: toNum(raw?.sort),
    status,
    owned,
    isRepeatable,
    exchangeLimit,
    ownedBlocksExchange,
    statusLabel: ownedBlocksExchange
      ? '已拥有'
      : status === 1 || exchangeLimit > 0
        ? '可兑换'
        : status === 5
          ? '特殊商品'
          : status === 120 || status === 130
            ? '可兑换'
            : `状态${status}`,
    name,
    itemId: item.itemId,
    itemCount: item.count,
    itemName: name,
    image: item.image || '',
    itemType,
    itemTypeLabel: isDecoration ? '装扮' : itemType === 7 ? '道具' : `类型${itemType || 0}`,
    isDecoration,
    currencyId: cost?.itemId || 0,
    currencyName: cost?.name || '',
    price: cost?.count || 0,
    desc: String(getItemById(item.itemId)?.desc || getItemById(item.itemId)?.effectDesc || ''),
    extra: String(raw?.extra || ''),
  };
}

// ---- 活动树遍历 ----

function flattenActivityNode(node, result = []) {
  if (!node) return result;
  if (node.activity) {
    if (!node.activity.random_shop && node.random_shop) node.activity.random_shop = node.random_shop;
    if (!node.activity.exchange_shop && node.exchange_shop) node.activity.exchange_shop = node.exchange_shop;
    if (!node.activity.draw_info && node.draw_info) node.activity.draw_info = node.draw_info;
    result.push(node.activity);
  }
  for (const child of Array.isArray(node.children) ? node.children : []) {
    flattenActivityNode(child, result);
  }
  return result;
}

function flattenActivityChildren(reply) {
  const list = flattenActivityNode(reply?.group, []);
  for (const group of Array.isArray(reply?.groups) ? reply.groups : []) {
    flattenActivityNode(group, list);
  }
  if (Array.isArray(reply?.activities)) list.push(...reply.activities);
  return list.filter(Boolean);
}

// ---- 原始 Protobuf 扫描（回退方案） ----

function skipUnknown(reader, wireType) {
  try {
    reader.skipType(wireType);
  } catch {
    reader.pos = reader.len;
  }
}

/**
 * 扫描长度分隔字段
 */
function scanLengthDelimitedFields(rawBytes, targetFieldNum, maxDepth = 3, results = []) {
  const buf = Buffer.from(rawBytes || []);
  if (buf.length === 0 || maxDepth <= 0) return results;

  const reader = protobuf.Reader.create(buf);
  while (reader.pos < reader.len) {
    let tag = 0;
    try {
      tag = reader.uint32();
    } catch {
      break;
    }
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x7;

    if (wireType === 2) {
      let bytes = null;
      try {
        bytes = reader.bytes();
      } catch {
        break;
      }
      if (fieldNum === targetFieldNum) results.push(Buffer.from(bytes));
      scanLengthDelimitedFields(bytes, targetFieldNum, maxDepth - 1, results);
      continue;
    }

    skipUnknown(reader, wireType);
  }
  return results;
}

/**
 * 从原始 body 中扫描随机商店信息
 */
function scanRandomShopInfoFromRawBody(rawBody) {
  if (!rawBody || rawBody.length === 0) return null;

  const RandomShopInfo = types.ActivityRandomShopInfo;
  if (!RandomShopInfo) return null;

  let best = null;
  const seen = new Set();

  for (const chunk of scanLengthDelimitedFields(rawBody, 7)) {
    try {
      const decoded = RandomShopInfo.decode(chunk);
      const normalized = normalizeRandomShopInfo(decoded);
      if (!normalized || normalized.items.length === 0) continue;

      const deduped = [];
      for (const item of normalized.items) {
        if (!item) continue;
        const key = `${item.id}:${item.itemId}:${item.price}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
      }

      normalized.items = deduped;

      if (!best || normalized.items.length > best.items.length) {
        best = normalized;
      }
    } catch {
      // 跳过解码失败的块
    }
  }

  return best;
}

/**
 * 从原始 body 中扫描兑换商店信息
 */
function scanExchangeShopInfoFromRawBody(rawBody) {
  if (!rawBody || rawBody.length === 0) return null;

  const ExchangeShopInfo = types.ActivityExchangeShopInfo;
  if (!ExchangeShopInfo) return null;

  let best = null;
  const seen = new Set();

  for (const chunk of scanLengthDelimitedFields(rawBody, 102)) {
    try {
      const decoded = ExchangeShopInfo.decode(chunk);
      const items = (Array.isArray(decoded?.items) ? decoded.items : [])
        .map(normalizeExchangeShopItem)
        .filter(Boolean);
      if (items.length === 0) continue;

      const deduped = [];
      for (const item of items) {
        const key = `${item.id}:${item.itemId}:${item.currencyId}:${item.price}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
      }

      const normalized = {
        items: deduped.sort((a, b) => {
          if (a.sort !== b.sort) return a.sort - b.sort;
          return a.id - b.id;
        }),
      };

      if (!best || normalized.items.length > best.items.length) best = normalized;
    } catch {
      // skip
    }
  }

  return best;
}

function scanDrawInfoFromRawBody(rawBody) {
  if (!rawBody || rawBody.length === 0) return null;

  const DrawInfo = types.ActivityDrawInfo;
  if (!DrawInfo) return null;

  let best = null;
  for (const chunk of scanLengthDelimitedFields(rawBody, 105)) {
    try {
      const decoded = DrawInfo.decode(chunk);
      const normalized = normalizeDrawInfo(decoded);
      if (!normalized || normalized.rewardPool.length === 0) continue;
      if (!best || normalized.rewardPool.length > best.rewardPool.length) best = normalized;
    } catch {
      // skip
    }
  }
  return best;
}

function getHeluActivityUidCandidates() {
  return [HELU_ACTIVITY_UID, 'SAIJI_DRAW', 'SaiJi', 'HeLu', 'Helu', ''];
}

async function getActivityGroupWithUidFallback(activityId, uidCandidates) {
  let lastErr = null;
  for (const uid of uidCandidates) {
    try {
      const reply = await getActivityGroup(activityId, uid);
      const activities = flattenActivityChildren(reply);
      if (activities.length > 0) {
        Object.defineProperty(reply, '__activityUid', {
          value: uid,
          enumerable: false,
          configurable: true,
        });
        return reply;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return getActivityGroup(activityId, uidCandidates[0]);
}

async function getHeluBalance() {
  try {
    const bag = await getBag();
    const items = getBagItems(bag);
    for (const item of items || []) {
      if (toNum(item?.id) === HELU_CURRENCY_ITEM_ID) {
        return Math.max(0, toNum(item?.count));
      }
    }
  } catch {
    // ignore
  }
  return 0;
}

async function getBagItemCount(itemId) {
  try {
    const bag = await getBag();
    return (getBagItems(bag) || [])
      .filter(entry => toNum(entry?.id) === toNum(itemId))
      .reduce((sum, item) => sum + Math.max(0, toNum(item?.count)), 0);
  } catch {
    return 0;
  }
}

async function getQingmeiWineMaterialItems() {
  const bag = await getBag();
  return (getBagItems(bag) || [])
    .map(item => ({
      id: toNum(item?.id),
      uid: toNum(item?.uid),
      count: Math.max(0, toNum(item?.count)),
      mutantType: Array.isArray(item?.mutant_types) && item.mutant_types.length
        ? Math.min(...item.mutant_types.map(toNum).filter(value => value > 0))
        : 0,
    }))
    .filter(item => item.id === QINGMEI_FRUIT_ITEM_ID && item.uid > 0 && item.count > 0)
    .sort((a, b) => {
      const aOrder = a.mutantType > 0 ? a.mutantType : Number.MAX_SAFE_INTEGER;
      const bOrder = b.mutantType > 0 ? b.mutantType : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.uid - b.uid;
    })
    .map(item => ({
      id: item.uid,
      count: item.count,
    }));
}

function normalizeQingmeiActivity(reply) {
  const activities = flattenActivityChildren(reply);
  const root = reply?.group?.activity || activities.find(item => toNum(item?.id) === QINGMEI_ACTIVITY_ID) || {};
  const claim = activities.find(item => toNum(item?.id) === QINGMEI_SEED_CLAIM_ACTIVITY_ID) || {};
  const wine = activities.find(item => toNum(item?.id) === QINGMEI_WINE_ACTIVITY_ID) || {};
  const status = toNum(claim?.status);
  const claimedToday = isQingmeiClaimedToday();
  const hasServerClaimStatus = claim?.status !== undefined && claim?.status !== null;
  const materialInfo = getItemById(QINGMEI_FRUIT_ITEM_ID);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claimEndTime = toNum(claim?.end_time ?? claim?.endTime) || QINGMEI_SEED_CLAIM_END_TIME;
  const wineEndTime = toNum(wine?.end_time ?? wine?.endTime ?? root?.end_time ?? root?.endTime) || QINGMEI_WINE_END_TIME;
  const claimActive = nowSeconds <= claimEndTime;
  const wineActive = nowSeconds <= wineEndTime;

  return {
    uid: reply?.__activityUid || QINGMEI_ACTIVITY_UID,
    title: '青酿换万金',
    activityId: toNum(root?.id) || QINGMEI_ACTIVITY_ID,
    claimActivityId: toNum(claim?.id) || QINGMEI_SEED_CLAIM_ACTIVITY_ID,
    claimCommand: QINGMEI_SEED_CLAIM_CMD,
    wineActivityId: toNum(wine?.id) || QINGMEI_WINE_ACTIVITY_ID,
    wineTitle: wine?.title || '青酿换万金',
    winePreviewCommand: QINGMEI_WINE_PREVIEW_CMD,
    wineBrewCommand: QINGMEI_WINE_BREW_CMD,
    wineSellCommand: QINGMEI_WINE_SELL_CMD,
    startTime: toNum(root?.start_time ?? root?.startTime ?? claim?.start_time ?? claim?.startTime),
    endTime: toNum(root?.end_time ?? root?.endTime ?? claim?.end_time ?? claim?.endTime),
    status,
    claimed: claimedToday || (hasServerClaimStatus && status === 3),
    // 领取节点通常不下发每日领取状态；未知时允许用户点击，由 Operate
    // 的“已领取”响应校准本进程当天状态。
    claimable: claimActive && !claimedToday && (!hasServerClaimStatus || status !== 3) && claim?.enabled !== false,
    claimStatusKnown: claimedToday || hasServerClaimStatus,
    claimActive,
    wineActive,
    reward: {
      itemId: QINGMEI_SEED_ITEM_ID,
      itemCount: QINGMEI_SEED_REWARD_COUNT,
      itemName: getItemById(QINGMEI_SEED_ITEM_ID)?.name || '青梅种子',
      image: getItemImageById(QINGMEI_SEED_ITEM_ID) || '',
    },
    material: {
      itemId: QINGMEI_FRUIT_ITEM_ID,
      itemCount: 0,
      itemName: materialInfo?.name || '青梅',
      image: getItemImageById(QINGMEI_FRUIT_ITEM_ID) || '',
    },
    payload: parsePayload(root?.payload || wine?.payload || claim?.payload),
  };
}

async function getQingmeiActivity() {
  try {
    const reply = await getActivityGroupWithUidFallback(QINGMEI_ACTIVITY_ID, [QINGMEI_ACTIVITY_UID, '']);
    const activity = normalizeQingmeiActivity(reply);
    activity.material.itemCount = await getBagItemCount(QINGMEI_FRUIT_ITEM_ID);
    return activity;
  } catch (err) {
    const materialInfo = getItemById(QINGMEI_FRUIT_ITEM_ID);
    const nowSeconds = Math.floor(Date.now() / 1000);
    return {
      uid: QINGMEI_ACTIVITY_UID,
      title: '青酿换万金',
      activityId: QINGMEI_ACTIVITY_ID,
      claimActivityId: QINGMEI_SEED_CLAIM_ACTIVITY_ID,
      claimCommand: QINGMEI_SEED_CLAIM_CMD,
      wineActivityId: QINGMEI_WINE_ACTIVITY_ID,
      wineTitle: '青酿换万金',
      winePreviewCommand: QINGMEI_WINE_PREVIEW_CMD,
      wineBrewCommand: QINGMEI_WINE_BREW_CMD,
      wineSellCommand: QINGMEI_WINE_SELL_CMD,
      claimActive: nowSeconds <= QINGMEI_SEED_CLAIM_END_TIME,
      wineActive: nowSeconds <= QINGMEI_WINE_END_TIME,
      claimed: false,
      claimable: false,
      reward: {
        itemId: QINGMEI_SEED_ITEM_ID,
        itemCount: QINGMEI_SEED_REWARD_COUNT,
        itemName: getItemById(QINGMEI_SEED_ITEM_ID)?.name || '青梅种子',
        image: getItemImageById(QINGMEI_SEED_ITEM_ID) || '',
      },
      material: {
        itemId: QINGMEI_FRUIT_ITEM_ID,
        itemCount: await getBagItemCount(QINGMEI_FRUIT_ITEM_ID),
        itemName: materialInfo?.name || '青梅',
        image: getItemImageById(QINGMEI_FRUIT_ITEM_ID) || '',
      },
      warning: err?.message || String(err),
    };
  }
}

async function claimQingmeiSeeds() {
  const beforeCount = await getBagItemCount(QINGMEI_SEED_ITEM_ID);
  let reply = null;
  try {
    reply = await operateActivityReply(QINGMEI_SEED_CLAIM_ACTIVITY_ID, QINGMEI_SEED_CLAIM_CMD, {
      qingmeiClaim: { type: QINGMEI_SEED_CLAIM_TYPE },
    });
  } catch (err) {
    if (isAlreadyClaimedError(err)) {
      markQingmeiClaimedToday();
      return {
        ok: true,
        alreadyClaimed: true,
        claimedCount: 0,
        beforeCount,
        afterCount: beforeCount,
        qingmei: await getQingmeiActivity(),
      };
    }
    throw err;
  }

  const claimResult = normalizeQingmeiClaimResult(reply?.qingmei_claim);
  await delay(HELU_DRAW_REFRESH_DELAY_MS);
  const afterCount = await getBagItemCount(QINGMEI_SEED_ITEM_ID);
  const claimedCount = claimResult.claimedCount || Math.max(0, afterCount - beforeCount);
  if (claimedCount <= 0) {
    throw new Error('领取青梅种子失败: 服务端未返回奖励，背包数量也未增加');
  }
  if (claimedCount > 0) markQingmeiClaimedToday();

  activityLogger.info('领取青梅种子完成', {
    event: 'qingmei_seed_claim',
    itemId: QINGMEI_SEED_ITEM_ID,
    beforeCount,
    afterCount,
    claimedCount,
    rewardItems: claimResult.items,
  });

  return {
    ok: true,
    claimedCount,
    beforeCount,
    afterCount,
    rewards: claimResult.items,
    qingmei: await getQingmeiActivity(),
  };
}

async function brewAndSellQingmeiWine(options = {}) {
  const share = options?.share !== false;
  const brewSteps = Math.max(1, Number(options?.brewSteps) || QINGMEI_FINE_BREW_STEPS);
  const materialItems = await getQingmeiWineMaterialItems();
  const beforeMaterialCount = materialItems.reduce((sum, item) => sum + Math.max(0, toNum(item?.count)), 0);
  if (beforeMaterialCount <= 0) {
    throw createQingmeiWineError('material', '青梅不足，无法精酿');
  }

  let previewReply = null;
  let previewWarning = '';
  try {
    previewReply = await operateActivityReply(QINGMEI_WINE_ACTIVITY_ID, QINGMEI_WINE_PREVIEW_CMD, {
      qingmeiWineStart: { items: materialItems },
    });
  } catch (err) {
    previewWarning = `打开青梅酿售卖失败，已尝试直接精酿: ${err.message}`;
  }
  const preview = normalizeQingmeiPreviewResult(previewReply?.qingmei_preview);
  await delay(QINGMEI_WINE_STEP_DELAY_MS);

  const brews = [];
  for (let index = 0; index < brewSteps; index += 1) {
    let brewReply = null;
    try {
      brewReply = await operateActivityReply(QINGMEI_WINE_ACTIVITY_ID, QINGMEI_WINE_BREW_CMD, {
        qingmeiWineBrew: true,
      });
    } catch (err) {
      if (index === 0 && isNoOngoingQingmeiBrewError(err)) {
        try {
          const retryMaterialItems = await getQingmeiWineMaterialItems();
          previewReply = await operateActivityReply(QINGMEI_WINE_ACTIVITY_ID, QINGMEI_WINE_PREVIEW_CMD, {
            qingmeiWineStart: { items: retryMaterialItems },
          });
          await delay(QINGMEI_WINE_STEP_DELAY_MS);
          brewReply = await operateActivityReply(QINGMEI_WINE_ACTIVITY_ID, QINGMEI_WINE_BREW_CMD, {
            qingmeiWineBrew: true,
          });
        } catch (retryErr) {
          throw createQingmeiWineError('brew', `青梅酿精酿失败: ${retryErr.message}`, retryErr);
        }
      } else {
        throw createQingmeiWineError('brew', `青梅酿精酿失败: ${err.message}`, err);
      }
    }
    const brew = normalizeQingmeiBrewResult(brewReply?.qingmei_brew);
    if (brew) brews.push(brew);
    await delay(QINGMEI_WINE_STEP_DELAY_MS);
  }

  const finalBrew = brews[brews.length - 1] || null;
  if (!finalBrew) {
    throw createQingmeiWineError('brew', beforeMaterialCount <= 0
      ? '青梅不足，无法精酿'
      : '精酿未返回有效结果，请稍后重试');
  }

  let shareResult = { canShare: false, shared: false, success: false };
  if (share && finalBrew?.canDouble) {
    try {
      shareResult = await reportQingmeiShareForDouble();
    } catch (err) {
      throw createQingmeiWineError('share', `青梅酿分享翻倍失败: ${err.message}`, err);
    }
    await delay(HELU_DRAW_REFRESH_DELAY_MS);
  }

  let sellReply = null;
  const sellMultiple = shareResult.shared ? 2 : 1;
  try {
    sellReply = await operateActivityReply(QINGMEI_WINE_ACTIVITY_ID, QINGMEI_WINE_SELL_CMD, {
      qingmeiWineSell: { multiple: sellMultiple },
    });
  } catch (err) {
    throw createQingmeiWineError('sell', `青梅酿售卖失败: ${err.message}`, err);
  }
  const sell = normalizeQingmeiSellResult(sellReply?.qingmei_sell);
  if (!sell || sell.gold <= 0) {
    throw createQingmeiWineError('sell', '售卖未返回金币收益，请稍后刷新活动状态');
  }
  await delay(HELU_DRAW_REFRESH_DELAY_MS);
  const afterMaterialCount = await getBagItemCount(QINGMEI_FRUIT_ITEM_ID);

  activityLogger.info('青梅酿售卖完成', {
    event: 'qingmei_wine_sell',
    beforeMaterialCount,
    afterMaterialCount,
    materialBatchCount: materialItems.length,
    brewSteps: brews.length,
    wineType: finalBrew?.wineType,
    price: finalBrew?.price,
    shared: shareResult.shared,
    sellMultiple,
    gold: sell?.gold,
  });

  return {
    ok: true,
    beforeMaterialCount,
    afterMaterialCount,
    consumedCount: Math.max(0, beforeMaterialCount - afterMaterialCount),
    materialBatchCount: materialItems.length,
    preview,
    previewWarning,
    brews,
    brew: finalBrew,
    share: shareResult,
    sell,
    activity: await getStarActivity().catch(() => null),
  };
}

function computeHeluDrawActions(drawInfo) {
  const freeRemaining = Math.max(0, toNum(drawInfo?.freeRemaining));
  const paidRemaining = Math.max(0, toNum(drawInfo?.paidRemaining));
  const paidPrice = Math.max(0, toNum(drawInfo?.paidPrice));
  const paidCurrencyId = toNum(drawInfo?.paidCurrencyId) || 1002;

  const drawOneIsFree = freeRemaining > 0;
  const drawOnePaid = !drawOneIsFree && paidRemaining > 0;
  const drawOneCount = drawOneIsFree || drawOnePaid ? 1 : 0;

  let batchCount = 0;
  let batchCost = 0;
  let batchType = 'none';
  if (freeRemaining > 0) {
    batchCount = Math.min(4, freeRemaining);
    batchType = 'free';
  } else if (paidRemaining > 0) {
    batchCount = Math.min(4, paidRemaining);
    batchCost = batchCount * paidPrice;
    batchType = 'paid';
  }

  return {
    one: {
      count: drawOneCount,
      available: drawOneCount > 0,
      cost: drawOnePaid ? paidPrice : 0,
      currencyId: drawOnePaid ? paidCurrencyId : 0,
      type: drawOneIsFree ? 'free' : drawOnePaid ? 'paid' : 'none',
      label: drawOneIsFree ? '免费1次' : drawOnePaid ? `${paidPrice}点券1次` : '已抽完',
    },
    batch: {
      count: batchCount,
      available: batchCount > 0,
      cost: batchCost,
      currencyId: batchType === 'paid' ? paidCurrencyId : 0,
      type: batchType,
      label: batchType === 'free'
        ? `免费${batchCount}次`
        : batchType === 'paid'
          ? `${batchCost}点券${batchCount}次`
          : '已抽完',
    },
  };
}

function normalizeSeasonRewardTier(rawBytes) {
  const entries = readProtoFields(rawBytes);
  return {
    level: getProtoNumber(entries, 1),
    freeRewards: getProtoBytesAll(entries, 2).map(parseActivityItemMessage).filter(Boolean),
    premiumRewards: getProtoBytesAll(entries, 3).map(parseActivityItemMessage).filter(Boolean),
  };
}

function normalizeSeasonPassport(rawBytes, rewardItems = []) {
  const entries = readProtoFields(rawBytes);
  const currentLevel = getProtoNumber(entries, 2);
  const score = getProtoNumber(entries, 3);
  const currentProgress = getProtoNumber(entries, 4);
  const nextLevelNeed = getProtoNumber(entries, 5);
  const maxLevel = getProtoNumber(entries, 6);
  const freeClaimedLevel = getProtoNumber(entries, 9);
  const premiumClaimedLevel = getProtoNumber(entries, 11);
  const levelRewardTiers = getProtoBytesAll(entries, 8)
    .map(normalizeSeasonRewardTier)
    .filter((tier) => tier.level > 0);

  return {
    uid: HELU_PASSPORT_UID,
    title: getProtoString(entries, 16, '荷风游记'),
    activityId: getProtoNumber(entries, 1) || HELU_ACTIVITY_ID,
    currentLevel,
    score,
    currentProgress,
    nextLevelNeed,
    maxLevel,
    freeClaimedLevel,
    premiumClaimedLevel,
    claimableLevels: Math.max(0, currentLevel - freeClaimedLevel),
    rewardTierCount: levelRewardTiers.length,
    levelRewardTiers,
    rewards: rewardItems,
    configText: getProtoString(entries, 17, ''),
  };
}

function normalizeSeasonInfo(rawBody) {
  const replyEntries = readProtoFields(rawBody);
  const seasonBytes = getProtoBytes(replyEntries, 1);
  if (!seasonBytes) {
    return {
      uid: HELU_PASSPORT_UID,
      title: '荷风游记',
      currentLevel: 0,
      claimableLevels: 0,
      rewards: [],
      levelRewardTiers: [],
    };
  }

  const seasonEntries = readProtoFields(seasonBytes);
  const passportBytes = getProtoBytes(seasonEntries, 10);
  const passport = normalizeSeasonPassport(passportBytes, []);

  return {
    ...passport,
    seasonTitle: getProtoString(seasonEntries, 2, HELU_TITLE),
    seasonStatus: getProtoNumber(seasonEntries, 3),
    startTime: getProtoNumber(seasonEntries, 5),
    endTime: getProtoNumber(seasonEntries, 6),
    nowTime: getProtoNumber(seasonEntries, 7),
  };
}

function normalizeSeasonClaimResult(rawBody) {
  const entries = readProtoFields(rawBody);
  const rewards = getProtoBytesAll(entries, 1).map(parseActivityItemMessage).filter(Boolean);
  const passportBytes = getProtoBytes(entries, 3);
  return {
    rewards,
    passport: passportBytes ? normalizeSeasonPassport(passportBytes, rewards) : null,
  };
}

function solarStatusLabel(status) {
  if (status === 2) return '可领取';
  if (status === 3) return '已领取';
  if (status === 1) return '未开启';
  if (status === 5) return '已结束';
  return '暂不可领取';
}

function normalizeSolarTerm(rawBytes) {
  const entries = readProtoFields(rawBytes);
  const status = getProtoNumber(entries, 2);
  return {
    id: getProtoNumber(entries, 1),
    status,
    statusLabel: solarStatusLabel(status),
    claimable: status === 2,
    startTime: getProtoNumber(entries, 3),
    endTime: getProtoNumber(entries, 4),
    rewards: getProtoBytesAll(entries, 5).map(parseActivityItemMessage).filter(Boolean),
    title: getProtoString(entries, 6, '') || solarTermNames.get(getProtoNumber(entries, 1)) || '节令赠礼',
  };
}

function isSolarTermClaimable(term, now) {
  return term?.status === 2 && Number.isFinite(now) && term.startTime > 0
    && term.endTime >= term.startTime && now >= term.startTime && now <= term.endTime;
}
function normalizeSolarTermsInfo(rawBody) {
  const entries = readProtoFields(rawBody);
  const terms = getProtoBytesAll(entries, 1)
    .map(normalizeSolarTerm)
    .filter((term) => term.id > 0);
  const configEntries = readProtoFields(getProtoBytes(entries, 3));
  const nowTime = getProtoNumber(entries, 2) || require('../utils/utils').getServerTimeSec();
  for (const term of terms) {
    term.claimable = isSolarTermClaimable(term, nowTime);
    term.statusLabel = term.status === 3 ? '已领取' : nowTime > term.endTime && term.endTime > 0 ? '已结束'
      : nowTime < term.startTime ? '未开始' : term.claimable ? '可领取' : '暂不可领取';
  }
  const group = term => term.claimable ? 0 : term.startTime <= nowTime && nowTime <= term.endTime ? 1 : term.startTime > nowTime ? 2 : 3;
  terms.sort((a, b) => group(a) - group(b) || (group(a) === 3 ? b.startTime - a.startTime : a.startTime - b.startTime));
  return {
    nowTime,
    terms,
    claimableCount: terms.filter((term) => term.claimable).length,
    currentTerm: terms.find(term => term.startTime <= nowTime && nowTime <= term.endTime) || null,
    nextTerm: terms.find(term => term.startTime > nowTime) || null,
    tipsText: getProtoString(configEntries, 3, ''),
  };
}

function normalizeSolarTermsClaimResult(rawBody) {
  const entries = readProtoFields(rawBody);
  const termBytes = getProtoBytes(entries, 2);
  return {
    rewards: getProtoBytesAll(entries, 1).map(parseActivityItemMessage).filter(Boolean),
    term: termBytes ? normalizeSolarTerm(termBytes) : null,
  };
}

async function getSeasonPassport() {
  return normalizeSeasonInfo(await getSeasonInfoRaw());
}

async function claimSeasonPassportRewards() {
  const before = await getSeasonPassport();
  const result = normalizeSeasonClaimResult(await claimSeasonRewardsRaw());
  const after = await getSeasonPassport();

  activityLogger.info('荷风游记领取成功', {
    event: 'season_passport_claim',
    beforeLevel: before.currentLevel,
    beforeClaimedLevel: before.freeClaimedLevel,
    afterLevel: after.currentLevel,
    afterClaimedLevel: after.freeClaimedLevel,
    rewardCount: result.rewards.length,
  });

  return {
    ok: true,
    rewards: result.rewards,
    passport: after,
    claimedLevels: Math.max(0, after.freeClaimedLevel - before.freeClaimedLevel),
  };
}

async function getSolarTermsInfo() {
  return normalizeSolarTermsInfo(await getSolarTermsRaw());
}

async function claimSolarTermsReward(termId = 0) {
  const before = await getSolarTermsInfo();
  const resolvedTermId = Number(termId) || toNum(before?.currentTerm?.id);
  if (resolvedTermId <= 0) throw new Error('未找到可领取的节令奖励');

  const target = (before.terms || []).find((term) => term.id === resolvedTermId) || null;
  if (!target || !target.claimable) {
    throw new Error(`${target?.title || '该节令'}当前不可领取`);
  }

  const result = normalizeSolarTermsClaimResult(await claimSolarTermsRaw(resolvedTermId));
  const after = await getSolarTermsInfo();

  activityLogger.info('节令小札领取成功', {
    event: 'solar_terms_claim',
    termId: resolvedTermId,
    termTitle: target?.title || result.term?.title || '',
    rewardCount: result.rewards.length,
  });

  return {
    ok: true,
    termId: resolvedTermId,
    rewards: result.rewards,
    term: result.term,
    solarTerms: after,
  };
}

function parseStarRecordExtra(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeStarRecord(node) {
  const info = node?.star_record || node?.starRecord || {};
  const configs = Array.isArray(info?.configs) ? info.configs : [];
  const states = new Map(
    (Array.isArray(info?.records) ? info.records : [])
      .map(record => [toNum(record?.id), record])
  );

  const records = configs.map((config) => {
    const id = toNum(config?.id);
    const state = states.get(id) || {};
    const extra = parseStarRecordExtra(config?.extra);
    return {
      id,
      title: String(config?.title || `星宿${id}`),
      category: String(extra?.category || ''),
      explain: String(extra?.explain || ''),
      graph: String(config?.graph || ''),
      featured: !!config?.featured,
      unlocked: !!state?.unlocked,
      claimed: !!state?.claimed,
      claimable: !!state?.unlocked && !state?.claimed,
      rewards: (state?.rewards || []).map(normalizeCoreItem).filter(item => item.itemId > 0),
    };
  });

  return {
    status: toNum(info?.status),
    openedDays: toNum(info?.opened_days ?? info?.openedDays),
    records,
    totalCount: records.length,
    unlockedCount: records.filter(record => record.unlocked).length,
    claimedCount: records.filter(record => record.claimed).length,
    claimableCount: records.filter(record => record.claimable).length,
  };
}

function findActivityNode(nodes, activityId) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (toNum(node?.activity?.id) === toNum(activityId)) return node;
    const child = findActivityNode(node?.children, activityId);
    if (child) return child;
  }
  return null;
}

async function getStarActivity() {
  if (!getUserState()) {
    return {
      uid: STAR_ACTIVITY_UID,
      title: '心许千灯星垂野',
      activityId: STAR_ACTIVITY_ID,
      starRecord: normalizeStarRecord(null),
      exchangeShop: [],
      starSandBalance: 0,
      passport: null,
      solarTerms: null,
      qingmei: await getQingmeiActivity(),
      warning: 'runtime connection is not open',
    };
  }

  const listed = await listActivityGroups();
  const rootNode = findActivityNode(listed?.groups, STAR_ACTIVITY_ID);
  const recordNode = findActivityNode(listed?.groups, STAR_RECORD_ACTIVITY_ID);
  if (!rootNode || !recordNode) {
    throw new Error('未在活动列表中找到“心许千灯星垂野”');
  }

  let shopItems = [];
  let shopWarning = '';
  try {
    const shopReply = await operateActivityReply(STAR_SHOP_ACTIVITY_ID, STAR_SHOP_OPEN_CMD);
    const shopNode = shopReply?.group || null;
    const shop = shopNode?.exchange_shop || shopNode?.exchangeShop || null;
    shopItems = (shop?.items || []).map(normalizeExchangeShopItem).filter(Boolean).map(item => ({
      ...item,
      currencyName: item.currencyId === STAR_SAND_ITEM_ID ? '星砂' : item.currencyName,
    }));
  } catch (err) {
    shopWarning = err?.message || String(err);
  }

  const currencyId = toNum(shopItems.find(item => item.currencyId > 0)?.currencyId) || STAR_SAND_ITEM_ID;
  const [passport, solarTerms, starSandBalance, qingmei] = await Promise.all([
    getSeasonPassport().catch(err => ({ title: '千星游记', warning: err?.message || String(err), claimableLevels: 0 })),
    getSolarTermsInfo().catch(err => ({ terms: [], claimableCount: 0, warning: err?.message || String(err) })),
    currencyId > 0 ? getBagItemCount(currencyId) : Promise.resolve(0),
    getQingmeiActivity(),
  ]);

  return {
    uid: STAR_ACTIVITY_UID,
    title: String(rootNode?.activity?.title || '心许千灯星垂野'),
    activityId: STAR_ACTIVITY_ID,
    recordActivityId: STAR_RECORD_ACTIVITY_ID,
    recordClaimCommand: STAR_RECORD_CLAIM_CMD,
    shopActivityId: STAR_SHOP_ACTIVITY_ID,
    shopOpenCommand: STAR_SHOP_OPEN_CMD,
    startTime: toNum(rootNode?.activity?.start_time),
    endTime: toNum(rootNode?.activity?.end_time),
    starRecord: normalizeStarRecord(recordNode),
    exchangeShop: shopItems,
    shopReadOnly: false,
    shopWarning,
    starSandCurrencyId: currencyId,
    starSandBalance,
    passport,
    solarTerms,
    qingmei,
    summary: {
      starCount: normalizeStarRecord(recordNode).totalCount,
      exchangeShopCount: shopItems.length,
    },
  };
}

async function claimStarRecordRewards() {
  assertActivityConnection('观星礼录领取');
  const before = await getStarActivity();
  if (before?.starRecord?.claimableCount <= 0) {
    throw new Error('当前没有可点亮或领取的星宿');
  }

  const reply = await operateActivityReply(STAR_RECORD_ACTIVITY_ID, STAR_RECORD_CLAIM_CMD);
  const result = reply?.star_record_claim || reply?.starRecordClaim || {};
  const recordIds = (result?.record_ids || result?.recordIds || []).map(toNum).filter(id => id > 0);
  const rewards = (result?.rewards || []).map(normalizeCoreItem).filter(item => item.itemId > 0);
  const after = await getStarActivity();

  activityLogger.info('观星礼录领取成功', {
    event: 'star_record_claim',
    recordIds,
    rewardCount: rewards.length,
  });

  return {
    ok: true,
    recordIds,
    rewards,
    activity: after,
  };
}

async function exchangeStarShopItem(slotId, count = 1) {
  const slotIdNum = Number(slotId) || 0;
  if (slotIdNum <= 0) throw new Error('缺少有效的星砂商店槽位');

  const exchangeCount = Math.floor(Number(count) || 0);
  if (exchangeCount <= 0) throw new Error('兑换数量必须大于 0');

  const before = await getStarActivity();
  const slots = Array.isArray(before?.exchangeShop) ? before.exchangeShop : [];
  const slot = slots.find(item => toNum(item?.id) === slotIdNum);
  if (!slot) throw new Error(`星砂商店未找到槽位: ${slotIdNum}`);

  const price = Math.max(0, toNum(slot?.price));
  const balance = Math.max(0, toNum(before?.starSandBalance));
  const exchangeLimit = Math.max(0, toNum(slot?.exchangeLimit));
  const totalPrice = price * exchangeCount;
  const ownedBlocksExchange = slot?.ownedBlocksExchange !== false
    && slot?.owned
    && !slot?.isRepeatable;

  if (toNum(slot?.currencyId) !== STAR_SAND_ITEM_ID) {
    throw new Error(`暂不支持非星砂货币兑换: slotId=${slotIdNum}`);
  }
  if (ownedBlocksExchange) throw new Error(`该商品已拥有，不能重复兑换: slotId=${slotIdNum}`);
  if (!slot?.isRepeatable && exchangeCount > 1) throw new Error('该商品每次只能兑换 1 个');
  if (exchangeLimit > 0 && exchangeCount > exchangeLimit) {
    throw new Error(`兑换数量超过上限: 最多可兑换 ${exchangeLimit} 个`);
  }
  if (totalPrice > balance) throw new Error(`星砂不足: 需要 ${totalPrice}, 当前 ${balance}`);

  activityLogger.info('星砂商店兑换开始', {
    slotId: slotIdNum,
    itemId: toNum(slot?.itemId),
    itemName: slot?.itemName || slot?.name || '',
    price,
    count: exchangeCount,
    totalPrice,
    balance,
    activityId: STAR_SHOP_ACTIVITY_ID,
    cmd: STAR_SHOP_EXCHANGE_CMD,
  });

  try {
    await operateActivity(STAR_SHOP_ACTIVITY_ID, STAR_SHOP_EXCHANGE_CMD, {
      exchangeShopOperate: {
        id: slotIdNum,
        count: exchangeCount,
      },
    });
  } catch (err) {
    throw new Error(
      `星砂商店兑换失败: slotId=${slotIdNum}, itemId=${toNum(slot?.itemId)}, price=${price}: ${err.message}`
    );
  }

  return {
    ok: true,
    slotId: slotIdNum,
    price,
    count: exchangeCount,
    totalPrice,
    currencyId: STAR_SAND_ITEM_ID,
    item: slot,
    activity: await getStarActivity(),
  };
}

function normalizeHeluGroup(reply, lastDrawResult = null) {
  const activities = flattenActivityChildren(reply);
  const getDrawInfo = (act) => act?.draw_info || act?.drawInfo || null;
  const getExchangeShop = (act) => act?.exchange_shop || act?.exchangeShop || null;

  const drawAct = activities.find((a) => toNum(a?.id) === HELU_DRAW_ACTIVITY_ID)
    || activities.find((a) => /奇遇礼莲/.test(String(a?.title || '')))
    || activities.find((a) => getDrawInfo(a))
    || null;

  const exchangeAct = activities.find(
    (a) => /荷露商店/.test(String(a?.title || ''))
      || (getExchangeShop(a) && Array.isArray(getExchangeShop(a).items) && getExchangeShop(a).items.length > 0)
  ) || null;

  let drawInfo = normalizeDrawInfo(getDrawInfo(drawAct)) || scanDrawInfoFromRawBody(reply?.__rawBody);
  let exchangeItems = (getExchangeShop(exchangeAct)?.items || [])
    .map(normalizeExchangeShopItem)
    .filter(Boolean);
  const rawExchange = scanExchangeShopInfoFromRawBody(reply?.__rawBody);
  if (exchangeItems.length === 0 && rawExchange) {
    exchangeItems = rawExchange.items;
  }
  if (!drawInfo) drawInfo = normalizeDrawInfo({});
  if (!drawInfo._hasPaidRemaining && drawInfo.freeRemaining <= 0) {
    drawInfo.paidUsed = drawInfo.paidMax;
    drawInfo.paidRemaining = 0;
  }
  drawInfo.actions = computeHeluDrawActions(drawInfo);
  drawInfo.dailyMax = drawInfo.freeMax + drawInfo.paidMax;
  drawInfo.dailyUsed = drawInfo.freeUsed + drawInfo.paidUsed;
  drawInfo.dailyRemaining = drawInfo.freeRemaining + drawInfo.paidRemaining;

  const root = reply?.group?.activity || {};
  const subActivities = normalizeHeluSubActivities(activities);
  return {
    uid: reply?.__activityUid || HELU_ACTIVITY_UID,
    title: String(root?.title || '荷风十里蝉初鸣'),
    activityId: toNum(root?.id) || HELU_ACTIVITY_ID,
    drawActivityId: toNum(drawAct?.id) || HELU_DRAW_ACTIVITY_ID,
    drawCommand: HELU_DRAW_CMD,
    draw: drawInfo,
    exchangeActivityId: toNum(exchangeAct?.id),
    exchangeShop: exchangeItems,
    subActivities,
    lastDrawResult,
    summary: {
      rewardPoolCount: drawInfo.rewardPool.length,
      exchangeShopCount: exchangeItems.length,
      activityCount: activities.length,
      subActivityCount: subActivities.length,
      dailyUsed: drawInfo.dailyUsed,
      dailyRemaining: drawInfo.dailyRemaining,
    },
    raw: {
      activityCount: activities.length,
      activityTitles: activities.map((a) => String(a?.title || '')).filter(Boolean),
      activityIds: activities.map((a) => toNum(a?.id)).filter((id) => id > 0),
    },
  };
}

async function getHeluActivity() {
  const state = getUserState();
  if (!state) {
    return {
      uid: HELU_ACTIVITY_UID,
      title: '荷风十里蝉初鸣',
      draw: {
        ...normalizeDrawInfo({}),
        actions: computeHeluDrawActions(normalizeDrawInfo({})),
      },
      heluBalance: 0,
      subActivities: normalizeHeluSubActivities([]),
      passport: {
        uid: HELU_PASSPORT_UID,
        title: '荷风游记',
        currentLevel: 0,
        claimableLevels: 0,
        rewards: [],
        levelRewardTiers: [],
      },
      solarTerms: {
        terms: [],
        claimableCount: 0,
        currentTerm: null,
      },
      summary: { rewardPoolCount: 0, subActivityCount: HELU_SUB_ACTIVITY_DEFS.length },
      qingmei: await getQingmeiActivity(),
      warning: 'runtime connection is not open',
    };
  }

  const activity = normalizeHeluGroup(
    await getActivityGroupWithUidFallback(HELU_ACTIVITY_ID, getHeluActivityUidCandidates())
  );
  activity.heluBalance = await getHeluBalance();
  try {
    activity.passport = await getSeasonPassport();
  } catch (err) {
    activity.passport = {
      uid: HELU_PASSPORT_UID,
      title: '荷风游记',
      currentLevel: 0,
      claimableLevels: 0,
      rewards: [],
      levelRewardTiers: [],
      warning: err?.message || String(err),
    };
  }
  try {
    activity.solarTerms = await getSolarTermsInfo();
  } catch (err) {
    activity.solarTerms = {
      terms: [],
      claimableCount: 0,
      currentTerm: null,
      warning: err?.message || String(err),
    };
  }
  activity.qingmei = await getQingmeiActivity();
  return activity;
}

function resolveHeluDrawCount(activity, options = {}) {
  const draw = activity?.draw || {};
  const mode = String(options?.mode || '').toLowerCase();
  const requestedCount = Math.max(0, toNum(options?.count));

  if (mode === 'batch' || mode === 'four' || mode === 'max') {
    return draw.actions?.batch?.count || 0;
  }
  if (mode === 'one') return draw.actions?.one?.count || 0;
  if (requestedCount > 0) {
    if (draw.freeRemaining > 0) return Math.min(requestedCount, draw.freeRemaining);
    return Math.min(requestedCount, draw.paidRemaining);
  }
  return draw.actions?.one?.count || 0;
}

async function drawHeluGiftLotus(options = {}) {
  const before = await getHeluActivity();
  const count = resolveHeluDrawCount(before, options);
  if (count <= 0) throw new Error('奇遇礼莲今日次数已用完');

  const usingFree = toNum(before?.draw?.freeRemaining) > 0;
  const expectedCost = usingFree ? 0 : count * toNum(before?.draw?.paidPrice);

  let drawResult = null;
  const drawPayload = { id: HELU_DRAW_ACTIVITY_ID, count };
  const paidPayload = { type: 0, count };
  if (!usingFree && expectedCost > 0) {
    drawPayload.cost = {
      id: toNum(before?.draw?.paidCurrencyId) || 1002,
      count: expectedCost,
    };
  }

  const drawContext = {
    requestedMode: options?.mode || '',
    requestedCount: toNum(options?.count) || 0,
    resolvedCount: count,
    mode: usingFree ? 'free' : 'paid',
    expectedCost,
    paidCurrencyId: toNum(before?.draw?.paidCurrencyId) || 1002,
    before: {
      freeUsed: toNum(before?.draw?.freeUsed),
      freeMax: toNum(before?.draw?.freeMax),
      freeRemaining: toNum(before?.draw?.freeRemaining),
      paidUsed: toNum(before?.draw?.paidUsed),
      paidMax: toNum(before?.draw?.paidMax),
      paidRemaining: toNum(before?.draw?.paidRemaining),
      paidPrice: toNum(before?.draw?.paidPrice),
    },
    payload: usingFree ? drawPayload : paidPayload,
    legacyDrawPayload: usingFree ? null : drawPayload,
  };
  activityLogger.info('奇遇礼莲抽奖开始', drawContext);

  try {
    if (usingFree && count > 1) {
      const merged = { rewards: [], items: [], cost: null };
      for (let i = 0; i < count; i += 1) {
        assertActivityConnection('奇遇礼莲抽奖');
        if (i > 0) await delay(HELU_DRAW_REQUEST_GAP_MS);

        const body = await operateActivity(HELU_DRAW_ACTIVITY_ID, HELU_DRAW_CMD, {
          draw: { id: HELU_DRAW_ACTIVITY_ID, count: 1 },
        });
        const decoded = types.ActivityOperateReply.decode(body);
        const result = normalizeDrawResult(decoded?.draw_result || decoded?.drawResult);
        if (Array.isArray(result?.rewards)) merged.rewards.push(...result.rewards);
        if (Array.isArray(result?.items)) merged.items.push(...result.items);
        if (!merged.cost && result?.cost) merged.cost = result.cost;
      }
      drawResult = merged;
    } else {
      assertActivityConnection('奇遇礼莲抽奖');
      const params = usingFree
        ? { draw: drawPayload }
        : { helu_paid_draw: paidPayload };
      const body = await operateActivity(HELU_DRAW_ACTIVITY_ID, HELU_DRAW_CMD, params);
      const decoded = types.ActivityOperateReply.decode(body);
      drawResult = normalizeDrawResult(decoded?.draw_result || decoded?.drawResult);
    }
  } catch (err) {
    activityLogger.error('奇遇礼莲抽奖失败', {
      ...drawContext,
      error: err?.message || String(err),
    });
    throw new Error(
      `奇遇礼莲抽奖失败: activityId=${HELU_DRAW_ACTIVITY_ID}, count=${count}, expectedCost=${expectedCost}: ${err.message}`
    );
  }

  await delay(HELU_DRAW_REFRESH_DELAY_MS);
  assertActivityConnection('刷新奇遇礼莲活动');
  const after = await getHeluActivity();
  activityLogger.info('奇遇礼莲抽奖成功', {
    ...drawContext,
    cost: drawResult?.cost || null,
    rewardCount: (Array.isArray(drawResult?.items) ? drawResult.items.length : 0)
      + (Array.isArray(drawResult?.rewards) ? drawResult.rewards.length : 0),
    after: {
      freeUsed: toNum(after?.draw?.freeUsed),
      freeMax: toNum(after?.draw?.freeMax),
      freeRemaining: toNum(after?.draw?.freeRemaining),
      paidUsed: toNum(after?.draw?.paidUsed),
      paidMax: toNum(after?.draw?.paidMax),
      paidRemaining: toNum(after?.draw?.paidRemaining),
    },
  });

  return {
    ok: true,
    count,
    expectedCost,
    costCurrencyId: usingFree ? 0 : toNum(before?.draw?.paidCurrencyId) || 1002,
    mode: usingFree ? 'free' : 'paid',
    result: drawResult,
    activity: {
      ...after,
      lastDrawResult: drawResult,
    },
  };
}

async function exchangeHeluShopItem(slotId, count = 1) {
  const slotIdNum = Number(slotId) || 0;
  if (slotIdNum <= 0) throw new Error('缺少有效的荷露商店槽位');

  const exchangeCount = Math.floor(Number(count) || 0);
  if (exchangeCount <= 0) throw new Error('兑换数量必须大于 0');

  const before = await getHeluActivity();
  const exchangeItems = Array.isArray(before?.exchangeShop) ? before.exchangeShop : [];
  const slot = exchangeItems.find((item) => toNum(item?.id) === slotIdNum);
  if (!slot) throw new Error(`荷露商店未找到槽位: ${slotIdNum}`);

  const price = Math.max(0, toNum(slot?.price));
  const balance = Math.max(0, toNum(before?.heluBalance));
  const isHeluCurrency = toNum(slot?.currencyId) === HELU_CURRENCY_ITEM_ID;
  const ownedBlocksExchange = slot?.ownedBlocksExchange !== false && slot?.owned && !slot?.isRepeatable;
  const exchangeLimit = Math.max(0, toNum(slot?.exchangeLimit));
  const totalPrice = price * exchangeCount;

  if (!isHeluCurrency) throw new Error(`暂不支持非荷露货币兑换: slotId=${slotIdNum}`);
  if (ownedBlocksExchange) throw new Error(`该商品已拥有，不能重复兑换: slotId=${slotIdNum}`);
  if (!slot?.isRepeatable && exchangeCount > 1) throw new Error('该商品每次只能兑换 1 个');
  if (exchangeLimit > 0 && exchangeCount > exchangeLimit) {
    throw new Error(`兑换数量超过上限: 最多可兑换 ${exchangeLimit} 个`);
  }
  if (totalPrice > balance) throw new Error(`荷露不足: 需要 ${totalPrice}, 当前 ${balance}`);

  activityLogger.info('荷露商店兑换开始', {
    slotId: slotIdNum,
    itemId: toNum(slot?.itemId),
    itemName: slot?.itemName || slot?.name || '',
    price,
    count: exchangeCount,
    totalPrice,
    balance,
    exchangeActivityId: HELU_EXCHANGE_ACTIVITY_ID,
    cmd: HELU_EXCHANGE_CMD,
  });

  try {
    await operateActivity(HELU_EXCHANGE_ACTIVITY_ID, HELU_EXCHANGE_CMD, {
      exchangeShopOperate: {
        id: slotIdNum,
        count: exchangeCount,
      },
    });
  } catch (err) {
    activityLogger.error('荷露商店兑换失败', {
      slotId: slotIdNum,
      itemId: toNum(slot?.itemId),
      price,
      count: exchangeCount,
      totalPrice,
      balance,
      error: err?.message || String(err),
    });
    throw new Error(`荷露商店兑换失败: slotId=${slotIdNum}, itemId=${toNum(slot?.itemId)}, price=${price}: ${err.message}`);
  }

  const after = await getHeluActivity();
  return {
    ok: true,
    slotId: slotIdNum,
    price,
    count: exchangeCount,
    totalPrice,
    currencyId: HELU_CURRENCY_ITEM_ID,
    item: slot,
    activity: after,
  };
}

// ---- 南瓜活动标准化 ----

function normalizeNanguaGroup(reply) {
  const activities = flattenActivityChildren(reply);

  const getRandomShop = (act) => act?.random_shop || act?.randomShop || null;
  const getExchangeShop = (act) => act?.exchange_shop || act?.exchangeShop || null;

  const randomAct = activities.find(
    (a) => getRandomShop(a) && Array.isArray(getRandomShop(a).items) && getRandomShop(a).items.length > 0
  ) || null;

  const exchangeAct = activities.find(
    (a) => getExchangeShop(a) && Array.isArray(getExchangeShop(a).items) && getExchangeShop(a).items.length > 0
  ) || null;

  // 优先使用 proto 解码
  let randomShop = normalizeRandomShopInfo(getRandomShop(randomAct));

  // 原始 body 扫描作为回退
  const rawRandomShop = scanRandomShopInfoFromRawBody(reply?.__rawBody);
  if (!randomShop || randomShop.items.length === 0) {
    randomShop = rawRandomShop;
  } else if (rawRandomShop) {
    randomShop = {
      ...randomShop,
      nextRefreshTime: randomShop.nextRefreshTime || rawRandomShop.nextRefreshTime,
      manualRefreshCost: randomShop.manualRefreshCost || rawRandomShop.manualRefreshCost,
      manualRefreshCurrencyId: randomShop.manualRefreshCurrencyId || rawRandomShop.manualRefreshCurrencyId,
      manualRefreshExtraValue: randomShop.manualRefreshExtraValue || rawRandomShop.manualRefreshExtraValue,
      maxManualRefreshCount: 6,
      manualRefreshUsedCount: randomShop.manualRefreshUsedCount || rawRandomShop.manualRefreshUsedCount,
    };
  }

  const randomItems = randomShop?.items || [];

  let exchangeItems = (getExchangeShop(exchangeAct)?.items || [])
    .map(normalizeExchangeShopItem)
    .filter(Boolean);

  const rawExchange = scanExchangeShopInfoFromRawBody(reply?.__rawBody);
  if (exchangeItems.length === 0 && rawExchange) {
    exchangeItems = rawExchange.items;
  }

  const refreshInfo = {
    nextRefreshTime: randomShop?.nextRefreshTime || 0,
    manualRefreshCost: randomShop?.manualRefreshCost || 0,
    manualRefreshCurrencyId: randomShop?.manualRefreshCurrencyId || 1001,
    manualRefreshExtraValue: randomShop?.manualRefreshExtraValue || 0,
    maxManualRefreshCount: 6,
    manualRefreshUsedCount: randomShop?.manualRefreshUsedCount || 0,
  };

  return {
    uid: NANGUA_ACTIVITY_UID,
    title: String(reply?.group?.activity?.title || '南瓜乐翻天'),
    randomActivityId: toNum(randomAct?.id),
    exchangeActivityId: toNum(exchangeAct?.id),
    randomShop: randomItems,
    randomShopRefresh: refreshInfo,
    exchangeShop: exchangeItems,
    summary: {
      randomShopCount: randomItems.length,
      exchangeShopCount: exchangeItems.length,
      activityCount: activities.length,
    },
    raw: {
      activityCount: activities.length,
      activityTitles: activities.map((a) => String(a?.title || '')).filter(Boolean),
      activityIds: activities.map((a) => toNum(a?.id)).filter((id) => id > 0),
    },
  };
}

/**
 * 获取南瓜商店
 */
async function getNanguaShop() {
  const state = getUserState();
  if (!state) {
    return {
      uid: NANGUA_ACTIVITY_UID,
      title: '南瓜乐翻天',
      randomShop: [],
      exchangeShop: [],
      summary: { randomShopCount: 0, exchangeShopCount: 0 },
      warning: 'runtime connection is not open',
    };
  }

  return normalizeNanguaGroup(await getActivityGroup(NANGUA_SHOP_ACTIVITY_ID));
}

module.exports = {
  NANGUA_ACTIVITY_UID,
  HELU_ACTIVITY_UID,
  STAR_ACTIVITY_UID,
  QINGMEI_ACTIVITY_UID,
  QIXI_ACTIVITY_UID,
  RAIN_POEM_ACTIVITY_UID,
  CHARITY_FLOWER_ACTIVITY_UID,
  CHARITY_FLOWER_GROUP_ACTIVITY_ID,
  NANGUA_SHOP_ACTIVITY_ID,
  NANGUA_RANDOM_SHOP_ACTIVITY_ID,
  HELU_ACTIVITY_ID,
  STAR_ACTIVITY_ID,
  STAR_RECORD_ACTIVITY_ID,
  STAR_SHOP_ACTIVITY_ID,
  STAR_SHOP_EXCHANGE_CMD,
  HELU_DRAW_ACTIVITY_ID,
  HELU_EXCHANGE_ACTIVITY_ID,
  HELU_JOURNEY_ACTIVITY_ID,
  HELU_NOTES_ACTIVITY_ID,
  QINGMEI_ACTIVITY_ID,
  QINGMEI_SEED_CLAIM_ACTIVITY_ID,
  QINGMEI_WINE_ACTIVITY_ID,
  QIXI_ACTIVITY_ID,
  QIXI_BRIDGE_ACTIVITY_ID,
  QIXI_GIFT_ACTIVITY_ID,
  RAIN_POEM_ACTIVITY_ID,
  RAIN_POEM_SHOP_ACTIVITY_ID,
  RAIN_POEM_PRANK_ACTIVITY_ID,
  RAIN_POEM_COLLECTION_ACTIVITY_ID,
  RAIN_POEM_RESEARCH_ACTIVITY_ID,
  RAIN_POEM_TASK_ACTIVITY_ID,
  CHARITY_FLOWER_ACTIVITY_ID,
  WISH_SIGN_ACTIVITY_ID,
  SHARE_REWARD_ACTIVITY_ID,
  isWishSignActive,
  isShareRewardActive,
  normalizeWishSignActivity,
  normalizeShareRewardActivity,
  getWishSignActivity,
  getShareRewardActivity,
  operateWishSign,
  operateShareReward,
  PET_DIARY_ACTIVITY_ID,
  PET_DIARY_GIFT_ACTIVITY_ID,
  PET_DIARY_SHOP_ACTIVITY_ID,
  PET_DIARY_START_TIME,
  PET_DIARY_END_TIME,
  PET_DIARY_ITEM_IDS,
  HELU_SUB_ACTIVITY_KEYS,
  NANGUA_SHOP_BUY_CMD,
  NANGUA_SHOP_REFRESH_CMD,
  HELU_EXCHANGE_CMD,
  HELU_DRAW_CMD,
  getActivityGroup,
  getActivityDiscoveryList,
  getActivityDiscoverySnapshot,
  getActivityGroupSnapshot,
  normalizeDiscoveryActivity,
  getNanguaShop,
  getHeluActivity,
  getStarActivity,
  claimStarRecordRewards,
  exchangeStarShopItem,
  getQingmeiActivity,
  claimQingmeiSeeds,
  brewAndSellQingmeiWine,
  getQixiActivity,
  buildQixiBridge,
  sendQixiSachet,
  useQixiDew,
  isQixiDewLandCandidate,
  normalizeQixiActivity,
  getRainPoemActivity,
  buyRainPoemCollectionBottle,
  collectRainPoemWeather,
  useRainPoemSummonBottle,
  unlockRainPoemResearch,
  normalizeRainPoemActivity,
  mergeRainPoemTaskUsage,
  normalizeWeatherStatus,
  getOwnWeatherStatus,
  encodeRainPoemSummonUseRequest,
  isLightningMutantPlant,
  getCharityFlowerActivity,
  normalizeCharityFlowerActivity,
  isCharityFlowerActive,
  claimCharityFlowerShareReward,
  donateCharityFlowerLove,
  claimCharityFlowerReward,
  claimCharityFlowerPublicFund,
  getPetDiaryActivity,
  getPetDiary,
  operatePetDiary,
  getPetDiaryRecords,
  getPetDiaryFriend,
  normalizePetDiaryPhotoWall,
  normalizePetDiaryEscort,
  normalizePetDiaryPouch,
  normalizePetDiaryPet,
  isPetDiaryWithinWindow,
  getSeasonPassport,
  claimSeasonPassportRewards,
  getSolarTermsInfo,
  claimSolarTermsReward,
  exchangeHeluShopItem,
  drawHeluGiftLotus,
  buyNanguaShopItem,
  refreshNanguaShop,
  normalizeNanguaGroup,
  normalizeHeluGroup,
};

let milkTeaService;
function getMilkTeaService() {
  const { types: loadedTypes } = require('../utils/proto');
  if (!milkTeaService || !milkTeaService._ready) {
    milkTeaService = require('./activity-milk-tea').createMilkTeaService({
      types: loadedTypes || types,
      sendMsgAsync,
      getBag,
      getBagItems,
      getUserState,
      getServerTimeSec: require('../utils/utils').getServerTimeSec,
      itemDto: petDiaryHelpers.itemDto
    });
    milkTeaService._ready = true;
  }
  return milkTeaService;
}
module.exports.getMilkTea = () => getMilkTeaService().getMilkTea();
module.exports.operateMilkTea = (action, params) => getMilkTeaService().operateMilkTea(action, params);
module.exports.milkTeaRecords = (kind, params) => getMilkTeaService().milkTeaRecords(kind, params);

// These actions previously emitted only wire request logs, with no account-visible outcome.
const { withActivityOperationLog } = require('./activity-operation-log');
for (const [method, label] of Object.entries({
  operateWishSign: action => `秋祈良愿${({ draw: '祈愿', claim: '领取奖励' })[action] || '操作'}`,
  operateShareReward: action => `快乐不独享${({ daily: '领取每日快乐值', share: '分享', milestones: '领取档位奖励' })[action] || '操作'}`,
  claimCharityFlowerShareReward: '公益小红花领取分享奖励',
  donateCharityFlowerLove: '公益小红花送出爱心',
  claimCharityFlowerReward: '公益小红花领取档位奖励',
  claimCharityFlowerPublicFund: '公益小红花送出公益金',
})) module.exports[method] = withActivityOperationLog(module.exports[method], label);

module.exports.isSolarTermClaimable = isSolarTermClaimable;

module.exports.normalizeSolarTermsInfo = normalizeSolarTermsInfo;
