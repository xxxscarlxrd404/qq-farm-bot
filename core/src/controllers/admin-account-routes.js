function createLogQuery(query) {
  return {
    limit: Number.parseInt(query.limit) || 100,
    tag: query.tag || "",
    module: query.module || "",
    event: query.event || "",
    keyword: query.keyword || "",
    isWarn: query.isWarn,
    timeFrom: query.timeFrom || "",
    timeTo: query.timeTo || "",
  };
}

function isAdminUser(user) {
  return user && (user.role === "admin" || user.role === "super_admin");
}

function hasWxRefreshIdentity(account) {
  return !!String((account && account.wxid) || "").trim();
}

const PROTECTED_WX_CREDENTIAL_FIELDS = [
  "loginBuffer",
  "refreshtoken",
  "accesstoken",
  "refreshToken",
  "accessToken",
];

function stripProtectedWxCredentials(source) {
  const result = { ...(source && typeof source === "object" ? source : {}) };
  for (const field of PROTECTED_WX_CREDENTIAL_FIELDS) delete result[field];
  return result;
}

const CLIENT_VERSION_RE = /^\d+(?:\.\d+){2,4}_\d{8}$/;

function parseOfficialGatewayUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "wss:"
    || url.hostname !== "gate-obt.nqf.qq.com"
    || url.pathname !== "/prod/ws") return null;
  const code = String(url.searchParams.get("code") || "").trim();
  const clientVersion = String(url.searchParams.get("ver") || "").trim();
  if (!code || !CLIENT_VERSION_RE.test(clientVersion)) return null;
  return { code, clientVersion };
}

function syncGatewayClientVersion(gateway, store, updateRuntimeConfig) {
  if (!gateway || !store || typeof store.getSystemConfig !== "function") return false;
  const currentSystemConfig = store.getSystemConfig() || {};
  if (String(currentSystemConfig.clientVersion || "") === gateway.clientVersion) return false;
  const savedSystemConfig = store.setSystemConfig({
    ...currentSystemConfig,
    clientVersion: gateway.clientVersion,
  });
  if (savedSystemConfig && typeof updateRuntimeConfig === "function") {
    updateRuntimeConfig(savedSystemConfig);
  }
  return !!savedSystemConfig;
}

function registerAdminAccountRoutes({
  app,
  provider,
  getIo,
  addOrUpdateAccount,
  deleteAccount,
  findAccountByRef,
  getAccountsForUser,
  getAccountIdFromRequest,
  resolveAccountReference,
  canAccessAccount,
  getAccessibleAccountIdsFromRequest,
  userStore,
  sendProviderError,
  store,
  updateRuntimeConfig,
}) {
  app.get("/api/accounts", (req, res) => {
    try {
      const currentUser = req.currentUser;
      let data;
      if (currentUser) {
        const accounts = provider.getAccounts();
        data =
          currentUser.role === "admin" || currentUser.role === "super_admin"
            ? accounts
            : {
                ...accounts,
                accounts: accounts.accounts.filter(
                  (account) => account.username === currentUser.username,
                ),
              };
      } else {
        data = { accounts: [], nextId: 1 };
      }
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/accounts/refresh-wx-codes", async (req, res) => {
    try {
      const currentUser = req.currentUser;
      if (!currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      if (!provider || typeof provider.refreshAccountCode !== "function") {
        return res.status(500).json({ ok: false, error: "自动刷新服务不可用" });
      }

      const allAccounts = getAccountsForUser();
      const accessibleAccounts = isAdminUser(currentUser)
        ? allAccounts
        : allAccounts.filter(
            (account) => account && account.username === currentUser.username,
          );
      const targetAccounts = accessibleAccounts.filter(hasWxRefreshIdentity);

      if (targetAccounts.length === 0) {
        return res.json({
          ok: false,
          error: "没有可刷新的微信账号",
          data: { total: 0, success: 0, failed: 0, skipped: accessibleAccounts.length },
        });
      }

      const results = [];
      for (const account of targetAccounts) {
        try {
          const result = await provider.refreshAccountCode(account.id);
          const success = result && result.ok !== false;
          results.push({
            accountId: account.id,
            name: account.name || account.nick || account.id,
            ok: success,
            error: success ? "" : "刷新失败",
          });
        } catch (error) {
          results.push({
            accountId: account.id,
            name: account.name || account.nick || account.id,
            ok: false,
            error: error.message || "刷新失败",
          });
        }
      }

      const success = results.filter((item) => item.ok).length;
      const failed = results.length - success;
      res.json({
        ok: failed === 0,
        data: {
          total: results.length,
          success,
          failed,
          skipped: accessibleAccounts.length - targetAccounts.length,
          results,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/account/remark", (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const accountRef =
        body.id || body.accountId || body.uin || req.headers["x-account-id"];
      const account = findAccountByRef(getAccountsForUser(), accountRef);
      if (!account || !account.id) {
        return res.status(404).json({ ok: false, error: "Account not found" });
      }

      const remark = String(
        body.remark !== undefined ? body.remark : body.name || "",
      ).trim();
      if (!remark) {
        return res.status(400).json({ ok: false, error: "Missing remark" });
      }

      const accountId = String(account.id);
      const data = addOrUpdateAccount({ id: accountId, name: remark });
      if (provider && typeof provider.setRuntimeAccountName === "function") {
        provider.setRuntimeAccountName(accountId, remark);
      }
      if (provider && provider.addAccountLog) {
        provider.addAccountLog("update", `更新账号备注: ${  remark}`, accountId, remark);
      }
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/accounts", async (req, res) => {
    try {
      const rawBody = req.body && typeof req.body === "object" ? req.body : {};
      const body = stripProtectedWxCredentials(rawBody);
      const gateway = parseOfficialGatewayUrl(body.gatewayUrl);
      if (body.gatewayUrl && !gateway) {
        return res.status(400).json({ ok: false, error: "WebSocket URL 无效或缺少有效的 code/ver" });
      }
      if (gateway) body.code = gateway.code;
      delete body.gatewayUrl;
      const startAfterSave = body.startAfterSave === true;
      delete body.startAfterSave;
      const currentUser = req.currentUser;
      const isUpdate = !!body.id;
      const isAdmin =
        currentUser &&
        (currentUser.role === "admin" || currentUser.role === "super_admin");

      if (isUpdate && currentUser && !isAdmin) {
        if (!canAccessAccount(req, resolveAccountReference(body.id))) {
          return res.status(403).json({ ok: false, error: "无权访问此账号" });
        }
      }

      if (!isUpdate && currentUser && !isAdmin) {
        const accountCount = getAccountsForUser(currentUser.username).length;
        const accountLimit =
          currentUser.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT || 2;
        if (accountCount >= accountLimit) {
          return res.status(403).json({
            ok: false,
            error: `账号数量已达上限（${  accountLimit  }个），请购买额度卡密增加额度`,
          });
        }
      }

      const resolvedId = isUpdate ? resolveAccountReference(body.id) : "";
      const nextAccount = isUpdate
        ? { ...body, id: resolvedId || String(body.id) }
        : body;

      // 扫码凭证只允许由同一登录用户持有的短期会话写入账号。
      if (body.wxSessionId && body.wxid && currentUser) {
        const wxLoginAdapter = require("../services/wx-login-adapter");
        const pending = wxLoginAdapter.peekPendingWxInfo(
          body.wxSessionId,
          body.wxid,
          currentUser.username,
        );
        if (!pending) {
          return res.status(400).json({ ok: false, error: "微信扫码会话无效或已过期，请重新扫码" });
        }
        Object.assign(nextAccount, {
          loginBuffer: pending.loginBuffer,
          refreshtoken: pending.refreshtoken,
          accesstoken: pending.accesstoken,
          avatar: pending.avatar || nextAccount.avatar || "",
          wxDefaultsApplied: true,
        });
      }

      // wxid 换绑后旧账号凭据绝不能继续使用；只有新的扫码会话可以重新写入。
      if (isUpdate) {
        const existing = getAccountsForUser().find(
          (account) => String(account.id) === String(nextAccount.id),
        );
        const wxidChanged = existing
          && Object.hasOwn(body, "wxid")
          && String(existing.wxid || "") !== String(body.wxid || "");
        if (wxidChanged && !body.wxSessionId) {
          Object.assign(nextAccount, {
            loginBuffer: "",
            refreshtoken: "",
            accesstoken: "",
          });
        }
      }

      let wasRunning = false;
      if (isUpdate && provider.isAccountRunning) {
        wasRunning = provider.isAccountRunning(nextAccount.id);
      }

      let onlyRenaming = false;
      if (isUpdate) {
        const accounts = provider.getAccounts();
        const existing = accounts.accounts.find(
          (account) => account.id === nextAccount.id,
        );
        if (existing) {
          const keys = Object.keys(nextAccount);
          onlyRenaming =
            keys.length === 2 && keys.includes("id") && keys.includes("name");
        }
      }

      if (!isUpdate && currentUser) nextAccount.username = currentUser.username;
      const data = addOrUpdateAccount(nextAccount);
      const clientVersionUpdated = syncGatewayClientVersion(gateway, store, updateRuntimeConfig);
      if (body.wxSessionId && body.wxid && currentUser) {
        const wxLoginAdapter = require("../services/wx-login-adapter");
        wxLoginAdapter.consumePendingWxInfo(body.wxSessionId, body.wxid, currentUser.username);
      }
      if (provider.addAccountLog) {
        const accountId = isUpdate
          ? String(nextAccount.id)
          : String((data.accounts.at(-1) || {}).id || "");
        const name = nextAccount.name || "";
        provider.addAccountLog(
          isUpdate ? "update" : "add",
          (isUpdate ? "更新账号: " : "添加账号: ") + (name || accountId),
          accountId,
          name,
        );
      }

      let autoRefreshEnabled = false;
      let startQueued = false;
      if (!isUpdate) {
        const created = data.accounts.at(-1);
        if (created) {
          const isNativeWxScan = created.platform === "wx"
            && created.loginType === "wx_qr"
            && !!body.wxSessionId;
          autoRefreshEnabled = isNativeWxScan
            && typeof store.getAutoCodeRefresh === "function"
            && store.getAutoCodeRefresh().enabled;
          // 启动微信账号会包含凭证续期和 MMTLS 换 Code，不能阻塞新增账号响应。
          // 账号与刷新策略落盘后立即返回，启动任务在后台继续执行。
          startQueued = true;
          Promise.resolve(provider.startAccount(created.id)).catch((error) => {
            if (provider.addAccountLog) {
              provider.addAccountLog(
                "start_failed",
                `账号 ${created.name || created.id} 后台启动失败: ${error.message || error}`,
                created.id,
                created.name || "",
              );
            }
          });
        }
      } else if (!onlyRenaming && (wasRunning || startAfterSave)) {
        startQueued = true;
        const startOperation = wasRunning
          ? provider.restartAccount(nextAccount.id)
          : provider.startAccount(nextAccount.id);
        Promise.resolve(startOperation).catch((error) => {
          if (provider.addAccountLog) {
            provider.addAccountLog(
              "start_failed",
              `账号 ${nextAccount.name || nextAccount.id} 后台启动失败: ${error.message || error}`,
              nextAccount.id,
              nextAccount.name || "",
            );
          }
        });
      }

      // 使用 provider 的脱敏结果，避免把微信滚动凭证返回浏览器。
      res.json({
        ok: true,
        data: provider.getAccounts(),
        startup: { queued: startQueued, autoRefreshEnabled },
        clientVersion: gateway ? gateway.clientVersion : "",
        clientVersionUpdated,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.delete("/api/accounts/:id", (req, res) => {
    try {
      const accountId =
        resolveAccountReference(req.params.id) || String(req.params.id || "");
      if (!canAccessAccount(req, accountId)) {
        return res.status(403).json({ ok: false, error: "无权访问此账号" });
      }

      const accounts = provider.getAccounts();
      const account = findAccountByRef(accounts.accounts || [], req.params.id);
      provider.stopAccount(accountId);
      const data = deleteAccount(accountId);
      if (provider.addAccountLog) {
        provider.addAccountLog(
          "delete",
          `删除账号: ${  (account && account.name) || req.params.id}`,
          accountId,
          account ? account.name : "",
        );
      }
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/account-logs", (req, res) => {
    try {
      const limit = Number.parseInt(req.query.limit) || 100;
      const currentUser = req.currentUser;
      const requestedAccountId = getAccountIdFromRequest(req);
      let logs = provider.getAccountLogs ? provider.getAccountLogs(limit) : [];
      if (!Array.isArray(logs)) logs = [];
      if (requestedAccountId) {
        if (!canAccessAccount(req, requestedAccountId)) {
          return res.status(403).json({ ok: false, error: "无权访问此账号" });
        }
        logs = logs.filter((log) => {
          const accountId = String(log.accountId || log.id || "");
          return accountId === requestedAccountId;
        });
      }
      if (currentUser) {
        const accessibleIds = getAccessibleAccountIdsFromRequest(req);
        logs = logs.filter((log) => {
          const accountId = log.accountId || log.id;
          return accessibleIds.includes(accountId);
        });
      }
      res.json(logs);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/logs", (req, res) => {
    const requestedAccountId = (req.query.accountId || "").toString().trim();
    const accountId = requestedAccountId
      ? requestedAccountId === "all"
        ? ""
        : resolveAccountReference(requestedAccountId)
      : getAccountIdFromRequest(req);
    const currentUser = req.currentUser;
    if (!currentUser) {
      return res.status(401).json({ ok: false, error: "未登录" });
    }
    if (accountId && !canAccessAccount(req, accountId)) {
      return res.status(403).json({ ok: false, error: "无权访问此账号" });
    }

    if (!accountId) {
      const accessibleIds = getAccessibleAccountIdsFromRequest(req);
      const mergedLogs = [];
      const query = createLogQuery(req.query);
      for (const accessibleId of accessibleIds) {
        const logs = provider.getLogs(accessibleId, query);
        if (Array.isArray(logs)) mergedLogs.push(...logs);
      }
      mergedLogs.sort((a, b) => (b.time || 0) - (a.time || 0));
      return res.json({ ok: true, data: mergedLogs.slice(0, query.limit) });
    }

    const query = createLogQuery(req.query);
    const logs = provider.getLogs(accountId, query);
    res.json({ ok: true, data: logs });
  });

  app.delete("/api/logs", (req, res) => {
    const accountId = getAccountIdFromRequest(req);
    if (!accountId) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing x-account-id" });
    }
    if (!canAccessAccount(req, accountId)) {
      return res.status(403).json({ ok: false, error: "无权访问此账号" });
    }

    try {
      const data = provider.clearLogs(accountId);
      const io = getIo();
      if (io && provider && typeof provider.getLogs === "function") {
        const accountLogs = provider.getLogs(accountId, { limit: 100 });
        io.to(`account:${  accountId}`).emit("logs:snapshot", {
          accountId,
          logs: Array.isArray(accountLogs) ? accountLogs : [],
        });
        const historicalAccountLogs =
          typeof provider.getAccountLogs === "function"
            ? provider
                .getAccountLogs(300)
                .filter(
                  (log) =>
                    String(log.accountId || log.id || "") === String(accountId),
                )
            : [];
        io.to(`account:${  accountId}`).emit("account-logs:snapshot", {
          accountId,
          logs: historicalAccountLogs,
        });
        const allLogs = provider.getLogs("", { limit: 100 });
        io.to("account:all").emit("logs:snapshot", {
          accountId: "all",
          logs: Array.isArray(allLogs) ? allLogs : [],
        });
        const allHistoricalAccountLogs =
          typeof provider.getAccountLogs === "function"
            ? provider.getAccountLogs(300)
            : [];
        io.to("account:all").emit("account-logs:snapshot", {
          accountId: "all",
          logs: Array.isArray(allHistoricalAccountLogs)
            ? allHistoricalAccountLogs
            : [],
        });
      }
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });
}

module.exports = {
  parseOfficialGatewayUrl,
  registerAdminAccountRoutes,
  stripProtectedWxCredentials,
  syncGatewayClientVersion,
};
