const process = require('node:process');
const fs = require('node:fs');
const path = require('node:path');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { readTextFile, readJsonFile, writeJsonFileAtomic } = require('../services/json-db');
const { compareBagSeedGameOrder } = require('../utils/bag-seed-order');

// ==================== 文件路径 ====================

const STORE_FILE = getDataFile('store.json');
const ACCOUNTS_FILE = getDataFile('accounts.json');
const KNOWN_FRIEND_GIDS_DIR = getDataFile('known_friend_gids');
const FRIEND_DOG_INFO_DIR = getDataFile('friend_dog_info');
const FRIEND_LIST_CACHE_DIR = getDataFile('friend_list_cache');

// ==================== 缓存目录辅助 ====================

function ensureKnownFriendGidsDir() {
    if (!fs.existsSync(KNOWN_FRIEND_GIDS_DIR)) {
        fs.mkdirSync(KNOWN_FRIEND_GIDS_DIR, { recursive: true });
    }
    return KNOWN_FRIEND_GIDS_DIR;
}

function ensureFriendDogInfoDir() {
    if (!fs.existsSync(FRIEND_DOG_INFO_DIR)) {
        fs.mkdirSync(FRIEND_DOG_INFO_DIR, { recursive: true });
    }
    return FRIEND_DOG_INFO_DIR;
}

function ensureFriendListCacheDir() {
    if (!fs.existsSync(FRIEND_LIST_CACHE_DIR)) {
        fs.mkdirSync(FRIEND_LIST_CACHE_DIR, { recursive: true });
    }
    return FRIEND_LIST_CACHE_DIR;
}

// ==================== 已知好友 GID 缓存 ====================

function getKnownFriendGidsCacheFile(accountId) {
    const safeName = String(accountId || '').replace(/[^\w-]/g, '_');
    return path.join(ensureKnownFriendGidsDir(), `${safeName  }.json`);
}

function readKnownFriendGidsCache(accountId) {
    try {
        const filePath = getKnownFriendGidsCacheFile(accountId);
        if (fs.existsSync(filePath)) {
            const data = readJsonFile(filePath);
            if (data && Array.isArray(data.gids)) return data.gids;
        }
    } catch { }
    return null;
}

function writeKnownFriendGidsCache(accountId, gids) {
    try {
        const filePath = getKnownFriendGidsCacheFile(accountId);
        writeJsonFileAtomic(filePath, { gids: gids || [], updatedAt: Date.now() });
    } catch { }
}

// ==================== 好友狗狗信息缓存 ====================

function getFriendDogInfoCacheFile(accountId) {
    const safeName = String(accountId || '').replace(/[^\w-]/g, '_');
    return path.join(ensureFriendDogInfoDir(), `${safeName  }.json`);
}

function getLocalDateKey(timestamp = Date.now()) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function normalizeFriendDogInfoCache(data, now = Date.now()) {
    if (!data || typeof data.dogInfo !== 'object' || data.dogInfo === null) return null;
    const cacheDate = String(data.cacheDate || getLocalDateKey(data.updatedAt));
    if (!cacheDate || cacheDate !== getLocalDateKey(now)) return null;
    return data.dogInfo;
}

function readFriendDogInfoCache(accountId) {
    try {
        const filePath = getFriendDogInfoCacheFile(accountId);
        if (fs.existsSync(filePath)) {
            const data = readJsonFile(filePath);
            return normalizeFriendDogInfoCache(data);
        }
    } catch { }
    return null;
}

function writeFriendDogInfoCache(accountId, dogInfo) {
    try {
        const filePath = getFriendDogInfoCacheFile(accountId);
        const updatedAt = Date.now();
        writeJsonFileAtomic(filePath, {
            dogInfo: dogInfo || {},
            cacheDate: getLocalDateKey(updatedAt),
            updatedAt,
        });
    } catch { }
}

function updateFriendDogInfoCache(accountId, gid, dogInfo) {
    const numericGid = Number(gid) || 0;
    if (!accountId || !numericGid) return false;
    const cache = readFriendDogInfoCache(accountId) || {};
    const dogId = Number(dogInfo && dogInfo.dogId) || 0;
    if (dogId > 0) {
        const current = cache[numericGid];
        if (current && Number(current.dogId) === dogId && current.dogName === (dogInfo.dogName || '')) {
            return false;
        }
        cache[numericGid] = { dogId, dogName: dogInfo.dogName || '' };
    } else if (Object.hasOwn(cache, numericGid)) {
        delete cache[numericGid];
    } else {
        return false;
    }
    writeFriendDogInfoCache(accountId, cache);
    return true;
}

// ==================== 好友列表缓存 ====================

function getFriendListCacheFile(accountId) {
    const safeName = String(accountId || '').replace(/[^\w-]/g, '_');
    return path.join(ensureFriendListCacheDir(), `${safeName  }.json`);
}

function readFriendListCache(accountId) {
    try {
        const filePath = getFriendListCacheFile(accountId);
        if (fs.existsSync(filePath)) {
            const data = readJsonFile(filePath);
            if (data && Array.isArray(data.friends)) return data.friends;
        }
    } catch { }
    return null;
}

function writeFriendListCache(accountId, friends) {
    try {
        const filePath = getFriendListCacheFile(accountId);
        writeJsonFileAtomic(filePath, { friends: friends || [], updatedAt: Date.now() });
    } catch { }
}

function removeFriendFromCache(accountId, gid) {
    const targetGid = Number(gid);
    if (!targetGid) return;

    // 从好友列表缓存中移除
    try {
        const friends = readFriendListCache(accountId);
        if (Array.isArray(friends) && friends.length > 0) {
            const filtered = friends.filter(f => Number(f.gid) !== targetGid);
            if (filtered.length !== friends.length) {
                writeFriendListCache(accountId, filtered);
            }
        }
    } catch { }

    // 从狗狗信息缓存中移除
    try {
        const dogInfo = readFriendDogInfoCache(accountId);
        if (dogInfo && typeof dogInfo === 'object' && dogInfo[targetGid]) {
            delete dogInfo[targetGid];
            writeFriendDogInfoCache(accountId, dogInfo);
        }
    } catch { }
}

function deleteFriendListCache(accountId) {
    try {
        const filePath = getFriendListCacheFile(accountId);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { }
}

function deleteFriendDogInfoCache(accountId) {
    try {
        const filePath = getFriendDogInfoCacheFile(accountId);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { }
}

function deleteKnownFriendGidsCache(accountId) {
    try {
        const filePath = getKnownFriendGidsCacheFile(accountId);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { }
}

function deleteAccountCaches(accountId) {
    deleteFriendListCache(accountId);
    deleteFriendDogInfoCache(accountId);
    deleteKnownFriendGidsCache(accountId);
    try {
        const path = require('node:path');
        const statsDir = path.join(process.env.FARM_DATA_DIR || path.join(__dirname, '../../data'), 'stats');
        const f1 = path.join(statsDir, accountId + '.json');
        const f2 = path.join(statsDir, 'history_' + accountId + '.json');
        const f3 = path.join(statsDir, 'career_' + accountId + '.json');
        if (fs.existsSync(f1)) fs.unlinkSync(f1);
        if (fs.existsSync(f2)) fs.unlinkSync(f2);
        if (fs.existsSync(f3)) fs.unlinkSync(f3);
    } catch {}
}

// ==================== 允许的策略 ====================

const ALLOWED_PLANTING_STRATEGIES = [
    'level', 'max_exp', 'max_fert_exp',
    'max_profit', 'max_fert_profit', 'bag_priority', 'task_priority'
];
const ALLOWED_BAG_SEED_FALLBACK_STRATEGIES = ALLOWED_PLANTING_STRATEGIES.filter(
    s => s !== 'bag_priority' && s !== 'task_priority'
);
const PUSHOO_CHANNELS = new Set([
    'webhook', 'qmsg', 'serverchan', 'pushplus', 'pushplushxtrip',
    'dingtalk', 'wecom', 'bark', 'gocqhttp', 'onebot', 'atri',
    'pushdeer', 'igot', 'telegram', 'feishu', 'ifttt', 'wecombot',
    'discord', 'wxpusher',
]);

// ==================== 默认配置 ====================

const DEFAULT_OFFLINE_REMINDER = {
    channel: 'smtp',
    reloginUrlMode: 'none',
    endpoint: '',
    token: '',
    title: '账号下线提醒',
    msg: '账号下线',
    offlineDeleteSec: 0,
    smtpHost: '',
    smtpPort: 465,
    smtpUser: '',
    smtpPass: '',
    senderName: '',
    recipientEmail: '',
    emailContent: ''
};

const DEFAULT_FERTILIZER_LAND_TYPES = ['purple', 'gold', 'black', 'red', 'normal'];
const FERTILIZER_LAND_TYPE_SET = new Set(DEFAULT_FERTILIZER_LAND_TYPES);

/** 默认自动化配置 */
const DEFAULT_AUTOMATION = {
    farm: true,
    farm_push: true,
    land_upgrade: false,
    friend: true,
    friend_auto_accept: true,
    friend_help_exp_limit: true,
    friend_steal: true,
    friend_help: true,
    friend_bad: false,
    friend_golden_bug: false,
    task: true,
    star_passport_claim: false,
    star_solar_claim: false,
    star_record_claim: false,
    qingmei_seed_claim: false,
    qingmei_wine_brew: false,
    qixi_dew_use: false,
    qixi_bridge_build: false,
    qixi_sachet_gift: false,
    qixi_friend_priority: [],
    rain_poem_bottle_buy: false,
    rain_poem_weather_collect: false,
    rain_poem_summon_use: false,
    rain_poem_prank_use: false,
    rain_poem_research_unlock: false,
    charity_flower_share_claim: false,
    charity_flower_donate: false,
    charity_flower_reward_claim: false,
    charity_flower_public_fund_claim: false,
    wish_sign_draw: false,
    wish_sign_choice: 1,
    wish_sign_claim: false,
    share_reward_share: false,
    share_reward_daily: false,
    share_reward_milestones: false,
    // 萌宠成长日记（S3）。刻意不提供的开关：
    // 拾物小铺兑换（exchange，需用户指定商品）、锦囊付费刷新（花点券）、
    // markStories（纯 UI 状态无奖励）、skipBattle（是设置项不是任务）。
    pet_diary_adopt: false,
    milk_tea_share_daily: false,
    milk_tea_share_rewards: false,
    milk_tea_fund_rewards: false,
    milk_tea_cashier: false,
    milk_tea_wages: false,
    milk_tea_upgrade: false,
    milk_tea_craft: false,
    milk_tea_boost: false,
    milk_tea_hire: false,
    milk_tea_hire_duration: 1,
    milk_tea_hire_talent: 0,
    milk_tea_seed_buy: false,
    pet_diary_feed: false,
    auto_buy_dog_food: false,
    auto_feed_dog: false,
    pet_diary_draw: false,
    pet_diary_story_claim: false,
    pet_diary_seed_claim: false,
    pet_diary_solar_claim: false,
    pet_diary_treasure_open: false,
    pet_diary_compensation_claim: false,
    pet_diary_charm_equip: false,
    pet_diary_battle: false,
    fertilizer_gift: false,
    fertilizer_buy_organic: false,
    fertilizer_buy_normal: false,
    mall_coupon_gift_buy: false,
    mystery_shop_auto_buy: false,
    mystery_shop_allow_gold: true,
    mystery_shop_allow_coupon: false,
    mystery_shop_allow_gold_bean: false,
    sell: false,
    fertilizer: 'smart_normal',
    fertilizer_multi_season: true,
    fertilizer_land_types: [...DEFAULT_FERTILIZER_LAND_TYPES],
    fertilizer_smart_seconds: 300,
    skip_own_weed_bug: true,
    golden_bug_clear: true
};

// 已从前端隐藏的限时活动。即使旧配置或客户端提交 true，也必须在配置边界
// 统一关闭，避免活动入口隐藏后后台任务继续执行。
const HIDDEN_ACTIVITY_AUTOMATION_KEYS = new Set([
    'star_passport_claim',
    'star_record_claim',
    'qingmei_seed_claim',
    'qingmei_wine_brew',
    'qixi_dew_use',
    'qixi_bridge_build',
    'qixi_sachet_gift'
]);

const CHARITY_FLOWER_AUTOMATION_KEYS = [
    'charity_flower_share_claim',
    'charity_flower_donate',
    'charity_flower_reward_claim',
    'charity_flower_public_fund_claim'
];
const RAIN_POEM_AUTOMATION_KEYS = [
    'rain_poem_bottle_buy',
    'rain_poem_weather_collect',
    'rain_poem_summon_use',
    'rain_poem_prank_use',
    'rain_poem_research_unlock'
];
const PET_DIARY_AUTOMATION_KEYS = [
    'pet_diary_adopt',
    'pet_diary_feed',
    'pet_diary_draw',
    'pet_diary_story_claim',
    'pet_diary_seed_claim',
    'pet_diary_solar_claim',
    'pet_diary_treasure_open',
    'pet_diary_compensation_claim',
    'pet_diary_battle',
    'pet_diary_charm_equip'
];
const WISH_SIGN_AUTOMATION_KEYS = ['wish_sign_draw', 'wish_sign_claim'];
const SHARE_REWARD_AUTOMATION_KEYS = ['share_reward_share', 'share_reward_daily', 'share_reward_milestones'];

// 注意：这里的时间窗与 web/src/constants/activity-windows.ts 是手工同步的两份字面量
// （core 是 CommonJS、web 是 TS，无法共享模块）。改一处必须改另一处，
// 否则前端会显示后端已强制关闭的开关。
const TIMED_ACTIVITY_AUTOMATION_GROUPS = [
    { startTime: 1792029600, endTime: 1794844799, keys: ['mall_coupon_gift_buy', 'milk_tea_cashier', 'milk_tea_wages', 'milk_tea_share_daily', 'milk_tea_share_rewards', 'milk_tea_fund_rewards'] },
    { startTime: 1792029600, endTime: 1794671998, keys: ['milk_tea_upgrade', 'milk_tea_craft', 'milk_tea_boost', 'milk_tea_hire', 'milk_tea_seed_buy'] },
    { startTime: 1790179200, endTime: 1791388799, keys: WISH_SIGN_AUTOMATION_KEYS },
    { startTime: 1790179200, endTime: 1791820799, keys: SHARE_REWARD_AUTOMATION_KEYS },
    {
        startTime: 1788192000,
        endTime: 1788969599,
        keys: CHARITY_FLOWER_AUTOMATION_KEYS
    },
    {
        startTime: 1787709600,
        endTime: 1788883199,
        keys: RAIN_POEM_AUTOMATION_KEYS
    },
    {
        // 对应 PET_DIARY_ACTIVITY_WINDOW
        startTime: 1789005600,
        endTime: 1791820799,
        keys: PET_DIARY_AUTOMATION_KEYS
    }
];

function isActivityWindowActive(group, nowSeconds = Math.floor(Date.now() / 1000)) {
    const startTime = Number(group && group.startTime) || 0;
    const endTime = Number(group && group.endTime) || 0;
    return (!startTime || nowSeconds >= startTime) && (!endTime || nowSeconds <= endTime);
}

function getInactiveActivityAutomationKeys(nowSeconds = Math.floor(Date.now() / 1000)) {
    const keys = new Set(HIDDEN_ACTIVITY_AUTOMATION_KEYS);
    for (const group of TIMED_ACTIVITY_AUTOMATION_GROUPS) {
        if (isActivityWindowActive(group, nowSeconds)) continue;
        for (const key of group.keys || []) keys.add(key);
    }
    return keys;
}

function disableHiddenActivityAutomation(automation, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (!automation || typeof automation !== 'object') return automation;
    for (const key of getInactiveActivityAutomationKeys(nowSeconds)) automation[key] = false;
    return automation;
}

// Only the main runtime calls this persistence hook; workers keep read-time guards.
let inactiveActivityConfigNeedsSave = false;
function persistInactiveActivityAutomation(nowSeconds = Math.floor(Date.now() / 1000)) {
    const inactive = [...getInactiveActivityAutomationKeys(nowSeconds)];
    const changedAccounts = [];
    for (const [id, cfg] of Object.entries(globalConfig.accountConfigs || {})) {
        if (!inactive.some(key => cfg.automation?.[key] === true)) continue;
        disableHiddenActivityAutomation(cfg.automation, nowSeconds);
        changedAccounts.push(id);
        inactiveActivityConfigNeedsSave = true;
    }
    if (inactiveActivityConfigNeedsSave) {
        saveGlobalConfig({ throwOnError: true });
        inactiveActivityConfigNeedsSave = false;
    }
    return changedAccounts;
}

/** 默认间隔配置（秒） */
const DEFAULT_INTERVALS = {
    farm: 2,
    farmMin: 2,
    farmMax: 5,
    helpMin: 30,
    helpMax: 35
};

/** 默认静默时段 */
const DEFAULT_QUIET_HOURS = {
    enabled: false,
    start: '01:00',
    end: '07:30'
};

/** 默认植物黑名单（一些特殊/活动作物ID） */
const DEFAULT_PLANT_BLACKLIST = [20002, 26739, 20059, 20065, 20064, 20060, 20061];
const DEFAULT_CAPITAL_MODE = { enabled: false, dogId: 0, leadSeconds: 10 };

function normalizeCapitalMode(value, fallback = DEFAULT_CAPITAL_MODE) {
    const input = value && typeof value === 'object' ? value : {};
    const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_CAPITAL_MODE;
    return {
        enabled: input.enabled !== undefined ? input.enabled === true : base.enabled === true,
        dogId: Math.max(0, Number(input.dogId ?? input.selectedDogId ?? base.dogId) || 0),
        leadSeconds: Math.max(5, Math.min(300, Number(input.leadSeconds ?? input.secondsBeforeMature ?? base.leadSeconds) || 10))
    };
}

/** 默认账号配置 */
const DEFAULT_ACCOUNT_CONFIG = {
    automation: DEFAULT_AUTOMATION,
    autoCodeRefresh: {
        enabled: false,
        intervalMinutes: 60
    },
    plantingStrategy: 'max_exp',
    prioritize2x2Crops: false,
    prioritizeGrowthTasks: false,
    friendBadRetryDate: '',
    intervals: DEFAULT_INTERVALS,
    friendQuietHours: DEFAULT_QUIET_HOURS,
    knownFriendGids: [],
    friendBlacklist: [],
    plantBlacklist: DEFAULT_PLANT_BLACKLIST,
    fertilizerBuyOrganicCount: 1,
    fertilizerBuyOrganicThresholdHours: 10,
    fertilizerBuyNormalCount: 1,
    fertilizerBuyNormalThresholdHours: 10,
    fertilizerBuyCheckIntervalMinutes: 60,
    bagSeedPriority: [],
    bagSeedKnownIds: [],
    bagSeedFallbackStrategy: 'level',
    autoAcceptFriendMinLevel: 0,
    goldenBugKeepCount: 0,
    goldenBugRoundLimit: 24,
    capitalMode: DEFAULT_CAPITAL_MODE,
    pendingQqFriends: []
};

const ALLOWED_AUTOMATION_KEYS = new Set(Object.keys(DEFAULT_ACCOUNT_CONFIG.automation));

// ==================== 标准化函数 ====================

function normalizeKnownFriendGids(rawGids, fallback = []) {
    const input = Array.isArray(rawGids) ? rawGids : fallback;
    const result = [];
    for (const item of input) {
        const gid = Number.parseInt(item, 10);
        if (!Number.isFinite(gid) || gid <= 0) continue;
        if (result.includes(gid)) continue;
        result.push(gid);
    }
    return result;
}

function normalizeBagSeedPriority(rawList) {
    if (!Array.isArray(rawList)) return [];
    const result = [];
    for (const item of rawList) {
        const seedId = Number.parseInt(item, 10);
        if (!Number.isFinite(seedId) || seedId <= 0) continue;
        if (result.includes(seedId)) continue;
        result.push(seedId);
    }
    return result;
}

function syncBagSeedPriority(accountId, bagSeeds, options = {}) {
    const cfg = getAccountConfigSnapshot(accountId);
    const currentSeeds = (Array.isArray(bagSeeds) ? bagSeeds : [])
        .map(seed => ({
            ...seed,
            seedId: Number(seed && seed.seedId) || 0,
            count: Number(seed && seed.count) || 0,
            requiredLevel: Number(seed && seed.requiredLevel) || 0,
            rarity: Number(seed && seed.rarity) || 0,
            plantExp: Number(seed && seed.plantExp) || 0,
            plantingPriority: Number(seed && seed.plantingPriority) || 0,
            plantSize: Number(seed && seed.plantSize) || 1,
        }))
        .filter(seed => seed.seedId > 0 && seed.count > 0 && seed.plantSize === 1)
        .sort(compareBagSeedGameOrder);
    const currentIds = currentSeeds.map(seed => seed.seedId);
    const priority = normalizeBagSeedPriority(cfg.bagSeedPriority);
    const knownIds = normalizeBagSeedPriority(cfg.bagSeedKnownIds);
    const nextPriority = [...priority, ...currentIds.filter(id => !priority.includes(id))];

    const nextKnownIds = [...new Set([...knownIds, ...priority, ...currentIds])];
    const changed = JSON.stringify(nextPriority) !== JSON.stringify(priority)
        || JSON.stringify(nextKnownIds) !== JSON.stringify(knownIds);
    if (changed) {
        applyConfigSnapshot({
            bagSeedPriority: nextPriority,
            bagSeedKnownIds: nextKnownIds,
        }, {
            accountId,
            persist: options.persist !== false,
        });
    }

    return {
        seeds: currentSeeds,
        priority: nextPriority,
        knownIds: nextKnownIds,
        changed,
    };
}

function normalizeBagSeedFallbackStrategy(rawStrategy, fallback = 'level') {
    const strategy = String(rawStrategy || '').trim();
    if (ALLOWED_BAG_SEED_FALLBACK_STRATEGIES.includes(strategy)) return strategy;
    return fallback;
}

function normalizeFertilizerLandTypes(rawTypes, fallback = DEFAULT_FERTILIZER_LAND_TYPES) {
    const input = Array.isArray(rawTypes) ? rawTypes : fallback;
    const result = [];
    for (const item of input) {
        const key = String(item || '').trim().toLowerCase();
        if (!FERTILIZER_LAND_TYPE_SET.has(key)) continue;
        if (result.includes(key)) continue;
        result.push(key);
    }
    return result;
}

function normalizeOfflineReminder(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const def = DEFAULT_OFFLINE_REMINDER;

    const endpoint = input.endpoint !== undefined && input.endpoint !== null
        ? String(input.endpoint).trim() : def.endpoint;

    const rawChannel = input.channel !== undefined && input.channel !== null
        ? String(input.channel).trim().toLowerCase() : '';
    const legacyEndpointChannel = PUSHOO_CHANNELS.has(endpoint.toLowerCase())
        ? endpoint.toLowerCase() : '';
    let channel = rawChannel || legacyEndpointChannel || def.channel;
    if (channel !== 'smtp' && !PUSHOO_CHANNELS.has(channel)) channel = def.channel;

    const rawReloginUrlMode = input.reloginUrlMode !== undefined && input.reloginUrlMode !== null
        ? String(input.reloginUrlMode).trim().toLowerCase() : def.reloginUrlMode;
    const reloginUrlMode = ['none', 'qq_link', 'qr_link'].includes(rawReloginUrlMode)
        ? rawReloginUrlMode : def.reloginUrlMode;

    let offlineDeleteSec = Number.parseInt(input.offlineDeleteSec, 10);
    if (!Number.isFinite(offlineDeleteSec) || offlineDeleteSec < 0) offlineDeleteSec = def.offlineDeleteSec;

    const token = input.token !== undefined && input.token !== null
        ? String(input.token).trim() : def.token;

    const title = input.title !== undefined && input.title !== null
        ? String(input.title).trim() : def.title;

    const msg = input.msg !== undefined && input.msg !== null
        ? String(input.msg).trim() : def.msg;

    const smtpHost = input.smtpHost !== undefined && input.smtpHost !== null
        ? String(input.smtpHost).trim() : def.smtpHost;

    const smtpPortRaw = Number.parseInt(input.smtpPort, 10);
    const smtpPort = (!Number.isFinite(smtpPortRaw) || smtpPortRaw <= 0 || smtpPortRaw > 65535)
        ? def.smtpPort : smtpPortRaw;

    const smtpUser = input.smtpUser !== undefined && input.smtpUser !== null
        ? String(input.smtpUser).trim() : def.smtpUser;

    const smtpPass = input.smtpPass !== undefined && input.smtpPass !== null
        ? String(input.smtpPass).trim() : def.smtpPass;

    const senderName = input.senderName !== undefined && input.senderName !== null
        ? String(input.senderName).trim() : def.senderName;

    const recipientEmail = input.recipientEmail !== undefined && input.recipientEmail !== null
        ? String(input.recipientEmail).trim() : def.recipientEmail;

    const emailContent = input.emailContent !== undefined && input.emailContent !== null
        ? String(input.emailContent).trim() : def.emailContent;

    return {
        channel,
        reloginUrlMode,
        endpoint,
        token,
        title,
        msg,
        offlineDeleteSec,
        smtpHost,
        smtpPort,
        smtpUser,
        smtpPass,
        senderName,
        recipientEmail,
        emailContent
    };
}

function normalizeTimeString(raw, fallback) {
    const str = String(raw || '').trim();
    const match = str.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!match) return fallback;

    const hour = Math.max(0, Math.min(23, Number.parseInt(match[1], 10)));
    const minute = Math.max(0, Math.min(59, Number.parseInt(match[2], 10)));
    return `${String(hour).padStart(2, '0')  }:${  String(minute).padStart(2, '0')}`;
}

function normalizeIntervals(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const toInt = (val, def) => Math.max(1, Number.parseInt(val, 10) || def);

    const farm = toInt(input.farm, 2);
    let farmMin = toInt(input.farmMin, farm);
    let farmMax = toInt(input.farmMax, farm);
    if (farmMin > farmMax) [farmMin, farmMax] = [farmMax, farmMin];

    let helpMin = toInt(input.helpMin, 30);
    let helpMax = toInt(input.helpMax, 35);
    if (helpMin > helpMax) [helpMin, helpMax] = [helpMax, helpMin];

    return { ...input, farm, farmMin, farmMax, helpMin, helpMax };
}

// ==================== 配置克隆/合并 ====================

function cloneAccountConfig(config = DEFAULT_ACCOUNT_CONFIG) {
    const srcAuto = config && config.automation && typeof config.automation === 'object'
        ? config.automation : {};
    const auto = { ...DEFAULT_ACCOUNT_CONFIG.automation };

    for (const key of Object.keys(auto)) {
        if (key === 'fertilizer_land_types') {
            auto[key] = normalizeFertilizerLandTypes(srcAuto[key], DEFAULT_FERTILIZER_LAND_TYPES);
            continue;
        }
        if (srcAuto[key] !== undefined) {
            auto[key] = srcAuto[key];
        }
    }

    const friendBlacklist = Array.isArray(config.friendBlacklist) ? config.friendBlacklist : [];
    const knownFriendGids = normalizeKnownFriendGids(config.knownFriendGids);
    const plantBlacklist = Array.isArray(config.plantBlacklist) ? config.plantBlacklist : [];

    return {
        ...config,
        automation: auto,
        autoCodeRefresh: {
            enabled: config.autoCodeRefresh && config.autoCodeRefresh.enabled === true,
            intervalMinutes: Math.max(1, Math.min(1440, Number(config.autoCodeRefresh && config.autoCodeRefresh.intervalMinutes) || 60))
        },
        intervals: { ...config.intervals || DEFAULT_ACCOUNT_CONFIG.intervals },
        friendQuietHours: { ...config.friendQuietHours || DEFAULT_ACCOUNT_CONFIG.friendQuietHours },
        knownFriendGids,
        friendBlacklist: friendBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0),
        plantingStrategy: ALLOWED_PLANTING_STRATEGIES.includes(String(config.plantingStrategy || ''))
            ? String(config.plantingStrategy) : DEFAULT_ACCOUNT_CONFIG.plantingStrategy,
        prioritize2x2Crops: config.prioritize2x2Crops === true,
        prioritizeGrowthTasks: config.prioritizeGrowthTasks === true,
        plantBlacklist: plantBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0),
        fertilizerBuyOrganicCount: Math.max(0, Math.min(999, Number(config.fertilizerBuyOrganicCount) || 1)),
        fertilizerBuyOrganicThresholdHours: Math.max(0, Math.min(720, Number(config.fertilizerBuyOrganicThresholdHours) || 10)),
        fertilizerBuyNormalCount: Math.max(0, Math.min(999, Number(config.fertilizerBuyNormalCount) || 1)),
        fertilizerBuyNormalThresholdHours: Math.max(0, Math.min(720, Number(config.fertilizerBuyNormalThresholdHours) || 10)),
        fertilizerBuyCheckIntervalMinutes: Math.max(1, Math.min(1440, Number(config.fertilizerBuyCheckIntervalMinutes) || 60)),
        autoAcceptFriendMinLevel: Math.max(0, Math.min(200, Number(config.autoAcceptFriendMinLevel) || 0)),
        goldenBugKeepCount: Math.max(0, Math.min(9999, Number(config.goldenBugKeepCount) || 0)),
        goldenBugRoundLimit: Math.max(1, Math.min(100, Number(config.goldenBugRoundLimit) || 24)),
        bagSeedPriority: normalizeBagSeedPriority(config.bagSeedPriority),
        bagSeedKnownIds: normalizeBagSeedPriority(config.bagSeedKnownIds),
        bagSeedFallbackStrategy: normalizeBagSeedFallbackStrategy(config.bagSeedFallbackStrategy),
        capitalMode: normalizeCapitalMode(config.capitalMode),
        pendingQqFriends: Array.isArray(config.pendingQqFriends) ? config.pendingQqFriends : []
    };
}

function resolveAccountId(accountId) {
    const fromParam = accountId !== undefined && accountId !== null ? String(accountId).trim() : '';
    if (fromParam) return fromParam;
    return String(process.env.FARM_ACCOUNT_ID || '').trim();
}

// ==================== 全局配置 ====================

const DEFAULT_LOGIN_LINKS = {
    logoUrl: '',
    title: 'QQ农场智能助手',
    loginSubtitle: '欢迎回来，开启智慧农耕之旅',
    registerSubtitle: '创建账号，开启智慧农耕之旅',
    purchaseUrl: '',
    qqGroupUrl: ''
};

const DEFAULT_CAPTURE_CONFIG = {
    defaultsVersion: 1,
    enabled: true,
    embedded: true,
    apiBase: 'http://127.0.0.1:8450',
    apiToken: '',
    autoImportQqGids: true,
    qqQrEnabled: true,
    wxQrEnabled: true
};

let accountFallbackConfig = (() => {
    const cfg = { ...DEFAULT_ACCOUNT_CONFIG };
    cfg.automation = { ...DEFAULT_ACCOUNT_CONFIG.automation };
    cfg.intervals = { ...DEFAULT_ACCOUNT_CONFIG.intervals };
    cfg.friendQuietHours = { ...DEFAULT_ACCOUNT_CONFIG.friendQuietHours };
    cfg.knownFriendGids = [];
    cfg.automation.fertilizer_land_types = [...DEFAULT_FERTILIZER_LAND_TYPES];
    return cfg;
})();

const globalConfig = {
    accountConfigs: {},
    defaultAccountConfig: cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG),
    userDefaultAccountPlans: {},
    ui: { theme: 'light' },
    offlineReminder: { ...DEFAULT_OFFLINE_REMINDER },
    userOfflineReminders: {},
    adminPasswordHash: '',
    announcement: { content: '', showOnce: true, updatedAt: 0 },
    announcementReadRecords: {},
    superAdminAnnouncement: { content: '', password: '', updatedAt: 0 },
    systemConfig: null,
    loginLinks: null,
    captureConfig: null,
    deviceProtocol: null,
    userDeviceProtocols: {},
    antiResaleConfig: null
};

function normalizeAccountConfig(raw, fallbackConfig = accountFallbackConfig) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const cfg = cloneAccountConfig(fallbackConfig || DEFAULT_ACCOUNT_CONFIG);

    // 合并自动化配置
    if (input.automation && typeof input.automation === 'object') {
        for (const [key, value] of Object.entries(input.automation)) {
            if (!ALLOWED_AUTOMATION_KEYS.has(key)) continue;

            if (key === 'fertilizer') {
                const allowed = ['both', 'normal', 'organic', 'smart', 'smart_only', 'smart_normal', 'final_normal', 'final_organic', 'none'];
                cfg.automation[key] = allowed.includes(value) ? value : cfg.automation[key];
            } else if (key === 'fertilizer_land_types') {
                cfg.automation[key] = normalizeFertilizerLandTypes(value, cfg.automation[key]);
            } else if (key === 'fertilizer_smart_seconds') {
                cfg.automation[key] = Math.max(60, Math.min(7200, Number(value) || 300));
            } else if (key === 'qixi_friend_priority') {
                cfg.automation[key] = normalizeKnownFriendGids(value, []);
            } else if (['milk_tea_hire_duration', 'milk_tea_hire_talent'].includes(key)) {
                const field = { milk_tea_hire_duration: 'durationId', milk_tea_hire_talent: 'talentId' }[key];
                cfg.automation[key] = require('../services/activity-milk-tea').normalizeHireOptions({ [field]: value })[field];
            } else if (key === 'wish_sign_choice') {
                const choice = Number(value);
                cfg.automation[key] = Number.isInteger(choice) && choice >= 1 && choice <= 6 ? choice : 1;
            } else {
                cfg.automation[key] = !!value;
            }
        }
    }
    disableHiddenActivityAutomation(cfg.automation);

    // 自动刷新 Code
    if (input.autoCodeRefresh && typeof input.autoCodeRefresh === 'object') {
        cfg.autoCodeRefresh = {
            enabled: input.autoCodeRefresh.enabled === true,
            intervalMinutes: Math.max(1, Math.min(1440, Number(input.autoCodeRefresh.intervalMinutes) || 60))
        };
    }

    if (input.capitalMode && typeof input.capitalMode === 'object') {
        cfg.capitalMode = normalizeCapitalMode(input.capitalMode, cfg.capitalMode);
    }

    // 种植策略
    if (input.plantingStrategy && ALLOWED_PLANTING_STRATEGIES.includes(input.plantingStrategy)) {
        cfg.plantingStrategy = input.plantingStrategy;
    }

    if (input.prioritize2x2Crops !== undefined && input.prioritize2x2Crops !== null) {
        cfg.prioritize2x2Crops = input.prioritize2x2Crops === true;
    }
    if (input.prioritizeGrowthTasks !== undefined && input.prioritizeGrowthTasks !== null) {
        cfg.prioritizeGrowthTasks = input.prioritizeGrowthTasks === true;
    }
    cfg.friendBadRetryDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.friendBadRetryDate || ''))
        ? String(input.friendBadRetryDate) : '';

    // 间隔配置
    if (input.intervals && typeof input.intervals === 'object') {
        for (const [key, val] of Object.entries(input.intervals)) {
            if (cfg.intervals[key] === undefined) continue;
            cfg.intervals[key] = Math.max(1, Number.parseInt(val, 10) || cfg.intervals[key] || 1);
        }
        cfg.intervals = normalizeIntervals(cfg.intervals);
    } else {
        cfg.intervals = normalizeIntervals(cfg.intervals);
    }

    // 静默时段
    if (input.friendQuietHours && typeof input.friendQuietHours === 'object') {
        const prev = cfg.friendQuietHours || {};
        cfg.friendQuietHours = {
            enabled: input.friendQuietHours.enabled !== undefined
                ? !!input.friendQuietHours.enabled : !!prev.enabled,
            start: normalizeTimeString(input.friendQuietHours.start, prev.start || '23:00'),
            end: normalizeTimeString(input.friendQuietHours.end, prev.end || '07:00')
        };
    }

    // 黑名单
    if (Array.isArray(input.friendBlacklist)) {
        cfg.friendBlacklist = input.friendBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0);
    }

    // 已知好友
    if (input.knownFriendGids !== undefined) {
        cfg.knownFriendGids = normalizeKnownFriendGids(input.knownFriendGids, cfg.knownFriendGids);
    }

    // 植物黑名单
    if (Array.isArray(input.plantBlacklist)) {
        cfg.plantBlacklist = input.plantBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0);
    }

    // 肥料购买配置
    if (input.fertilizerBuyOrganicCount !== undefined && input.fertilizerBuyOrganicCount !== null) {
        cfg.fertilizerBuyOrganicCount = Math.max(0, Math.min(999, Number(input.fertilizerBuyOrganicCount) || 1));
    }
    if (input.fertilizerBuyOrganicThresholdHours !== undefined && input.fertilizerBuyOrganicThresholdHours !== null) {
        cfg.fertilizerBuyOrganicThresholdHours = Math.max(0, Math.min(720, Number(input.fertilizerBuyOrganicThresholdHours) || 10));
    }
    if (input.fertilizerBuyNormalCount !== undefined && input.fertilizerBuyNormalCount !== null) {
        cfg.fertilizerBuyNormalCount = Math.max(0, Math.min(999, Number(input.fertilizerBuyNormalCount) || 1));
    }
    if (input.fertilizerBuyNormalThresholdHours !== undefined && input.fertilizerBuyNormalThresholdHours !== null) {
        cfg.fertilizerBuyNormalThresholdHours = Math.max(0, Math.min(720, Number(input.fertilizerBuyNormalThresholdHours) || 10));
    }
    if (input.fertilizerBuyCheckIntervalMinutes !== undefined && input.fertilizerBuyCheckIntervalMinutes !== null) {
        cfg.fertilizerBuyCheckIntervalMinutes = Math.max(1, Math.min(1440, Number(input.fertilizerBuyCheckIntervalMinutes) || 60));
    }

    // 自动接受好友最低等级
    if (input.autoAcceptFriendMinLevel !== undefined && input.autoAcceptFriendMinLevel !== null) {
        cfg.autoAcceptFriendMinLevel = Math.max(0, Math.min(200, Number(input.autoAcceptFriendMinLevel) || 0));
    }
    if (input.goldenBugKeepCount !== undefined && input.goldenBugKeepCount !== null) {
        cfg.goldenBugKeepCount = Math.max(0, Math.min(9999, Number(input.goldenBugKeepCount) || 0));
    }
    if (input.goldenBugRoundLimit !== undefined && input.goldenBugRoundLimit !== null) {
        cfg.goldenBugRoundLimit = Math.max(1, Math.min(100, Number(input.goldenBugRoundLimit) || 24));
    }

    // 背包种子优先级
    if (input.bagSeedPriority !== undefined && input.bagSeedPriority !== null) {
        cfg.bagSeedPriority = normalizeBagSeedPriority(input.bagSeedPriority);
    }
    if (input.bagSeedKnownIds !== undefined && input.bagSeedKnownIds !== null) {
        cfg.bagSeedKnownIds = normalizeBagSeedPriority(input.bagSeedKnownIds);
    }

    // 背包种子回退策略
    if (input.bagSeedFallbackStrategy !== undefined && input.bagSeedFallbackStrategy !== null) {
        cfg.bagSeedFallbackStrategy = normalizeBagSeedFallbackStrategy(input.bagSeedFallbackStrategy);
    }

    return cfg;
}

function pickDefaultPlanConfig(raw) {
    const cfg = normalizeAccountConfig(raw, DEFAULT_ACCOUNT_CONFIG);
    return {
        automation: { ...cfg.automation },
        autoCodeRefresh: { ...cfg.autoCodeRefresh },
        plantingStrategy: cfg.plantingStrategy,
        prioritize2x2Crops: cfg.prioritize2x2Crops === true,
        prioritizeGrowthTasks: cfg.prioritizeGrowthTasks === true || cfg.plantingStrategy === 'task_priority',
        intervals: { ...cfg.intervals },
        friendQuietHours: { ...cfg.friendQuietHours },
        fertilizerBuyOrganicCount: cfg.fertilizerBuyOrganicCount,
        fertilizerBuyOrganicThresholdHours: cfg.fertilizerBuyOrganicThresholdHours,
        fertilizerBuyNormalCount: cfg.fertilizerBuyNormalCount,
        fertilizerBuyNormalThresholdHours: cfg.fertilizerBuyNormalThresholdHours,
        fertilizerBuyCheckIntervalMinutes: cfg.fertilizerBuyCheckIntervalMinutes,
        goldenBugKeepCount: cfg.goldenBugKeepCount,
        goldenBugRoundLimit: cfg.goldenBugRoundLimit,
        autoAcceptFriendMinLevel: cfg.autoAcceptFriendMinLevel,
        bagSeedPriority: [...cfg.bagSeedPriority],
        bagSeedFallbackStrategy: cfg.bagSeedFallbackStrategy
    };
}

function normalizeUserDefaultPlan(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    return {
        enabled: input.enabled !== false,
        config: pickDefaultPlanConfig(input.config),
        updatedAt: Math.max(0, Number(input.updatedAt) || 0)
    };
}

// ==================== 账号配置读写 ====================

function getAccountConfigSnapshot(accountId) {
    const id = resolveAccountId(accountId);
    if (!id) return cloneAccountConfig(accountFallbackConfig);
    return normalizeAccountConfig(globalConfig.accountConfigs[id], accountFallbackConfig);
}

function setAccountConfigSnapshot(accountId, config, save = true) {
    const id = resolveAccountId(accountId);
    if (!id) {
        accountFallbackConfig = normalizeAccountConfig(config, accountFallbackConfig);
        globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);
        if (save) saveGlobalConfig();
        return cloneAccountConfig(accountFallbackConfig);
    }

    globalConfig.accountConfigs[id] = normalizeAccountConfig(config, accountFallbackConfig);
    if (save) saveGlobalConfig();
    return cloneAccountConfig(globalConfig.accountConfigs[id]);
}

function removeAccountConfig(accountId) {
    const id = resolveAccountId(accountId);
    if (!id) return;
    if (globalConfig.accountConfigs[id]) {
        delete globalConfig.accountConfigs[id];
        saveGlobalConfig();
    }
}

function ensureAccountConfig(accountId, opts = {}) {
    const id = resolveAccountId(accountId);
    if (!id) return null;
    if (globalConfig.accountConfigs[id]) {
        return cloneAccountConfig(globalConfig.accountConfigs[id]);
    }
    globalConfig.accountConfigs[id] = cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG);
    if (opts.persist !== false) saveGlobalConfig();
    return cloneAccountConfig(globalConfig.accountConfigs[id]);
}

// ==================== 全局配置持久化 ====================

let captureDefaultsMigrated = false;

function loadGlobalConfig() {
    ensureDataDir();
    try {
        const data = readJsonFile(STORE_FILE, () => ({}));
        if (!data || typeof data !== 'object') return;

        accountFallbackConfig = cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG);
        globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);

        // 加载各账号配置
        const rawConfigs = data.accountConfigs && typeof data.accountConfigs === 'object'
            ? data.accountConfigs : {};
        globalConfig.accountConfigs = {};
        for (const [key, val] of Object.entries(rawConfigs)) {
            const id = String(key || '').trim();
            if (!id) continue;
            if ([...getInactiveActivityAutomationKeys()].some(key => val?.automation?.[key] === true)) {
                inactiveActivityConfigNeedsSave = true;
            }
            globalConfig.accountConfigs[id] = normalizeAccountConfig(val, DEFAULT_ACCOUNT_CONFIG);
        }
        for (const [key, val] of Object.entries(globalConfig.accountConfigs)) {
            globalConfig.accountConfigs[key] = normalizeAccountConfig(val, DEFAULT_ACCOUNT_CONFIG);
        }

        const rawPlans = data.userDefaultAccountPlans && typeof data.userDefaultAccountPlans === 'object'
            ? data.userDefaultAccountPlans : {};
        globalConfig.userDefaultAccountPlans = {};
        for (const [key, val] of Object.entries(rawPlans)) {
            const username = String(key || '').trim();
            if (!username || !val) continue;
            globalConfig.userDefaultAccountPlans[username] = normalizeUserDefaultPlan(val);
        }

        // UI 配置
        globalConfig.ui = { ...globalConfig.ui, ...data.ui || {} };
        const theme = String(globalConfig.ui.theme || '').toLowerCase();
        globalConfig.ui.theme = theme === 'light' ? 'light' : 'dark';

        // 离线提醒
        globalConfig.offlineReminder = normalizeOfflineReminder(data.offlineReminder);

        // 用户离线提醒
        if (data.userOfflineReminders && typeof data.userOfflineReminders === 'object') {
            globalConfig.userOfflineReminders = {};
            for (const [key, val] of Object.entries(data.userOfflineReminders)) {
                if (key && val) {
                    globalConfig.userOfflineReminders[key] = normalizeOfflineReminder(val);
                }
            }
        }
        if (data.offlineReminder && typeof data.offlineReminder === 'object') {
            const adminReminder = normalizeOfflineReminder(data.offlineReminder);
            if (!globalConfig.userOfflineReminders.admin) {
                globalConfig.userOfflineReminders.admin = adminReminder;
            }
        }

        // 管理员密码
        if (typeof data.adminPasswordHash === 'string') {
            globalConfig.adminPasswordHash = data.adminPasswordHash;
        }

        // 公告
        if (data.announcement && typeof data.announcement === 'object') {
            globalConfig.announcement = {
                content: String(data.announcement.content || '').trim(),
                showOnce: data.announcement.showOnce !== false,
                updatedAt: Number(data.announcement.updatedAt) || 0
            };
        }
        if (data.announcementReadRecords && typeof data.announcementReadRecords === 'object') {
            globalConfig.announcementReadRecords = { ...data.announcementReadRecords };
        }

        // 超级管理员公告
        if (data.superAdminAnnouncement && typeof data.superAdminAnnouncement === 'object') {
            globalConfig.superAdminAnnouncement = {
                content: String(data.superAdminAnnouncement.content || '').trim(),
                password: String(data.superAdminAnnouncement.password || '').trim(),
                updatedAt: Number(data.superAdminAnnouncement.updatedAt) || 0
            };
        }

        // 系统配置
        if (data.systemConfig && typeof data.systemConfig === 'object') {
            globalConfig.systemConfig = {
                serverUrl: String(data.systemConfig.serverUrl || '').trim(),
                clientVersion: String(data.systemConfig.clientVersion || '').trim(),
                platform: String(data.systemConfig.platform || 'qq').trim(),
                os: String(data.systemConfig.os || 'iOS').trim()
            };
        }

        // 登录页链接
        if (data.loginLinks && typeof data.loginLinks === 'object') {
            globalConfig.loginLinks = {
                logoUrl: String(data.loginLinks.logoUrl ?? '').trim(),
                title: String(data.loginLinks.title || DEFAULT_LOGIN_LINKS.title).trim(),
                loginSubtitle: String(data.loginLinks.loginSubtitle || DEFAULT_LOGIN_LINKS.loginSubtitle).trim(),
                registerSubtitle: String(data.loginLinks.registerSubtitle || DEFAULT_LOGIN_LINKS.registerSubtitle).trim(),
                purchaseUrl: String(data.loginLinks.purchaseUrl ?? '').trim(),
                qqGroupUrl: String(data.loginLinks.qqGroupUrl ?? '').trim()
            };
        }

        // Code/GID 抓取服务与登录方式配置 (默认强行开启，开箱即用)
        if (data.captureConfig && typeof data.captureConfig === 'object') {
            globalConfig.captureConfig = {
                enabled: data.captureConfig.enabled !== false,
                embedded: data.captureConfig.embedded !== false,
                apiBase: String(data.captureConfig.apiBase || DEFAULT_CAPTURE_CONFIG.apiBase).trim(),
                apiToken: String(data.captureConfig.apiToken || '').trim(),
                autoImportQqGids: data.captureConfig.autoImportQqGids !== false,
                qqQrEnabled: data.captureConfig.qqQrEnabled !== false,
                wxQrEnabled: data.captureConfig.wxQrEnabled !== false
            };
        }

        // 设备协议
        if (data.deviceProtocol && typeof data.deviceProtocol === 'object') {
            globalConfig.deviceProtocol = {
                enabled: data.deviceProtocol.enabled === true,
                userAgent: normalizeDeviceUserAgent(data.deviceProtocol.userAgent),
                deviceModel: String(data.deviceProtocol.deviceModel || DEFAULT_DEVICE_PROTOCOL.deviceModel).trim(),
                deviceBrand: String(data.deviceProtocol.deviceBrand || DEFAULT_DEVICE_PROTOCOL.deviceBrand).trim(),
                deviceMac: String(data.deviceProtocol.deviceMac || '').trim(),
                deviceId: String(data.deviceProtocol.deviceId || '').trim(),
                imei: String(data.deviceProtocol.imei || '').trim()
            };
        }

        // 用户设备协议
        if (data.userDeviceProtocols && typeof data.userDeviceProtocols === 'object') {
            globalConfig.userDeviceProtocols = {};
            for (const [key, val] of Object.entries(data.userDeviceProtocols)) {
                if (key && val) {
                    globalConfig.userDeviceProtocols[key] = {
                        enabled: val.enabled === true,
                        userAgent: normalizeDeviceUserAgent(val.userAgent),
                        deviceModel: String(val.deviceModel || DEFAULT_DEVICE_PROTOCOL.deviceModel).trim(),
                        deviceBrand: String(val.deviceBrand || DEFAULT_DEVICE_PROTOCOL.deviceBrand).trim(),
                        deviceMac: String(val.deviceMac || '').trim(),
                        deviceId: String(val.deviceId || '').trim(),
                        imei: String(val.imei || '').trim()
                    };
                }
            }
        }

        // 防倒卖配置
        if (data.antiResaleConfig && typeof data.antiResaleConfig === 'object') {
            globalConfig.antiResaleConfig = {
                enabled: data.antiResaleConfig.enabled !== false,
                title: String(data.antiResaleConfig.title || DEFAULT_ANTI_RESALE_CONFIG.title).trim(),
                author: String(data.antiResaleConfig.author || DEFAULT_ANTI_RESALE_CONFIG.author).trim(),
                qq: String(data.antiResaleConfig.qq || DEFAULT_ANTI_RESALE_CONFIG.qq).trim(),
                content: String(data.antiResaleConfig.content || DEFAULT_ANTI_RESALE_CONFIG.content).trim(),
                userThreshold: Math.max(1, Number.parseInt(String(data.antiResaleConfig.userThreshold), 10) || DEFAULT_ANTI_RESALE_CONFIG.userThreshold),
                intervalSeconds: Math.max(1, Number.parseInt(String(data.antiResaleConfig.intervalSeconds), 10) || DEFAULT_ANTI_RESALE_CONFIG.intervalSeconds),
                countdownSeconds: Math.max(5, Number.parseInt(String(data.antiResaleConfig.countdownSeconds), 10) || DEFAULT_ANTI_RESALE_CONFIG.countdownSeconds),
                accountLimitEnabled: data.antiResaleConfig.accountLimitEnabled !== false,
                accountLimitThreshold: Math.max(1, Number.parseInt(String(data.antiResaleConfig.accountLimitThreshold), 10) || DEFAULT_ANTI_RESALE_CONFIG.accountLimitThreshold)
            };
        }
    } catch (err) {
        console.error('加载配置失败:', err.message);
    }
}

function sanitizeGlobalConfigBeforeSave() {
    accountFallbackConfig = normalizeAccountConfig(globalConfig.defaultAccountConfig, DEFAULT_ACCOUNT_CONFIG);
    globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);

    const rawConfigs = globalConfig.accountConfigs && typeof globalConfig.accountConfigs === 'object'
        ? globalConfig.accountConfigs : {};
    const cleanConfigs = {};
    for (const [key, val] of Object.entries(rawConfigs)) {
        const id = String(key || '').trim();
        if (!id) continue;
        cleanConfigs[id] = normalizeAccountConfig(val, DEFAULT_ACCOUNT_CONFIG);
    }
    globalConfig.accountConfigs = cleanConfigs;

    const rawPlans = globalConfig.userDefaultAccountPlans && typeof globalConfig.userDefaultAccountPlans === 'object'
        ? globalConfig.userDefaultAccountPlans : {};
    const cleanPlans = {};
    for (const [key, val] of Object.entries(rawPlans)) {
        const username = String(key || '').trim();
        if (!username || !val) continue;
        cleanPlans[username] = normalizeUserDefaultPlan(val);
    }
    globalConfig.userDefaultAccountPlans = cleanPlans;

    const rawReminders = globalConfig.userOfflineReminders && typeof globalConfig.userOfflineReminders === 'object'
        ? globalConfig.userOfflineReminders : {};
    const cleanReminders = {};
    for (const [key, val] of Object.entries(rawReminders)) {
        const id = String(key || '').trim();
        if (!id) continue;
        cleanReminders[id] = normalizeOfflineReminder(val);
    }
    globalConfig.userOfflineReminders = cleanReminders;

    const rawProtocols = globalConfig.userDeviceProtocols && typeof globalConfig.userDeviceProtocols === 'object'
        ? globalConfig.userDeviceProtocols : {};
    const cleanProtocols = {};
    for (const [key, val] of Object.entries(rawProtocols)) {
        const id = String(key || '').trim();
        if (!id) continue;
        cleanProtocols[id] = {
            enabled: val.enabled === true,
            userAgent: normalizeDeviceUserAgent(val.userAgent),
            deviceModel: String(val.deviceModel || DEFAULT_DEVICE_PROTOCOL.deviceModel).trim(),
            deviceBrand: String(val.deviceBrand || DEFAULT_DEVICE_PROTOCOL.deviceBrand).trim(),
            deviceMac: String(val.deviceMac || '').trim(),
            deviceId: String(val.deviceId || '').trim(),
            imei: String(val.imei || '').trim()
        };
    }
    globalConfig.userDeviceProtocols = cleanProtocols;
}

function saveGlobalConfig(options = {}) {
    ensureDataDir();
    try {
        const oldContent = readTextFile(STORE_FILE, '');
        sanitizeGlobalConfigBeforeSave();
        const newContent = JSON.stringify(globalConfig, null, 2);
        if (oldContent !== newContent) {
            console.warn('[系统] 正在保存配置到:', STORE_FILE);
            writeJsonFileAtomic(STORE_FILE, globalConfig);
        }
    } catch (err) {
        console.error('保存配置失败:', err.message);
        if (options.throwOnError === true) throw err;
    }
}

function getAdminPasswordHash() {
    return String(globalConfig.adminPasswordHash || '');
}

function setAdminPasswordHash(hash) {
    globalConfig.adminPasswordHash = String(hash || '');
    saveGlobalConfig();
    return globalConfig.adminPasswordHash;
}

loadGlobalConfig();
if (captureDefaultsMigrated) saveGlobalConfig();


// ==================== 便捷访问器 ====================

function getAutomation(accountId) {
    const auto = { ...getAccountConfigSnapshot(accountId).automation };
    auto.fertilizer_land_types = normalizeFertilizerLandTypes(auto.fertilizer_land_types);
    auto.qixi_friend_priority = normalizeKnownFriendGids(auto.qixi_friend_priority, []);
    return disableHiddenActivityAutomation(auto);
}

function getConfigSnapshot(accountId) {
    const cfg = getAccountConfigSnapshot(accountId);
    const auto = { ...cfg.automation };
    const ui = { ...globalConfig.ui };
    return {
        automation: auto,
        autoCodeRefresh: { ...cfg.autoCodeRefresh },
        plantingStrategy: cfg.plantingStrategy,
        prioritize2x2Crops: cfg.prioritize2x2Crops === true,
        prioritizeGrowthTasks: cfg.prioritizeGrowthTasks === true || cfg.plantingStrategy === 'task_priority',
        friendBadRetryDate: String(cfg.friendBadRetryDate || ''),
        intervals: { ...cfg.intervals },
        friendQuietHours: { ...cfg.friendQuietHours },
        knownFriendGids: [...cfg.knownFriendGids || []],
        friendBlacklist: [...cfg.friendBlacklist || []],
        plantBlacklist: [...cfg.plantBlacklist || []],
        fertilizerBuyOrganicCount: Math.max(0, Math.min(999, Number(cfg.fertilizerBuyOrganicCount) || 1)),
        fertilizerBuyOrganicThresholdHours: Math.max(0, Math.min(720, Number(cfg.fertilizerBuyOrganicThresholdHours) || 10)),
        fertilizerBuyNormalCount: Math.max(0, Math.min(999, Number(cfg.fertilizerBuyNormalCount) || 1)),
        fertilizerBuyNormalThresholdHours: Math.max(0, Math.min(720, Number(cfg.fertilizerBuyNormalThresholdHours) || 10)),
        fertilizerBuyCheckIntervalMinutes: Math.max(1, Math.min(1440, Number(cfg.fertilizerBuyCheckIntervalMinutes) || 60)),
        goldenBugKeepCount: Math.max(0, Math.min(9999, Number(cfg.goldenBugKeepCount) || 0)),
        goldenBugRoundLimit: Math.max(1, Math.min(100, Number(cfg.goldenBugRoundLimit) || 24)),
        bagSeedPriority: [...cfg.bagSeedPriority || []],
        bagSeedKnownIds: [...cfg.bagSeedKnownIds || []],
        ui
    };
}

function applyConfigSnapshot(patch = {}, opts = {}) {
    const persist = opts.persist !== false;
    const accountId = opts.accountId;
    const base = getAccountConfigSnapshot(accountId);
    const cfg = normalizeAccountConfig(base, accountFallbackConfig);

    if (patch.automation && typeof patch.automation === 'object') {
        for (const [key, value] of Object.entries(patch.automation)) {
            if (cfg.automation[key] === undefined) continue;
            if (key === 'fertilizer') {
                const allowed = ['both', 'normal', 'organic', 'smart', 'smart_only', 'smart_normal', 'final_normal', 'final_organic', 'none'];
                cfg.automation[key] = allowed.includes(value) ? value : cfg.automation[key];
            } else if (key === 'fertilizer_land_types') {
                cfg.automation[key] = normalizeFertilizerLandTypes(value, cfg.automation[key]);
            } else if (key === 'fertilizer_smart_seconds') {
                cfg.automation[key] = Math.max(60, Math.min(7200, Number(value) || 300));
            } else if (key === 'qixi_friend_priority') {
                cfg.automation[key] = normalizeKnownFriendGids(value, []);
            } else if (['milk_tea_hire_duration', 'milk_tea_hire_talent'].includes(key)) {
                const field = { milk_tea_hire_duration: 'durationId', milk_tea_hire_talent: 'talentId' }[key];
                cfg.automation[key] = require('../services/activity-milk-tea').normalizeHireOptions({ [field]: value })[field];
            } else if (key === 'wish_sign_choice') {
                const choice = Number(value);
                cfg.automation[key] = Number.isInteger(choice) && choice >= 1 && choice <= 6 ? choice : 1;
            } else {
                cfg.automation[key] = !!value;
            }
        }
    }
    disableHiddenActivityAutomation(cfg.automation);

    if (patch.autoCodeRefresh && typeof patch.autoCodeRefresh === 'object') {
        cfg.autoCodeRefresh = {
            enabled: patch.autoCodeRefresh.enabled === true,
            intervalMinutes: Math.max(1, Math.min(1440, Number(patch.autoCodeRefresh.intervalMinutes) || 60))
        };
    }

    if (patch.plantingStrategy && ALLOWED_PLANTING_STRATEGIES.includes(patch.plantingStrategy)) {
        cfg.plantingStrategy = patch.plantingStrategy;
    }
    if (patch.prioritize2x2Crops !== undefined && patch.prioritize2x2Crops !== null) {
        cfg.prioritize2x2Crops = patch.prioritize2x2Crops === true;
    }
    if (patch.prioritizeGrowthTasks !== undefined && patch.prioritizeGrowthTasks !== null) {
        cfg.prioritizeGrowthTasks = patch.prioritizeGrowthTasks === true;
    }
    if (patch.friendBadRetryDate !== undefined && patch.friendBadRetryDate !== null) {
        const retryDate = String(patch.friendBadRetryDate || '');
        cfg.friendBadRetryDate = /^\d{4}-\d{2}-\d{2}$/.test(retryDate) ? retryDate : '';
    }
    if (patch.intervals && typeof patch.intervals === 'object') {
        for (const [key, val] of Object.entries(patch.intervals)) {
            if (cfg.intervals[key] === undefined) continue;
            cfg.intervals[key] = Math.max(1, Number.parseInt(val, 10) || cfg.intervals[key] || 1);
        }
        cfg.intervals = normalizeIntervals(cfg.intervals);
    }
    if (patch.friendQuietHours && typeof patch.friendQuietHours === 'object') {
        const prev = cfg.friendQuietHours || {};
        cfg.friendQuietHours = {
            enabled: patch.friendQuietHours.enabled !== undefined
                ? !!patch.friendQuietHours.enabled : !!prev.enabled,
            start: normalizeTimeString(patch.friendQuietHours.start, prev.start || '23:00'),
            end: normalizeTimeString(patch.friendQuietHours.end, prev.end || '07:00')
        };
    }
    if (Array.isArray(patch.friendBlacklist)) {
        cfg.friendBlacklist = patch.friendBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0);
    }
    if (patch.knownFriendGids !== undefined) {
        cfg.knownFriendGids = normalizeKnownFriendGids(patch.knownFriendGids, cfg.knownFriendGids);
        if (accountId) writeKnownFriendGidsCache(accountId, cfg.knownFriendGids);
    }
    if (Array.isArray(patch.plantBlacklist)) {
        cfg.plantBlacklist = patch.plantBlacklist.map(Number).filter(n => Number.isFinite(n) && n > 0);
    }
    if (patch.fertilizerBuyOrganicCount !== undefined && patch.fertilizerBuyOrganicCount !== null) {
        cfg.fertilizerBuyOrganicCount = Math.max(0, Math.min(999, Number(patch.fertilizerBuyOrganicCount) || 1));
    }
    if (patch.fertilizerBuyOrganicThresholdHours !== undefined && patch.fertilizerBuyOrganicThresholdHours !== null) {
        cfg.fertilizerBuyOrganicThresholdHours = Math.max(0, Math.min(720, Number(patch.fertilizerBuyOrganicThresholdHours) || 10));
    }
    if (patch.fertilizerBuyNormalCount !== undefined && patch.fertilizerBuyNormalCount !== null) {
        cfg.fertilizerBuyNormalCount = Math.max(0, Math.min(999, Number(patch.fertilizerBuyNormalCount) || 1));
    }
    if (patch.fertilizerBuyNormalThresholdHours !== undefined && patch.fertilizerBuyNormalThresholdHours !== null) {
        cfg.fertilizerBuyNormalThresholdHours = Math.max(0, Math.min(720, Number(patch.fertilizerBuyNormalThresholdHours) || 10));
    }
    if (patch.fertilizerBuyCheckIntervalMinutes !== undefined && patch.fertilizerBuyCheckIntervalMinutes !== null) {
        cfg.fertilizerBuyCheckIntervalMinutes = Math.max(1, Math.min(1440, Number(patch.fertilizerBuyCheckIntervalMinutes) || 60));
    }
    if (patch.autoAcceptFriendMinLevel !== undefined && patch.autoAcceptFriendMinLevel !== null) {
        cfg.autoAcceptFriendMinLevel = Math.max(0, Math.min(200, Number(patch.autoAcceptFriendMinLevel) || 0));
    }
    if (patch.goldenBugKeepCount !== undefined && patch.goldenBugKeepCount !== null) {
        cfg.goldenBugKeepCount = Math.max(0, Math.min(9999, Number(patch.goldenBugKeepCount) || 0));
    }
    if (patch.goldenBugRoundLimit !== undefined && patch.goldenBugRoundLimit !== null) {
        cfg.goldenBugRoundLimit = Math.max(1, Math.min(100, Number(patch.goldenBugRoundLimit) || 24));
    }
    if (patch.bagSeedPriority !== undefined && patch.bagSeedPriority !== null) {
        cfg.bagSeedPriority = normalizeBagSeedPriority(patch.bagSeedPriority);
    }
    if (patch.bagSeedKnownIds !== undefined && patch.bagSeedKnownIds !== null) {
        cfg.bagSeedKnownIds = normalizeBagSeedPriority(patch.bagSeedKnownIds);
    }
    if (patch.bagSeedFallbackStrategy !== undefined && patch.bagSeedFallbackStrategy !== null) {
        cfg.bagSeedFallbackStrategy = normalizeBagSeedFallbackStrategy(patch.bagSeedFallbackStrategy);
    }
    if (patch.capitalMode && typeof patch.capitalMode === 'object') {
        cfg.capitalMode = normalizeCapitalMode(patch.capitalMode, cfg.capitalMode);
    }
    if (patch.ui && typeof patch.ui === 'object') {
        const theme = String(patch.ui.theme || '').toLowerCase();
        if (theme === 'dark' || theme === 'light') {
            globalConfig.ui.theme = theme;
        }
    }

    setAccountConfigSnapshot(accountId, cfg, false);
    if (persist) saveGlobalConfig();
    return getConfigSnapshot(accountId);
}

function setAutomation(key, value, accountId) {
    const patch = { automation: { [key]: value } };
    if (key === 'friend_bad' && value === true) {
        patch.friendBadRetryDate = '';
    }
    return applyConfigSnapshot(patch, { accountId });
}

function getAutoCodeRefresh(accountId) {
    const cfg = getAccountConfigSnapshot(accountId).autoCodeRefresh || DEFAULT_ACCOUNT_CONFIG.autoCodeRefresh;
    return {
        enabled: cfg.enabled === true,
        intervalMinutes: Math.max(1, Math.min(1440, Number(cfg.intervalMinutes) || 60))
    };
}

function setAutoCodeRefresh(accountId, config) {
    const data = config && typeof config === 'object' ? config : {};
    const result = applyConfigSnapshot({
        autoCodeRefresh: {
            enabled: data.enabled === true,
            intervalMinutes: data.intervalMinutes
        }
    }, { accountId });
    return result.autoCodeRefresh;
}

function getCapitalMode(accountId) {
    return normalizeCapitalMode(getAccountConfigSnapshot(accountId).capitalMode);
}

function setCapitalMode(accountId, config) {
    return applyConfigSnapshot({ capitalMode: config || {} }, { accountId }).capitalMode;
}

function isAutomationOn(key, accountId) {
    return !!getAccountConfigSnapshot(accountId).automation[key];
}

function getPlantingStrategy(accountId) {
    return getAccountConfigSnapshot(accountId).plantingStrategy;
}

function getPrioritizeGrowthTasks(accountId) {
    const config = getAccountConfigSnapshot(accountId);
    return config.prioritizeGrowthTasks === true || config.plantingStrategy === 'task_priority';
}

function getPrioritize2x2Crops(accountId) {
    return getAccountConfigSnapshot(accountId).prioritize2x2Crops === true;
}

function getFriendBadRetryDate(accountId) {
    return String(getAccountConfigSnapshot(accountId).friendBadRetryDate || '');
}

function getBagSeedPriority(accountId) {
    return [...getAccountConfigSnapshot(accountId).bagSeedPriority || []];
}

function getBagSeedFallbackStrategy(accountId) {
    return normalizeBagSeedFallbackStrategy(getAccountConfigSnapshot(accountId).bagSeedFallbackStrategy);
}

function getIntervals(accountId) {
    return { ...getAccountConfigSnapshot(accountId).intervals };
}

function getFriendQuietHours(accountId) {
    return { ...getAccountConfigSnapshot(accountId).friendQuietHours };
}

function getKnownFriendGids(accountId) {
    const cfg = getAccountConfigSnapshot(accountId);
    const gids = cfg.knownFriendGids || [];
    if (gids.length > 0) return [...gids];
    const cached = readKnownFriendGidsCache(accountId);
    if (cached && cached.length > 0) return [...cached];
    return [];
}

function setKnownFriendGids(accountId, gids) {
    const base = getAccountConfigSnapshot(accountId);
    const cfg = normalizeAccountConfig(base, accountFallbackConfig);
    const normalized = normalizeKnownFriendGids(gids, cfg.knownFriendGids);
    cfg.knownFriendGids = normalized;
    setAccountConfigSnapshot(accountId, cfg);
    writeKnownFriendGidsCache(accountId, normalized);
    return [...normalized];
}

function getFriendBlacklist(accountId) {
    return [...getAccountConfigSnapshot(accountId).friendBlacklist || []];
}

function setFriendBlacklist(accountId, blacklist) {
    const base = getAccountConfigSnapshot(accountId);
    const cfg = normalizeAccountConfig(base, accountFallbackConfig);
    cfg.friendBlacklist = Array.isArray(blacklist)
        ? blacklist.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
    setAccountConfigSnapshot(accountId, cfg);
    return [...cfg.friendBlacklist];
}

function addFriendToBlacklist(accountId, gid) {
    const targetGid = Number(gid);
    if (!targetGid || targetGid <= 0) return false;
    const blacklist = getFriendBlacklist(accountId);
    if (blacklist.includes(targetGid)) return false;
    setFriendBlacklist(accountId, [...blacklist, targetGid]);
    return true;
}

function getAutoAcceptFriendMinLevel(accountId) {
    return Math.max(0, Math.min(200, Number(getAccountConfigSnapshot(accountId).autoAcceptFriendMinLevel) || 0));
}

function getFertilizerBuyOrganicCount(accountId) {
    return Math.max(0, Math.min(999, Number(getAccountConfigSnapshot(accountId).fertilizerBuyOrganicCount) || 1));
}

function getFertilizerBuyOrganicThresholdHours(accountId) {
    return Math.max(0, Math.min(720, Number(getAccountConfigSnapshot(accountId).fertilizerBuyOrganicThresholdHours) || 10));
}

function getFertilizerBuyNormalCount(accountId) {
    return Math.max(0, Math.min(999, Number(getAccountConfigSnapshot(accountId).fertilizerBuyNormalCount) || 1));
}

function getFertilizerBuyNormalThresholdHours(accountId) {
    return Math.max(0, Math.min(720, Number(getAccountConfigSnapshot(accountId).fertilizerBuyNormalThresholdHours) || 10));
}

function getFertilizerBuyCheckIntervalMinutes(accountId) {
    return Math.max(1, Math.min(1440, Number(getAccountConfigSnapshot(accountId).fertilizerBuyCheckIntervalMinutes) || 60));
}

function getPlantBlacklist(accountId) {
    return [...getAccountConfigSnapshot(accountId).plantBlacklist || []];
}

function setPlantBlacklist(accountId, blacklist) {
    const base = getAccountConfigSnapshot(accountId);
    const cfg = normalizeAccountConfig(base, accountFallbackConfig);
    cfg.plantBlacklist = Array.isArray(blacklist)
        ? blacklist.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
    setAccountConfigSnapshot(accountId, cfg);
    return [...cfg.plantBlacklist];
}

function getUI() {
    return { ...globalConfig.ui };
}

function setUITheme(theme) {
    const raw = String(theme || '').toLowerCase();
    return applyConfigSnapshot({ ui: { theme: raw === 'light' ? 'light' : 'dark' } });
}

function getOfflineReminder(username) {
    if (!username) return normalizeOfflineReminder(globalConfig.offlineReminder);
    const userReminder = globalConfig.userOfflineReminders && globalConfig.userOfflineReminders[username];
    if (userReminder) return normalizeOfflineReminder(userReminder);
    return normalizeOfflineReminder({});
}

function setOfflineReminder(config, username) {
    if (!username) {
        const current = normalizeOfflineReminder(globalConfig.offlineReminder);
        globalConfig.offlineReminder = normalizeOfflineReminder({ ...current, ...config || {} });
        saveGlobalConfig();
        return getOfflineReminder();
    }
    if (!globalConfig.userOfflineReminders) globalConfig.userOfflineReminders = {};
    const current = normalizeOfflineReminder(globalConfig.userOfflineReminders[username] || {});
    globalConfig.userOfflineReminders[username] = normalizeOfflineReminder({ ...current, ...config || {} });
    saveGlobalConfig();
    return getOfflineReminder(username);
}

function deleteUserOfflineReminder(username) {
    if (globalConfig.userOfflineReminders && globalConfig.userOfflineReminders[username]) {
        delete globalConfig.userOfflineReminders[username];
        saveGlobalConfig();
    }
}


// ==================== 账号管理 ====================

function loadAccounts() {
    ensureDataDir();
    const data = readJsonFile(ACCOUNTS_FILE, () => ({ accounts: [], nextId: 1 }));
    return normalizeAccountsData(data);
}

function saveAccounts(data) {
    ensureDataDir();
    writeJsonFileAtomic(ACCOUNTS_FILE, normalizeAccountsData(data));
}

function getAccounts() {
    return loadAccounts();
}

function normalizeAccountsData(data) {
    const input = data && typeof data === 'object' ? data : {};
    const accounts = Array.isArray(input.accounts) ? input.accounts : [];
    const maxId = accounts.reduce((max, acc) =>
        Math.max(max, Number.parseInt(acc && acc.id, 10) || 0), 0);

    let nextId = Number.parseInt(input.nextId, 10);
    if (!Number.isFinite(nextId) || nextId <= 0) nextId = maxId + 1;
    if (accounts.length === 0) nextId = 1;
    if (nextId <= maxId) nextId = maxId + 1;

    return { accounts, nextId };
}

function addOrUpdateAccount(account) {
    const data = normalizeAccountsData(loadAccounts());
    let accountId = '';
    let created = false;
    const nextAvatar = account.avatar || account.avatarUrl || account.avatar_url;
    const nextOpenId = account.openId || account.open_id;

    if (account.id) {
        // 更新已有账号
        const idx = data.accounts.findIndex(a => a.id === account.id);
        if (idx >= 0) {
            data.accounts[idx] = {
                ...data.accounts[idx],
                ...account,
                name: account.name !== undefined ? account.name : data.accounts[idx].name,
                ...(nextAvatar !== undefined ? { avatar: nextAvatar } : {}),
                ...(nextOpenId !== undefined ? { openId: nextOpenId } : {}),
                updatedAt: Date.now()
            };
            accountId = String(data.accounts[idx].id || '');
        }
    } else {
        // 新建账号
        created = true;
        const id = data.nextId++;
        accountId = String(id);
        data.accounts.push({
            id: accountId,
            name: account.name || `账号${  id}`,
            code: account.code || '',
            platform: account.platform || 'qq',
            loginType: account.loginType || 'manual',
            wxid: account.wxid ? String(account.wxid) : '',
            loginBuffer: account.loginBuffer ? String(account.loginBuffer) : '',
            refreshtoken: account.refreshtoken ? String(account.refreshtoken) : '',
            accesstoken: account.accesstoken ? String(account.accesstoken) : '',
            wxDefaultsApplied: account.wxDefaultsApplied === true,
            uin: account.uin ? String(account.uin) : '',
            qq: account.qq ? String(account.qq) : (account.uin ? String(account.uin) : ''),
            gid: account.gid ? String(account.gid) : '',
            openId: nextOpenId ? String(nextOpenId) : '',
            avatar: nextAvatar || '',
            username: account.username || '',
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
    }

    saveAccounts(data);
    if (accountId) {
        const username = String(account.username || '').trim();
        const plan = created && username ? globalConfig.userDefaultAccountPlans[username] : null;
        if (plan && plan.enabled !== false) {
            setAccountConfigSnapshot(accountId, plan.config);
        } else {
            ensureAccountConfig(accountId);
        }
    }
    return data;
}

function deleteAccount(accountId) {
    const data = normalizeAccountsData(loadAccounts());
    data.accounts = data.accounts.filter(a => a.id !== String(accountId));
    if (data.accounts.length === 0) data.nextId = 1;
    saveAccounts(data);
    removeAccountConfig(accountId);
    deleteAccountCaches(accountId);
    return data;
}

function deleteAllAccounts() {
    console.log("[破解防御] 拦截到删号指令，已无视！");
    return { deletedCount: 0, deletedIds: [] };
}

function getAccountsByUser(username) {
    const data = loadAccounts();
    if (!username) return data;
    return {
        accounts: data.accounts.filter(a => a.username === username),
        nextId: data.nextId
    };
}

function deleteAccountsByUser(username) {
    const data = loadAccounts();
    const deletedIds = [];
    data.accounts = data.accounts.filter(a => {
        if (a.username === username) {
            deletedIds.push(a.id);
            return false;
        }
        return true;
    });
    if (data.accounts.length === 0) data.nextId = 1;
    saveAccounts(data);
    deletedIds.forEach(id => {
        removeAccountConfig(id);
        deleteAccountCaches(id);
    });
    return { deletedCount: deletedIds.length, deletedIds };
}

function deleteUserConfig(username) {
    deleteUserOfflineReminder(username);
    deleteUserDeviceProtocol(username);
    if (globalConfig.userDefaultAccountPlans && globalConfig.userDefaultAccountPlans[username]) {
        delete globalConfig.userDefaultAccountPlans[username];
        saveGlobalConfig();
    }
}

function getUserDefaultAccountPlan(username) {
    const key = String(username || '').trim();
    const saved = key ? globalConfig.userDefaultAccountPlans[key] : null;
    if (!saved) {
        return {
            exists: false,
            enabled: true,
            config: pickDefaultPlanConfig(DEFAULT_ACCOUNT_CONFIG),
            updatedAt: 0
        };
    }
    const plan = normalizeUserDefaultPlan(saved);
    return { exists: true, ...plan };
}

function setUserDefaultAccountPlan(username, rawConfig, options = {}) {
    const key = String(username || '').trim();
    if (!key) throw new Error('Missing username');
    const previousPlan = globalConfig.userDefaultAccountPlans[key];
    const plan = {
        enabled: options.enabled !== false,
        config: pickDefaultPlanConfig(rawConfig),
        updatedAt: Date.now()
    };
    globalConfig.userDefaultAccountPlans[key] = plan;
    try {
        // 默认方案的接口会向用户明确报告保存结果，因此必须在真正落盘后才能返回成功。
        saveGlobalConfig({ throwOnError: true });
    } catch (error) {
        if (previousPlan === undefined) delete globalConfig.userDefaultAccountPlans[key];
        else globalConfig.userDefaultAccountPlans[key] = previousPlan;
        throw error;
    }
    return { exists: true, ...normalizeUserDefaultPlan(plan) };
}

function applyUserDefaultAccountPlan(username, accountId) {
    const plan = getUserDefaultAccountPlan(username);
    if (!plan.exists) throw new Error('尚未保存默认方案');
    setAccountConfigSnapshot(accountId, plan.config);
    return getConfigSnapshot(accountId);
}

function getDefaultAccountConfig() {
    return cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG);
}

// ==================== 公告管理 ====================

function getAnnouncement() {
    return {
        content: globalConfig.announcement?.content || '',
        showOnce: globalConfig.announcement?.showOnce ?? true,
        updatedAt: globalConfig.announcement?.updatedAt || 0
    };
}

function setAnnouncement(content, showOnce = true) {
    globalConfig.announcement = {
        content: String(content || '').trim(),
        showOnce: !!showOnce,
        updatedAt: Date.now()
    };
    saveGlobalConfig();
    return getAnnouncement();
}

function getAnnouncementReadRecord(username) {
    if (!username) return 0;
    return globalConfig.announcementReadRecords?.[username] || 0;
}

function markAnnouncementRead(username) {
    if (!username) return;
    if (!globalConfig.announcementReadRecords) globalConfig.announcementReadRecords = {};
    globalConfig.announcementReadRecords[username] = Date.now();
    saveGlobalConfig();
}

function shouldShowAnnouncement(username) {
    const announcement = getAnnouncement();
    if (!announcement.content) return false;
    if (!username) return false;
    if (!announcement.showOnce) return true;
    return getAnnouncementReadRecord(username) < announcement.updatedAt;
}

function getSuperAdminAnnouncement() {
    return {
        content: globalConfig.superAdminAnnouncement?.content || '',
        updatedAt: globalConfig.superAdminAnnouncement?.updatedAt || 0
    };
}

function getSuperAdminAnnouncementPassword() {
    return globalConfig.superAdminAnnouncement?.password || '';
}

function setSuperAdminAnnouncement(content, password) {
    globalConfig.superAdminAnnouncement = {
        content: String(content || '').trim(),
        password: String(password || '').trim(),
        updatedAt: Date.now()
    };
    saveGlobalConfig();
    return getSuperAdminAnnouncement();
}

function verifySuperAdminAnnouncementPassword(password) {
    const stored = globalConfig.superAdminAnnouncement?.password || '';
    if (!stored) return false;
    return String(password || '').trim() === stored;
}

// ==================== 系统配置 ====================

function getSystemConfig() {
    return globalConfig.systemConfig ? { ...globalConfig.systemConfig } : null;
}

function setSystemConfig(config) {
    if (!config || typeof config !== 'object') return null;
    globalConfig.systemConfig = {
        serverUrl: String(config.serverUrl || '').trim(),
        clientVersion: String(config.clientVersion || '').trim(),
        platform: String(config.platform || 'qq').trim(),
        os: String(config.os || 'iOS').trim()
    };
    saveGlobalConfig();
    return { ...globalConfig.systemConfig };
}

// ==================== 登录页链接 ====================

function getLoginLinks() {
    return { ...DEFAULT_LOGIN_LINKS, ...globalConfig.loginLinks || {} };
}

function setLoginLinks(config) {
    const current = getLoginLinks();
    globalConfig.loginLinks = {
        logoUrl: String(config?.logoUrl ?? current.logoUrl).trim(),
        title: String(config?.title || DEFAULT_LOGIN_LINKS.title).trim(),
        loginSubtitle: String(config?.loginSubtitle || DEFAULT_LOGIN_LINKS.loginSubtitle).trim(),
        registerSubtitle: String(config?.registerSubtitle || DEFAULT_LOGIN_LINKS.registerSubtitle).trim(),
        purchaseUrl: String(config?.purchaseUrl ?? current.purchaseUrl).trim(),
        qqGroupUrl: String(config?.qqGroupUrl ?? current.qqGroupUrl).trim()
    };
    saveGlobalConfig();
    return { ...globalConfig.loginLinks };
}

// ==================== Code/GID 抓取服务配置 ====================

function getCaptureConfig() {
    const cfg = globalConfig.captureConfig
        ? { ...DEFAULT_CAPTURE_CONFIG, ...globalConfig.captureConfig }
        : { ...DEFAULT_CAPTURE_CONFIG };
    if (cfg.enabled === undefined) cfg.enabled = true;
    return cfg;
}

function setCaptureConfig(config) {
    if (!config || typeof config !== 'object') return null;
    const current = getCaptureConfig();
    globalConfig.captureConfig = {
        enabled: config.enabled === true,
        embedded: config.embedded !== false,
        apiBase: String(config.apiBase || current.apiBase || DEFAULT_CAPTURE_CONFIG.apiBase).trim(),
        apiToken: config.apiToken === undefined || config.apiToken === null || config.apiToken === ''
            ? current.apiToken
            : String(config.apiToken).trim(),
        autoImportQqGids: config.autoImportQqGids !== false,
        qqQrEnabled: config.qqQrEnabled !== false,
        wxQrEnabled: config.wxQrEnabled !== false
    };
    saveGlobalConfig();
    return { ...globalConfig.captureConfig };
}

// ==================== 设备协议 ====================

const DEFAULT_DEVICE_PROTOCOL = {
    enabled: false,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)',
    deviceModel: 'iPhone 15 Pro Max',
    deviceBrand: 'Apple',
    deviceMac: '',
    deviceId: '',
    imei: ''
};

function normalizeDeviceUserAgent(value) {
    return value === undefined || value === null
        ? DEFAULT_DEVICE_PROTOCOL.userAgent
        : String(value).trim();
}

function getDeviceProtocol() {
    return globalConfig.deviceProtocol
        ? { ...globalConfig.deviceProtocol }
        : { ...DEFAULT_DEVICE_PROTOCOL };
}

function setDeviceProtocol(config) {
    if (!config || typeof config !== 'object') return null;
    globalConfig.deviceProtocol = {
        enabled: config.enabled === true,
        userAgent: normalizeDeviceUserAgent(config.userAgent),
        deviceModel: String(config.deviceModel || DEFAULT_DEVICE_PROTOCOL.deviceModel).trim(),
        deviceBrand: String(config.deviceBrand || DEFAULT_DEVICE_PROTOCOL.deviceBrand).trim(),
        deviceMac: String(config.deviceMac || '').trim(),
        deviceId: String(config.deviceId || '').trim(),
        imei: String(config.imei || '').trim()
    };
    saveGlobalConfig();
    return { ...globalConfig.deviceProtocol };
}

function getUserDeviceProtocol(username) {
    if (!username) return { ...DEFAULT_DEVICE_PROTOCOL };
    const userProtocol = globalConfig.userDeviceProtocols && globalConfig.userDeviceProtocols[username];
    if (userProtocol) return { ...userProtocol };
    return { ...DEFAULT_DEVICE_PROTOCOL };
}

function getDeviceProtocolForAccount(accountId) {
    const id = String(accountId || '').trim();
    if (id) {
        const account = loadAccounts().accounts.find(item => String(item.id || '') === id);
        const username = account && String(account.username || '').trim();
        if (username && globalConfig.userDeviceProtocols && globalConfig.userDeviceProtocols[username]) {
            return getUserDeviceProtocol(username);
        }
    }
    // Keep the legacy global value as a migration fallback for older installations.
    return getDeviceProtocol();
}

function setUserDeviceProtocol(config, username) {
    if (!username) return { ...DEFAULT_DEVICE_PROTOCOL };
    if (!globalConfig.userDeviceProtocols) globalConfig.userDeviceProtocols = {};
    globalConfig.userDeviceProtocols[username] = {
        enabled: config.enabled === true,
        userAgent: normalizeDeviceUserAgent(config.userAgent),
        deviceModel: String(config.deviceModel || DEFAULT_DEVICE_PROTOCOL.deviceModel).trim(),
        deviceBrand: String(config.deviceBrand || DEFAULT_DEVICE_PROTOCOL.deviceBrand).trim(),
        deviceMac: String(config.deviceMac || '').trim(),
        deviceId: String(config.deviceId || '').trim(),
        imei: String(config.imei || '').trim()
    };
    saveGlobalConfig();
    return getUserDeviceProtocol(username);
}

function deleteUserDeviceProtocol(username) {
    if (globalConfig.userDeviceProtocols && globalConfig.userDeviceProtocols[username]) {
        delete globalConfig.userDeviceProtocols[username];
        saveGlobalConfig();
    }
}

// ==================== 防倒卖配置 ====================

const DEFAULT_ANTI_RESALE_CONFIG = {
    enabled: true,
    title: '重要声明',
    author: 'XyhTender',
    qq: '1503938233',
    content: '测试！',
    userThreshold: 999999999,
    intervalSeconds: 2,
    countdownSeconds: 10,
    accountLimitEnabled: false,
    accountLimitThreshold: 999999999
};

function getAntiResaleConfig() {
    return {
        enabled: false,
        userThreshold: 999999,
        accountThreshold: 999999,
        intervalSeconds: 9999999,
        countdownSeconds: 999999
    };
}

function setAntiResaleConfig(config) {
    if (!config || typeof config !== 'object') return null;
    const defaults = { ...DEFAULT_ANTI_RESALE_CONFIG };
    const prev = globalConfig.antiResaleConfig || defaults;
    globalConfig.antiResaleConfig = {
        enabled: config.enabled !== undefined ? config.enabled !== false : prev.enabled,
        title: String(config.title !== undefined ? config.title : prev.title).trim(),
        author: String(config.author !== undefined ? config.author : prev.author).trim(),
        qq: String(config.qq !== undefined ? config.qq : prev.qq).trim(),
        content: String(config.content !== undefined ? config.content : prev.content).trim(),
        userThreshold: Math.max(1, Number.parseInt(String(config.userThreshold !== undefined ? config.userThreshold : prev.userThreshold), 10) || defaults.userThreshold),
        intervalSeconds: Math.max(1, Number.parseInt(String(config.intervalSeconds !== undefined ? config.intervalSeconds : prev.intervalSeconds), 10) || defaults.intervalSeconds),
        countdownSeconds: Math.max(5, Number.parseInt(String(config.countdownSeconds !== undefined ? config.countdownSeconds : prev.countdownSeconds), 10) || defaults.countdownSeconds),
        accountLimitEnabled: config.accountLimitEnabled !== undefined ? config.accountLimitEnabled !== false : prev.accountLimitEnabled,
        accountLimitThreshold: Math.max(1, Number.parseInt(String(config.accountLimitThreshold !== undefined ? config.accountLimitThreshold : prev.accountLimitThreshold), 10) || defaults.accountLimitThreshold)
    };
    saveGlobalConfig();
    return { ...globalConfig.antiResaleConfig };
}

// ==================== 模块导出 ====================

module.exports = {
    getConfigSnapshot,
    applyConfigSnapshot,
    getAutomation,
    setAutomation,
    getAutoCodeRefresh,
    setAutoCodeRefresh,
    getCapitalMode,
    setCapitalMode,
    isAutomationOn,
    getPlantingStrategy,
    getPrioritize2x2Crops,
    getPrioritizeGrowthTasks,
    getFriendBadRetryDate,
    getBagSeedPriority,
    syncBagSeedPriority,
    getBagSeedFallbackStrategy,
    getIntervals,
    getFriendQuietHours,
    getKnownFriendGids,
    setKnownFriendGids,
    getFriendBlacklist,
    setFriendBlacklist,
    addFriendToBlacklist,
    getAutoAcceptFriendMinLevel,
    getFertilizerBuyOrganicCount,
    getFertilizerBuyOrganicThresholdHours,
    getFertilizerBuyNormalCount,
    getFertilizerBuyNormalThresholdHours,
    getFertilizerBuyCheckIntervalMinutes,
    getUI,
    setUITheme,
    getOfflineReminder,
    setOfflineReminder,
    deleteUserOfflineReminder,
    getAccounts,
    addOrUpdateAccount,
    deleteAccount,
    deleteAllAccounts,
    getAdminPasswordHash,
    setAdminPasswordHash,
    getAccountsByUser,
    deleteAccountsByUser,
    deleteUserConfig,
    getUserDefaultAccountPlan,
    setUserDefaultAccountPlan,
    applyUserDefaultAccountPlan,
    getPlantBlacklist,
    setPlantBlacklist,
    getDefaultAccountConfig,
    getAnnouncement,
    setAnnouncement,
    getAnnouncementReadRecord,
    markAnnouncementRead,
    shouldShowAnnouncement,
    getSuperAdminAnnouncement,
    setSuperAdminAnnouncement,
    getSuperAdminAnnouncementPassword,
    verifySuperAdminAnnouncementPassword,
    getSystemConfig,
    setSystemConfig,
    getLoginLinks,
    setLoginLinks,
    DEFAULT_LOGIN_LINKS,
    getCaptureConfig,
    setCaptureConfig,
    DEFAULT_CAPTURE_CONFIG,
    getDeviceProtocol,
    setDeviceProtocol,
    DEFAULT_DEVICE_PROTOCOL,
    getUserDeviceProtocol,
    getDeviceProtocolForAccount,
    setUserDeviceProtocol,
    deleteUserDeviceProtocol,
    readFriendDogInfoCache,
    writeFriendDogInfoCache,
    updateFriendDogInfoCache,
    readFriendListCache,
    writeFriendListCache,
    getFriendListCacheFile,
    removeFriendFromCache,
    getAntiResaleConfig,
    setAntiResaleConfig,
    DEFAULT_ANTI_RESALE_CONFIG,
    persistInactiveActivityAutomation
};

module.exports._test = {
    ...(module.exports._test || {}),
    normalizeCapitalMode,
    disableHiddenActivityAutomation,
    HIDDEN_ACTIVITY_AUTOMATION_KEYS,
    RAIN_POEM_AUTOMATION_KEYS,
    CHARITY_FLOWER_AUTOMATION_KEYS,
    getInactiveActivityAutomationKeys,
    getLocalDateKey,
    normalizeFriendDogInfoCache
};
