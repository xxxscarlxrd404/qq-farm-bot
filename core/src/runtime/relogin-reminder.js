const { sleep } = require('../utils/utils');

function createReloginReminderService(deps) {
  const {
    store,
    miniProgramLoginSession,
    sendPushooMessage,
    sendSmtpEmail,
    log,
    addAccountLog,
    getAccounts,
    addOrUpdateAccount,
    resolveWorkerControls,
  } = deps;

  const reloginWatchers = new Map();

  function getOfflineAutoDeleteMs(username = '') {
    const cfg = store.getOfflineReminder ? store.getOfflineReminder(username) : null;
    const seconds = Math.max(0, Number.parseInt(cfg && cfg.offlineDeleteSec, 10) || 0);
    return seconds === 0 ? Infinity : seconds * 1000;
  }

  function findAccount(accountId) {
    const data = getAccounts();
    const accounts = Array.isArray(data && data.accounts) ? data.accounts : [];
    return accounts.find(acc => String(acc.id) === String(accountId));
  }

  function resolveUsername(accountId, fallback = '') {
    if (fallback) return String(fallback).trim();
    try {
      const account = findAccount(accountId);
      return account && account.username ? String(account.username).trim() : '';
    } catch (err) {
      log('错误', `查找账号用户名失败: ${  err.message}`);
      return '';
    }
  }

  function applyReloginCode({ accountId = '', accountName = '', authCode = '', uin = '' }) {
    const code = String(authCode || '').trim();
    if (!code) return;

    const found = findAccount(accountId);
    const avatar = uin ? `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640` : '';
    const controls = typeof resolveWorkerControls === 'function' ? (resolveWorkerControls() || {}) : {};
    const startWorker = typeof controls.startWorker === 'function' ? controls.startWorker : null;
    const restartWorker = typeof controls.restartWorker === 'function' ? controls.restartWorker : null;

    if (found) {
      const nextAccount = {
        ...found,
        code,
        platform: found.platform || 'qq',
        qq: uin || found.qq || found.uin || '',
        uin: uin || found.uin || found.qq || '',
        avatar: avatar || found.avatar || '',
      };
      addOrUpdateAccount(nextAccount);
      if (restartWorker) restartWorker(nextAccount);
      addAccountLog('update', `重登录成功，已更新账号: ${  found.name}`, found.id, found.name, { reason: 'relogin' });
      log('系统', `重登录成功，账号已更新并重启: ${  found.name}`);
      return;
    }

    const created = addOrUpdateAccount({
      name: accountName || (uin ? String(uin) : '重登录账号'),
      code,
      platform: 'qq',
      qq: uin || '',
      uin: uin || '',
      avatar,
    });
    const list = Array.isArray(created && created.accounts) ? created.accounts : [];
    const newAccount = list.at(-1);
    if (newAccount) {
      if (startWorker) startWorker(newAccount);
      addAccountLog('add', `重登录成功，已新增账号: ${  newAccount.name}`, newAccount.id, newAccount.name, { reason: 'relogin' });
      log('系统', `重登录成功，已新增账号并启动: ${  newAccount.name}`, {
        accountId: String(newAccount.id),
        accountName: newAccount.name,
      });
    }
  }

  function startReloginWatcher({ loginCode, accountId = '', accountName = '' }) {
    const code = String(loginCode || '').trim();
    if (!code || !miniProgramLoginSession) return;

    const key = `${accountId || 'unknown'}:${code}`;
    if (reloginWatchers.has(key)) return;
    reloginWatchers.set(key, { startedAt: Date.now() });
    log('系统', `已启动重登录监听: ${  accountName || accountId || '未知账号'}`, {
      accountId: String(accountId || ''),
      accountName: accountName || '',
    });

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      reloginWatchers.delete(key);
    };

    (async () => {
      for (let i = 0; i < 120; i += 1) {
        try {
          const status = await miniProgramLoginSession.queryStatus(code);
          if (!status || status.status === 'Wait') {
            await sleep(1000);
            continue;
          }
          if (status.status === 'Used') {
            log('系统', `重登录二维码已失效: ${  accountName || accountId || '未知账号'}`);
            stop();
            return;
          }
          if (status.status === 'OK') {
            const ticket = String(status.ticket || '').trim();
            const uin = String(status.uin || '').trim();
            if (!ticket) {
              log('错误', '重登录监听失败: ticket 为空');
              stop();
              return;
            }
            const authCode = await miniProgramLoginSession.getAuthCode(ticket, '1112386029');
            if (!authCode) {
              log('错误', '重登录监听失败: 未获取到新 code');
              stop();
              return;
            }
            applyReloginCode({ accountId, accountName, authCode, uin });
            stop();
            return;
          }
          await sleep(1000);
        } catch {
          await sleep(1000);
        }
      }
      log('系统', `重登录监听超时: ${  accountName || accountId || '未知账号'}`);
      stop();
    })();
  }

  async function appendReloginContent(content, reloginUrlMode, accountId, accountName) {
    const mode = String(reloginUrlMode || 'none').trim().toLowerCase();
    if (mode !== 'qq_link' && mode !== 'qr_link') return content;
    if (!miniProgramLoginSession || typeof miniProgramLoginSession.requestLoginCode !== 'function') return content;

    try {
      const qr = await miniProgramLoginSession.requestLoginCode();
      const loginCode = String(qr && qr.code || '').trim();
      const qqUrl = String(qr && (qr.url || qr.loginUrl) || '').trim();
      const qrCodeUrl = String(qr && (qr.qrcode || qr.image) || '').trim();
      if (qqUrl) {
        if (mode === 'qq_link') {
          content += `\n\n重登录链接: ${  qqUrl}`;
        } else {
          content += `\n\n重登录二维码链接: ${  qrCodeUrl || qqUrl}`;
        }
      }
      if (loginCode) startReloginWatcher({ loginCode, accountId, accountName });
    } catch (err) {
      log('错误', `获取重登录链接失败: ${  err.message}`);
    }
    return content;
  }

  async function startAutoRelogin(params = {}) {
    const accountId = String(params.accountId || '').trim();
    const accountName = String(params.accountName || '').trim();
    if (!miniProgramLoginSession || typeof miniProgramLoginSession.requestLoginCode !== 'function') {
      log('错误', '自动重连失败: 当前环境不支持扫码重登录');
      return false;
    }

    try {
      const qr = await miniProgramLoginSession.requestLoginCode();
      const loginCode = String(qr && qr.code || '').trim();
      if (!loginCode) {
        log('错误', '自动重连失败: 未获取到二维码 code');
        return false;
      }
      startReloginWatcher({ loginCode, accountId, accountName });
      log('系统', `已刷新自动重连二维码: ${  accountName || accountId || '未知账号'}`, {
        accountId,
        accountName,
      });
      return true;
    } catch (err) {
      log('错误', `自动重连二维码刷新失败: ${  err.message}`);
      return false;
    }
  }

  async function sendSmtpReminder(cfg, accountId, accountName, reason, offlineMs) {
    // 继承系统管理员配置的全局发信 SMTP
    const globalSmtp = store.getOfflineReminder ? (store.getOfflineReminder() || {}) : {};
    const smtpHost = String(cfg.smtpHost || globalSmtp.smtpHost || '').trim();
    const smtpPort = Number(cfg.smtpPort || globalSmtp.smtpPort) || 465;
    const smtpUser = String(cfg.smtpUser || globalSmtp.smtpUser || '').trim();
    const smtpPass = String(cfg.smtpPass || globalSmtp.smtpPass || '').trim();
    const senderName = String(cfg.senderName || globalSmtp.senderName || 'QQ农场助手监控中心').trim();
    const recipientEmail = String(cfg.recipientEmail || '').trim();

    if (!smtpHost || !smtpUser || !smtpPass) {
      log('错误', '系统管理员未在后台系统配置中设置全局发信邮箱 (SMTP)，跳过发信');
      return;
    }
    if (!recipientEmail) {
      log('提示', `账号【${accountName || accountId}】未设置接收提醒邮箱，跳过通知`);
      return;
    }

    const minutes = Math.floor((Number(offlineMs) || 0) / 60000);
    const title = `[QQ农场] 您的账号【${accountName || accountId}】已离线`;
    let content = `尊敬的农场主：\n您的农场账号【${accountName || accountId}】已于当前时间离线。`;
    if (reason) content += `\n离线原因: ${reason}`;
    if (minutes > 0) content += `\n离线时长: ${minutes} 分钟`;
    content += `\n发送时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    content += `\n提示: 请尽快登录控制面板重新扫码或运行账号。`;
    content = await appendReloginContent(content, cfg.reloginUrlMode, accountId, accountName);

    const ret = await sendSmtpEmail({
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPass,
      senderName,
      recipientEmail,
      subject: accountName ? `${title  } ${  accountName}` : title,
      content,
    });
    if (ret && ret.ok) log('系统', `下线提醒邮件发送成功: ${  accountName || accountId}`);
    else log('错误', `下线提醒邮件发送失败: ${  ret && ret.msg ? ret.msg : 'unknown'}`);
  }

  async function sendPushooReminder(cfg, accountId, accountName, reason, offlineMs) {
    const channel = String(cfg.channel || '').trim().toLowerCase();
    const endpoint = String(cfg.endpoint || '').trim();
    const token = String(cfg.token || '').trim();
    const title = `[QQ农场] 您的账号【${accountName || accountId}】已离线`;
    let content = `尊敬的农场主：\n您的农场账号【${accountName || accountId}】已离线。`;
    if (reason) content += `\n离线原因: ${reason}`;
    const minutes = Math.floor((Number(offlineMs) || 0) / 60000);
    if (minutes > 0) content += `\n离线时长: ${minutes} 分钟`;
    content += `\n发送时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    content += `\n提示: 请尽快登录控制面板重新扫码或运行账号。`;

    if (!channel || !token) {
      log('错误', `下线提醒配置不完整: channel=${channel}, token=未设置`);
      return;
    }
    if (channel !== 'webhook' && !token) {
      log('错误', '下线提醒配置不完整: token=未设置');
      return;
    }
    if (channel === 'webhook' && !endpoint) {
      log('错误', 'Webhook 渠道未设置接口地址');
      return;
    }


    content = await appendReloginContent(content, cfg.reloginUrlMode, accountId, accountName);

    const ret = await sendPushooMessage({ channel, endpoint, token, title, content });
    if (ret && ret.ok) log('系统', `下线提醒发送成功: ${  accountName || accountId}`);
    else log('错误', `下线提醒发送失败: ${  ret && ret.msg ? ret.msg : 'unknown'}`);
  }

  async function triggerOfflineReminder(params = {}) {
    try {
      const accountId = String(params.accountId || '').trim();
      const accountName = String(params.accountName || '').trim();
      const reason = String(params.reason || 'unknown');
      const offlineMs = Number(params.offlineMs) || 0;
      const username = resolveUsername(accountId, params.username);

      log('系统',
        `触发下线提醒: 账号=${  accountName || accountId  }, 原因=${  reason}`,
        { accountId, accountName, reason, username });

      const cfg = store.getOfflineReminder ? store.getOfflineReminder(username) : null;
      if (!cfg) {
        log('错误', `未找到下线提醒配置: 用户=${  username || '(空)'}`);
        return;
      }

      const channel = String(cfg.channel || 'smtp').trim().toLowerCase();
      log('系统', `下线提醒配置: 渠道=${  channel  }, 标题=${  cfg.title || '账号下线提醒'}`, {
        channel,
        username,
      });

      if (channel === 'smtp') {
        await sendSmtpReminder(cfg, accountId, accountName, reason, offlineMs);
      } else {
        await sendPushooReminder(cfg, accountId, accountName, reason, offlineMs);
      }
    } catch (err) {
      log('错误', `下线提醒发送异常: ${  err.message}`);
    }
  }

  return {
    getOfflineAutoDeleteMs,
    triggerOfflineReminder,
    startReloginWatcher,
    startAutoRelogin,
    applyReloginCode,
  };
}

module.exports = { createReloginReminderService };
