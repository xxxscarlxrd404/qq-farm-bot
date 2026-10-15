const process = require('node:process');
const { parentPort, workerData } = require('node:worker_threads');

const { CONFIG } = require('../config/config');
const { getLevelExpProgress } = require('../config/gameConfig');
const {
    getAutomation,
    getFriendBlacklist,
    getConfigSnapshot,
    applyConfigSnapshot
} = require('../models/store');
const {
    checkAndClaimEmails,
    getEmailDailyState
} = require('../services/email');
const {
    checkFarm,
    startFarmCheckLoop,
    stopFarmCheckLoop,
    refreshFarmCheckLoop,
    getLandsDetail,
    getAvailableSeeds,
    runFarmOperation,
    runFertilizerByConfig,
    ORGANIC_FERTILIZER_ID,
    fertilize,
    removePlant
} = require('../services/farm');
const {
    checkFriends,
    runScheduledStealCheck,
    startFriendCheckLoop,
    stopFriendCheckLoop,
    refreshFriendCheckLoop,
    runBadOnceOnStartup,
    runGoldenBugPlacement,
    getFriendsList,
    getFriendLandsDetail,
    doFriendOperation,
    getFriendDogInfo,
    batchGetFriendDogInfo,
    syncFriendsFromGids,
    bootstrapQqFriendGids,
    fetchFriendsDogInfo,
    delFriend
} = require('../services/friend');
const { getInteractRecords } = require('../services/interact');
const { processInviteCodes } = require('../services/invite');
const {
    autoBuyFertilizer,
    checkAndBuyFertilizerBoth,
    buyFreeGifts,
    getFreeGiftDailyState
} = require('../services/mall');
const {
    performDailyMonthCardGift,
    getMonthCardDailyState
} = require('../services/monthcard');
const {
    performDailyVipGift,
    getVipDailyState
} = require('../services/qqvip');
const {
    createScheduler,
    getSchedulerRegistrySnapshot
} = require('../services/scheduler');
const {
    performDailyShare,
    getShareDailyState
} = require('../services/share');
const {
    resetSessionGains,
    recordOperation,
    initStatsWithPersistence,
    saveStats
} = require('../services/stats');
const {
    initStatusBar,
    setStatusPlatform,
    setRecordGoldExpHook,
    statusData
} = require('../services/status');
const {
    initTaskSystem,
    cleanupTaskSystem,
    checkAndClaimTasks,
    getTaskClaimDailyState,
    getTaskDailyStateLikeApp,
    getGrowthTaskStateLikeApp
} = require('../services/task');
const {
    sellAllFruits,
    getBag,
    getBagItems,
    openFertilizerGiftPacksSilently
} = require('../services/warehouse');
const {
    connect,
    stopNetwork,
    getWs,
    getUserState,
    getGatewayHealth,
    networkEvents
} = require('../utils/network');
const { nextBusinessBackoffMs } = require('../utils/gateway-health');
const { runWithRequestPriority } = require('../utils/request-priority');
const { loadProto } = require('../utils/proto');
const { setLogHook, log, toNum, sleep } = require('../utils/utils');
const { resourcePolicy, createResourceMonitor } = require('../runtime/resource-policy');

// 设置环境变量中的账号ID
if (parentPort && workerData && workerData.accountId && !process.env.FARM_ACCOUNT_ID) {
    process.env.FARM_ACCOUNT_ID = String(workerData.accountId);
}

// ==================== IPC 通信 ====================

/** 发送消息给主进程 */
function sendToMaster(message) {
    if (process.send) {
        process.send(message);
        return;
    }
    if (parentPort) {
        parentPort.postMessage(message);
    }
}

/** 监听主进程消息 */
function onMasterMessage(handler) {
    if (process.send) process.on('message', handler);
    if (parentPort) parentPort.on('message', handler);
}

/** 退出 Worker 进程 */
function exitWorker(code = 0) {
    if (parentPort) {
        try { parentPort.close(); } catch { }
    }
    setImmediate(() => process.exit(code));
}

// ==================== 格式化工具 ====================

function pad2(num) {
    return String(num).padStart(2, '0');
}

function formatLocalDateTime24(date = new Date()) {
    const d = date instanceof Date ? date : new Date();
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const min = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    return `${yyyy  }-${  mm  }-${  dd  } ${  hh  }:${  min  }:${  ss}`;
}

// ==================== 日志/统计钩子 ====================

setLogHook((tag, msg, isWarn, meta) => {
    sendToMaster({
        type: 'log',
        data: {
            time: formatLocalDateTime24(new Date()),
            tag,
            msg,
            isWarn,
            meta: meta || {}
        }
    });
});

setRecordGoldExpHook((gold, exp) => {
    const { recordGoldExp } = require('../services/stats');
    recordGoldExp(gold, exp);
    sendToMaster({
        type: 'stat_update',
        data: { gold, exp }
    });
});

// ==================== 全局状态 ====================

let isRunning = false;
let loginReady = false;
let latestDailyGifts = null;

async function syncDailyGiftsToMaster() {
    try {
        const overview = await getDailyGiftOverview();
        if (overview && overview.gifts) {
            latestDailyGifts = overview;
            sendToMaster({ type: 'daily_gifts_sync', data: overview });
            try {
                const statsService = require('../services/stats');
                if (statsService && typeof statsService.setLatestDailyGifts === 'function') {
                    statsService.setLatestDailyGifts(overview);
                }
            } catch {}
        }
    } catch {}
}
let appliedConfigRevision = 0;
let unifiedSchedulerRunning = false;

// ==================== 工具函数 ====================

/** 判断是否是瞬时网络错误（可忽略） */
function isTransientNetworkError(err) {
    const msg = String(err && err.message || '');
    if (!msg) return false;
    return ['连接未打开', '请求超时', '请求已中断', '连接关闭', '发送失败', '请求队列已满']
        .some(text => msg.includes(text));
}

// ==================== 农场/好友/偷菜 Tick 任务 ====================

let farmTaskRunning = false;
let nextFarmRunAt = 0;
let lastStatusHash = '';
let lastStatusSentAt = 0;
let onSellGain = null;
let onFarmHarvested = null;
let onDogSkillGiftPending = null;
let harvestSellRunning = false;
let onWsError = null;
let onDisconnectHandler = null;
let onClientVersionUpdate = null;
let wsErrorHandledAt = 0;
let lastDailyRunDate = '';
let friendSyncPaused = false;
let starActivityClaimRunning = false;

const workerScheduler = createScheduler('worker');
const resourceMonitor = createResourceMonitor();
let offlinePollDelayMs = resourcePolicy.offlinePollMinMs;
let nextPermitId = 1;
const pendingPermits = new Map();

function acquireTaskPermit() {
    if (resourcePolicy.globalTaskConcurrency <= 0) return Promise.resolve(null);
    const token = String(nextPermitId++);
    return new Promise(resolve => {
        pendingPermits.set(token, resolve);
        sendToMaster({ type: 'task_permit_request', token });
    });
}

function releaseTaskPermit(token) {
    if (!token) return;
    sendToMaster({ type: 'task_permit_release', token });
}

/** 每日任务是否启用 */
function isDailyRoutineEnabled() { return true; }

/** 获取当天日期键 */
function getLocalDateKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y  }-${  m  }-${  day}`;
}

// ==================== 每日任务 ====================

async function runDailyRoutines(force = false, options = {}) {
    if (!loginReady || friendSyncPaused) return;
    const automation = getAutomation() || {};
    const tasks = [
        ['邮件', () => checkAndClaimEmails(force)],
        ['每日任务', () => (automation.task && !options.skipTask) ? checkAndClaimTasks() : Promise.resolve()],
        ['化肥礼包', () => automation.fertilizer_gift ? openFertilizerGiftPacksSilently() : Promise.resolve()],
        ['分享', () => performDailyShare(force)],
        ['月卡', () => performDailyMonthCardGift(force)],
        ['免费礼包', () => buyFreeGifts(force)],
        ['点券礼包', () => require('../services/mall-gift-auto-buy').autoBuyCouponGifts()],
        ['SVIP', () => performDailyVipGift(force)],
    ];
    for (const [name, fn] of tasks) {
        try {
            await fn();
            await sleep(350);
        } catch (err) {
            log('系统', `每日[${name}]执行失败: ${err.message}`, {
                module: 'system',
                event: '每日任务',
                result: 'error'
            });
        }
    }
}

function stopDailyRoutineTimer() {
    workerScheduler.clear('daily_routine_interval');
}

function startDailyRoutineTimer() {
    stopDailyRoutineTimer();
    lastDailyRunDate = getLocalDateKey();
    workerScheduler.setTimeoutTask('initial_daily_routine', 3500, () => {
        runDailyRoutines(true, { skipTask: true }).then(() => syncDailyGiftsToMaster()).catch(() => null);
    });

    // 每 60 秒检查一次日期是否变化
    workerScheduler.setIntervalTask('daily_routine_interval', 60000, () => {
        if (!loginReady) return;
        const today = getLocalDateKey();
        if (today === lastDailyRunDate) {
            // 分享资格在服务端日切后可能延迟刷新；服务内部有 10 分钟冷却，
            // 持续检查可避免零点单次未命中后必须重连才能领取。
            performDailyShare(false).catch(() => null);
            return;
        }
        lastDailyRunDate = today;
        runDailyRoutines(true)
            .then(() => runBadOnceOnStartup(true))
            .then(() => syncDailyGiftsToMaster())
            .catch(() => null);
    });
}

// ==================== 活动自动控制 ====================

const petDiaryBattleEnabled = () => loginReady && !friendSyncPaused
    && getAutomation().pet_diary_battle === true;
const petDiaryBattleExcluded = gid => String(getUserState().gid) === gid
    || getFriendBlacklist(process.env.FARM_ACCOUNT_ID || '').some(value => String(value) === gid);
const runPetDiaryBattles = require('../services/pet-diary-battle-automation').createPetDiaryBattleAutomation({
    getPet: () => require('../services/activity').getPetDiary(),
    getFriends: () => getFriendsList(),
    getFriend: gid => require('../services/activity').getPetDiaryFriend(gid),
    operate: (action, params) => require('../services/activity').operatePetDiary(action, params, {
        shouldContinue: () => petDiaryBattleEnabled() && !petDiaryBattleExcluded(params.gid),
    }),
    enabled: petDiaryBattleEnabled,
    excluded: petDiaryBattleExcluded,
    now: () => require('../utils/utils').getServerTimeSec() * 1000,
    pause: () => new Promise(resolve => setTimeout(resolve, 400)),
    report: (message, detail) => log('活动', `${message}（检查 ${detail.scanned} 人，夺宝 ${detail.battles} 次）`, {
        module: 'activity', event: '自动好友夺宝', result: detail.error ? 'error' : 'ok', ...detail,
    }),
});

/**
 * 萌宠成长日记（S3）自动化。
 *
 * 设计约束：
 * - 只调用 operatePetDiary，不绕过 service 的任何前置校验（限额、资源、活动窗口、拒绝钻石）。
 * - 每次 operate 返回完整 snapshot，直接拿来驱动下一步，避免额外读。
 * - 执行顺序有依赖：领养 -> 投喂 -> 领狗 -> 选锦囊 -> 寻宝 -> 各类领取。
 *   选锦囊必须在投喂之后：canChoose 要求已成年，而成年靠投喂换来。
 *   阶段 1（投喂）与阶段 2（寻宝）在单个快照内互斥，但同一轮里可以级联：
 *   投喂 10 次成年 -> 领狗 -> 选锦囊 -> 转入寻宝。
 * - 循环都有硬上限，即使服务端标志位异常也不会打转。
 */
async function runPetDiaryAutomation(flags) {
    const { getPetDiary, operatePetDiary } = require('../services/activity');
    const { getServerTimeSec } = require('../utils/utils');
    const spacer = () => new Promise(resolve => setTimeout(resolve, 400));
    // 用漂移校正后的服务器时钟，而不是快照里抓取的 pet.serverTime：
    // 一轮跑下来可能过去几分钟，快照时间戳只会偏小，导致中途成熟的宝藏被漏掉、
    // 精准唤醒也会算得偏晚。service 端 openTreasure 的判定用的就是这个时钟。
    const serverNowMs = () => getServerTimeSec() * 1000;

    let pet = await getPetDiary();
    if (!pet || pet.active !== true) {
        workerScheduler.clear('pet_diary_treasure_ready');
        return;
    }

    // 单步执行器：判定 -> 操作 -> 用返回的 snapshot 更新状态。
    // 失败只记日志不中断后续步骤，避免一个受限操作拖垮整批。
    // ready() 也放进 try：它一旦抛出会逃出本函数并被外层 catch 吞掉，
    // 连带跳过后续所有活动自动化，且只留一条无指向的通用错误日志。
    const step = async (enabled, event, ready, action, params = {}) => {
        try {
            if (!enabled || !ready()) return false;
            const result = await operatePetDiary(action, params);
            if (result?.snapshot) pet = result.snapshot;
            const rewards = (result?.rewards || []).map(item => `${item.name}x${item.count}`).join('、');
            log('活动', `萌宠日记${event}完成${rewards ? `：${rewards}` : ''}`, {
                module: 'activity', event: `萌宠日记${event}`, result: 'success'
            });
            return true;
        } catch (err) {
            log('活动', `萌宠日记${event}失败: ${err.message}`, {
                module: 'activity', event: `萌宠日记${event}`, result: 'error'
            });
            return false;
        }
    };

    // 领养比熊。未领养时后续所有玩法都不可用，必须最先执行。
    await step(flags.adopt, '领养比熊', () => pet.nurture?.initialized !== true, 'initialize');

    // 阶段 1：投喂。单次成长 700，成年阈值 7000，即 10 次成年即转阶段 2。
    // 日限虽为 16，但 canFeed 要求未成年，所以单次运行最多 10 次。
    let fed = 0;
    while (flags.feed && pet.nurture?.canFeed === true && fed < 12) {
        if (!await step(true, '投喂', () => true, 'feed')) break;
        fed++;
        await spacer();
    }

    // 成年即领取比熊，与领养同属一次性领取，复用同一开关。
    await step(flags.adopt, '领取比熊',
        () => pet.nurture?.adult === true && pet.nurture?.dogGranted !== true, 'claimDog');

    // ActivityService 领取奖励后，比熊还只是“可激活”；官方客户端会在宠物界面另调
    // DogService.ActivateDog。严格复用成年 + 已领奖条件，并由 pets service 再校验
    // GetDogInfo 的可激活标记，兼容此前已领取但尚未手动激活的账号。
    if (flags.adopt && pet.nurture?.adult === true && pet.nurture?.dogGranted === true) {
        try {
            const result = await require('../services/pets').activateBichonIfEligible(pet);
            if (result.activated) {
                log('活动', '萌宠日记激活比熊完成', {
                    module: 'activity', event: '萌宠日记激活比熊', result: 'success'
                });
            }
        } catch (err) {
            log('活动', `萌宠日记激活比熊失败: ${err.message}`, {
                module: 'activity', event: '萌宠日记激活比熊', result: 'error'
            });
        }
    }

    // 选锦囊必须排在投喂之后：canChoose 要求已成年（stage 2），
    // 而成年是投喂到 7000 成长值换来的。放在投喂前会导致刚成年的那一轮永远选不到锦囊。
    // 锦囊影响夺宝结算，所以又要排在寻宝之前。
    //
    // 只选不刷新：免费刷新每日仅 1 次，而池内锦囊均为正向效果，
    // 盲目重摇再取 pool[0] 期望收益为零，白扣一次免费额度。
    if (flags.charm && pet.charms?.canChoose && pet.charms.pool?.length) {
        await step(true, '选择锦囊', () => true, 'equipCharm', { charmId: pet.charms.pool[0].id });
    }

    // 阶段 2：寻宝，日限 10 次。与投喂消耗同一种元气糕（1028 x700），
    // 刚成年那一轮通常因元气糕已耗尽而拿不到 canDraw。
    let drawn = 0;
    while (flags.draw && pet.hunt?.canDraw === true && drawn < 12) {
        if (!await step(true, '寻宝', () => true, 'draw')) break;
        drawn++;
        await spacer();
    }

    // 爪印手记：逐个领取已解锁未领取的。
    if (flags.story) {
        let claimed = 0;
        while (claimed < 20) {
            const story = (pet.stories || []).find(item => item.unlocked && !item.claimed);
            if (!story) break;
            if (!await step(true, '领取手记', () => true, 'story', { order: story.order })) break;
            claimed++;
            await spacer();
        }
    }

    await step(flags.seeds, '领取种子礼包', () => pet.seeds?.canClaim === true, 'seeds');

    // 节令小礼：窗口内可领取的逐个领。
    if (flags.solar) {
        for (const term of (pet.solarTerms?.terms || [])) {
            if (term.canClaim !== true) continue;
            await step(true, `领取${term.name || '节令'}好礼`, () => true, 'solar', { termId: term.id });
            await spacer();
        }
    }

    // 宝藏护送：status 3 已完成，status 2 且 endTime 已过也算完成。
    // service 端会一并处理，这里只判断是否存在可开的宝藏。
    const treasureReady = () => (pet.treasures || []).some(item => item.status === 3
        || (item.status === 2 && item.endTime > 0 && item.endTime <= serverNowMs()));
    if (flags.treasure) {
        let opened = 0;
        while (treasureReady() && opened < 20) {
            if (!await step(true, '开启宝藏', () => true, 'openTreasure')) break;
            opened++;
            await spacer();
        }
    }

    await step(flags.compensation, '领取夺宝补偿',
        () => BigInt(String(pet.compensationCount || '0')) > 0n, 'compensation');

    if (flags.battle) await runPetDiaryBattles();

    // 护送完成是时间驱动的，5 分钟轮询会白等。按最近一个 endTime 精准唤醒，
    // 与 rain_poem_weather_renew 同一套写法：先清后设，+2s 安全垫，回调重入顶层函数。
    workerScheduler.clear('pet_diary_treasure_ready');
    if (flags.treasure) {
        const nowMs = serverNowMs();
        const nextEnd = (pet.treasures || [])
            .filter(item => item.status === 2 && item.endTime > nowMs)
            .map(item => item.endTime)
            .sort((a, b) => a - b)[0];
        if (nextEnd) {
            const delayMs = Math.max(1000, nextEnd - nowMs + 2000);
            workerScheduler.setTimeoutTask('pet_diary_treasure_ready', delayMs, () => {
                runStarActivityAutoClaims().catch(() => null);
            });
        }
    }
}

async function runStarActivityAutoClaims() {
    if (!loginReady || friendSyncPaused || starActivityClaimRunning) return;

    const automation = getAutomation() || {};
    const milkTeaEnabled = Object.keys(require('../services/activity-milk-tea').AUTO_ACTIONS).some(key => automation[key] === true);
    const claimPassport = automation.star_passport_claim === true;
    const claimSolarTerms = automation.star_solar_claim === true;
    const claimRecords = automation.star_record_claim === true;
    const claimQingmeiSeedsEnabled = automation.qingmei_seed_claim === true;
    const brewQingmeiWineEnabled = automation.qingmei_wine_brew === true;
    const useQixiDewEnabled = automation.qixi_dew_use === true;
    const buildQixiBridgeEnabled = automation.qixi_bridge_build === true;
    const giftQixiSachetEnabled = automation.qixi_sachet_gift === true;
    const buyRainPoemBottleEnabled = automation.rain_poem_bottle_buy === true;
    const collectRainPoemWeatherEnabled = automation.rain_poem_weather_collect === true;
    const useRainPoemSummonEnabled = automation.rain_poem_summon_use === true;
    const useRainPoemPrankEnabled = automation.rain_poem_prank_use === true;
    const unlockRainPoemResearchEnabled = automation.rain_poem_research_unlock === true;
    const claimCharityShareEnabled = automation.charity_flower_share_claim === true;
    const donateCharityLoveEnabled = automation.charity_flower_donate === true;
    const claimCharityRewardsEnabled = automation.charity_flower_reward_claim === true;
    const claimCharityPublicFundEnabled = automation.charity_flower_public_fund_claim === true;
    const drawWishSignEnabled = automation.wish_sign_draw === true;
    const wishSignChoice = Number(automation.wish_sign_choice);
    const wishSignChoiceId = Number.isInteger(wishSignChoice) && wishSignChoice >= 1 && wishSignChoice <= 6 ? wishSignChoice : 1;
    const claimWishSignEnabled = automation.wish_sign_claim === true;
    const shareRewardShareEnabled = automation.share_reward_share === true;
    const claimShareDailyEnabled = automation.share_reward_daily === true;
    const claimShareMilestonesEnabled = automation.share_reward_milestones === true;
    const petDiaryAdoptEnabled = automation.pet_diary_adopt === true;
    const petDiaryFeedEnabled = automation.pet_diary_feed === true;
    const petDiaryDrawEnabled = automation.pet_diary_draw === true;
    const petDiaryStoryEnabled = automation.pet_diary_story_claim === true;
    const petDiarySeedEnabled = automation.pet_diary_seed_claim === true;
    const petDiarySolarEnabled = automation.pet_diary_solar_claim === true;
    const petDiaryTreasureEnabled = automation.pet_diary_treasure_open === true;
    const petDiaryCompensationEnabled = automation.pet_diary_compensation_claim === true;
    const petDiaryCharmEnabled = automation.pet_diary_charm_equip === true;
    const petDiaryBattleFlag = automation.pet_diary_battle === true;
    const petDiaryAnyEnabled = petDiaryAdoptEnabled || petDiaryFeedEnabled || petDiaryDrawEnabled
        || petDiaryStoryEnabled || petDiarySeedEnabled || petDiarySolarEnabled
        || petDiaryTreasureEnabled || petDiaryCompensationEnabled || petDiaryCharmEnabled || petDiaryBattleFlag;
    const qixiFriendPriority = Array.isArray(automation.qixi_friend_priority)
        ? automation.qixi_friend_priority.map(Number).filter(gid => gid > 0) : [];
    if (!milkTeaEnabled && !claimPassport && !claimSolarTerms && !claimRecords && !claimQingmeiSeedsEnabled && !brewQingmeiWineEnabled
        && !useQixiDewEnabled && !buildQixiBridgeEnabled && !giftQixiSachetEnabled
        && !buyRainPoemBottleEnabled && !collectRainPoemWeatherEnabled && !useRainPoemSummonEnabled && !useRainPoemPrankEnabled
        && !unlockRainPoemResearchEnabled && !claimCharityShareEnabled && !donateCharityLoveEnabled
        && !claimCharityRewardsEnabled && !claimCharityPublicFundEnabled && !petDiaryAnyEnabled
        && !drawWishSignEnabled && !claimWishSignEnabled && !shareRewardShareEnabled && !claimShareDailyEnabled && !claimShareMilestonesEnabled) return;

    starActivityClaimRunning = true;
    try {
        const {
            claimSeasonPassportRewards,
            claimSolarTermsReward,
            claimStarRecordRewards,
            claimQingmeiSeeds,
            brewAndSellQingmeiWine
        } = require('../services/activity');
        // 心许千灯星垂野已于2026年9月官方下线，彻底跳过 getStarActivity，避免产生未找到活动报错
        const activity = {};
        if (claimPassport && Number(activity?.passport?.claimableLevels || 0) > 0) {
            try {
                const result = await claimSeasonPassportRewards();
                log('活动', `自动领取千星游记完成：${  Number(result?.claimedLevels || 0)  } 级奖励`, {
                    module: 'activity',
                    event: '千星游记自动领取',
                    result: 'success',
                    claimedLevels: Number(result?.claimedLevels || 0)
                });
            } catch (err) {
                log('活动', `自动领取千星游记失败: ${  err.message}`, {
                    module: 'activity',
                    event: '千星游记自动领取',
                    result: 'error'
                });
            }
        }

        if (claimSolarTerms) {
            const { getSolarTermsInfo } = require('../services/activity');
            const solar = await getSolarTermsInfo().catch(error => {
                log('活动', `节令小札读取失败：${error.message}`, { module: 'activity', event: '节令小札自动检查', result: 'error' });
                return { terms: [] };
            });
            const terms = (solar.terms || []).filter(term => term && term.claimable);
            for (const term of terms) {
                try {
                    const result = await claimSolarTermsReward(Number(term.id) || 0);
                    log('活动', `自动领取节令小札完成：${  term.title || result?.term?.title || term.id  }`, {
                        module: 'activity',
                        event: '节令小札自动领取',
                        result: 'success',
                        termId: Number(term.id) || 0,
                        termTitle: term.title || result?.term?.title || ''
                    });
                } catch (err) {
                    log('活动', `自动领取节令小札失败: ${  err.message}`, {
                        module: 'activity',
                        event: '节令小札自动领取',
                        result: 'error',
                        termId: Number(term.id) || 0
                    });
                }
            }
        }

        if (claimRecords && Number(activity?.starRecord?.claimableCount || 0) > 0) {
            try {
                const result = await claimStarRecordRewards();
                log('活动', `自动领取观星礼录完成：${  result?.recordIds?.length || 0  } 个星宿`, {
                    module: 'activity',
                    event: '观星礼录自动领取',
                    result: 'success',
                    recordCount: result?.recordIds?.length || 0
                });
            } catch (err) {
                log('活动', `自动领取观星礼录失败: ${  err.message}`, {
                    module: 'activity',
                    event: '观星礼录自动领取',
                    result: 'error'
                });
            }
        }

        // 青梅领取节点不稳定地下发每日 status，不能依赖页面用的 claimable
        // 字段决定是否调用；服务端“已领取”响应会在 service 内标记当天状态。
        if (claimQingmeiSeedsEnabled && activity?.qingmei?.claimActive !== false && activity?.qingmei?.claimed !== true) {
            try {
                const result = await claimQingmeiSeeds();
                const alreadyClaimed = result?.alreadyClaimed === true;
                log('活动', alreadyClaimed
                    ? '自动校验青梅种子：今日已领取'
                    : `自动领取青梅种子完成：${  Number(result?.claimedCount || 0)  } 个`, {
                    module: 'activity',
                    event: '青梅种子自动领取',
                    result: alreadyClaimed ? 'none' : 'success',
                    alreadyClaimed,
                    claimedCount: Number(result?.claimedCount || 0)
                });
            } catch (err) {
                log('活动', `自动领取青梅种子失败: ${  err.message}`, {
                    module: 'activity',
                    event: '青梅种子自动领取',
                    result: 'error'
                });
            }
        }
        if (brewQingmeiWineEnabled && activity?.qingmei?.wineActive !== false && Number(activity?.qingmei?.material?.itemCount || 0) > 0) {
            try {
                const result = await brewAndSellQingmeiWine({ share: true });
                const sellOption = Math.max(1, Number(result?.sell?.multiple || (result?.share?.shared ? 2 : 1)) || 1);
                const incomeMultiple = sellOption === 2 ? 1.5 : 1;
                const previewPrice = Number(result?.preview?.price || 0);
                const finalPrice = Number(result?.brew?.price || 0);
                const brewMultiple = previewPrice > 0 && finalPrice > 0
                    ? Number((finalPrice / previewPrice).toFixed(2))
                    : 1;
                log('活动', `自动酿造并售卖青梅酿完成：酿造 ${  brewMultiple  } 倍，分享收入 ${  incomeMultiple  } 倍，金币 ${  Number(result?.sell?.gold || 0)  }`, {
                    module: 'activity',
                    event: '青梅酿自动酿造',
                    result: 'success',
                    consumedCount: Number(result?.consumedCount || 0),
                    gold: Number(result?.sell?.gold || 0),
                    brewMultiple,
                    previewPrice,
                    finalPrice,
                    incomeMultiple,
                    protocolMultiple: sellOption,
                    shared: result?.share?.shared === true
                });
            } catch (err) {
                log('活动', `自动酿造青梅酿失败: ${  err.message}`, {
                    module: 'activity',
                    event: '青梅酿自动酿造',
                    result: 'error',
                    stage: err?.stage || ''
                });
            }
        }

        if (useQixiDewEnabled || buildQixiBridgeEnabled || giftQixiSachetEnabled) {
            const { getQixiActivity, useQixiDew, buildQixiBridge, sendQixiSachet } = require('../services/activity');
            let qixi = await getQixiActivity();
            if (useQixiDewEnabled && !qixi?.dewUsage?.limitReached && Number(qixi?.items?.dew?.itemCount || 0) > 0) {
                const result = await useQixiDew();
                qixi = result.activity || qixi;
                log('活动', `自动使用鹊羽灵露完成：${Number(result.usedCount || 0)} 个`, { module: 'activity', event: '鹊羽灵露自动使用', result: result.usedCount ? 'success' : 'none' });
            }
            if (buildQixiBridgeEnabled) {
                let built = 0;
                try {
                    while (qixi?.bridge?.canBuild && built < 20) {
                        const result = await buildQixiBridge();
                        if (!result.built) break;
                        built++;
                        qixi = result.activity || qixi;
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    log('活动', `自动驻建鹊桥完成：${built} 阶段`, { module: 'activity', event: '鹊桥自动驻建', result: built ? 'success' : 'none', count: built });
                } catch (err) {
                    log('活动', `自动驻建鹊桥失败: ${err.message}`, { module: 'activity', event: '鹊桥自动驻建', result: 'error', count: built });
                }
            }
            if (giftQixiSachetEnabled && qixiFriendPriority.length > 0 && Number(qixi?.gift?.remainingCount || 0) > 0) {
                let sent = 0;
                for (const gid of qixiFriendPriority) {
                    if (Number(qixi?.gift?.remainingCount || 0) <= 0 || Number(qixi?.items?.sachet?.itemCount || 0) <= 0) break;
                    try {
                        const sendCount = Math.min(
                            Number(qixi.gift.remainingCount || 0),
                            Number(qixi.items.sachet.itemCount || 0)
                        );
                        const result = await sendQixiSachet(gid, sendCount);
                        sent += Number(result.sentCount || 0);
                        qixi = result.activity || qixi;
                    } catch (err) {
                        log('活动', `向好友 ${gid} 赠送香囊失败: ${err.message}`, { module: 'activity', event: '香囊自动赠送', result: 'error', friendGid: gid });
                    }
                }
                log('活动', `自动赠送鹊羽香囊完成：${sent} 个`, { module: 'activity', event: '香囊自动赠送', result: sent ? 'success' : 'none', count: sent });
            }
        }

        if (claimCharityShareEnabled || donateCharityLoveEnabled || claimCharityRewardsEnabled || claimCharityPublicFundEnabled) {
            const {
                getCharityFlowerActivity,
                claimCharityFlowerShareReward,
                donateCharityFlowerLove,
                claimCharityFlowerReward,
                claimCharityFlowerPublicFund
            } = require('../services/activity');
            let charity = await getCharityFlowerActivity();
            if (charity?.active !== false) {
                if (claimCharityShareEnabled && charity?.share?.claimable) {
                    await claimCharityFlowerShareReward();
                    charity = await getCharityFlowerActivity();
                }
                if (donateCharityLoveEnabled && charity?.love?.canDonate && Number(charity?.love?.count || 0) > 0) {
                    await donateCharityFlowerLove();
                    charity = await getCharityFlowerActivity();
                }
                if (claimCharityRewardsEnabled) {
                    for (const tier of charity?.personalRewards || []) {
                        if (!tier.reached || tier.claimed) continue;
                        await claimCharityFlowerReward(tier.needScore);
                    }
                    charity = await getCharityFlowerActivity();
                }
                if (claimCharityPublicFundEnabled && charity?.publicFund?.claimable && charity?.publicFund?.complianceAgreed) {
                    await claimCharityFlowerPublicFund();
                }
            }
        }

        if (drawWishSignEnabled || claimWishSignEnabled) {
            try {
                const { isWishSignActive, getWishSignActivity, operateWishSign } = require('../services/activity');
                if (isWishSignActive()) {
                    let wish = await getWishSignActivity();
                    if (drawWishSignEnabled && wish.active && wish.remainingCount > 0 && !wish.pending) {
                        await operateWishSign('draw', wishSignChoiceId);
                        wish = await getWishSignActivity();
                    }
                    if (claimWishSignEnabled && wish.active && wish.pending?.chooseId) {
                        await operateWishSign('claim', wish.pending.chooseId);
                    }
                }
            } catch (err) {
                log('活动', `秋祈良愿自动操作失败: ${err.message}`, { module: 'activity', event: '秋祈良愿自动操作', result: 'error' });
            }
        }

        if (shareRewardShareEnabled || claimShareDailyEnabled || claimShareMilestonesEnabled) {
            try {
                const { isShareRewardActive, getShareRewardActivity, operateShareReward } = require('../services/activity');
                if (isShareRewardActive()) {
                    let share = await getShareRewardActivity();
                    if (shareRewardShareEnabled && share.active && !share.daily.firstShareAwarded) {
                        await operateShareReward('share');
                        share = await getShareRewardActivity();
                    }
                    if (claimShareDailyEnabled && share.active && !share.daily.rewardClaimed) {
                        await operateShareReward('daily');
                        share = await getShareRewardActivity();
                    }
                    if (claimShareMilestonesEnabled && share.active && share.milestones.some(tier => tier.state === 2)) {
                        await operateShareReward('milestones');
                    }
                }
            } catch (err) {
                log('活动', `快乐不独享自动领取失败: ${err.message}`, { module: 'activity', event: '快乐不独享自动领取', result: 'error' });
            }
        }

        if (buyRainPoemBottleEnabled || collectRainPoemWeatherEnabled || useRainPoemSummonEnabled || useRainPoemPrankEnabled || unlockRainPoemResearchEnabled) {
            const {
                getRainPoemActivity,
                buyRainPoemCollectionBottle,
                collectRainPoemWeather,
                useRainPoemSummonBottle,
                unlockRainPoemResearch
            } = require('../services/activity');
            let rainPoem = await getRainPoemActivity();
            // 活动已结束时只跳过雨落成诗自身。此处原为 return，会连带跳过后面所有活动
            // （萌宠日记排在最后，一旦雨落成诗结束就永远不执行且无任何日志）。
            if (rainPoem?.active !== false) {
            const lightningHarvestComplete = rainPoem?.lightningHarvest?.complete === true;

            // 雷电变异作物每日目标未完成时，按服务端天气结束时间精准续接。
            // 5 分钟活动轮询仍作为断线、重启或定时器丢失后的兜底。
            workerScheduler.clear('rain_poem_weather_renew');
            if (useRainPoemSummonEnabled && !lightningHarvestComplete && rainPoem?.weather?.rainstorm && Number(rainPoem?.weather?.endTime || 0) > 0) {
                const renewDelayMs = Math.max(1000, (Number(rainPoem.weather.endTime) - Math.floor(Date.now() / 1000) + 2) * 1000);
                workerScheduler.setTimeoutTask('rain_poem_weather_renew', renewDelayMs, () => {
                    runStarActivityAutoClaims().catch(() => null);
                });
            }

            if (buyRainPoemBottleEnabled && rainPoem?.shop?.available && !rainPoem?.shop?.purchasedToday) {
                try {
                    const result = await buyRainPoemCollectionBottle();
                    rainPoem = result.activity || rainPoem;
                    log('活动', result?.purchased ? '自动购买天气采集瓶完成：1 个' : '自动购买天气采集瓶：今日已购买', {
                        module: 'activity',
                        event: '雨落成诗自动买瓶',
                        result: result?.purchased ? 'success' : 'none'
                    });
                } catch (err) {
                    log('活动', `自动购买天气采集瓶失败: ${err.message}`, { module: 'activity', event: '雨落成诗自动买瓶', result: 'error' });
                }
            }

            if (collectRainPoemWeatherEnabled && Number(rainPoem?.items?.collectionBottles || 0) > 0 && Number(rainPoem?.collection?.remainingUseCount || 0) > 0) {
                try {
                    const result = await collectRainPoemWeather();
                    rainPoem = result.activity || rainPoem;
                    log('活动', result?.collected === false
                        ? `自动采集好友雷雨：已检查 ${Number(result?.checkedCount || 0)} 位好友，暂未发现雷雨`
                        : `自动采集好友雷雨完成：${result?.friendName || result?.friendGid || ''}`, {
                        module: 'activity',
                        event: '雨落成诗自动采集',
                        result: result?.collected === false ? 'none' : 'success',
                        checkedCount: Number(result?.checkedCount || 0),
                        friendGid: Number(result?.friendGid || 0)
                    });
                } catch (err) {
                    log('活动', `自动采集好友雷雨失败: ${err.message}`, { module: 'activity', event: '雨落成诗自动采集', result: 'error' });
                }
            }

            if (useRainPoemSummonEnabled
                && !lightningHarvestComplete
                && !rainPoem?.weather?.rainstorm
                && Number(rainPoem?.items?.summonBottles || 0) > 0
                && Number(rainPoem?.summon?.usedToday || 0) < Number(rainPoem?.summon?.dailyUseLimit || 50)) {
                try {
                    const result = await useRainPoemSummonBottle();
                    rainPoem = result.activity || rainPoem;
                    const noUseMessage = result?.reason === 'daily_limit'
                        ? '自动使用雷雨召唤瓶：今日使用次数已达上限'
                        : '自动使用雷雨召唤瓶：当前已是雷雨天气';
                    log('活动', result?.used ? '自动使用雷雨召唤瓶完成' : noUseMessage, {
                        module: 'activity',
                        event: '雨落成诗自动召唤',
                        result: result?.used ? 'success' : 'none'
                    });
                } catch (err) {
                    log('活动', `自动使用雷雨召唤瓶失败: ${err.message}`, { module: 'activity', event: '雨落成诗自动召唤', result: 'error' });
                }
            }

            if (useRainPoemPrankEnabled
                && (Number(rainPoem?.items?.frogPrankBottles || 0) > 0
                    || Number(rainPoem?.items?.cloudPrankBottles || 0) > 0)) {
                try {
                    const { runRainPoemPrankPlacement } = require('../services/rain-poem-prank-service');
                    // 投放服务只在实际成功使用至少一个瓶子时记录完成日志。
                    // 活动状态与背包二次读取之间若发生库存竞态，保持静默。
                    await runRainPoemPrankPlacement();
                } catch (err) {
                    log('活动', `自动使用使坏瓶失败: ${err.message}`, { module: 'activity', event: '雨落成诗自动使坏', result: 'error' });
                }
            }

            if (unlockRainPoemResearchEnabled) {
                let unlocked = 0;
                try {
                    while ((rainPoem?.research?.stages || []).some(stage => stage.available)
                        && unlocked < 20) {
                        const stage = (rainPoem.research.stages || []).find(item => item.available);
                        if (!stage || Number(rainPoem?.items?.badges || 0) < Number(stage?.cost?.itemCount || 0)) break;
                        const result = await unlockRainPoemResearch();
                        if (!result?.unlocked) break;
                        unlocked++;
                        rainPoem = result.activity || rainPoem;
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    log('活动', `自动解锁气象研究完成：${unlocked} 个节点`, {
                        module: 'activity',
                        event: '雨落成诗自动研究',
                        result: unlocked ? 'success' : 'none',
                        count: unlocked
                    });
                } catch (err) {
                    log('活动', `自动解锁气象研究失败: ${err.message}`, { module: 'activity', event: '雨落成诗自动研究', result: 'error', count: unlocked });
                }
            }
            } // end if (rainPoem?.active !== false)
        }

        if (milkTeaEnabled) {
            const { AUTO_ACTIONS, phase } = require('../services/activity-milk-tea');
            const service = require('../services/activity');
            for (const [key, action] of Object.entries(AUTO_ACTIONS)) {
                if (!loginReady || friendSyncPaused || getAutomation()?.[key] !== true) continue;
                const currentPhase = phase(require('../utils/utils').getServerTimeSec());
                if (!['business', 'settling'].includes(currentPhase)) break;
                try {
                    const state = await service.getMilkTea();
                    if (!Number(state.summary?.shop_open_at) && !['shareDaily', 'shareRewards', 'fundRewards'].includes(action)) continue;
                    let params = {};
                    if (action === 'buy') {
                        const goods = (state.goods || []).find(x => x.category_tag === 'seed' && x.unlocked && x.remaining > 0 && !x.paid && x.affordable);
                        if (!goods) continue;
                        params = { goodsId: goods.id, count: 1 };
                    }
                    if (action === 'hire') {
                        const capacity = (state.levels || []).find(x => x.level === Number(state.shop?.level))?.employee_slot_count || 0;
                        const slot = Array.from({ length: capacity }, (_, i) => i).find(i => !(state.shop?.slots || []).some(x => Number(x.slot_index) === i && Number(x.end_at) > state.serverTime));
                        if (slot == null) continue;
                        const options = getAutomation() || {};
                        params = { slotIndex: slot, autoSelect: true, ...require('../services/activity-milk-tea').normalizeHireOptions({
                            durationId: options.milk_tea_hire_duration, talentId: options.milk_tea_hire_talent,
                        }) };
                    }
                    if (action === 'cashier' && !(state.shop?.pending_rewards || []).some(x => Number(x.count) > 0)) continue;
                    if (action === 'craft' && !(state.recipes || []).some(recipe => recipe.unlocked && recipe.fruits?.length)) continue;
                    if (action === 'boost' && !(state.balances || []).some(item => String(item.id) === String(state.shop?.sales_item_id) && Number(item.count) > 0)) continue;
                    if (action === 'wages' && !state.summary?.has_unclaimed_wage) continue;
                    if (action === 'upgrade' && !state.summary?.can_upgrade) continue;
                    if (currentPhase === 'settling' && !['cashier', 'wages', 'shareDaily', 'shareRewards', 'fundRewards'].includes(action)) continue;
                    if (action === 'shareDaily' && state.share?.daily?.daily_reward_claimed) continue;
                    if (action === 'shareRewards' && !(state.share?.milestones || []).some(x => Number(x.state) === 2)) continue;
                    if (action === 'fundRewards' && (!state.fund?.unlocked || !(state.fund?.tiers || []).some(x => Number(x.state) === 2))) continue;
                    await service.operateMilkTea(action, params);
                } catch (error) {
                    if (!error.milkTeaLogged) log('活动', `奶茶热销中自动检查失败：${error.message}`, { module: 'activity', event: '奶茶热销中自动检查', result: 'error' });
                }
            }
        }
        if (petDiaryAnyEnabled) {
            await runPetDiaryAutomation({
                adopt: petDiaryAdoptEnabled,
                feed: petDiaryFeedEnabled,
                draw: petDiaryDrawEnabled,
                story: petDiaryStoryEnabled,
                seeds: petDiarySeedEnabled,
                solar: petDiarySolarEnabled,
                treasure: petDiaryTreasureEnabled,
                compensation: petDiaryCompensationEnabled,
                battle: petDiaryBattleFlag,
                charm: petDiaryCharmEnabled
            });
        }
    } catch (err) {
        if (!isTransientNetworkError(err)) {
            log('活动', `活动自动领取检查失败: ${  err.message}`, {
                module: 'activity',
                event: '活动自动领取检查',
                result: 'error'
            });
        }
    } finally {
        starActivityClaimRunning = false;
    }
}

function stopStarActivityClaimTimer() {
    workerScheduler.clear('star_activity_claim_initial');
    workerScheduler.clear('star_activity_claim_interval');
    workerScheduler.clear('rain_poem_weather_renew');
    workerScheduler.clear('rain_poem_after_harvest');
    workerScheduler.clear('pet_diary_treasure_ready');
    starActivityClaimRunning = false;
}

function startStarActivityClaimTimer() {
    stopStarActivityClaimTimer();
    workerScheduler.setTimeoutTask('star_activity_claim_initial', 10000, () => {
        runStarActivityAutoClaims().catch(() => null);
    });
    workerScheduler.setIntervalTask('star_activity_claim_interval', 5 * 60 * 1000, () => {
        runStarActivityAutoClaims().catch(() => null);
    }, { preventOverlap: true });
}

// 神秘商人可能在登录后的任意时间出现；登录后先检查，并持续短周期探测。
function stopMysteryShopAutoBuyTimer() {
    workerScheduler.clear('mystery_shop_auto_buy_initial');
    workerScheduler.clear('mystery_shop_auto_buy_interval');
    workerScheduler.clear('mystery_shop_auto_buy_after_save');
}

function runMysteryShopAutoBuy() {
    if (!loginReady || getAutomation().mystery_shop_auto_buy !== true) return Promise.resolve();
    const { checkAndAutoBuyMysteryShop } = require('../services/mystery-shop');
    return checkAndAutoBuyMysteryShop();
}

function startMysteryShopAutoBuyTimer() {
    const { AUTO_BUY_CHECK_INTERVAL_MS } = require('../services/mystery-shop');
    stopMysteryShopAutoBuyTimer();
    workerScheduler.setTimeoutTask('mystery_shop_auto_buy_initial', 10000, () => {
        runMysteryShopAutoBuy().catch(() => null);
    });
    workerScheduler.setIntervalTask('mystery_shop_auto_buy_interval', AUTO_BUY_CHECK_INTERVAL_MS, () => {
        runMysteryShopAutoBuy().catch(() => null);
    }, { preventOverlap: true });
}

// ==================== 间隔计算 ====================

function normalizeIntervalRangeSec(minVal, maxVal, defaultVal) {
    const def = Math.max(1, Number.parseInt(defaultVal, 10) || 3);
    let min = Math.max(1, Number.parseInt(minVal, 10) || def);
    let max = Math.max(1, Number.parseInt(maxVal, 10) || def);
    if (min > max) [min, max] = [max, min];
    return { min, max };
}

function applyIntervalsToRuntime(intervals) {
    const iv = intervals && typeof intervals === 'object' ? intervals : {};
    const farmDefault = Math.max(2, Number.parseInt(iv.farm, 10) || 2);
    const farmRange = normalizeIntervalRangeSec(iv.farmMin, iv.farmMax, farmDefault);
    CONFIG.farmCheckIntervalMin = farmRange.min * 1000;
    CONFIG.farmCheckIntervalMax = farmRange.max * 1000;
    CONFIG.farmCheckInterval = CONFIG.farmCheckIntervalMin;

    const helpRange = normalizeIntervalRangeSec(iv.helpMin, iv.helpMax, 30);
    CONFIG.helpCheckIntervalMin = helpRange.min * 1000;
    CONFIG.helpCheckIntervalMax = helpRange.max * 1000;

    // 偷菜巡查时机由 friend-maturity-plan 的成熟度计划动态计算（见 runScheduledStealCheck /
    // getNextStealDelayMs），不再受用户配置的固定区间控制，此处无需处理 steal 相关字段。
}

/** 在 [minMs, maxMs] 范围内随机取一个毫秒数 */
function randomIntervalMs(minMs, maxMs) {
    const min = Math.max(1, Math.floor(Number(minMs) || 3));
    const max = Math.max(min, Math.floor(Number(maxMs) || min * 2));
    if (max === min) return min;
    return min + Math.floor(Math.random() * (max - min + 1));
}

// ==================== 统一调度时间重置 ====================

function resetUnifiedSchedule() {
    const farmDelay = randomIntervalMs(
        CONFIG.farmCheckIntervalMin || CONFIG.farmCheckInterval || 3000,
        CONFIG.farmCheckIntervalMax || CONFIG.farmCheckInterval || 5000
    );
    const helpDelay = randomIntervalMs(
        CONFIG.helpCheckIntervalMin || 30000,
        CONFIG.helpCheckIntervalMax || 35000
    );
    // 偷菜首轮延迟固定给一个较短的随机窗口即可，后续节奏由 runScheduledStealCheck
    // 返回的 getNextStealDelayMs() 动态决定（根据好友作物成熟时间计算）。
    const stealDelay = randomIntervalMs(5000, 15000);
    const accountId = String(process.env.FARM_ACCOUNT_ID || '');
    const staggerMs = [...accountId].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 3000, 0);
    const now = Date.now() + staggerMs;
    nextFarmRunAt = now + farmDelay;
    nextHelpRunAt = now + helpDelay;
    nextStealRunAt = now + stealDelay;
}

// ==================== 农场 Tick ====================

const businessBackoff = {
    farm: { delayMs: 0, reason: '' },
    friend: { delayMs: 0, reason: '' },
};

function getBusinessDeferMs(kind) {
    const state = businessBackoff[kind];
    const health = getGatewayHealth();
    if (health.healthy) {
        if (state.delayMs > 0) {
            log('系统', `${kind === 'farm' ? '农场' : '好友'}任务网关已恢复`, {
                module: 'network', event: '业务网关恢复', kind,
            });
        }
        state.delayMs = 0;
        state.reason = '';
        return 0;
    }
    state.delayMs = nextBusinessBackoffMs(state.delayMs);
    if (state.reason !== health.reason) {
        log('系统', `${kind === 'farm' ? '农场' : '好友'}任务因网关不健康退避 ${Math.round(state.delayMs / 1000)} 秒`, {
            module: 'network', event: '业务网关退避', kind, reason: health.reason,
            pending: health.pending,
        });
    }
    state.reason = health.reason;
    return state.delayMs;
}

async function runFarmTick(autoConfig) {
    if (farmTaskRunning || friendSyncPaused) return;
    const deferMs = getBusinessDeferMs('farm');
    if (deferMs > 0) {
        nextFarmRunAt = Date.now() + deferMs;
        return;
    }
    farmTaskRunning = true;

    const nextDelay = randomIntervalMs(
        CONFIG.farmCheckIntervalMin || CONFIG.farmCheckInterval || 3000,
        CONFIG.farmCheckIntervalMax || CONFIG.farmCheckInterval || 5000
    );

    try {
        await runWithRequestPriority('farm', async () => {
            if (autoConfig.farm) await checkFarm();
            // 常态农田巡查中，若开启了自动卖果实，自动兜底清空背包中的成熟果实
            if (autoConfig.sell && !harvestSellRunning) {
                try { await sellAllFruits(); } catch (_) {}
            }
        });
    } catch { } finally {
        nextFarmRunAt = Date.now() + nextDelay;
        farmTaskRunning = false;
    }
}

// ==================== 帮助 Tick ====================

let helpTaskRunning = false;
let nextHelpRunAt = 0;

async function runHelpTick(autoConfig) {
    if (helpTaskRunning || friendSyncPaused) return;
    if (!autoConfig.friend_help && !autoConfig.friend_golden_bug) return;
    const deferMs = getBusinessDeferMs('friend');
    if (deferMs > 0) {
        nextHelpRunAt = Date.now() + deferMs;
        return;
    }
    helpTaskRunning = true;

    const nextDelay = randomIntervalMs(
        CONFIG.helpCheckIntervalMin || 30000,
        CONFIG.helpCheckIntervalMax || 35000
    );
    const lowFrequencyDelay = Math.max(10 * 60 * 1000, nextDelay);

    try {
        await runWithRequestPriority('friend', async () => {
            if (autoConfig.friend_help) await checkFriends({ onlyHelp: true });
            if (autoConfig.friend_golden_bug) await runGoldenBugPlacement();
        });
    } catch (err) {
        if (!isTransientNetworkError(err)) {
            log('系统', `帮助巡查执行失败: ${  err.message}`, {
                module: 'system',
                event: '帮助巡查',
                result: 'error'
            });
        }
    } finally {
        nextHelpRunAt = Date.now() + lowFrequencyDelay;
        helpTaskRunning = false;
    }
}

// ==================== 偷菜 Tick ====================

let stealTaskRunning = false;
let nextStealRunAt = 0;

async function runStealTick(autoConfig) {
    if (stealTaskRunning || friendSyncPaused) return;
    if (!autoConfig.friend_steal) {
        nextStealRunAt = Date.now() + (15 * 60 * 1000);
        return;
    }
    const deferMs = getBusinessDeferMs('friend');
    if (deferMs > 0) {
        nextStealRunAt = Date.now() + deferMs;
        return;
    }
    stealTaskRunning = true;

    let nextDelay = 15 * 60 * 1000;

    try {
        nextDelay = await runWithRequestPriority('friend', () => runScheduledStealCheck());
    } catch (err) {
        if (!isTransientNetworkError(err)) {
            log('系统', `偷菜巡查执行失败: ${  err.message}`, {
                module: 'system',
                event: '偷菜巡查',
                result: 'error'
            });
        }
    } finally {
        nextStealRunAt = Date.now() + Math.max(1000, Number(nextDelay) || 15 * 60 * 1000);
        stealTaskRunning = false;
    }
}

// ==================== 统一调度器 ====================

async function runUnifiedTick() {
    if (!unifiedSchedulerRunning || !loginReady || friendSyncPaused) return;

    const now = Date.now();
    const shouldFarm = now >= nextFarmRunAt;
    const shouldHelp = now >= nextHelpRunAt;
    const shouldSteal = now >= nextStealRunAt;

    if (!shouldFarm && !shouldHelp && !shouldSteal) return;

    const permit = await acquireTaskPermit();
    try {
        const autoConfig = getAutomation();
        if (shouldFarm) await runFarmTick(autoConfig);
        if (shouldHelp) await runHelpTick(autoConfig);
        if (shouldSteal) await runStealTick(autoConfig);
    } finally {
        releaseTaskPermit(permit);
    }
}

function scheduleUnifiedNextTick() {
    if (!unifiedSchedulerRunning) return;
    workerScheduler.clear('unified_next_tick');

    if (!loginReady) {
        const waitMs = offlinePollDelayMs;
        offlinePollDelayMs = Math.min(resourcePolicy.offlinePollMaxMs,
            Math.max(waitMs * 2, resourcePolicy.offlinePollMinMs));
        workerScheduler.setTimeoutTask('unified_next_tick', waitMs, async () => {
            try { await runUnifiedTick(); } finally { scheduleUnifiedNextTick(); }
        });
        return;
    }

    offlinePollDelayMs = resourcePolicy.offlinePollMinMs;

    const now = Date.now();
    const nearest = Math.min(
        Number(nextFarmRunAt) || now + 3000,
        Number(nextHelpRunAt) || now + 30000,
        Number(nextStealRunAt) || now + 25000
    );
    const waitMs = Math.max(100, nearest - now);

    workerScheduler.setTimeoutTask('unified_next_tick', waitMs, async () => {
        try { await runUnifiedTick(); } finally { scheduleUnifiedNextTick(); }
    });
}

function startUnifiedScheduler() {
    if (unifiedSchedulerRunning) return;
    unifiedSchedulerRunning = true;
    resetUnifiedSchedule();
    scheduleUnifiedNextTick();
}

function stopUnifiedScheduler() {
    unifiedSchedulerRunning = false;
    farmTaskRunning = false;
    helpTaskRunning = false;
    stealTaskRunning = false;
    workerScheduler.clear('unified_next_tick');
}

// ==================== 配置同步 ====================

function applyRuntimeConfig(config, syncStatusAfter = false) {
    const prevAuto = getAutomation();
    const prevCapitalMode = require('../models/store').getCapitalMode();
    const accountId = process.env.FARM_ACCOUNT_ID || '';

    applyConfigSnapshot(config || {}, {
        persist: false,
        accountId
    });
    const nextCapitalMode = require('../models/store').getCapitalMode();
    require('../services/capital-mode').reconcileConfigChange(prevCapitalMode, nextCapitalMode).catch(() => null);

    const revision = Number((config || {}).__revision || 0);
    if (revision > 0) appliedConfigRevision = revision;

    const intervals = config && config.intervals && typeof config.intervals === 'object'
        ? config.intervals : null;
    if (intervals) applyIntervalsToRuntime(intervals);

    if (loginReady) {
        refreshFarmCheckLoop(3000);
        refreshFriendCheckLoop(12000);
        resetUnifiedSchedule();
        scheduleUnifiedNextTick();

        const hasAutomation = !!(config && config.automation && typeof config.automation === 'object');
        if (hasAutomation) {
            const newAuto = getAutomation();

            const starClaimBecameEnabled = (
                !prevAuto?.star_passport_claim && newAuto?.star_passport_claim
            ) || (
                !prevAuto?.star_record_claim && newAuto?.star_record_claim
            ) || (
                !prevAuto?.qingmei_seed_claim && newAuto?.qingmei_seed_claim
            ) || (
                !prevAuto?.qingmei_wine_brew && newAuto?.qingmei_wine_brew
            ) || (
                !prevAuto?.qixi_dew_use && newAuto?.qixi_dew_use
            ) || (
                !prevAuto?.qixi_bridge_build && newAuto?.qixi_bridge_build
            ) || (
                !prevAuto?.qixi_sachet_gift && newAuto?.qixi_sachet_gift
            ) || (
                !prevAuto?.rain_poem_bottle_buy && newAuto?.rain_poem_bottle_buy
            ) || (
                !prevAuto?.rain_poem_weather_collect && newAuto?.rain_poem_weather_collect
            ) || (
                !prevAuto?.rain_poem_summon_use && newAuto?.rain_poem_summon_use
            ) || (
                !prevAuto?.rain_poem_prank_use && newAuto?.rain_poem_prank_use
            ) || (
                !prevAuto?.rain_poem_research_unlock && newAuto?.rain_poem_research_unlock
            ) || [
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
            ].some(key => !prevAuto?.[key] && newAuto?.[key]);
            if (starClaimBecameEnabled) {
                workerScheduler.setTimeoutTask('star_activity_claim_after_save', 2000, () => {
                    runStarActivityAutoClaims().catch(() => null);
                });
            }

            const mysteryShopConfigChanged = [
                'mystery_shop_auto_buy',
                'mystery_shop_allow_gold',
                'mystery_shop_allow_coupon',
                'mystery_shop_allow_gold_bean'
            ].some(key => prevAuto?.[key] !== newAuto?.[key]);
            if (newAuto?.mystery_shop_auto_buy && mysteryShopConfigChanged) {
                workerScheduler.setTimeoutTask('mystery_shop_auto_buy_after_save', 2000, () => {
                    runMysteryShopAutoBuy().catch(() => null);
                });
            }

            // 每日任务从关变开 → 立即执行一次
            const prevDailyEnabled = isDailyRoutineEnabled(prevAuto);
            const newDailyEnabled = isDailyRoutineEnabled(newAuto);
            if (!prevDailyEnabled && newDailyEnabled) {
                workerScheduler.setTimeoutTask('daily_routine_immediate', 2000, () => {
                    runDailyRoutines(true).catch(() => null);
                });
            }

            // 施肥策略变化 → 立即施肥
            const prevFert = String(prevAuto && prevAuto.fertilizer ? prevAuto.fertilizer : '').toLowerCase();
            const newFert = String(newAuto && newAuto.fertilizer ? newAuto.fertilizer : '').toLowerCase();
            const fertChanged = prevFert !== newFert;
            if (fertChanged && (newFert === 'both' || newFert === 'organic' || newFert === 'smart' || newFert === 'smart_only' || newFert === 'smart_normal' || newFert === 'final_normal' || newFert === 'final_organic')) {
                workerScheduler.setTimeoutTask('fertilizer_immediate_after_save', 1000, async () => {
                    if (!loginReady) return;
                    try {
                        await runFertilizerByConfig([], { skipNormal: true });
                    } catch (err) {
                        log('施肥', `保存配置后立即施肥失败: ${  err.message}`, {
                            module: 'farm', event: '施肥', result: 'error'
                        });
                    }
                });
            }

            // 好友捣乱从关变开 → 立即执行
            const prevBad = !!(prevAuto && prevAuto.friend_bad);
            const newBad = !!(newAuto && newAuto.friend_bad);
            if (!prevBad && newBad) {
                workerScheduler.setTimeoutTask('friend_bad_immediate', 3000, async () => {
                    if (!loginReady) return;
                    try {
                        await runBadOnceOnStartup(true);
                    } catch (err) {
                        log('好友', `开启自动捣乱后立即执行失败: ${  err.message}`, {
                            module: 'friend', event: '开启捣乱立即执行', result: 'error'
                        });
                    }
                });
            }

            const prevGoldenBug = !!(prevAuto && prevAuto.friend_golden_bug);
            const newGoldenBug = !!(newAuto && newAuto.friend_golden_bug);
            if (!prevGoldenBug && newGoldenBug) {
                workerScheduler.setTimeoutTask('friend_golden_bug_immediate', 3000, async () => {
                    if (!loginReady) return;
                    await runGoldenBugPlacement({ force: true });
                });
            }
        }
    }

    if (syncStatusAfter) syncStatus();
}

// ==================== 主控消息处理 ====================

onMasterMessage(async (msg) => {
    try {
        if (msg.type === 'start') {
            await startBot(msg.config);
        } else if (msg.type === 'stop') {
            await stopBot();
        } else if (msg.type === 'api_call') {
            handleApiCall(msg);
        } else if (msg.type === 'config_sync') {
            applyRuntimeConfig(msg.config || {}, true);
        } else if (msg.type === 'watchdog_ping') {
            sendToMaster({ type: 'watchdog_pong', at: msg.at || Date.now() });
        } else if (msg.type === 'task_permit_granted') {
            const rawToken = String(msg.token || '');
            const token = rawToken.includes(':') ? rawToken.slice(rawToken.lastIndexOf(':') + 1) : rawToken;
            const resolve = pendingPermits.get(token);
            if (resolve) {
                pendingPermits.delete(token);
                resolve(token);
            }
        }
    } catch (err) {
        sendToMaster({ type: 'error', error: err.message });
    }
});

// ==================== 启动/停止 Bot ====================

async function startBot(config) {
    if (isRunning) return;
    isRunning = true;

    const { code, platform, loginType } = config;
    CONFIG.platform = platform || 'qq';

    await loadProto();
    log('系统', '正在连接服务器...');

    applyRuntimeConfig(getConfigSnapshot(), false);
    initStatusBar();
    setStatusPlatform(CONFIG.platform);

    // WebSocket 错误监听
    if (onWsError) {
        networkEvents.off('ws_error', onWsError);
        onWsError = null;
    }
    onWsError = (wsErr) => {
        if ((Number(wsErr?.code) || 0) !== 400) return;
        const now = Date.now();
        if (now - wsErrorHandledAt < 5000) return;
        wsErrorHandledAt = now;

        log('系统', '连接被拒绝，可能需要更新 Code');
        sendToMaster({
            type: 'ws_error',
            code: 400,
            message: wsErr?.message || ''
        });
        if (isRunning) {
            workerScheduler.setTimeoutTask('ws_error_cleanup', 500, () => {
                if (isRunning) stopBot().catch(() => exitWorker(0));
            });
        }
    };
    networkEvents.on('ws_error', onWsError);
    networkEvents.on('reconnect_failed', onReconnectFailed);
    networkEvents.on('kickout', onKickout);

    if (onClientVersionUpdate) networkEvents.off('client_version_update', onClientVersionUpdate);
    onClientVersionUpdate = ({ clientVersion, previous }) => {
        sendToMaster({
            type: 'client_version_update',
            clientVersion: String(clientVersion || ''),
            previous: String(previous || '')
        });
    };
    networkEvents.on('client_version_update', onClientVersionUpdate);

    // 断线监听
    if (onDisconnectHandler) networkEvents.off('disconnect', onDisconnectHandler);
    onDisconnectHandler = () => {
        if (!loginReady) return;
        loginReady = false;
        log('系统', '连接断开，暂停自动化任务，等待重连...');
    };
    networkEvents.on('disconnect', onDisconnectHandler);

    // 登录成功回调
    const onReady = async () => {
        loginReady = true;

        // 出售收益监听
        if (onSellGain) networkEvents.off('sell', onSellGain);
        onSellGain = (sellInfo) => {
            const gold = Number(sellInfo && sellInfo.gold || sellInfo || 0);
            const count = Number(sellInfo && sellInfo.count || 0);
            if (!Number.isFinite(gold) || gold <= 0) return;
            if (count > 0) recordOperation('sell', count);
        };
        networkEvents.on('sell', onSellGain);

        // 收获后自动出售
        if (onFarmHarvested) networkEvents.off('farmHarvested', onFarmHarvested);
        onFarmHarvested = async () => {
            if (getAutomation().rain_poem_summon_use === true) {
                workerScheduler.setTimeoutTask('rain_poem_after_harvest', 2000, () => {
                    runStarActivityAutoClaims().catch(() => null);
                });
            }
            if (harvestSellRunning) return;
            if (!getAutomation().sell) return;
            harvestSellRunning = true;
            try {
                await sellAllFruits();
            } catch (err) {
                log('仓库', `收获后自动出售失败: ${  err.message}`, {
                    module: 'warehouse', event: '收获后出售', result: 'error'
                });
            } finally {
                harvestSellRunning = false;
            }
        };
        networkEvents.on('farmHarvested', onFarmHarvested);

        if (onDogSkillGiftPending) networkEvents.off('dogSkillGiftPending', onDogSkillGiftPending);
        onDogSkillGiftPending = (count) => {
            const pendingCount = Math.max(0, toNum(count));
            if (!loginReady || pendingCount <= 0) return;
            require('../services/dog-skill-gifts').checkAndClaimDogSkillGifts(pendingCount).catch(() => null);
        };
        networkEvents.on('dogSkillGiftPending', onDogSkillGiftPending);

        // 单次背包请求同步点券和金豆豆，避免登录阶段重复并发查询。
        try {
            const bag = await getBag();
            const items = getBagItems(bag);
            let couponCount = 0;
            let goldBeanCount = 0;
            for (const item of items || []) {
                const itemId = toNum(item && item.id);
                if (itemId === 1002) couponCount = toNum(item.count);
                else if (itemId === 1005) goldBeanCount = toNum(item.count);
            }
            const state = getUserState();
            state.coupon = Math.max(0, couponCount);
            state.goldBean = Math.max(0, goldBeanCount);
        } catch { }

        // 支付服务会更新网关序列状态，等启动背包请求完成后再查询。
        try {
            const diamond = await require('../services/pay').getDiamondBalance();
            getUserState().diamond = Math.max(0, Number(diamond) || 0);
        } catch { }

        // 初始化统计数据
        const userState = getUserState();
        const accountId = process.env.FARM_ACCOUNT_ID || '';
        initStatsWithPersistence(
            accountId,
            Number(userState.gold || 0),
            Number(userState.exp || 0),
            Number(userState.coupon || 0)
        );
        resetSessionGains();

        // NapCat only supplies Code/UIN. Bootstrap farm-side GIDs after the
        // authenticated game connection is ready, without requiring openid.
        if (loginType === 'qq_napcat') {
            workerScheduler.setTimeoutTask('napcat_friend_gid_bootstrap', 2000, async () => {
                if (!loginReady) return;
                try {
                    await bootstrapQqFriendGids();
                } catch (err) {
                    log('好友', `NapCat 扫码后的好友GID补充失败: ${err.message}`, {
                        module: 'friend', event: 'QQ好友GID引导同步', result: 'error'
                    });
                }
            });
        }

        // 处理邀请码
        await processInviteCodes();

        // 打开肥料礼包
        if (getAutomation().fertilizer_gift) {
            await openFertilizerGiftPacksSilently().catch(() => 0);
        }

        // 启动后执行一次静默果实检查与出售（清理账号历史遗留果实）
        workerScheduler.setTimeoutTask('startup_sell_fruits_once', 6000, async () => {
            if (getAutomation().sell) {
                try { await sellAllFruits(); } catch (_) {}
            }
        });

        // 延迟执行放虫放草
        workerScheduler.setTimeoutTask('bad_startup_once', 15000, async () => {
            try {
                await runBadOnceOnStartup();
            } catch (err) {
                log('好友', `启动时放虫放草执行失败: ${  err.message}`, {
                    module: 'friend', event: '启动放虫放草失败', error: err.message
                });
            }
        });

        // 启动各检查循环
        startFarmCheckLoop({ externalScheduler: true });
        startFriendCheckLoop({ externalScheduler: true });

        // 启动统一调度器
        if (unifiedSchedulerRunning) {
            resetUnifiedSchedule();
            scheduleUnifiedNextTick();
        } else {
            startUnifiedScheduler();
        }

        // 启动每日定时器
        initTaskSystem();
        startDailyRoutineTimer();
        startStarActivityClaimTimer();
        startMysteryShopAutoBuyTimer();

        syncStatus();
    };

    // 建立连接
    connect(code, onReady);

    // 定期同步状态
    workerScheduler.setIntervalTask('status_sync', resourcePolicy.statusSyncIntervalMs, syncStatus, { preventOverlap: true });
}

async function stopBot() {
    if (!isRunning) return exitWorker(0);
    saveStats();
    isRunning = false;
    loginReady = false;
    friendSyncPaused = false;

    stopUnifiedScheduler();
    stopMysteryShopAutoBuyTimer();

    networkEvents.off('kickout', onKickout);
    networkEvents.off('reconnect_failed', onReconnectFailed);
    if (onClientVersionUpdate) {
        networkEvents.off('client_version_update', onClientVersionUpdate);
        onClientVersionUpdate = null;
    }

    if (onDisconnectHandler) {
        networkEvents.off('disconnect', onDisconnectHandler);
        onDisconnectHandler = null;
    }
    if (onWsError) {
        networkEvents.off('ws_error', onWsError);
        onWsError = null;
    }
    if (onSellGain) {
        networkEvents.off('sell', onSellGain);
        onSellGain = null;
    }
    if (onFarmHarvested) {
        networkEvents.off('farmHarvested', onFarmHarvested);
        onFarmHarvested = null;
    }
    if (onDogSkillGiftPending) {
        networkEvents.off('dogSkillGiftPending', onDogSkillGiftPending);
        onDogSkillGiftPending = null;
    }

    stopFarmCheckLoop();
    stopFriendCheckLoop();
    stopDailyRoutineTimer();
    stopStarActivityClaimTimer();
    cleanupTaskSystem();
    workerScheduler.clearAll();
    resourceMonitor.dispose();
    stopNetwork('账号停止');

    const ws = getWs();
    if (ws) ws.close();

    exitWorker(0);
}

// ==================== 踢下线处理 ====================

function onKickout(info) {
    const reason = info && info.reason ? info.reason : '未知';
    log('系统', `检测到踢下线，准备自动停止账号。原因: ${  reason}`);
    sendToMaster({ type: 'account_kicked', reason });
    workerScheduler.setTimeoutTask('kickout_stop', 500, () => {
        stopBot().catch(() => exitWorker(0));
    });
}

function onReconnectFailed(info) {
    const reason = info && info.reason ? info.reason : '未知';
    log('系统', `连接多次重试失败，准备停止账号。原因: ${  reason}`);
    sendToMaster({ type: 'ws_reconnect_failed', reason });
    stopBot().catch(() => exitWorker(0));
}

// ==================== API 调用处理 ====================

async function handleApiCall(msg) {
    const { id, method, args } = msg;
    let result = null;
    let error = null;

    // 好友同步操作期间暂停自动化
    const isFriendSync = method === 'getFriends' && args[0] === true
        || method === 'fetchFriendsDogInfo'
        || method === 'syncFriendsFromGids';

    if (isFriendSync) {
        friendSyncPaused = true;
        log('系统', '好友同步操作开始，已暂停其他自动化进程', {
            module: 'system', event: '好友同步暂停', method
        });
    }

    try {
        switch (method) {
            case 'getLands':
                result = await getLandsDetail();
                try {
                    const { getOwnWeatherStatus } = require('../services/activity');
                    result.weather = await getOwnWeatherStatus();
                } catch (weatherError) {
                    result.weather = { type: 0, status: 0, rainstorm: false, error: weatherError.message };
                }
                break;
            case 'getFarmScene':
                result = await require('../services/farm-scene').getFarmScene();
                break;
            case 'getFriends':
                result = await getFriendsList(args[0] === true);
                break;
            case 'getDiamondBalance':
                result = await require('../services/pay').getDiamondBalance();
                getUserState().diamond = Math.max(0, Number(result) || 0);
                break;
            case 'clearFriendsCache':
                require('../services/friend').clearFriendsListCache();
                result = { ok: true };
                break;
            case 'getInteractRecords':
                result = await getInteractRecords();
                break;
            case 'getFriendLands':
                result = await getFriendLandsDetail(args[0]);
                break;
            case 'doFriendOp':
                result = await doFriendOperation(args[0], args[1]);
                break;
            case 'getFriendDogInfo':
                result = await getFriendDogInfo(args[0]);
                break;
            case 'batchGetFriendDogInfo':
                result = await batchGetFriendDogInfo(args[0]);
                break;
            case 'syncFriendsFromGids':
                result = await syncFriendsFromGids(args[0]);
                break;
            case 'fetchFriendsDogInfo':
                result = await fetchFriendsDogInfo();
                break;
            case 'delFriend':
                result = await delFriend(args[0]);
                break;
            case 'getSeeds':
                result = await getAvailableSeeds();
                break;
            case 'getBag':
                result = await require('../services/warehouse').getBagDetail();
                break;
            case 'getBagSeeds':
                result = await require('../services/warehouse').getBagSeeds();
                break;
            case 'getDogSkillGiftStatus': {
                const dogGifts = require('../services/dog-skill-gifts');
                result = { pendingCount: dogGifts.getPendingGiftCount(await dogGifts.getDogInfo()) };
                break;
            }
            case 'claimDogSkillGifts':
                result = await require('../services/dog-skill-gifts').checkAndClaimDogSkillGifts();
                break;
            case 'getPetOverview':
                result = await require('../services/pets').getPetOverview();
                break;
            case 'activateDog':
                result = await require('../services/pets').activateDog(args[0]);
                break;
            case 'deployDog':
                require('../services/capital-mode').releaseForManualCommand();
                result = await require('../services/pets').deployDog(args[0]);
                break;
            case 'withdrawDog':
                require('../services/capital-mode').releaseForManualCommand();
                result = await require('../services/pets').withdrawDog();
                break;
            case 'feedDog':
                result = await require('../services/pets').feedDog(args[0], args[1]);
                break;
            case 'getProtectLogs':
                result = await require('../services/pets').getProtectLogs();
                break;
            case 'useItem': {
                const { useItem } = require('../services/warehouse');
                const itemId = Number(args[0]) || 0;
                const count = Math.max(1, Number(args[1]) || 1);
                const uid = Number(args[2]) || 0;
                result = await useItem(itemId, count, uid);
                break;
            }
            case 'sellItems': {
                const { sellItems } = require('../services/warehouse');
                const items = Array.isArray(args[0]) ? args[0] : [];
                const totalCount = items.reduce((sum, it) => sum + (Number(it.count) || 0), 0);
                result = await sellItems(items.map(it => ({
                    id: it.id, count: it.count, uid: it.uid || 0
                })));
                if (totalCount > 0) {
                    recordOperation('sell', totalCount);
                    // 手动出售成功后，从回包中提取金币增量，实时通知统计模块与事件总线
                    try {
                        let goldGain = 0;
                        if (result && Array.isArray(result.get_items)) {
                            for (const git of result.get_items) {
                                const gid = Number(git.id);
                                if (gid === 1001 || gid === 500001) goldGain += Number(git.count) || 0;
                            }
                        }
                        if (goldGain > 0) {
                            networkEvents.emit('sell', { gold: goldGain, count: totalCount });
                            updateStatusGold((getUserState()?.gold || 0) + goldGain);
                        }
                    } catch (_) {}
                }
                break;
            }
            case 'setAutomation': {
                const item = args && args[0] ? args[0] : {};
                const patch = { [item.key]: item.value };
                applyRuntimeConfig({ automation: patch }, true);
                result = getAutomation();
                break;
            }
            case 'doFarmOp':
                result = await runFarmOperation(args[0]);
                break;
            case 'buyFertilizer': {
                const fertType = args[0] || 'organic';
                const count = Number(args[1]) || 1;
                result = await autoBuyFertilizer(true, fertType, count);
                break;
            }
            case 'checkAndBuyFertilizer': {
                const opts = args[0] || {};
                result = await checkAndBuyFertilizerBoth(opts);
                break;
            }
            case 'getAnalytics': {
                const { getPlantRankings } = require('../services/analytics');
                result = getPlantRankings(args[0]);
                break;
            }
            case 'getShopInfo': {
                const { getShopInfo } = require('../services/farm');
                result = await getShopInfo(args[0]);
                break;
            }
            case 'buyGoods': {
                const { buyGoods } = require('../services/farm');
                result = await buyGoods(args[0], args[1], args[2]);
                break;
            }
            case 'getMallGoods': {
                const { getMallGoodsList } = require('../services/mall');
                result = await getMallGoodsList(0);
                break;
            }
            case 'buyMallGoods': {
                const { purchaseMallGoods } = require('../services/mall');
                result = await purchaseMallGoods(args[0], args[1]);
                break;
            }
            case 'getMysteryShop': {
                const { getActiveMysteryShop } = require('../services/mystery-shop');
                result = await getActiveMysteryShop();
                break;
            }
            case 'buyMysteryShopGoods': {
                const { getActiveMysteryShop, buyMysteryShopGoods } = require('../services/mystery-shop');
                const offer = await getActiveMysteryShop();
                if (!offer.active || Number(offer.npcId) !== Number(args[0])) {
                    throw new Error('神秘商人商品已失效，请刷新后重试');
                }
                result = await buyMysteryShopGoods(args[0], offer, 'manual');
                break;
            }
            case 'abandonMysteryShop': {
                const { abandonMysteryShop } = require('../services/mystery-shop');
                result = await abandonMysteryShop();
                break;
            }
            case 'getActivityShop': {
                const { getNanguaShop } = require('../services/activity');
                result = await getNanguaShop();
                break;
            }
            case 'getActivityDiscoveryList': {
                const { getActivityDiscoveryList } = require('../services/activity');
                result = await getActivityDiscoveryList();
                break;
            }
            case 'getActivityDiscoverySnapshot': {
                const { getActivityDiscoverySnapshot } = require('../services/activity');
                result = await getActivityDiscoverySnapshot();
                break;
            }
            case 'getActivityGroupSnapshot': {
                const { getActivityGroupSnapshot } = require('../services/activity');
                result = await getActivityGroupSnapshot(args[0], args[1]);
                break;
            }
            case 'buyActivityShopItem': {
                const { buyNanguaShopItem } = require('../services/activity');
                result = await buyNanguaShopItem(args[0], args[1]);
                break;
            }
            case 'refreshActivityShop': {
                const { refreshNanguaShop } = require('../services/activity');
                result = await refreshNanguaShop();
                break;
            }
            case 'getHeluActivity': {
                const { getHeluActivity } = require('../services/activity');
                result = await getHeluActivity();
                break;
            }
            case 'getStarActivity': {
                const { getStarActivity } = require('../services/activity');
                result = await getStarActivity();
                break;
            }
            case 'claimStarRecordRewards': {
                const { claimStarRecordRewards } = require('../services/activity');
                result = await claimStarRecordRewards();
                break;
            }
            case 'exchangeStarShopItem': {
                const { exchangeStarShopItem } = require('../services/activity');
                result = await exchangeStarShopItem(args[0], args[1]);
                break;
            }
            case 'getQixiActivity': {
                const { getQixiActivity } = require('../services/activity');
                result = await getQixiActivity();
                break;
            }
            case 'buildQixiBridge': {
                const { buildQixiBridge } = require('../services/activity');
                result = await buildQixiBridge();
                break;
            }
            case 'sendQixiSachet': {
                const { sendQixiSachet } = require('../services/activity');
                result = await sendQixiSachet(args[0], args[1]);
                break;
            }
            case 'useQixiDew': {
                const { useQixiDew } = require('../services/activity');
                result = await useQixiDew(args[0] || {});
                break;
            }
            case 'getRainPoemActivity': {
                const { getRainPoemActivity } = require('../services/activity');
                result = await getRainPoemActivity();
                break;
            }
            case 'buyRainPoemCollectionBottle': {
                const { buyRainPoemCollectionBottle } = require('../services/activity');
                result = await buyRainPoemCollectionBottle();
                break;
            }
            case 'collectRainPoemWeather': {
                const { collectRainPoemWeather } = require('../services/activity');
                result = await collectRainPoemWeather(args[0]);
                break;
            }
            case 'useRainPoemSummonBottle': {
                const { useRainPoemSummonBottle } = require('../services/activity');
                result = await useRainPoemSummonBottle();
                break;
            }
            case 'unlockRainPoemResearch': {
                const { unlockRainPoemResearch } = require('../services/activity');
                result = await unlockRainPoemResearch();
                break;
            }
            case 'getCharityFlowerActivity': {
                const { getCharityFlowerActivity } = require('../services/activity');
                result = await getCharityFlowerActivity();
                break;
            }
            case 'getSolarTermsInfo':
            case 'getMilkTea':
            case 'getWishSignActivity':
            case 'getShareRewardActivity': {
                const activity = require('../services/activity');
                result = await activity[method]();
                break;
            }
            case 'operateMilkTea':
            case 'milkTeaRecords':
            case 'operateWishSign':
            case 'operateShareReward': {
                const activity = require('../services/activity');
                result = await activity[method](...args);
                break;
            }
            case 'getPetDiaryActivity': {
                const { getPetDiaryActivity } = require('../services/activity');
                result = await getPetDiaryActivity();
                break;
            }
            case 'getPetDiary': {
                const { getPetDiary } = require('../services/activity');
                result = await getPetDiary();
                break;
            }
            case 'operatePetDiary': {
                const { operatePetDiary } = require('../services/activity');
                result = await operatePetDiary(args[0], args[1]);
                break;
            }
            case 'getPetDiaryRecords': {
                const { getPetDiaryRecords } = require('../services/activity');
                result = await getPetDiaryRecords(args[0]);
                break;
            }
            case 'getPetDiaryFriend': {
                const { getPetDiaryFriend } = require('../services/activity');
                result = await getPetDiaryFriend(args[0]);
                break;
            }
            case 'exchangeHeluShopItem': {
                const { exchangeHeluShopItem } = require('../services/activity');
                result = await exchangeHeluShopItem(args[0], args[1]);
                break;
            }
            case 'drawHeluGiftLotus': {
                const { drawHeluGiftLotus } = require('../services/activity');
                result = await drawHeluGiftLotus(args[0] || {});
                break;
            }
            case 'claimSeasonPassportRewards': {
                const { claimSeasonPassportRewards } = require('../services/activity');
                result = await claimSeasonPassportRewards();
                break;
            }
            case 'claimSolarTermsReward': {
                const { claimSolarTermsReward } = require('../services/activity');
                result = await claimSolarTermsReward(args[0]);
                break;
            }
            case 'claimQingmeiSeeds': {
                const { claimQingmeiSeeds } = require('../services/activity');
                result = await claimQingmeiSeeds();
                break;
            }
            case 'brewAndSellQingmeiWine': {
                const { brewAndSellQingmeiWine } = require('../services/activity');
                result = await brewAndSellQingmeiWine(args[0] || {});
                break;
            }
            case 'getIllustratedList': {
                const { getIllustratedListV2 } = require('../services/illustrated');
                result = await getIllustratedListV2(args[0], args[1]);
                break;
            }
            case 'claimIllustratedRewards': {
                const { claimAllRewardsV2 } = require('../services/illustrated');
                result = await claimAllRewardsV2(args[0]);
                break;
            }
            case 'getCareerInfo': {
                const { getCareerInfo } = require('../services/career');
                result = await getCareerInfo(args[0]);
                break;
            }
            case 'getDailyGiftOverview':
                result = await getDailyGiftOverview();
                latestDailyGifts = result;
                try {
                    const statsService = require('../services/stats');
                    if (statsService && typeof statsService.setLatestDailyGifts === 'function') {
                        statsService.setLatestDailyGifts(result);
                    }
                } catch {}
                break;
            case 'getSchedulers':
                result = { ...getSchedulerRegistrySnapshot(), resources: resourceMonitor.snapshot() };
                break;
            case 'fertilizeLand': {
                const landId = Number(args[0]) || 0;
                if (!landId) {
                    error = '无效的土地ID';
                } else {
                    log('施肥', `正在对土地 ${  landId  } 使用有机肥料催熟`, {
                        module: 'farm', event: '催熟', landId
                    });
                    const fertilizeCount = await fertilize([landId], ORGANIC_FERTILIZER_ID);
                    if (fertilizeCount > 0) {
                        log('施肥', `土地 ${  landId  } 催熟成功`, {
                            module: 'farm', event: '催熟', result: 'ok', landId
                        });
                        result = { success: true, count: fertilizeCount };
                    } else {
                        log('施肥', `土地 ${  landId  } 催熟失败，可能有机肥料不足`, {
                            module: 'farm', event: '催熟', result: 'error', landId
                        });
                        result = { success: false, count: 0 };
                    }
                }
                break;
            }
            case 'removePlant': {
                const landId = Number(args[0]) || 0;
                if (!landId) {
                    error = '无效的土地ID';
                } else {
                    result = await removePlant([landId]);
                }
                break;
            }
            case 'removeAllPlants': {
                const landsDetail = await getLandsDetail();
                const lands = landsDetail?.lands || [];
                const occupiedLands = lands
                    .filter(l => l && l.unlocked && l.status !== 'empty' && l.status !== 'locked')
                    .map(l => l.id);

                if (occupiedLands.length === 0) {
                    result = { removed: 0, message: '没有可铲除的作物' };
                } else {
                    await removePlant(occupiedLands);
                    log('铲除', `已铲除 ${  occupiedLands.length  } 块土地上的作物`, {
                        module: 'farm', event: '一键铲除', result: 'ok', count: occupiedLands.length
                    });
                    result = { removed: occupiedLands.length };
                }
                break;
            }
            default:
                error = 'Unknown method';
        }
    } catch (err) {
        error = err.message;
    }

    if (isFriendSync) {
        friendSyncPaused = false;
        log('系统', '好友同步操作完成，已恢复自动化进程', {
            module: 'system', event: '好友同步恢复', method
        });
    }

    sendToMaster({
        type: 'api_response',
        id,
        result,
        error
    });
}

// ==================== 每日礼包总览 ====================

async function getDailyGiftOverview() {
    const auto = getAutomation() || {};

    const taskState = getTaskDailyStateLikeApp
        ? await getTaskDailyStateLikeApp()
        : getTaskClaimDailyState ? getTaskClaimDailyState() : { doneToday: false, lastClaimAt: 0 };

    const growthState = getGrowthTaskStateLikeApp
        ? await getGrowthTaskStateLikeApp()
        : { doneToday: false, completedCount: 0, totalCount: 0, tasks: [] };

    const emailState = getEmailDailyState
        ? getEmailDailyState()
        : { doneToday: false, lastCheckAt: 0 };

    const freeGiftState = getFreeGiftDailyState
        ? getFreeGiftDailyState()
        : { doneToday: false, lastClaimAt: 0 };

    const shareState = getShareDailyState
        ? getShareDailyState()
        : { doneToday: false, lastClaimAt: 0 };

    const vipState = getVipDailyState
        ? getVipDailyState()
        : { doneToday: false, lastClaimAt: 0 };

    const monthCardState = getMonthCardDailyState
        ? getMonthCardDailyState()
        : { doneToday: false, lastClaimAt: 0 };

    return {
        date: new Date().toISOString().slice(0, 10),
        growth: {
            key: 'growth_task',
            label: '成长任务',
            doneToday: !!growthState.doneToday,
            completedCount: Number(growthState.completedCount || 0),
            totalCount: Number(growthState.totalCount || 0),
            tasks: Array.isArray(growthState.tasks) ? growthState.tasks : []
        },
        gifts: [
            {
                key: 'task_claim',
                label: '每日任务',
                enabled: !!auto.task,
                doneToday: !!taskState.doneToday,
                lastAt: Number(taskState.lastClaimAt || 0),
                completedCount: Number(taskState.completedCount || 0),
                totalCount: Number(taskState.totalCount || 0)
            },
            {
                key: 'email_rewards',
                label: '邮箱奖励',
                enabled: true,
                doneToday: !!emailState.doneToday,
                lastAt: Number(emailState.lastCheckAt || 0)
            },
            {
                key: 'mall_free_gifts',
                label: '商城免费礼包',
                enabled: true,
                doneToday: !!freeGiftState.doneToday,
                lastAt: Number(freeGiftState.lastClaimAt || 0)
            },
            {
                key: 'daily_share',
                label: '分享礼包',
                enabled: true,
                doneToday: !!shareState.doneToday,
                lastAt: Number(shareState.lastClaimAt || 0)
            },
            {
                key: 'vip_daily_gift',
                label: '会员礼包',
                enabled: true,
                doneToday: !!vipState.doneToday,
                lastAt: Number(vipState.lastClaimAt || vipState.lastCheckAt || 0),
                hasGift: Object.hasOwn(vipState, 'hasGift') ? !!vipState.hasGift : undefined,
                canClaim: Object.hasOwn(vipState, 'canClaim') ? !!vipState.canClaim : undefined,
                result: vipState.result || ''
            },
            {
                key: 'month_card_gift',
                label: '月卡礼包',
                enabled: true,
                doneToday: !!monthCardState.doneToday,
                lastAt: Number(monthCardState.lastClaimAt || monthCardState.lastCheckAt || 0),
                hasCard: Object.hasOwn(monthCardState, 'hasCard') ? !!monthCardState.hasCard : undefined,
                hasClaimable: Object.hasOwn(monthCardState, 'hasClaimable') ? !!monthCardState.hasClaimable : undefined,
                result: monthCardState.result || ''
            }
        ]
    };
}

// ==================== 状态同步 ====================

function syncStatus() {
    if (!process.send && !parentPort) return;

    const userState = getUserState();
    const ws = getWs();
    const connected = !!(loginReady && ws && ws.readyState === 1);

    let levelProgress = null;
    const level = userState.level ?? statusData.level ?? 0;
    const exp = userState.exp ?? statusData.exp ?? 0;
    if (level > 0 && exp >= 0) {
        levelProgress = getLevelExpProgress(level, exp);
    }

    const limits = require('../services/friend').getOperationLimits();
    const stats = require('../services/stats').getStats(statusData, userState, connected, limits);

    const now = Date.now();
    const farmRemainSec = Math.max(0, Math.ceil((Number(nextFarmRunAt || 0) - now) / 1000));
    const helpRemainSec = Math.max(0, Math.ceil((Number(nextHelpRunAt || 0) - now) / 1000));
    const stealRemainSec = Math.max(0, Math.ceil((Number(nextStealRunAt || 0) - now) / 1000));

    stats.nextChecks = {
        farmRemainSec,
        helpRemainSec,
        stealRemainSec,
        friendRemainSec: Math.max(helpRemainSec, stealRemainSec)
    };
    stats.automation = getAutomation();
    stats.levelProgress = levelProgress;
    stats.configRevision = appliedConfigRevision;
    if (latestDailyGifts) {
        stats.dailyGifts = latestDailyGifts;
    }

    const stableStats = { ...stats };
    delete stableStats.nextChecks;
    const hash = JSON.stringify(stableStats);
    const now2 = Date.now();

    if (hash !== lastStatusHash || now2 - lastStatusSentAt > resourcePolicy.statusFullSyncIntervalMs) {
        lastStatusHash = hash;
        lastStatusSentAt = now2;
        sendToMaster({ type: 'status_sync', data: stats });
    }
}
