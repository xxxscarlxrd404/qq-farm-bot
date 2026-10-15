const { createScheduler } = require('../services/scheduler');
const { resourcePolicy, createResourceMonitor } = require('./resource-policy');

/**
 * 创建 Worker 管理器
 * 负责账号 Worker 进程/线程的启动、停止、重启、消息处理和 RPC 调用
 */
function createWorkerManager(deps) {
    const {
        fork,
        WorkerThread,
        runtimeMode = 'thread',
        processRef,
        mainEntryPath,
        workerScriptPath,
        workers,
        globalLogs,
        log,
        addAccountLog,
        normalizeStatusForPanel,
        buildConfigSnapshotForAccount,
        getOfflineAutoDeleteMs,
        triggerOfflineReminder,
        addOrUpdateAccount,
        getAccounts,
        deleteAccount,
        scheduleAutoRelogin,
        refreshAccountCode,
        updateSystemClientVersion,
        onStatusSync,
        onWorkerLog
    } = deps;

    const scheduler = createScheduler('worker_manager');
    const resourceMonitor = createResourceMonitor();
    const restartHistory = new Map();
    const credentialRefreshes = new Map();
    const permitQueue = [];
    const activePermits = new Map();
    const WATCHDOG_PING_MS = 30000;
    const WATCHDOG_TIMEOUT_MS = 90000;
    const DEFAULT_API_TIMEOUT_MS = 10000;
    // 按方法名的超时覆盖。萌宠日记单次操作要串行多次 RPC（读组 → 校验 → 操作 → 重读快照），
    // 10 秒默认值会误判超时，取值与上游一致。
    const METHOD_TIMEOUT_MS = {
        getDailyGiftOverview: 30000,
        getPetDiary: 90000,
        operatePetDiary: 180000,
        getPetDiaryRecords: 30000,
        getPetDiaryFriend: 30000,
    };
    const WATCHDOG_MAX_RESTARTS = 3;

    /** 是否支持 Thread 模式（非 pkg 打包 + Worker 可用） */
    const threadMode = runtimeMode === 'thread' && !processRef.pkg && typeof WorkerThread === 'function';

    function drainPermitQueue() {
        const limit = resourcePolicy.globalTaskConcurrency;
        while (permitQueue.length > 0) {
            if (limit > 0 && activePermits.size >= limit) break;
            const request = permitQueue.shift();
            const wrk = workers[request.accountId];
            if (!wrk || wrk.process !== request.proc || wrk.stopping) continue;
            activePermits.set(request.token, request);
            try { request.proc.send({ type: 'task_permit_granted', token: request.token }); } catch {
                activePermits.delete(request.token);
            }
        }
    }

    function releaseAccountPermits(accountId) {
        for (let i = permitQueue.length - 1; i >= 0; i -= 1) {
            if (String(permitQueue[i].accountId) === String(accountId)) permitQueue.splice(i, 1);
        }
        for (const [token, request] of activePermits.entries()) {
            if (String(request.accountId) === String(accountId)) activePermits.delete(token);
        }
        drainPermitQueue();
    }

    function cleanText(value) {
        return String(value || '').trim();
    }

    function notifyAbnormalOffline(accountId, wrk, reason, action, message) {
        if (!wrk || wrk.offlineReminderTriggered) return false;
        wrk.offlineReminderTriggered = true;
        const normalizedReason = cleanText(reason) || 'unknown';

        triggerOfflineReminder({
            accountId,
            accountName: wrk.name,
            username: wrk.username,
            reason: normalizedReason,
            offlineMs: wrk.disconnectedSince ? Date.now() - wrk.disconnectedSince : 0
        });
        if (action && message) {
            addAccountLog(action, message, accountId, wrk.name, { reason: normalizedReason });
        }
        return true;
    }

    function buildQqAvatarUrl(qq) {
        const value = cleanText(qq);
        if (!/^\d+$/.test(value)) return '';
        return `https://q1.qlogo.cn/g?b=qq&nk=${  value  }&s=100`;
    }

    function resolveLoginProfile(status, worker) {
        const data = status && typeof status === 'object' ? status : {};
        const info = data.status && typeof data.status === 'object' ? data.status : {};
        const platform = cleanText(info.platform || data.platform || worker.platform || 'qq').toLowerCase();
        const gid = cleanText(info.gid || data.gid);
        const openId = cleanText(info.openId || info.open_id || data.openId || data.open_id);
        const avatar = cleanText(info.avatar || info.avatarUrl || info.avatar_url || data.avatar || data.avatarUrl || data.avatar_url);
        const qq = cleanText(info.qq || info.uin || data.qq || data.uin || worker.qq || worker.uin);
        const fallbackAvatar = platform === 'qq' ? buildQqAvatarUrl(qq) : '';

        return {
            platform,
            gid,
            openId,
            qq,
            avatar: avatar || fallbackAvatar
        };
    }

    function syncAccountProfile(accountId, msgData, worker) {
        const profile = resolveLoginProfile(msgData, worker);
        const update = { id: accountId };

        if (profile.openId && worker.openId !== profile.openId) {
            update.openId = profile.openId;
        }
        if (profile.gid && worker.gid !== profile.gid) {
            update.gid = profile.gid;
        }
        if (profile.qq && worker.qq !== profile.qq) {
            update.qq = profile.qq;
            update.uin = profile.qq;
        }
        if (profile.avatar && worker.avatar !== profile.avatar) {
            update.avatar = profile.avatar;
        }

        if (Object.keys(update).length <= 1) return;

        // 【终极防重去重核心】：登录拿到真实 openId / gid / uin 之后，立即在全库排查重复账号！
        const targetOpenId = profile.openId || worker.openId;
        const targetGid = profile.gid || worker.gid;
        const targetUin = profile.qq || worker.qq;

        if (targetOpenId || targetGid || targetUin) {
            try {
                const accountsData = deps.store.getAccounts ? deps.store.getAccounts() : { accounts: [] };
                const allList = Array.isArray(accountsData.accounts) ? accountsData.accounts : [];
                const currentAcc = allList.find(a => String(a.id) === String(accountId));

                for (const existing of allList) {
                    if (String(existing.id) === String(accountId)) continue; // 跳过当前新账号
                    
                    const isSame = (targetOpenId && existing.openId && String(existing.openId) === String(targetOpenId))
                        || (targetGid && existing.gid && String(existing.gid) === String(targetGid))
                        || (targetUin && (existing.uin || existing.qq) && String(existing.uin || existing.qq) === String(targetUin));

                    if (isSame) {
                        const duplicateId = String(existing.id);
                        // 1. 停用重复的老账号（防止老进程和新进程抢 Session 互踢）
                        stopWorker(duplicateId);

                        // 2. 彻底从数据库删除老账号（遵从指示：新添加账号采用全新配置，老账号干净清退）
                        if (typeof deleteAccount === 'function') {
                            deleteAccount(duplicateId);
                        }

                        if (onWorkerLog) {
                            onWorkerLog('dedupe_cleaned', `农场账号已由新实例[#${accountId}]接管登录，已安全停用并清理老账号[#${duplicateId}]`, accountId, currentAcc ? currentAcc.name : '');
                        }
                    }
                }
            } catch (dedupeErr) {
                console.error('[WorkerDedupe] 去重处理异常:', dedupeErr);
            }
        }

        addOrUpdateAccount(update);
        if (update.openId) worker.openId = update.openId;
        if (update.gid) worker.gid = update.gid;
        if (update.qq) {
            worker.qq = update.qq;
            worker.uin = update.uin;
        }
        if (update.avatar) worker.avatar = update.avatar;
    }

    /**
     * 创建 Thread Worker
     */
    function createThreadWorker(account) {
        const worker = new WorkerThread(workerScriptPath, {
            workerData: {
                accountId: String(account.id || ''),
                channel: 'thread'
            }
        });
        // 统一 send/kill 接口
        worker.send = (msg) => worker.postMessage(msg);
        worker.kill = () => worker.terminate();
        return worker;
    }

    /**
     * 创建 Fork Worker
     */
    function createForkWorker(account) {
        if (processRef.pkg) {
            // pkg 打包模式：fork 主入口而不是 worker 脚本
            return fork(mainEntryPath, [], {
                execPath: processRef.execPath,
                stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
                env: {
                    ...processRef.env,
                    FARM_WORKER: '1',
                    FARM_ACCOUNT_ID: String(account.id || '')
                }
            });
        }
        return fork(workerScriptPath, [], {
            stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
            env: {
                ...processRef.env,
                FARM_ACCOUNT_ID: String(account.id || '')
            }
        });
    }

    /**
     * 根据运行模式创建 Worker
     */
    function createWorker(account) {
        if (threadMode) return createThreadWorker(account);
        return createForkWorker(account);
    }

    /**
     * 启动账号 Worker
     */
    function startWorker(account) {
        if (!account || !account.id) return false;
        if (workers[account.id]) return false;

        const runningCount = Object.keys(workers).length;
        if (resourcePolicy.maxRunningAccounts > 0 && runningCount >= resourcePolicy.maxRunningAccounts) {
            log('系统', `低配资源策略已阻止启动账号 ${account.name}：运行账号数达到 ${resourcePolicy.maxRunningAccounts}`, {
                accountId: String(account.id), accountName: account.name
            });
            return false;
        }
        const rssMb = processRef.memoryUsage ? processRef.memoryUsage().rss / 1024 / 1024 : 0;
        if (resourcePolicy.maxRssMb > 0 && rssMb >= resourcePolicy.maxRssMb) {
            log('系统', `资源策略已阻止启动账号 ${account.name}：RSS ${Math.round(rssMb)}MB`, {
                accountId: String(account.id), accountName: account.name
            });
            return false;
        }

        log('系统', `正在启动账号: ${  account.name}`, {
            accountId: String(account.id),
            accountName: account.name
        });

        let proc = null;
        try {
            proc = createWorker(account);
        } catch (err) {
            const errorMsg = err && err.message ? err.message : String(err || 'unknown error');
            log('错误', `账号 ${  account.name  } 启动失败: ${  errorMsg}`, {
                accountId: String(account.id),
                accountName: account.name
            });
            addAccountLog('start_failed', `账号 ${  account.name  } 启动失败`,
                account.id, account.name, { reason: errorMsg });
            return false;
        }

        // 注册 Worker 记录
        workers[account.id] = {
            process: proc,
            status: null,
            logs: [],
            requests: new Map(),
            reqId: 1,
            name: account.name,
            username: account.username || '',
            platform: account.platform || 'qq',
            gid: account.gid || '',
            openId: account.openId || account.open_id || '',
            qq: account.qq || account.uin || '',
            uin: account.uin || account.qq || '',
            avatar: account.avatar || account.avatarUrl || '',
            stopping: false,
            disconnectedSince: 0,
            offlineReminderTriggered: false,
            autoDeleteTriggered: false,
            wsError: null,
            lastPongAt: Date.now()
        };

        // 发送启动配置
        proc.send({
            type: 'start',
            config: { code: account.code, platform: account.platform, loginType: account.loginType || 'manual' }
        });

        // 发送配置快照
        proc.send({
            type: 'config_sync',
            config: buildConfigSnapshotForAccount(account.id)
        });

        // 监听 Worker 消息
        proc.on('message', (msg) => {
            handleWorkerMessage(account.id, msg);
        });

        // 监听 Worker 错误
        proc.on('error', (err) => {
            log('系统', `账号 ${  account.name  } 子进程启动失败: ${ 
                err && err.message ? err.message : err}`, {
                accountId: String(account.id),
                accountName: account.name
            });
        });

        // 监听 Worker 退出
        proc.on('exit', (code, signal) => {
            const wrk = workers[account.id];
            const displayName = wrk && wrk.name ? wrk.name : account.name;

            log('系统', `账号 ${  displayName  } 进程退出 (code=${  code 
                }, signal=${  signal || 'none'  })`, {
                accountId: String(account.id),
                accountName: displayName,
                runtimeMode: threadMode ? 'thread' : 'fork'
            });

            if (wrk && !wrk.stopping) {
                const reason = `worker_exit:code=${code == null ? 'unknown' : code},signal=${signal || 'none'}`;
                notifyAbnormalOffline(account.id, wrk, reason, 'worker_unexpected_exit',
                    `账号 ${displayName} 异常掉线（Worker 进程意外退出）`);
            }

            scheduler.clear(`force_kill_${  account.id}`);
            scheduler.clear(`restart_fallback_${  account.id}`);
            releaseAccountPermits(account.id);

            // 清理所有未完成的 API 请求
            if (wrk && wrk.requests && wrk.requests.size > 0) {
                for (const [reqId, pending] of wrk.requests.entries()) {
                    scheduler.clear(`api_timeout_${  account.id  }_${  reqId}`);
                    try { pending.reject(new Error('Worker exited')); } catch { }
                }
                wrk.requests.clear();
            }

            if (wrk && wrk.process === proc) {
                delete workers[account.id];
            }
        });

        return true;
    }

    /**
     * 停止账号 Worker
     */
    function stopWorker(accountId) {
        const wrk = workers[accountId];
        if (!wrk) return;

        const targetProc = wrk.process;
        wrk.stopping = true;

        // 发送停止指令
        wrk.process.send({ type: 'stop' });

        // 1 秒后强制杀死
        scheduler.setTimeoutTask(`force_kill_${  accountId}`, 1000, () => {
            const current = workers[accountId];
            if (current && current.process === targetProc) {
                current.process.kill();
                delete workers[accountId];
            }
        });
    }

    /**
     * 重启账号 Worker
     */
    function restartWorker(account) {
        if (!account) return;
        const accountId = account.id;
        const wrk = workers[accountId];

        // 如果未运行，直接启动
        if (!wrk) return startWorker(account);

        const targetProc = wrk.process;
        let restarted = false;

        const doRestart = () => {
            if (restarted) return;
            restarted = true;
            scheduler.clear(`restart_fallback_${  accountId}`);

            const current = workers[accountId];
            if (!current) return startWorker(account);
            if (current.process !== targetProc) return;

            delete workers[accountId];
            startWorker(account);
        };

        const forceKill = () => {
            const current = workers[accountId];
            if (!current || current.process !== targetProc) return false;
            try { current.process.kill(); } catch { }
            delete workers[accountId];
            return true;
        };

        // 如果进程已退出，直接重启
        if (typeof targetProc.exitCode === 'number' || targetProc.signalCode) {
            return doRestart();
        }

        // 先尝试正常停止，再等待退出事件
        targetProc.once('exit', doRestart);
        stopWorker(accountId);

        // 1500ms 超时回退
        scheduler.setTimeoutTask(`restart_fallback_${  accountId}`, 1500, () => {
            if (restarted) return;
            forceKill();
            doRestart();
        });
    }

    /**
     * 处理 Worker 消息
     */
    function handleWorkerMessage(accountId, msg) {
        const wrk = workers[accountId];
        if (!wrk) return;

        if (msg.type === 'task_permit_request') {
            const token = `${accountId}:${String(msg.token || '')}`;
            permitQueue.push({ accountId, token, proc: wrk.process, requestedAt: Date.now() });
            drainPermitQueue();
        } else if (msg.type === 'task_permit_release') {
            activePermits.delete(`${accountId}:${String(msg.token || '')}`);
            drainPermitQueue();
        } else if (msg.type === 'daily_gifts_sync') {
            const currentWrk = workers[accountId];
            if (currentWrk) {
                if (!currentWrk.status) currentWrk.status = {};
                currentWrk.status.dailyGifts = msg.data;
            }
        } else if (msg.type === 'status_sync') {
            // 状态同步
            wrk.status = normalizeStatusForPanel(msg.data, accountId, wrk.name);
            if (typeof onStatusSync === 'function') {
                onStatusSync(accountId, wrk.status, wrk.name);
            }

            syncAccountProfile(accountId, msg.data, wrk);

            // 同步昵称
            if (msg.data && msg.data.status && msg.data.status.name) {
                const nick = String(msg.data.status.name).trim();
                if (nick && nick !== '未知' && nick !== '未登录') {
                    if (wrk.nick !== nick) {
                        const oldNick = wrk.nick;
                        wrk.nick = nick;
                        addOrUpdateAccount({ id: accountId, nick });
                        if (oldNick !== nick) {
                            log('系统', `已同步账号昵称: ${  oldNick || 'None'  } -> ${  nick}`, {
                                accountId, accountName: wrk.name
                            });
                        }
                    }
                }
            }

            // 连接状态追踪和离线提醒
            const isConnected = !!(msg.data && msg.data.connection && msg.data.connection.connected);
            if (isConnected) {
                wrk.disconnectedSince = 0;
                wrk.offlineReminderTriggered = false;
                wrk.autoDeleteTriggered = false;
                wrk.wsError = null;
            } else if (!wrk.stopping) {
                const now = Date.now();
                if (!wrk.disconnectedSince) wrk.disconnectedSince = now;

                const offlineDuration = now - wrk.disconnectedSince;
                if (!wrk.offlineReminderTriggered && offlineDuration >= 60000) {
                    const offlineMinutes = Math.floor(offlineDuration / 60000);
                    log('系统', `账号 ${  wrk.name  } 已离线 ${  offlineMinutes  } 分钟，发送下线提醒`);

                    notifyAbnormalOffline(accountId, wrk, 'offline', 'offline_reminder',
                        `账号 ${  wrk.name  } 已离线 ${  offlineMinutes  } 分钟，已发送下线提醒`,
                    );
                }

                const autoDeleteMs = typeof getOfflineAutoDeleteMs === 'function'
                    ? getOfflineAutoDeleteMs(wrk.username)
                    : Infinity;
                if (!wrk.autoDeleteTriggered && offlineDuration >= autoDeleteMs) {
                    wrk.autoDeleteTriggered = true;
                    const offlineMinutes = Math.floor(offlineDuration / 60000);
                    log('系统', `账号 ${  wrk.name  } 持续离线 ${  offlineMinutes  } 分钟，自动删除账号信息`, {
                        accountId: String(accountId),
                        accountName: wrk.name
                    });
                    triggerOfflineReminder({
                        accountId,
                        accountName: wrk.name,
                        username: wrk.username,
                        reason: 'offline_timeout',
                        offlineMs: offlineDuration
                    });
                    addAccountLog('offline_delete',
                        `账号 ${  wrk.name  } 持续离线 ${  offlineMinutes  } 分钟，已自动删除`,
                        accountId, wrk.name, { reason: 'offline_timeout', offlineMs: offlineDuration });
                    stopWorker(accountId);
                    try {
                        if (typeof deleteAccount === 'function') deleteAccount(accountId);
                    } catch (err) {
                        log('错误', `删除离线账号失败: ${  err.message}`);
                    }
                }
            }
        } else if (msg.type === 'log') {
            // 日志消息
            const timestamp = Date.now();
            const entry = {
                ...msg.data,
                logId: `worker-${accountId}-${timestamp}-${globalLogs.length}`,
                accountId,
                accountName: wrk.name,
                ts: timestamp,
                level: msg.data && msg.data.isWarn ? 'warn' : 'info',
                source: 'business',
                meta: msg.data && msg.data.meta ? msg.data.meta : {}
            };
            entry._searchText = (`${entry.msg || ''  } ${  entry.tag || '' 
                } ${  JSON.stringify(entry.meta || {})}`).toLowerCase();

            wrk.logs.push(entry);
            if (wrk.logs.length > 1000) wrk.logs.shift();

            globalLogs.push(entry);
            if (globalLogs.length > 2000) globalLogs.shift();

            if (typeof onWorkerLog === 'function') {
                onWorkerLog(entry, accountId, wrk.name);
            }
        } else if (msg.type === 'error') {
            log('错误', `账号[${  accountId  }]进程报错: ${  msg.error}`, {
                accountId: String(accountId),
                accountName: wrk.name
            });
        } else if (msg.type === 'ws_error') {
            // WebSocket 错误
            const code = Number(msg.code) || 0;
            const message = msg.message || '';
            wrk.wsError = { code, message, at: Date.now() };

            // Code 400 = 登录失效
            if (code === 400) {
                notifyAbnormalOffline(accountId, wrk, `ws_400:${message || '登录失效'}`,
                    'offline_reminder', `账号 ${wrk.name} 登录失效，已发送下线提醒`);
                addAccountLog('ws_400', `账号 ${  wrk.name  } 登录失效，请更新 Code`,
                    accountId, wrk.name);
                if (typeof refreshAccountCode === 'function' && !credentialRefreshes.has(accountId)) {
                    const task = Promise.resolve(refreshAccountCode(accountId, 'ws_400'))
                        .then(ok => {
                            if (!ok && typeof scheduleAutoRelogin === 'function') {
                                scheduleAutoRelogin(accountId, 'ws_400_refresh_failed');
                            }
                        })
                        .finally(() => credentialRefreshes.delete(accountId));
                    credentialRefreshes.set(accountId, task);
                }
            }
        } else if (msg.type === 'watchdog_pong') {
            wrk.lastPongAt = Date.now();
        } else if (msg.type === 'account_kicked') {
            // 被踢下线
            const reason = msg.reason || '未知';
            log('系统', `账号 ${  wrk.name  } 被踢下线，已自动停止账号`, {
                accountId: String(accountId),
                accountName: wrk.name
            });

            notifyAbnormalOffline(accountId, wrk, `kickout:${reason}`);
            addAccountLog('kickout_stop',
                `账号 ${  wrk.name  } 被踢下线，已自动停止`,
                accountId, wrk.name, { reason });

            stopWorker(accountId);
            if (typeof scheduleAutoRelogin === 'function') {
                scheduleAutoRelogin(accountId, `kickout:${reason}`);
            }
        } else if (msg.type === 'ws_reconnect_failed') {
            const reason = msg.reason || '未知';
            log('系统', `账号 ${  wrk.name  } 连接多次重试失败，已自动停止账号`, {
                accountId: String(accountId),
                accountName: wrk.name
            });

            notifyAbnormalOffline(accountId, wrk, `ws_reconnect_failed:${reason}`);
            addAccountLog('ws_reconnect_failed',
                `账号 ${  wrk.name  } 连接多次重试失败，已自动停止`,
                accountId, wrk.name, { reason });

            stopWorker(accountId);
            if (typeof scheduleAutoRelogin === 'function') {
                scheduleAutoRelogin(accountId, `ws_reconnect_failed:${reason}`);
            }
        } else if (msg.type === 'client_version_update') {
            const clientVersion = cleanText(msg.clientVersion);
            if (clientVersion && typeof updateSystemClientVersion === 'function') {
                const changed = updateSystemClientVersion(clientVersion);
                if (changed) {
                    log('系统', `已根据服务端 WebSocket 回包更新游戏版本: ${clientVersion}`, {
                        accountId: String(accountId), accountName: wrk.name
                    });
                    addAccountLog('client_version_update',
                        `服务端已自动更新游戏版本: ${clientVersion}`,
                        accountId, wrk.name, { previous: cleanText(msg.previous) });
                }
            }
        } else if (msg.type === 'automation_patch') {
            const patch = msg.patch && typeof msg.patch === 'object' ? msg.patch : {};
            if ((patch.automation && typeof patch.automation === 'object')
                || patch.friendBadRetryDate !== undefined) {
                const store = require('../models/store');
                store.applyConfigSnapshot(patch, { accountId });
                const currentWrk = workers[accountId];
                if (currentWrk && currentWrk.process) {
                    currentWrk.process.send({
                        type: 'config_sync',
                        config: buildConfigSnapshotForAccount(accountId)
                    });
                }
            }
        } else if (msg.type === 'bag_seed_priority_sync') {
            const store = require('../models/store');
            store.applyConfigSnapshot({
                bagSeedPriority: msg.priority,
                bagSeedKnownIds: msg.knownIds
            }, { accountId });
            const currentWrk = workers[accountId];
            if (currentWrk && currentWrk.process) {
                currentWrk.process.send({
                    type: 'config_sync',
                    config: buildConfigSnapshotForAccount(accountId)
                });
            }
        } else if (msg.type === 'api_response') {
            // API 响应
            const { id, result, error } = msg;
            scheduler.clear(`api_timeout_${  accountId  }_${  id}`);

            const pending = wrk.requests.get(id);
            if (pending) {
                if (error) pending.reject(new Error(error));
                else pending.resolve(result);
                wrk.requests.delete(id);
            }
        } else if (msg.type === 'friend_blacklist_add') {
            // 好友黑名单添加
            const gid = Number(msg.gid) || 0;
            if (gid > 0) {
                const { addFriendToBlacklist } = require('../models/store');
                addFriendToBlacklist(accountId, gid);
                log('好友', `已将好友 ${  msg.friendName || `GID:${  gid}`  } 加入黑名单`, {
                    accountId: String(accountId),
                    accountName: wrk.name,
                    friendGid: gid,
                    friendName: msg.friendName,
                    reason: msg.reason
                });

                // 同步黑名单到 Worker
                const currentWrk = workers[accountId];
                if (currentWrk && currentWrk.process) {
                    currentWrk.process.send({
                        type: 'config_sync',
                        config: buildConfigSnapshotForAccount(accountId)
                    });
                }
            }
        }
    }

    function findAccount(accountId) {
        const data = typeof getAccounts === 'function' ? getAccounts() : { accounts: [] };
        return (data.accounts || []).find(account => String(account.id) === String(accountId));
    }

    const persistInactiveActivities = () => {
        try {
            const changed = require('../models/store').persistInactiveActivityAutomation();
            for (const accountId of changed) {
                const wrk = workers[accountId];
                if (wrk?.process && !wrk.stopping) wrk.process.send({
                    type: 'config_sync', config: buildConfigSnapshotForAccount(accountId),
                });
            }
        } catch (error) {
            log('系统', `活动过期开关保存失败：${error.message}`);
        }
    };
    persistInactiveActivities();
    scheduler.setIntervalTask('inactive_activity_config', WATCHDOG_PING_MS, persistInactiveActivities);

    scheduler.setIntervalTask('watchdog_tick', WATCHDOG_PING_MS, () => {
        const now = Date.now();
        for (const [accountId, wrk] of Object.entries(workers)) {
            if (!wrk || wrk.stopping) continue;
            if (now - Number(wrk.lastPongAt || 0) > WATCHDOG_TIMEOUT_MS) {
                const history = (restartHistory.get(accountId) || [])
                    .filter(at => now - at < 60 * 60 * 1000);
                if (history.length >= WATCHDOG_MAX_RESTARTS) {
                    wrk.stopping = true;
                    notifyAbnormalOffline(accountId, wrk, 'worker_watchdog_stopped',
                        'offline_reminder', `账号 ${wrk.name} Worker 连续无响应，已发送下线提醒`);
                    stopWorker(accountId);
                    log('错误', `账号 ${wrk.name} Worker 连续无响应，已停止自动重启`, {
                        accountId, accountName: wrk.name
                    });
                    addAccountLog('worker_watchdog_stopped',
                        `Worker 一小时内已重启 ${WATCHDOG_MAX_RESTARTS} 次，停止账号`,
                        accountId, wrk.name);
                    continue;
                }
                history.push(now);
                restartHistory.set(accountId, history);
                const account = findAccount(accountId);
                log('错误', `账号 ${wrk.name} Worker 超过 90 秒无响应，正在自动重启`, {
                    accountId, accountName: wrk.name
                });
                if (account) restartWorker(account);
                continue;
            }
            try { wrk.process.send({ type: 'watchdog_ping', at: now }); } catch { }
        }
    }, { preventOverlap: true });

    /**
     * 调用 Worker API（RPC）
     */
    function callWorkerApi(accountId, method, ...args) {
        const wrk = workers[accountId];
        if (!wrk) return Promise.reject(new Error('账号未运行'));

        // 检查最后一个参数是否包含 _timeoutMs
        const lastArg = args.at(-1);
        const customTimeout = lastArg && typeof lastArg === 'object' && lastArg._timeoutMs;
        const timeoutMs = customTimeout
            ? Number(lastArg._timeoutMs) || DEFAULT_API_TIMEOUT_MS
            : METHOD_TIMEOUT_MS[method] || DEFAULT_API_TIMEOUT_MS;

        const actualArgs = customTimeout ? args.slice(0, -1) : args;

        return new Promise((resolve, reject) => {
            const reqId = wrk.reqId++;
            wrk.requests.set(reqId, { resolve, reject });

            // API 超时保护
            scheduler.setTimeoutTask(`api_timeout_${  accountId  }_${  reqId}`, timeoutMs, () => {
                if (wrk.requests.has(reqId)) {
                    wrk.requests.delete(reqId);
                    reject(new Error('API Timeout'));
                }
            });

            wrk.process.send({
                type: 'api_call',
                id: reqId,
                method,
                args: actualArgs
            });
        });
    }

    return {
        startWorker,
        stopWorker,
        restartWorker,
        callWorkerApi,
        getResourceStatus: () => ({
            policy: resourcePolicy,
            runtime: resourceMonitor.snapshot(),
            governor: { active: activePermits.size, queued: permitQueue.length }
        }),
        dispose: () => {
            scheduler.dispose();
            resourceMonitor.dispose();
        }
    };
}

module.exports = { createWorkerManager };
