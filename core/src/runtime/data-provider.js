const {
    findAccountByRef,
    normalizeAccountRef,
    resolveAccountId: resolveAccountIdByList
} = require('../services/account-resolver');
const { getSchedulerRegistrySnapshot } = require('../services/scheduler');

/**
 * 创建数据提供器 —— 封装对 Worker 的 API 调用，供 Admin Server 使用
 */
function createDataProvider(deps) {
    const {
        workers,
        globalLogs,
        accountLogs,
        store,
        getAccounts,
        callWorkerApi,
        buildDefaultStatus,
        normalizeStatusForPanel,
        filterLogs,
        nextConfigRevision,
        broadcastConfigToWorkers,
        startWorker,
        stopWorker,
        restartWorker,
        getResourceStatus,
        scheduleAutoCodeRefresh,
        refreshAccountCode
    } = deps;

    /** 获取账号列表 */
    function getAllAccountList() {
        const data = getAccounts();
        return Array.isArray(data.accounts) ? data.accounts : [];
    }

    /** 解析账号引用（account-ref / accountId） */
    function resolveAccountId(ref) {
        const normalized = normalizeAccountRef(ref);
        if (!normalized) return '';
        const id = resolveAccountIdByList(getAllAccountList(), normalized);
        return id || normalized;
    }

    /** 根据引用查找账号 */
    function findAccount(ref) {
        return findAccountByRef(getAllAccountList(), ref);
    }

    // 超时配置
    const FRIEND_TIMEOUT = { _timeoutMs: 180000 };       // 3分钟
    const SYNC_TIMEOUT = { _timeoutMs: 180000 };          // 3分钟
    const DOG_INFO_TIMEOUT = { _timeoutMs: 600000 };     // 10分钟

    // 浏览器整页刷新后，旧 HTTP 请求仍会在服务端继续执行。按账号合并并发的
    // 背包只读请求，避免刷新风暴把同一个 Bag RPC 重复塞进游戏连接队列。
    const pendingReadRequests = new Map();

    function callWorkerReadOnce(key, accountId, method, ...args) {
        const pending = pendingReadRequests.get(key);
        if (pending) return pending;

        const request = Promise.resolve()
            .then(() => callWorkerApi(accountId, method, ...args))
            .finally(() => {
                if (pendingReadRequests.get(key) === request) pendingReadRequests.delete(key);
            });
        pendingReadRequests.set(key, request);
        return request;
    }

    function getBag(ref) {
        const accountId = resolveAccountId(ref);
        return callWorkerReadOnce(`bag:${String(accountId || '')}`, accountId, 'getBag');
    }

    function getIllustratedList(ref, type, level) {
        const accountId = resolveAccountId(ref);
        const key = `illustrated:${String(accountId || '')}:${String(type)}:${String(level)}`;
        return callWorkerReadOnce(key, accountId, 'getIllustratedList', type, level);
    }

    return {
        /** 获取账号运行状态 */
        getStatus: (ref) => {
            const id = resolveAccountId(ref);
            if (!id) return buildDefaultStatus('');

            const worker = workers[id];
            if (!worker || !worker.status) return buildDefaultStatus(id);

            return {
                ...buildDefaultStatus(id),
                ...normalizeStatusForPanel(worker.status, id, worker.name),
                wsError: worker.wsError || null
            };
        },

        /** 获取日志 */
        getLogs: (ref, opts) => {
            const options = typeof opts === 'object' && opts ? opts : { limit: opts };
            const limit = Math.max(100, Number(options.limit) || 200);

            const normalized = normalizeAccountRef(ref);
            const id = resolveAccountId(ref);

            if (!normalized || normalized === 'all') {
                return filterLogs(globalLogs, options).slice(-limit);
            }

            if (!id) return [];

            const accountIdStr = String(id || '');
            return filterLogs(
                globalLogs.filter(e => String(e.accountId || '') === accountIdStr),
                options
            ).slice(-limit);
        },

        /** 获取账号操作日志 */
        getAccountLogs: (limit) => accountLogs.slice(-limit).reverse(),

        /** 清空日志 */
        clearLogs: (ref) => {
            const normalized = normalizeAccountRef(ref);
            const id = resolveAccountId(ref);

            if (!normalized || normalized === 'all') {
                const clearedRuntimeLogs = globalLogs.length;
                const clearedAccountLogs = accountLogs.length;
                globalLogs.length = 0;
                accountLogs.length = 0;
                return {
                    cleared: 'all',
                    clearedRuntimeLogs,
                    clearedAccountLogs
                };
            }

            const result = {
                cleared: 0,
                clearedRuntimeLogs: 0,
                clearedAccountLogs: 0
            };
            if (!id) return result;

            const idStr = String(id || '');
            const runtimeLogsBefore = globalLogs.length;
            for (let i = globalLogs.length - 1; i >= 0; i--) {
                if (String(globalLogs[i].accountId || '') === idStr) {
                    globalLogs.splice(i, 1);
                }
            }
            const accountLogsBefore = accountLogs.length;
            for (let i = accountLogs.length - 1; i >= 0; i--) {
                if (String(accountLogs[i].accountId || accountLogs[i].id || '') === idStr) {
                    accountLogs.splice(i, 1);
                }
            }

            result.clearedRuntimeLogs = runtimeLogsBefore - globalLogs.length;
            result.clearedAccountLogs = accountLogsBefore - accountLogs.length;
            result.cleared = result.clearedRuntimeLogs + result.clearedAccountLogs;
            return { ...result, accountId: id };
        },

        // ========== Farm API ==========
        getLands: (ref) => callWorkerApi(resolveAccountId(ref), 'getLands'),
        getDiamondBalance: (ref) => callWorkerApi(resolveAccountId(ref), 'getDiamondBalance'),
        getSeeds: (ref) => callWorkerApi(resolveAccountId(ref), 'getSeeds'),
        getBag,
        getBagSeeds: (ref) => callWorkerApi(resolveAccountId(ref), 'getBagSeeds'),
        getDogSkillGiftStatus: (ref) => callWorkerApi(resolveAccountId(ref), 'getDogSkillGiftStatus'),
        claimDogSkillGifts: (ref) => callWorkerApi(resolveAccountId(ref), 'claimDogSkillGifts'),
        getPetOverview: (ref) => callWorkerApi(resolveAccountId(ref), 'getPetOverview'),
        activateDog: (ref, dogId) => callWorkerApi(resolveAccountId(ref), 'activateDog', dogId),
        deployDog: (ref, dogId) => callWorkerApi(resolveAccountId(ref), 'deployDog', dogId),
        withdrawDog: (ref) => callWorkerApi(resolveAccountId(ref), 'withdrawDog'),
        feedDog: (ref, foodId, count) => callWorkerApi(resolveAccountId(ref), 'feedDog', foodId, count),
        getProtectLogs: (ref) => callWorkerApi(resolveAccountId(ref), 'getProtectLogs'),
        doFarmOp: (ref, op) => callWorkerApi(resolveAccountId(ref), 'doFarmOp', op),
        buyFertilizer: (ref, type, count) => callWorkerApi(resolveAccountId(ref), 'buyFertilizer', type, count),
        checkAndBuyFertilizer: (ref, opts) => callWorkerApi(resolveAccountId(ref), 'checkAndBuyFertilizer', opts),
        fertilizeLand: (ref, landId) => callWorkerApi(resolveAccountId(ref), 'fertilizeLand', landId),
        removePlant: (ref, landId) => callWorkerApi(resolveAccountId(ref), 'removePlant', landId),
        removeAllPlants: (ref) => callWorkerApi(resolveAccountId(ref), 'removeAllPlants'),
        getShopInfo: (ref, shopId) => callWorkerApi(resolveAccountId(ref), 'getShopInfo', shopId),
        buyGoods: (ref, shopId, goodsId, count) => callWorkerApi(resolveAccountId(ref), 'buyGoods', shopId, goodsId, count),
        doAnalytics: (ref, days) => callWorkerApi(resolveAccountId(ref), 'getAnalytics', days),

        // ========== Friend API ==========
        getFriends: (ref, force = false) => callWorkerApi(resolveAccountId(ref), 'getFriends', force,
            force ? FRIEND_TIMEOUT : undefined),
        clearFriendsCache: (ref) => callWorkerApi(resolveAccountId(ref), 'clearFriendsCache'),
        getInteractRecords: (ref) => callWorkerApi(resolveAccountId(ref), 'getInteractRecords'),
        getFriendLands: (ref, gid) => callWorkerApi(resolveAccountId(ref), 'getFriendLands', gid),
        doFriendOp: (ref, gid, op) => callWorkerApi(resolveAccountId(ref), 'doFriendOp', gid, op),
        getFriendDogInfo: (ref, gid) => callWorkerApi(resolveAccountId(ref), 'getFriendDogInfo', gid),
        batchGetFriendDogInfo: (ref, gids) => callWorkerApi(resolveAccountId(ref), 'batchGetFriendDogInfo', gids),
        syncFriendsFromGids: (ref, gids) => callWorkerApi(resolveAccountId(ref), 'syncFriendsFromGids', gids, SYNC_TIMEOUT),
        fetchFriendsDogInfo: (ref) => callWorkerApi(resolveAccountId(ref), 'fetchFriendsDogInfo', DOG_INFO_TIMEOUT),
        delFriend: (ref, gid) => callWorkerApi(resolveAccountId(ref), 'delFriend', gid),

        // ========== 仓库 ==========
        useItem: (ref, itemId, count, uid) => callWorkerApi(resolveAccountId(ref), 'useItem', itemId, count, uid),
        sellItems: (ref, items) => callWorkerApi(resolveAccountId(ref), 'sellItems', items),

        // ========== 每日礼包 ==========
        getDailyGifts: async (ref) => {
            const id = resolveAccountId(ref);
            const gifts = await callWorkerApi(id, 'getDailyGiftOverview');
            if (gifts && workers[id]) {
                if (!workers[id].status) workers[id].status = {};
                workers[id].status.dailyGifts = gifts;
            }
            return gifts;
        },

        // ========== Mall ==========
        getMallGoods: (ref) => callWorkerApi(resolveAccountId(ref), 'getMallGoods'),
        buyMallGoods: (ref, goodsId, count) => callWorkerApi(resolveAccountId(ref), 'buyMallGoods', goodsId, count),
        getMysteryShop: (ref) => callWorkerApi(resolveAccountId(ref), 'getMysteryShop'),
        buyMysteryShopGoods: (ref, npcId) => callWorkerApi(resolveAccountId(ref), 'buyMysteryShopGoods', npcId),
        abandonMysteryShop: (ref) => callWorkerApi(resolveAccountId(ref), 'abandonMysteryShop'),

        // ========== Activity ==========
        getActivityShop: (ref) => callWorkerApi(resolveAccountId(ref), 'getActivityShop'),
        getActivityDiscoveryList: (ref) => callWorkerApi(resolveAccountId(ref), 'getActivityDiscoveryList'),
        getActivityDiscoverySnapshot: (ref) => callWorkerApi(resolveAccountId(ref), 'getActivityDiscoverySnapshot'),
        getActivityGroupSnapshot: (ref, activityId, uid = '') => callWorkerApi(resolveAccountId(ref), 'getActivityGroupSnapshot', activityId, uid),
        buyActivityShopItem: (ref, itemId, count) => callWorkerApi(resolveAccountId(ref), 'buyActivityShopItem', itemId, count),
        refreshActivityShop: (ref) => callWorkerApi(resolveAccountId(ref), 'refreshActivityShop'),
        getHeluActivity: (ref) => callWorkerApi(resolveAccountId(ref), 'getHeluActivity'),
        getStarActivity: (ref) => callWorkerApi(resolveAccountId(ref), 'getStarActivity'),
        claimStarRecordRewards: (ref) => callWorkerApi(resolveAccountId(ref), 'claimStarRecordRewards'),
        exchangeStarShopItem: (ref, slotId, count) => callWorkerApi(resolveAccountId(ref), 'exchangeStarShopItem', slotId, count),
        getQixiActivity: (ref) => callWorkerApi(resolveAccountId(ref), 'getQixiActivity'),
        buildQixiBridge: (ref) => callWorkerApi(resolveAccountId(ref), 'buildQixiBridge'),
        sendQixiSachet: (ref, friendGid, count) => callWorkerApi(resolveAccountId(ref), 'sendQixiSachet', friendGid, count),
        useQixiDew: (ref, options) => callWorkerApi(resolveAccountId(ref), 'useQixiDew', options),
        getRainPoemActivity: (ref) => callWorkerApi(resolveAccountId(ref), 'getRainPoemActivity'),
        buyRainPoemCollectionBottle: (ref) => callWorkerApi(resolveAccountId(ref), 'buyRainPoemCollectionBottle'),
        collectRainPoemWeather: (ref) => callWorkerApi(resolveAccountId(ref), 'collectRainPoemWeather'),
        useRainPoemSummonBottle: (ref) => callWorkerApi(resolveAccountId(ref), 'useRainPoemSummonBottle'),
        unlockRainPoemResearch: (ref) => callWorkerApi(resolveAccountId(ref), 'unlockRainPoemResearch'),
        getCharityFlowerActivity: (ref) => callWorkerApi(resolveAccountId(ref), 'getCharityFlowerActivity'),
        getWishSignActivity: (ref) => callWorkerApi(resolveAccountId(ref), 'getWishSignActivity'),
        operateWishSign: (ref, action, chooseId) => callWorkerApi(resolveAccountId(ref), 'operateWishSign', action, chooseId),
        getShareRewardActivity: (ref) => callWorkerApi(resolveAccountId(ref), 'getShareRewardActivity'),
        operateShareReward: (ref, action) => callWorkerApi(resolveAccountId(ref), 'operateShareReward', action),
        getMilkTea: ref => callWorkerApi(resolveAccountId(ref), 'getMilkTea'),
        operateMilkTea: (ref, action, params) => callWorkerApi(resolveAccountId(ref), 'operateMilkTea', action, params || {}),
        milkTeaRecords: (ref, kind, params) => callWorkerApi(resolveAccountId(ref), 'milkTeaRecords', kind, params || {}),
        getPetDiaryActivity: (ref) => callWorkerApi(resolveAccountId(ref), 'getPetDiaryActivity'),
        getPetDiary: (ref) => callWorkerApi(resolveAccountId(ref), 'getPetDiary'),
        operatePetDiary: (ref, action, params) => callWorkerApi(resolveAccountId(ref), 'operatePetDiary', action, params || {}),
        getPetDiaryRecords: (ref, kind) => callWorkerApi(resolveAccountId(ref), 'getPetDiaryRecords', kind),
        getPetDiaryFriend: (ref, gid) => callWorkerApi(resolveAccountId(ref), 'getPetDiaryFriend', gid),
        exchangeHeluShopItem: (ref, slotId, count) => callWorkerApi(resolveAccountId(ref), 'exchangeHeluShopItem', slotId, count),
        drawHeluGiftLotus: (ref, options) => callWorkerApi(resolveAccountId(ref), 'drawHeluGiftLotus', options || {}),
        claimSeasonPassportRewards: (ref) => callWorkerApi(resolveAccountId(ref), 'claimSeasonPassportRewards'),
        getSolarTermsInfo: (ref) => callWorkerApi(resolveAccountId(ref), 'getSolarTermsInfo'),
        claimSolarTermsReward: (ref, termId) => callWorkerApi(resolveAccountId(ref), 'claimSolarTermsReward', termId),
        claimQingmeiSeeds: (ref) => callWorkerApi(resolveAccountId(ref), 'claimQingmeiSeeds'),
        brewAndSellQingmeiWine: (ref, options) => callWorkerApi(resolveAccountId(ref), 'brewAndSellQingmeiWine', options || {}),

        // ========== Illustrated ==========
        getIllustratedList,
        claimIllustratedRewards: (ref, type) => callWorkerApi(resolveAccountId(ref), 'claimIllustratedRewards', type),

        // ========== Career ==========
        getCareerInfo: (ref, gid) => callWorkerApi(resolveAccountId(ref), 'getCareerInfo', gid),

        // ========== 配置 ==========
        setAutomation: async (ref, key, value) => {
            const id = resolveAccountId(ref);
            if (!id) throw new Error('Missing x-account-id');
            store.setAutomation(key, value, id);
            const rev = nextConfigRevision();
            broadcastConfigToWorkers(id);
            return { automation: store.getAutomation(id), configRevision: rev };
        },

        saveSettings: async (ref, settings) => {
            const id = resolveAccountId(ref);
            if (!id) throw new Error('Missing x-account-id');
            const s = settings && typeof settings === 'object' ? settings : {};
            const patch = {
                plantingStrategy: s.plantingStrategy !== undefined ? s.plantingStrategy : s.strategy,
                prioritize2x2Crops: s.prioritize2x2Crops,
                prioritizeGrowthTasks: s.prioritizeGrowthTasks,
                intervals: s.intervals,
                friendQuietHours: s.friendQuietHours,
                autoCodeRefresh: s.autoCodeRefresh,
                fertilizerBuyOrganicCount: s.fertilizerBuyOrganicCount,
                fertilizerBuyOrganicThresholdHours: s.fertilizerBuyOrganicThresholdHours,
                fertilizerBuyNormalCount: s.fertilizerBuyNormalCount,
                fertilizerBuyNormalThresholdHours: s.fertilizerBuyNormalThresholdHours,
                fertilizerBuyCheckIntervalMinutes: s.fertilizerBuyCheckIntervalMinutes,
                goldenBugKeepCount: s.goldenBugKeepCount,
                goldenBugRoundLimit: s.goldenBugRoundLimit,
                autoAcceptFriendMinLevel: s.autoAcceptFriendMinLevel,
                bagSeedPriority: s.bagSeedPriority,
                bagSeedKnownIds: s.bagSeedKnownIds,
                bagSeedFallbackStrategy: s.bagSeedFallbackStrategy,
            };
            store.applyConfigSnapshot(patch, { accountId: id });
            const rev = nextConfigRevision();
            broadcastConfigToWorkers(id);
            if (s.autoCodeRefresh && typeof scheduleAutoCodeRefresh === 'function') {
                scheduleAutoCodeRefresh(id);
            }
            return {
                strategy: store.getPlantingStrategy(id),
                prioritize2x2Crops: store.getPrioritize2x2Crops(id),
                prioritizeGrowthTasks: store.getPrioritizeGrowthTasks(id),
                intervals: store.getIntervals(id),
                friendQuietHours: store.getFriendQuietHours(id),
                autoCodeRefresh: store.getAutoCodeRefresh(id),
                fertilizerBuyOrganicCount: store.getFertilizerBuyOrganicCount(id),
                fertilizerBuyOrganicThresholdHours: store.getFertilizerBuyOrganicThresholdHours(id),
                fertilizerBuyNormalCount: store.getFertilizerBuyNormalCount(id),
                fertilizerBuyNormalThresholdHours: store.getFertilizerBuyNormalThresholdHours(id),
                fertilizerBuyCheckIntervalMinutes: store.getFertilizerBuyCheckIntervalMinutes(id),
                goldenBugKeepCount: store.getConfigSnapshot(id).goldenBugKeepCount,
                goldenBugRoundLimit: store.getConfigSnapshot(id).goldenBugRoundLimit,
                autoAcceptFriendMinLevel: store.getAutoAcceptFriendMinLevel(id),
                bagSeedPriority: store.getBagSeedPriority(id),
                bagSeedFallbackStrategy: store.getBagSeedFallbackStrategy(id),
                configRevision: rev
            };
        },

        syncAccountConfig: (ref) => {
            const id = resolveAccountId(ref);
            if (!id) return false;
            nextConfigRevision();
            broadcastConfigToWorkers(id);
            return true;
        },

        saveAutoCodeRefresh: async (ref, config) => {
            const id = resolveAccountId(ref);
            if (!id) throw new Error('Missing x-account-id');
            const data = store.setAutoCodeRefresh(id, config || {});
            if (typeof scheduleAutoCodeRefresh === 'function') scheduleAutoCodeRefresh(id);
            return { autoCodeRefresh: data };
        },

        refreshAccountCode: async (ref) => {
            const id = resolveAccountId(ref);
            if (!id) throw new Error('Missing x-account-id');
            if (typeof refreshAccountCode !== 'function') throw new Error('自动刷新服务不可用');
            const ok = await refreshAccountCode(id, 'manual');
            return { ok };
        },

        setUITheme: async (theme) => {
            const result = store.setUITheme(theme);
            return { ui: result.ui || store.getUI() };
        },

        broadcastConfig: (accountId) => {
            broadcastConfigToWorkers(accountId);
        },

        setRuntimeAccountName: (ref, name) => {
            const id = resolveAccountId(ref);
            if (!id) return;
            const worker = workers[id];
            if (worker) {
                worker.name = String(name || worker.name || id);
            }
        },

        // ========== 账号管理 ==========
        getAccounts: () => {
            const data = getAccounts();
            data.accounts.forEach(acc => {
                const worker = workers[acc.id];
                acc.running = !!worker;
                acc.hasWxCredential = !!acc.loginBuffer;
                delete acc.loginBuffer;
                delete acc.refreshtoken;
                delete acc.accesstoken;

                let liveLevel = null;
                let liveNick = null;
                let liveTasks = null;

                if (worker && worker.status) {
                    if (worker.status.status) {
                        liveLevel = worker.status.status.level;
                        liveNick = worker.status.status.name || worker.status.status.nick;
                    }
                    if (worker.status.dailyGifts && worker.status.dailyGifts.gifts) {
                        liveTasks = worker.status.dailyGifts.gifts;
                    }
                }
                // 如果实时数据未获取到，从该账号自身的持久化 stats 中读取真实的等级与任务，绝不向其他账号借用数据！
                if (!liveLevel || !liveTasks) {
                    try {
                        const persisted = require('../services/stats').loadPersistedStats(account.id);
                        if (persisted) {
                            if (!liveLevel && persisted.profile && persisted.profile.level) {
                                liveLevel = persisted.profile.level;
                            }
                            if (!liveNick && persisted.profile && persisted.profile.name) {
                                liveNick = persisted.profile.name;
                            }
                            if (!liveTasks && persisted.dailyGifts && persisted.dailyGifts.gifts) {
                                liveTasks = persisted.dailyGifts.gifts;
                            }
                        }
                    } catch (_) {}
                }

                // 尝试从持久化 stats 补全真实等级与任务（离线时也能正常显示等级和任务）
                if (liveLevel === null || liveLevel === undefined || !liveTasks) {
                    try {
                        const path = require('node:path');
                        const fs = require('node:fs');
                        const baseDir = process.env.FARM_DATA_DIR || path.join(__dirname, '../../data');
                        const statsFile = path.join(baseDir, 'stats', `${acc.id}.json`);
                        if (fs.existsSync(statsFile)) {
                            const stat = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
                            if (stat && stat.profile && stat.profile.level && (liveLevel === null || liveLevel === undefined)) {
                                liveLevel = stat.profile.level;
                            }
                            if (stat && stat.profile && stat.profile.name && !acc.nick && !liveNick) {
                                liveNick = stat.profile.name;
                            }
                            if (!liveTasks && stat && stat.dailyGifts && stat.dailyGifts.gifts) {
                                liveTasks = stat.dailyGifts.gifts;
                            }
                        }
                    } catch {}
                }

                if (liveNick) acc.nick = liveNick;
                if (liveLevel !== null && liveLevel !== undefined) acc.level = Number(liveLevel);
                if (liveTasks) acc.tasks = liveTasks;
            });
            return data;
        },

        startAccount: async (ref) => {
            const id = resolveAccountId(ref);
            const account = findAccount(id || ref);
            if (!account) return false;
            if (typeof scheduleAutoCodeRefresh === 'function') scheduleAutoCodeRefresh(account.id);
            if (account.platform === 'wx' && account.loginBuffer && typeof refreshAccountCode === 'function') {
                const refreshed = await refreshAccountCode(account.id, 'manual_start');
                if (refreshed) return true;
            }
            startWorker(account);
            return true;
        },

        stopAccount: (ref) => {
            const id = resolveAccountId(ref);
            const account = findAccount(id || ref);
            if (!account) return false;
            if (id) stopWorker(id);
            return true;
        },

        restartAccount: (ref) => {
            const id = resolveAccountId(ref);
            const account = findAccount(id || ref);
            if (!account) return false;
            restartWorker(account);
            return true;
        },

        isAccountRunning: (ref) => {
            const id = resolveAccountId(ref);
            return !!(id && workers[id]);
        },

        getRunningAccountCount: () => Object.keys(workers).length,

        // ========== 调度器状态 ==========
        getSchedulerStatus: async (ref) => {
            const id = resolveAccountId(ref);
            const runtimeSchedulers = getSchedulerRegistrySnapshot();
            let workerSchedulers = null;
            let workerError = '';

            if (!id) {
                return { accountId: '', runtime: runtimeSchedulers, resources: getResourceStatus?.() || null, worker: workerSchedulers, workerError: '' };
            }

            if (!workers[id]) {
                return { accountId: id, runtime: runtimeSchedulers, resources: getResourceStatus?.() || null, worker: workerSchedulers, workerError: '账号未运行' };
            }

            try {
                workerSchedulers = await callWorkerApi(id, 'getSchedulers');
            } catch (err) {
                workerError = err && err.message ? err.message : String(err || 'unknown');
            }

            return { accountId: id, runtime: runtimeSchedulers, resources: getResourceStatus?.() || null, worker: workerSchedulers, workerError };
        }
    };
}

module.exports = { createDataProvider };
