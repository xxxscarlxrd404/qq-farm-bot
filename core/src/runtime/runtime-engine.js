const { fork } = require('node:child_process');
const path = require('node:path');
const process = require('node:process');
const { Worker } = require('node:worker_threads');
const store = require('../models/store');
const { getRuntimeConfig, updateRuntimeConfig } = require('../config/config');
const { sendPushooMessage, sendWxPusherMessage, sendWxPusherWechatMessage } = require('../services/push');
const { MiniProgramLoginSession } = require('../services/qrlogin');
const { createAutoCodeRefreshService } = require('./auto-code-refresh');
const { createDataProvider } = require('./data-provider');
const { createReloginReminderService } = require('./relogin-reminder');
const { createRuntimeState } = require('./runtime-state');
const { createWorkerManager } = require('./worker-manager');
const { resourcePolicy } = require('./resource-policy');

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

/** 操作类型键列表 */
const OPERATION_KEYS = [
    'harvest', 'water', 'weed', 'bug', 'farming', 'fertilize', 'plant',
    'steal', 'helpWater', 'helpWeed', 'helpBug',
    'taskClaim', 'sell', 'upgrade', 'tongQiGift'
];

/**
 * 创建运行时引擎
 * @param {object} options
 * @param {object} options.processRef - process 引用
 * @param {string} options.mainEntryPath - 主入口文件路径
 * @param {string} options.workerScriptPath - Worker 脚本路径
 * @param {string} options.runtimeMode - 运行模式 'thread' | 'fork'
 * @param {Function} options.onStatusSync - 状态同步回调
 * @param {Function} options.onLog - 日志回调
 * @param {Function} options.onAccountLog - 账号日志回调
 * @param {Function} options.startAdminServer - 启动管理服务器回调
 */
function createRuntimeEngine(options = {}) {
    const processRef = options.processRef || process;
    const mainEntryPath = options.mainEntryPath || path.join(__dirname, '../../client.js');
    const workerScriptPath = options.workerScriptPath || path.join(__dirname, '../core/worker.js');
    const runtimeMode = String(options.runtimeMode || processRef.env.FARM_RUNTIME_MODE || 'thread').toLowerCase();
    const onStatusSync = typeof options.onStatusSync === 'function' ? options.onStatusSync : null;
    const onLog = typeof options.onLog === 'function' ? options.onLog : null;
    const onAccountLog = typeof options.onAccountLog === 'function' ? options.onAccountLog : null;
    const startAdminServer = typeof options.startAdminServer === 'function' ? options.startAdminServer : null;

    // Worker 启动/重启的引用占位
    const engine = { startWorker: null, restartWorker: null };

    // 创建运行时状态
    const runtimeState = createRuntimeState({
        store,
        operationKeys: OPERATION_KEYS
    });

    const {
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
    } = runtimeState;

    // 创建重登提醒服务
    const reloginReminder = createReloginReminderService({
        store,
        miniProgramLoginSession: MiniProgramLoginSession,
        sendPushooMessage,
        sendWxPusherMessage,
        sendWxPusherWechatMessage,
        log,
        addAccountLog,
        getAccounts: store.getAccounts,
        addOrUpdateAccount: store.addOrUpdateAccount,
        resolveWorkerControls: () => engine
    });
    const { getOfflineAutoDeleteMs, triggerOfflineReminder } = reloginReminder;

    const autoCodeRefresh = createAutoCodeRefreshService({
        store,
        getAccounts: store.getAccounts,
        addOrUpdateAccount: store.addOrUpdateAccount,
        resolveWorkerControls: () => engine,
        log,
        addAccountLog
    });

    // 创建 Worker 管理器
    const {
        startWorker,
        stopWorker,
        restartWorker,
        callWorkerApi,
        getResourceStatus
    } = createWorkerManager({
        fork,
        WorkerThread: Worker,
        runtimeMode,
        processRef,
        mainEntryPath,
        workerScriptPath,
        workers,
        globalLogs,
        store,
        log,
        addAccountLog,
        normalizeStatusForPanel,
        buildConfigSnapshotForAccount,
        getOfflineAutoDeleteMs,
        triggerOfflineReminder,
        addOrUpdateAccount: store.addOrUpdateAccount,
        getAccounts: store.getAccounts,
        deleteAccount: store.deleteAccount,
        scheduleAutoRelogin: autoCodeRefresh.scheduleRelogin,
        refreshAccountCode: autoCodeRefresh.refreshAccountCode,
        updateSystemClientVersion: (clientVersion) => {
            const value = String(clientVersion || '').trim();
            const current = store.getSystemConfig() || store.DEFAULT_SYSTEM_CONFIG || {};
            if (!value || current.clientVersion === value) return false;
            const saved = store.setSystemConfig({ ...current, clientVersion: value });
            if (saved) updateRuntimeConfig(saved);
            return !!saved;
        },
        onStatusSync: (accountId, status, accountName) => {
            runtimeEvents.emit('status', { accountId, status, accountName });
            if (onStatusSync) onStatusSync(accountId, status, accountName);
        },
        onWorkerLog: (entry, accountId, accountName) => {
            runtimeEvents.emit('worker_log', { entry, accountId, accountName });
            if (onLog) onLog(entry, accountId, accountName);
        }
    });

    engine.startWorker = startWorker;
    engine.restartWorker = restartWorker;

    // 创建数据提供器
    const dataProviderDeps = {
        workers,
        globalLogs,
        accountLogs,
        store,
        getAccounts: store.getAccounts,
        callWorkerApi,
        buildDefaultStatus,
        normalizeStatusForPanel,
        filterLogs,
        addAccountLog,
        nextConfigRevision,
        broadcastConfigToWorkers,
        startWorker,
        stopWorker,
        restartWorker,
        getResourceStatus,
        scheduleAutoCodeRefresh: autoCodeRefresh.scheduleAccount,
        rescheduleAllAutoCodeRefresh: autoCodeRefresh.rescheduleAll,
        refreshAccountCode: autoCodeRefresh.refreshAccountCode
    };
    const dataProvider = createDataProvider(dataProviderDeps);

    // 绑定全局日志事件
    runtimeEvents.on('log', (entry) => {
        if (onLog) {
            onLog(
                entry,
                entry && entry.accountId ? entry.accountId : '',
                entry && entry.accountName ? entry.accountName : ''
            );
        }
    });

    runtimeEvents.on('account_log', (entry) => {
        if (onAccountLog) onAccountLog(entry);
    });

    /** 广播配置到所有/指定 Worker */
    function broadcastConfigToWorkers(accountId = '') {
        const targetId = String(accountId || '').trim();
        for (const [id, worker] of Object.entries(workers)) {
            if (targetId && String(id) !== targetId) continue;
            const config = buildConfigSnapshotForAccount(id);
            try {
                worker.process.send({ type: 'config_sync', config });
            } catch { }
        }
    }

    /** 启动所有账号 */
    async function startAllAccounts() {
        const accounts = store.getAccounts().accounts || [];
        if (accounts.length > 0) {
            log('系统', `发现 ${  accounts.length  } 个账号，正在启动...`);
            let launchedInBatch = 0;
            for (const acc of accounts) {
                if (acc.platform === 'wx' && acc.loginBuffer) {
                    const refreshed = await autoCodeRefresh.refreshAccountCode(acc.id, 'startup');
                    if (!refreshed) startWorker(acc);
                } else {
                    startWorker(acc);
                }
                launchedInBatch += 1;
                if (launchedInBatch >= resourcePolicy.workerStartConcurrency) {
                    launchedInBatch = 0;
                    await delay(resourcePolicy.workerStartDelayMs);
                }
            }
        } else {
            log('系统', '未发现账号，请访问管理面板添加账号');
        }
    }

    /** 引擎启动入口 */
    async function start(startOpts = {}) {
        const shouldStartAdmin = startOpts.startAdminServer !== false;
        const shouldAutoStart = startOpts.autoStartAccounts !== false;

        // 加载系统配置
        const sysConfig = store.getSystemConfig();
        if (sysConfig) {
            updateRuntimeConfig(sysConfig);
            const runtimeSystemConfig = getRuntimeConfig();
            if (runtimeSystemConfig.clientVersion !== sysConfig.clientVersion) {
                store.setSystemConfig({ ...sysConfig, clientVersion: runtimeSystemConfig.clientVersion });
            }
            log('系统', `已加载系统配置: serverUrl=${  sysConfig.serverUrl
                 }, clientVersion=${  runtimeSystemConfig.clientVersion
                 }, platform=${  sysConfig.platform}`);
        }

        if (shouldStartAdmin && startAdminServer) {
            startAdminServer(dataProvider);
        }

        if (shouldAutoStart) {
            await startAllAccounts();
        }
        autoCodeRefresh.rescheduleAll();
    }

    /** 停止所有账号 */
    function stopAllAccounts() {
        for (const id of Object.keys(workers)) {
            stopWorker(id);
        }
    }

    return {
        store,
        runtimeEvents,
        workers,
        dataProvider,
        getResourceStatus,
        start,
        startAllAccounts,
        stopAllAccounts,
        broadcastConfigToWorkers,
        startWorker,
        stopWorker,
        restartWorker,
        callWorkerApi,
        log,
        addAccountLog
    };
}

module.exports = { createRuntimeEngine };
