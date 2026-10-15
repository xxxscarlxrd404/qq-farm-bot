const EventEmitter = require('node:events');
const { createModuleLogger } = require('../services/logger');
const { getTodayKey, loadPersistedStats } = require('../services/stats');

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

// ==================== 运行时状态工厂 ====================

function createRuntimeState(deps) {
    const {
        store,
        operationKeys = []
    } = deps;

    const workers = {};
    const globalLogs = [];
    const accountLogs = [];
    const runtimeEvents = new EventEmitter();
    let nextLogSequence = 0;

    function createLogId(prefix, timestamp) {
        nextLogSequence = (nextLogSequence + 1) % Number.MAX_SAFE_INTEGER;
        return `${prefix}-${timestamp}-${nextLogSequence}`;
    }

    let configRevision = Date.now();
    const moduleLogger = createModuleLogger('runtime');

    /** 递增配置版本号 */
    function nextConfigRevision() {
        configRevision += 1;
        return configRevision;
    }

    /** 为指定账号构建配置快照 */
    function buildConfigSnapshotForAccount(accountId) {
        return {
            automation: store.getAutomation(accountId),
            plantingStrategy: store.getPlantingStrategy(accountId),
            prioritize2x2Crops: store.getPrioritize2x2Crops(accountId),
            prioritizeGrowthTasks: store.getPrioritizeGrowthTasks(accountId),
            intervals: store.getIntervals(accountId),
            friendQuietHours: store.getFriendQuietHours(accountId),
            friendBlacklist: store.getFriendBlacklist(accountId),
            plantBlacklist: store.getPlantBlacklist(accountId),
            knownFriendGids: store.getKnownFriendGids(accountId),
            bagSeedPriority: store.getBagSeedPriority(accountId),
            bagSeedKnownIds: store.getConfigSnapshot(accountId).bagSeedKnownIds,
            bagSeedFallbackStrategy: store.getBagSeedFallbackStrategy(accountId),
            autoAcceptFriendMinLevel: store.getAutoAcceptFriendMinLevel(accountId),
            capitalMode: store.getCapitalMode(accountId),
            __revision: configRevision
        };
    }

    /** 记录全局日志 */
    function log(tag, msg, meta = {}) {
        const now = new Date();
        const time = formatLocalDateTime24(now);
        const timestamp = now.getTime();
        const level = tag === '错误' ? 'error' : tag === '警告' ? 'warn' : 'info';
        moduleLogger[level](msg, { tag, ...meta });

        const module = tag === '系统' || tag === '错误' ? 'system' : '';
        const accountId = meta && meta.accountId ? String(meta.accountId) : '';
        const accountName = meta && meta.accountName ? String(meta.accountName) : '';
        const entry = {
            logId: createLogId('runtime', timestamp),
            time,
            tag,
            msg,
            level,
            source: module === 'system' ? 'system' : 'business',
            meta: {
                ...(module ? { module } : {}),
                ...meta
            },
            ts: timestamp,
            ...meta,
            ...(accountId ? { accountId } : {}),
            ...(accountName ? { accountName } : {})
        };
        entry._searchText = (`${entry.msg || ''  } ${  entry.tag || ''  } ${  JSON.stringify(entry.meta || {})}`).toLowerCase();

        globalLogs.push(entry);
        if (globalLogs.length > 2000) globalLogs.shift();
        runtimeEvents.emit('log', entry);
    }

    /** 记录账号操作日志 */
    function addAccountLog(action, msg, accountId = '', accountName = '', meta = {}) {
        const now = new Date();
        const timestamp = now.getTime();
        const normalizedAction = String(action || '');
        const level = /(?:error|failed|failure|blocked|kickout|offline_delete|watchdog_stopped|ws_400)/i.test(normalizedAction)
            ? 'error'
            : /(?:warn|offline|reconnect)/i.test(normalizedAction) ? 'warn' : 'info';
        const entry = {
            logId: createLogId('account', timestamp),
            ts: timestamp,
            time: formatLocalDateTime24(now),
            action,
            msg,
            level,
            source: 'account',
            accountId: accountId ? String(accountId) : '',
            accountName: accountName || '',
            ...meta
        };
        accountLogs.push(entry);
        if (accountLogs.length > 2000) accountLogs.shift();
        runtimeEvents.emit('account_log', entry);
    }

    /** 标准化状态数据供面板使用 */
    function normalizeStatusForPanel(rawStatus, accountId, accountName) {
        const status = rawStatus && typeof rawStatus === 'object' ? rawStatus : {};
        const operations = status.operations && typeof status.operations === 'object'
            ? { ...status.operations }
            : {};

        for (const key of operationKeys) {
            if (operations[key] === undefined || operations[key] === null || Number.isNaN(Number(operations[key]))) {
                operations[key] = 0;
            } else {
                operations[key] = Number(operations[key]);
            }
        }

        const result = { ...status };
        result.accountId = accountId;
        result.accountName = accountName;
        result.operations = operations;
        return result;
    }

    /** 构建默认空状态 */
    function buildEmptyOperations() {
        const ops = {};
        for (const key of operationKeys) ops[key] = 0;
        return ops;
    }

    /** 构建默认状态 */
    function buildDefaultStatus(accountId) {
        const aid = String(accountId || '');
        const ops = buildEmptyOperations();
        let totalSteal = 0;
        const todayKey = getTodayKey();

        if (aid) {
            const persisted = loadPersistedStats(aid);
            if (persisted) {
                if (persisted.date === todayKey && persisted.operations) {
                    for (const key of operationKeys) {
                        if (persisted.operations[key] !== undefined) {
                            ops[key] = Number(persisted.operations[key]) || 0;
                        }
                    }
                }
                if (typeof persisted.totalSteal === 'number') {
                    totalSteal = persisted.totalSteal;
                }
            }
        }

        let savedLevel = 0;
        let savedName = '';
        let savedGold = 0;
        let savedExp = 0;
        let savedGoldGained = 0;
        let savedExpGained = 0;

        if (aid) {
            const p = loadPersistedStats(aid);
            if (p) {
                if (p.profile) {
                    savedLevel = Number(p.profile.level) || 0;
                    savedName = p.profile.name || '';
                    savedGold = Number(p.profile.gold) || 0;
                    savedExp = Number(p.profile.exp) || 0;
                }
                // 离线时：若尚未拉取到当前实际余额（savedGold <= 0），不计算误判负增量；仅在有记录上次有效余额时才计算
                const lastRecordedGold = Number(p.lastState?.gold ?? p.profile?.gold ?? 0);
                const baseGold = Number(p.accountBaseline?.gold ?? p.initialState?.gold);
                const baseExp = Number(p.accountBaseline?.exp ?? p.initialState?.exp);
                if (lastRecordedGold > 0 && Number.isFinite(baseGold)) {
                    savedGold = lastRecordedGold;
                    savedGoldGained = lastRecordedGold - baseGold;
                } else {
                    savedGoldGained = 0;
                }
                const lastRecordedExp = Number(p.lastState?.exp ?? p.profile?.exp ?? 0);
                if (lastRecordedExp > 0 && Number.isFinite(baseExp)) {
                    savedExp = lastRecordedExp;
                    savedExpGained = lastRecordedExp - baseExp;
                } else {
                    savedExpGained = 0;
                }
            }
        }

        let accountPlatform = 'qq';
        if (aid) {
            try {
                const accs = store.getAccounts ? store.getAccounts() : null;
                const found = (accs?.accounts || []).find(a => String(a.id) === aid);
                if (found?.platform) accountPlatform = String(found.platform).toLowerCase();
            } catch {}
        }

        return {
            connection: { connected: false },
            status: { name: savedName, level: savedLevel, gold: savedGold, exp: savedExp, platform: accountPlatform },
            uptime: 0,
            operations: ops,
            totalSteal,
            sessionExpGained: savedExpGained,
            sessionGoldGained: savedGoldGained,
            sessionCouponGained: 0,
            lastExpGain: 0,
            lastGoldGain: 0,
            limits: {},
            wsError: null,
            automation: store.getAutomation(aid),
            expProgress: { current: 0, needed: 0, level: savedLevel },
            configRevision,
            accountId: aid
        };
    }

    /** 过滤日志列表 */
    function filterLogs(logList, filter = {}) {
        const keyword = String(filter.keyword || '').trim().toLowerCase();
        const keywords = keyword ? keyword.split(/\s+/).filter(Boolean) : [];
        const tagFilter = String(filter.tag || '').trim();
        const moduleFilter = String(filter.module || '').trim();
        const eventFilter = String(filter.event || '').trim();
        const isWarn = filter.isWarn;
        const timeFrom = filter.timeFrom ? Date.parse(String(filter.timeFrom)) : Number.NaN;
        const timeTo = filter.timeTo ? Date.parse(String(filter.timeTo)) : Number.NaN;

        return (logList || []).filter(entry => {
            const ts = Number(entry && entry.ts) || Date.parse(String(entry && entry.time || ''));
            if (Number.isFinite(timeFrom) && Number.isFinite(ts) && ts < timeFrom) return false;
            if (Number.isFinite(timeTo) && Number.isFinite(ts) && ts > timeTo) return false;

            if (tagFilter && String(entry.tag || '') !== tagFilter) return false;

            if (moduleFilter) {
                const entryModule = String((entry.meta || {}).module || '');
                if (moduleFilter === 'system') {
                    const isSystem = String(entry.tag || '') === '系统' || String(entry.tag || '') === '错误';
                    if (entryModule !== 'system' && !isSystem) return false;
                } else {
                    if (entryModule !== moduleFilter) return false;
                }
            }

            if (eventFilter && String((entry.meta || {}).event || '') !== eventFilter) return false;

            if (isWarn !== undefined && isWarn !== null && String(isWarn) !== '') {
                const targetIsWarn = String(isWarn) === '1' || String(isWarn).toLowerCase() === 'true';
                if (!!entry.isWarn !== targetIsWarn) return false;
            }

            if (keywords.length > 0) {
                const searchText = String(entry._searchText || `${entry.msg || ''  } ${  entry.tag || ''}`).toLowerCase();
                for (const kw of keywords) {
                    if (!searchText.includes(kw)) return false;
                }
            }

            return true;
        });
    }

    return {
        workers,
        globalLogs,
        accountLogs,
        runtimeEvents,
        nextConfigRevision,
        buildConfigSnapshotForAccount,
        log,
        addAccountLog,
        normalizeStatusForPanel,
        buildDefaultStatus,
        filterLogs
    };
}

module.exports = { createRuntimeState };
