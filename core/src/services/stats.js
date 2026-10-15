const process = require('node:process');
const path = require('node:path');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');

// ─── 持久化路径 ───

function getStatsFilePath(accountId) {
  const baseDir = process.env.FARM_DATA_DIR || path.join(__dirname, '../../data');
  return path.join(baseDir, 'stats', `${accountId}.json`);
}

/** 获取 YYYY-MM-DD 格式的当天日期键 */
function getTodayKey() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function loadPersistedStats(accountId) {
  const filePath = getStatsFilePath(accountId);
  return readJsonFile(filePath, null);
}

function savePersistedStats(accountId, data) {
  try {
    const filePath = getStatsFilePath(accountId);
    writeJsonFileAtomic(filePath, data);
  } catch {}
}

// ─── 运行状态 ───

/** 每日操作计数（按类型） */
const operations = {
  harvest: 0,
  water: 0,
  weed: 0,
  bug: 0,
  farming: 0,
  fertilize: 0,
  plant: 0,
  steal: 0,
  helpWater: 0,
  helpWeed: 0,
  helpBug: 0,
  goldenBugClear: 0,
  goldenBugPut: 0,
  taskClaim: 0,
  sell: 0,
  upgrade: 0,
  levelUp: 0,
  tongQiGift: 0
};

/** 同气连枝礼包计数 */
let tongQiGiftCount = 0;
/** 当前日期键，跨天时自动重置 */
let currentDateKey = null;

/** 最新每日任务礼包快照（用于持久化到 stats 文件） */
let latestDailyGiftsSnapshot = null;

function setLatestDailyGifts(gifts) {
  if (gifts && typeof gifts === 'object') {
    latestDailyGiftsSnapshot = gifts;
    scheduleSave();
  }
}

/** 上次记录的金币/经验/点券值（用于计算增量） */
const lastState = {
  gold: -1,
  exp: -1,
  coupon: -1
};

/** 账号全生命周期初始值（从添加账号起记录，绝不随跨天重置，供概览页累积计算） */
const accountBaseline = {
  gold: null,
  exp: null,
  coupon: null
};

/** 今日纯收入（只计正向增加，不计损耗，跨天清零，供排行榜使用） */
const dailyIncome = {
  gold: 0,
  exp: 0
};

/** 会话期间累计增益（概览页呈现：自添加账号以来的生命周期净增减） */
const session = {
  goldGained: 0,
  expGained: 0,
  couponGained: 0,
  lastExpGain: 0,
  lastGoldGain: 0
};

let currentAccountId = null;
let saveTimer = null;
let accountOnlineAt = null;

// ─── 公开 API ───

/**
 * 记录一次操作
 * @param {string} opType - 操作类型（harvest/plant/steal 等）
 * @param {number} count - 次数，默认 1
 */
function recordOperation(opType, count = 1) {
  checkAndResetDailyStats();
  if (operations[opType] !== undefined) {
    operations[opType] += count;
    scheduleSave();
  }
}

/** 记录同气连枝礼包 */
function recordTongQiGift(count = 1) {
  checkAndResetDailyStats();
  tongQiGiftCount += count;
  operations.tongQiGift = tongQiGiftCount;
  scheduleSave();
}

function getTongQiGiftCount() {
  checkAndResetDailyStats();
  return tongQiGiftCount;
}

function getTongQiGiftLimit() {
  return null; // 当前无限制
}

/** 检查是否跨天，若跨天则重置每日统计（只重置操作数与排行榜今日收入，绝不重置账号全周期初始基准） */
function checkAndResetDailyStats() {
  if (!currentAccountId) return;
  const todayKey = getTodayKey();
  if (currentDateKey && currentDateKey !== todayKey) {
    console.warn(`[统计] 检测到跨天，重置每日操作与排行榜今日收入 (${currentDateKey} -> ${todayKey})`);
    Object.keys(operations).forEach(k => { operations[k] = 0; });
    tongQiGiftCount = 0;
    // 排行榜今日纯收入清零
    dailyIncome.gold = 0;
    dailyIncome.exp = 0;
    session.lastGoldGain = 0;
    session.lastExpGain = 0;
    currentDateKey = todayKey;
    doSave();
  }
  currentDateKey = todayKey;
}

/** 延迟 2 秒后保存（防抖） */
function scheduleSave() {
  if (!currentAccountId) return;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    doSave();
  }, 2000);
}

function doSave() {
  if (!currentAccountId) return;
  const todayKey = getTodayKey();
  const ops = { ...operations };
  const base = { ...accountBaseline };
  const last = { ...lastState };
  let profile = {};
  try {
    const { statusData } = require('./status');
    if (statusData && (statusData.level || statusData.name)) {
      profile = {
        level: Number(statusData.level) || 0,
        name: statusData.name || '',
        avatar: statusData.avatar || '',
        gold: Number(statusData.gold) || 0,
        exp: Number(statusData.exp) || 0,
      };
    }
  } catch {}

  const prev = loadPersistedStats(currentAccountId) || {};
  const data = {
    date: todayKey,
    operations: ops,
    tongQiGiftCount,
    // 账号全生命周期基准保持永久存储（兼顾历史兼容）
    accountBaseline: base,
    initialState: base,
    lastState: last,
    profile: (profile.level || profile.name) ? profile : (prev.profile || {}),
    dailyGifts: (latestDailyGiftsSnapshot && latestDailyGiftsSnapshot.gifts) ? latestDailyGiftsSnapshot : (prev.dailyGifts || null),
    // 排行榜每日纯收入（只计正向，不计损耗）
    gains: {
      gold: Math.max(0, dailyIncome.gold),
      exp: Math.max(0, dailyIncome.exp),
      coupon: 0,
    },
    dailyIncome: {
      gold: Math.max(0, dailyIncome.gold),
      exp: Math.max(0, dailyIncome.exp),
    },
    savedAt: Date.now()
  };
  savePersistedStats(currentAccountId, data);
}

/**
 * 初始化统计（设置初始金币/经验/点券）
 */
function initStats(gold, exp, coupon = 0) {
  const g = Number.isFinite(Number(gold)) ? Number(gold) : 0;
  const e = Number.isFinite(Number(exp)) ? Number(exp) : 0;
  const c = Number.isFinite(Number(coupon)) ? Number(coupon) : 0;
  lastState.gold = g;
  lastState.exp = e;
  lastState.coupon = c;
  if (accountBaseline.gold === null) {
    accountBaseline.gold = g;
    accountBaseline.exp = e;
    accountBaseline.coupon = c;
  }
}

/**
 * 初始化统计并加载持久化数据
 * @param {string} accountId - 账号 ID
 * @param {number} gold - 金币
 * @param {number} exp - 经验
 * @param {number} coupon - 点券（默认 0）
 */
function initStatsWithPersistence(accountId, gold, exp, coupon = 0) {
  currentAccountId = accountId;
  const todayKey = getTodayKey();
  currentDateKey = todayKey;

  // 重置运行时日常操作
  Object.keys(operations).forEach(k => { operations[k] = 0; });
  tongQiGiftCount = 0;
  dailyIncome.gold = 0;
  dailyIncome.exp = 0;
  lastState.gold = -1;
  lastState.exp = -1;
  lastState.coupon = -1;
  accountBaseline.gold = null;
  accountBaseline.exp = null;
  accountBaseline.coupon = null;
  session.goldGained = 0;
  session.expGained = 0;
  session.couponGained = 0;
  session.lastExpGain = 0;
  session.lastGoldGain = 0;
  accountOnlineAt = Date.now();

  // 读取持久化文件
  const persisted = loadPersistedStats(accountId);

  // 1. 恢复账号全生命周期基准（只要存在就绝不重置，从添加账号一直累积）
  const savedBase = persisted?.accountBaseline || persisted?.initialState;
  if (savedBase && savedBase.gold !== null && savedBase.gold !== undefined) {
    accountBaseline.gold = Number(savedBase.gold);
    accountBaseline.exp = Number(savedBase.exp);
    accountBaseline.coupon = Number(savedBase.coupon);
  } else {
    // 首次录入账号初始资产
    accountBaseline.gold = Number.isFinite(Number(gold)) ? Number(gold) : 0;
    accountBaseline.exp = Number.isFinite(Number(exp)) ? Number(exp) : 0;
    accountBaseline.coupon = Number.isFinite(Number(coupon)) ? Number(coupon) : 0;
  }

  // 2. 恢复当天数据（操作数 & 排行榜今日纯收入）
  if (persisted && persisted.date === todayKey) {
    Object.keys(persisted.operations || {}).forEach(k => {
      if (operations[k] !== undefined) {
        operations[k] = Number(persisted.operations[k]) || 0;
      }
    });
    tongQiGiftCount = Number(persisted.tongQiGiftCount) || Number(operations.tongQiGift) || 0;
    operations.tongQiGift = tongQiGiftCount;

    if (persisted.dailyIncome) {
      dailyIncome.gold = Number(persisted.dailyIncome.gold) || 0;
      dailyIncome.exp = Number(persisted.dailyIncome.exp) || 0;
    } else if (persisted.gains) {
      dailyIncome.gold = Number(persisted.gains.gold) || 0;
      dailyIncome.exp = Number(persisted.gains.exp) || 0;
    }
  }

  initStats(gold, exp, coupon);
  // 重新计算全生命周期累计盈亏
  recomputeSessionTotals(gold, exp, coupon);
}

/**
 * 更新金币/经验差值追踪
 * @param {number} gold - 当前金币
 * @param {number} exp - 当前经验
 */
function updateStats(gold, exp) {
  if (lastState.gold === -1) lastState.gold = gold;
  if (lastState.exp === -1) lastState.exp = exp;

  // 金币增量（排行榜：仅累计正向收入，不计升级土地/买种子等损耗）
  if (gold > lastState.gold) {
    const gain = gold - lastState.gold;
    session.lastGoldGain = gain;
    dailyIncome.gold = (dailyIncome.gold || 0) + gain;
  } else if (gold < lastState.gold) {
    session.lastGoldGain = 0;
  }
  lastState.gold = gold;

  // 经验增量（带同值去重，避免短时间内重复计算）
  if (exp > lastState.exp) {
    const gain = exp - lastState.exp;
    const now = Date.now();
    if (gain === session.lastExpGain && now - (session.lastExpTime || 0) < 5000) {
      // skip duplicate
    } else {
      session.lastExpGain = gain;
      session.lastExpTime = now;
      dailyIncome.exp = (dailyIncome.exp || 0) + gain;
    }
  } else {
    session.lastExpGain = 0;
  }
  lastState.exp = exp;
}

function recordGoldExp(gold, exp) {
  updateStats(gold, exp);
}

function setInitialValues(gold, exp, coupon = 0) {
  initStats(gold, exp, coupon);
}

/** 重置会话增益 */
function resetSessionGains() {
  session.goldGained = 0;
  session.expGained = 0;
  session.couponGained = 0;
  session.lastGoldGain = 0;
  session.lastExpGain = 0;
  session.lastExpTime = 0;
}

/** 根据全生命周期初始值重新计算概览页累计总盈亏（当前资产 - 添加账号初始资产，带正负） */
function recomputeSessionTotals(gold, exp, coupon) {
  if (accountBaseline.gold === null || accountBaseline.gold === undefined) {
    accountBaseline.gold = gold;
    accountBaseline.exp = exp;
    accountBaseline.coupon = coupon;
  }
  // 概览页指标：支持正负（+绿色盈利 / -红色损耗），不随日期清零，自添加账号一直累积
  session.goldGained = gold - accountBaseline.gold;
  session.expGained = exp - accountBaseline.exp;
  session.couponGained = coupon - accountBaseline.coupon;
}

/**
 * 获取完整统计快照（供 API 返回）
 * @param {object} farmUser - 农场用户数据
 * @param {object} userState - 用户状态（含 gold/exp/coupon）
 * @param {boolean} connected - 是否连接中
 * @param {object} limits - 操作次数限制
 */
function getStats(farmUser, userState, connected, limits) {
  checkAndResetDailyStats();
  const fu = farmUser && typeof farmUser === 'object' ? farmUser : {};
  const us = userState && typeof userState === 'object' ? userState : {};

  const gold = us.gold ?? fu.gold;
  const exp = us.exp ?? fu.exp;
  const coupon = us.coupon ?? fu.coupon;
  const diamond = us.diamond ?? fu.diamond;
  const goldBean = us.goldBean ?? fu.goldBean;

  const g = Number.isFinite(Number(gold)) ? Number(gold) : 0;
  const e = Number.isFinite(Number(exp)) ? Number(exp) : 0;
  const c = Number.isFinite(Number(coupon)) ? Number(coupon) : 0;
  const d = Number.isFinite(Number(diamond)) ? Number(diamond) : 0;
  const gb = Number.isFinite(Number(goldBean)) ? Number(goldBean) : 0;

  // 如果已连接，更新内部追踪并重新计算全生命周期盈亏
  if (connected) {
    updateStats(g, e);
    recomputeSessionTotals(g, e, c);
  }

  const ops = { ...operations, tongQiGift: tongQiGiftCount };

  return {
    connection: { connected },
    status: {
      name: us.name || fu.name,
      level: fu.level || us.level || 0,
      gold: g,
      coupon: Number.isFinite(Number(us.coupon)) ? Number(us.coupon) : 0,
      diamond: d,
      goldBean: gb,
      exp: e,
      platform: fu.platform || us.platform || 'qq',
      gid: us.gid || fu.gid || 0,
      openId: us.openId || fu.openId || fu.open_id || '',
      avatar: us.avatar || fu.avatar || fu.avatarUrl || fu.avatar_url || ''
    },
    uptime: connected ? Math.max(1, Math.floor((Date.now() - (accountOnlineAt || Date.now())) / 1000)) : 0,
    operations: ops,
    tongQiGiftCount,
    tongQiGiftLimit: null,
    // 概览页呈现：全生命周期净盈亏（从添加账号累积至今，带+-）
    sessionExpGained: session.expGained,
    sessionGoldGained: session.goldGained,
    sessionCouponGained: session.couponGained,
    // 排行榜呈现：今日纯收入（只计正向增加，不计损耗，每日清零）
    dailyGoldIncome: dailyIncome.gold,
    dailyExpIncome: dailyIncome.exp,
    dailyIncome: { ...dailyIncome },
    lastExpGain: session.lastExpGain,
    lastGoldGain: session.lastGoldGain,
    limits
  };
}

function saveStats() {
  doSave();
}

module.exports = {
  recordOperation,
  recordTongQiGift,
  getTongQiGiftCount,
  getTongQiGiftLimit,
  initStats,
  initStatsWithPersistence,
  updateStats,
  setInitialValues,
  recordGoldExp,
  resetSessionGains,
  getStats,
  saveStats,
  setLatestDailyGifts,
  getTodayKey,
  loadPersistedStats,
  checkAndResetDailyStats
};
