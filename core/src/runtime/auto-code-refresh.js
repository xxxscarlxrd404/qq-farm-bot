const { createScheduler } = require('../services/scheduler');
const wxLoginAdapter = require('../services/wx-login-adapter');

function createAutoCodeRefreshService(deps) {
  const {
    store,
    getAccounts,
    addOrUpdateAccount,
    resolveWorkerControls,
    log,
    addAccountLog,
  } = deps;

  const scheduler = createScheduler('auto_code_refresh');
  const recoveryState = new Map();

  function getRecoveryState(accountId) {
    const date = new Date().toISOString().slice(0, 10);
    const current = recoveryState.get(String(accountId));
    if (!current || current.date !== date) {
      const fresh = { date, attempts: 0 };
      recoveryState.set(String(accountId), fresh);
      return fresh;
    }
    return current;
  }

  function isRecoveryReason(reason) {
    return ['ws_400', 'kickout:', 'ws_reconnect_failed:', 'refresh_failed']
      .some(prefix => String(reason || '').includes(prefix));
  }

  function getTaskName(accountId) {
    return `refresh_${  String(accountId || '')}`;
  }

  function getKeepaliveTaskName(accountId) {
    return `wx_keepalive_${String(accountId || '')}`;
  }

  function findAccount(accountId) {
    const data = getAccounts();
    const accounts = Array.isArray(data && data.accounts) ? data.accounts : [];
    return accounts.find(acc => String(acc.id) === String(accountId));
  }

  function normalizeConfig() {
    const cfg = store.getAutoCodeRefresh ? store.getAutoCodeRefresh() : null;
    return {
      enabled: cfg && cfg.enabled === true,
      intervalMinutes: Math.max(1, Math.min(1440, Number(cfg && cfg.intervalMinutes) || 2)),
      maxRetries: Math.max(1, Math.min(100, Number(cfg && cfg.maxRetries) || 8)),
    };
  }

  async function requestFarmCode(account) {
    const wxid = String(account && account.wxid || '').trim();
    if (!wxid) throw new Error('账号缺少 wxid，无法自动刷新 Code');

    if (!account.loginBuffer) throw new Error('账号缺少应用宝登录凭据，请重新扫码登录');
    if (account.refreshtoken) {
      const keepalive = await wxLoginAdapter.keepWxCredentialAlive(account);
      if (!keepalive.Success) throw new Error(keepalive.Message || '微信凭证续期失败');
    }
    const local = await wxLoginAdapter.getFarmCode(wxid, { accountId: account.id });
    if (local.Success && local.Data && local.Data.code) return String(local.Data.code);
    throw new Error(local.Message || '进程内获取 Code 失败');
  }

  async function refreshAccountCode(accountId, reason = 'timer') {
    const account = findAccount(accountId);
    if (!account) return false;

    const recovery = isRecoveryReason(reason) ? getRecoveryState(accountId) : null;
    const config = normalizeConfig();
    if (recovery && recovery.attempts >= config.maxRetries) {
      addAccountLog('auto_relogin_blocked', '已达到每日自动重试次数上限，请检查网络或重新扫码',
        account.id, account.name, { reason, ...recovery });
      return false;
    }
    if (recovery) recovery.attempts += 1;

    try {
      const code = await requestFarmCode(account);
      const nextAccount = { ...account, code };
      addOrUpdateAccount(nextAccount);

      const controls = typeof resolveWorkerControls === 'function' ? (resolveWorkerControls() || {}) : {};
      if (typeof controls.restartWorker === 'function') controls.restartWorker(nextAccount);

      addAccountLog('auto_code_refresh', `自动刷新 Code 成功，已重启账号: ${  account.name}`,
        account.id, account.name, { reason });
      log('系统', `自动刷新 Code 成功: ${  account.name}`, {
        accountId: String(account.id),
        accountName: account.name,
      });
      return true;
    } catch (err) {
      addAccountLog('auto_code_refresh_failed', `自动刷新 Code 失败: ${  err.message}`,
        account.id, account.name, { reason });
      log('错误', `自动刷新 Code 失败: ${  account.name  } - ${  err.message}`, {
        accountId: String(account.id),
        accountName: account.name,
      });
      return false;
    }
  }

  function scheduleAccount(accountId) {
    const cfg = normalizeConfig();
    const taskName = getTaskName(accountId);
    scheduler.clear(taskName);
    scheduler.clear(getKeepaliveTaskName(accountId));

    const account = findAccount(accountId);
    // Code refresh and credential keepalive only apply to WeChat scan-login accounts.
    // All accounts are passed through rescheduleAll(), so QQ accounts must exit quietly.
    if (!account || account.platform !== 'wx') return;

    if (!String(account.wxid || '').trim()) {
      log('系统', '自动刷新 Code 未启动: 账号缺少 wxid', {
        accountId: String(accountId),
        accountName: account.name || '',
      });
      return;
    }

    if (account.loginBuffer && account.refreshtoken) {
      scheduler.setIntervalTask(getKeepaliveTaskName(accountId), 30 * 60000, async () => {
        const latest = findAccount(accountId);
        if (!latest) return;
        const result = await wxLoginAdapter.keepWxCredentialAlive(latest);
        if (!result.Success) {
          log('错误', `微信凭证保活失败: ${latest.name} - ${result.Message || '未知错误'}`, {
            accountId: String(accountId), accountName: latest.name,
          });
        }
      }, { preventOverlap: true });
    }

    if (!cfg.enabled) return;

    scheduler.setIntervalTask(taskName, cfg.intervalMinutes * 60000, () => {
      refreshAccountCode(accountId, 'timer');
    }, { preventOverlap: true });

    log('系统', `自动刷新 Code 已启用: ${  account.name  }，间隔 ${  cfg.intervalMinutes  } 分钟`, {
      accountId: String(accountId),
      accountName: account.name,
    });
  }

  function rescheduleAll() {
    scheduler.clearAll();
    const data = getAccounts();
    const accounts = Array.isArray(data && data.accounts) ? data.accounts : [];
    for (const account of accounts) {
      scheduleAccount(account.id);
    }
  }

  function stopAccount(accountId) {
    scheduler.clear(getTaskName(accountId));
    scheduler.clear(getKeepaliveTaskName(accountId));
    scheduler.clear(`relogin_${String(accountId || '')}`);
  }

  function scheduleRelogin(accountId, reason = 'offline') {
    const cfg = normalizeConfig();
    if (!cfg.enabled) return false;
    const account = findAccount(accountId);
    if (!account || !account.loginBuffer) return false;
    const recovery = getRecoveryState(accountId);
    if (recovery.attempts >= cfg.maxRetries) {
      addAccountLog('auto_relogin_blocked', '已达到每日自动重试次数上限，请检查网络或重新扫码',
        account.id, account.name, { reason, ...recovery });
      return false;
    }
    const taskName = `relogin_${String(accountId || '')}`;
    scheduler.clear(taskName);
    scheduler.setTimeoutTask(taskName, cfg.intervalMinutes * 60000, () => {
      refreshAccountCode(accountId, reason);
    });
    log('系统', `账号 ${account.name} 将在 ${cfg.intervalMinutes} 分钟后自动刷新凭证并重登`, {
      accountId: String(accountId), accountName: account.name, reason,
    });
    return true;
  }

  return {
    refreshAccountCode,
    scheduleAccount,
    rescheduleAll,
    stopAccount,
    scheduleRelogin,
  };
}

module.exports = { createAutoCodeRefreshService };
