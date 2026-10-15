function requireAccountAccess(req, res, { getAccountIdFromRequest, canAccessAccount }) {
  const accountId = getAccountIdFromRequest(req);
  if (!accountId) {
    res.status(400).json({ ok: false, error: "Missing x-account-id" });
    return null;
  }
  if (!canAccessAccount(req, accountId)) {
    res.status(403).json({ ok: false, error: "无权访问此账号" });
    return null;
  }
  return accountId;
}

function getOfflineReminderConfig(store, accountId, body) {
  const saved =
    store.getOfflineReminder && accountId
      ? store.getOfflineReminder(accountId)
      : {};
  const submitted = body && typeof body === "object" ? body : {};
  const savedCredentials = saved.channelCredentials || {};
  const submittedCredentials = submitted.channelCredentials || {};
  const channelCredentials = { ...savedCredentials };
  for (const [channel, credentials] of Object.entries(submittedCredentials)) {
    channelCredentials[channel] = {
      ...(savedCredentials[channel] || {}),
      ...(credentials || {}),
    };
  }
  return { ...saved, ...submitted, channelCredentials };
}

async function sendOfflineReminderTest(config) {
  const { sendPushooMessage, sendWxPusherMessage, sendWxPusherWechatMessage } = require("../services/push");
  const channel = String(config.channel || "qmsg").trim().toLowerCase();
  const hasChannelCredentials = Object.hasOwn(config.channelCredentials || {}, channel);
  const channelCredentials = hasChannelCredentials ? config.channelCredentials[channel] || {} : {};
  const token = String(hasChannelCredentials
    ? channelCredentials.token || ""
    : config.channel === channel ? config.token || "" : "").trim();
  const wxPusherUid = String(hasChannelCredentials
    ? channelCredentials.wxPusherUid || ""
    : config.channel === channel ? config.wxPusherUid || "" : "").trim();
  const titleBase = String(config.title || "账号下线提醒").trim();
  const msgBase = String(config.msg || "账号下线").trim();
  if (!["qmsg", "wxpusher", "wxpusher_wechat", "bark"].includes(channel)) {
    return { error: "不支持的推送渠道，请选择 Qmsg 酱、WxPusher、Bark" };
  }
  if (!token) {
    const tokenLabel = channel === "qmsg"
      ? "Qmsg 酱 Key"
      : channel === "bark"
        ? "Bark Key 或服务器 URL"
        : channel === "wxpusher_wechat"
          ? "WxPusher AppToken"
          : "WxPusher SPT";
    return { error: `${tokenLabel} 不能为空` };
  }
  if (channel === "wxpusher_wechat" && !wxPusherUid) {
    return { error: "WxPusher 接收者 UID 不能为空" };
  }

  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const payload = {
    channel,
    token,
    wxPusherUid,
    title: `${titleBase}（测试）`,
    content: `${msgBase}\n\n这是一条下线提醒测试消息。\n时间: ${ts}`,
  };
  if (channel === "wxpusher_wechat") return sendWxPusherWechatMessage(payload);
  if (channel === "wxpusher") return sendWxPusherMessage(payload);
  return sendPushooMessage(payload);
}

function buildSettingsPayload(store, accountId) {
  const accountConfig = accountId && typeof store.getConfigSnapshot === "function"
    ? store.getConfigSnapshot(accountId)
    : {};
  const offlineReminderDefault = {
    channel: "qmsg",
    reloginUrlMode: "none",
    token: "",
    wxPusherUid: "",
    title: "账号下线提醒",
    msg: "账号下线",
    offlineDeleteSec: 0,
  };

  return {
    intervals: accountId ? store.getIntervals(accountId) : {},
    plantingStrategy: accountId ? store.getPlantingStrategy(accountId) : null,
    prioritizeGrowthTasks: accountId ? store.getPrioritizeGrowthTasks(accountId) : false,
    prioritize2x2Crops:
      accountId && typeof store.getPrioritize2x2Crops === "function"
        ? store.getPrioritize2x2Crops(accountId)
        : true,
    friendQuietHours: accountId ? store.getFriendQuietHours(accountId) : null,
    automation: accountId ? store.getAutomation(accountId) : {},
    autoCodeRefresh:
      typeof store.getAutoCodeRefresh === "function"
        ? store.getAutoCodeRefresh()
        : { enabled: true, intervalMinutes: 2, maxRetries: 8 },
    fertilizerBuyOrganicCount:
      accountId && typeof store.getFertilizerBuyOrganicCount === "function"
        ? store.getFertilizerBuyOrganicCount(accountId)
        : 0,
    fertilizerBuyOrganicThresholdHours:
      accountId &&
      typeof store.getFertilizerBuyOrganicThresholdHours === "function"
        ? store.getFertilizerBuyOrganicThresholdHours(accountId)
        : 10,
    fertilizerBuyNormalCount:
      accountId && typeof store.getFertilizerBuyNormalCount === "function"
        ? store.getFertilizerBuyNormalCount(accountId)
        : 0,
    fertilizerBuyNormalThresholdHours:
      accountId && typeof store.getFertilizerBuyNormalThresholdHours === "function"
        ? store.getFertilizerBuyNormalThresholdHours(accountId)
        : 10,
    fertilizerBuyCheckIntervalMinutes:
      accountId &&
      typeof store.getFertilizerBuyCheckIntervalMinutes === "function"
        ? store.getFertilizerBuyCheckIntervalMinutes(accountId)
        : 30,
    goldenBugKeepCount: Number(accountConfig.goldenBugKeepCount) || 0,
    goldenBugRoundLimit: Number(accountConfig.goldenBugRoundLimit) || 24,
    autoAcceptFriendMinLevel:
      accountId && typeof store.getAutoAcceptFriendMinLevel === "function"
        ? store.getAutoAcceptFriendMinLevel(accountId)
        : 0,
    bagSeedPriority:
      accountId && typeof store.getBagSeedPriority === "function"
        ? store.getBagSeedPriority(accountId)
        : [],
    bagSeedKnownIds: Array.isArray(accountConfig.bagSeedKnownIds)
      ? accountConfig.bagSeedKnownIds
      : [],
    bagSeedFallbackStrategy:
      accountId && typeof store.getBagSeedFallbackStrategy === "function"
        ? store.getBagSeedFallbackStrategy(accountId)
        : "level",
    ui: store.getUI(),
    offlineReminder:
      store.getOfflineReminder && accountId
        ? store.getOfflineReminder(accountId)
        : offlineReminderDefault,
  };
}

function registerAdminSettingsRoutes({
  app,
  provider,
  store,
  logger,
  getAccountIdFromRequest,
  canAccessAccount,
  requireDangerConfirmation,
}) {
  app.get("/api/settings/default-plan", (req, res) => {
    try {
      const currentUser = req.currentUser;
      if (!currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      const data = store.getUserDefaultAccountPlan(currentUser.username);
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.put("/api/settings/default-plan", (req, res) => {
    try {
      const currentUser = req.currentUser;
      if (!currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const data = store.setUserDefaultAccountPlan(
        currentUser.username,
        body.config || {},
        { enabled: body.enabled !== false },
      );
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/default-plan/import", (req, res) => {
    const accountId = requireAccountAccess(req, res, {
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const currentUser = req.currentUser;
      const currentPlan = store.getUserDefaultAccountPlan(currentUser.username);
      const config = store.getConfigSnapshot(accountId);
      const data = store.setUserDefaultAccountPlan(
        currentUser.username,
        config,
        { enabled: currentPlan.enabled !== false },
      );
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/default-plan/apply", async (req, res) => {
    const accountId = requireAccountAccess(req, res, {
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const currentUser = req.currentUser;
      const data = store.applyUserDefaultAccountPlan(
        currentUser.username,
        accountId,
      );
      if (provider && typeof provider.saveSettings === "function") {
        await provider.saveSettings(accountId, data);
      } else if (provider && typeof provider.broadcastConfig === "function") {
        provider.broadcastConfig(accountId);
      }
      res.json({ ok: true, data });
    } catch (error) {
      const status = error.message === "尚未保存默认方案" ? 400 : 500;
      res.status(status).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/default-plan/reset", (req, res) => {
    try {
      const currentUser = req.currentUser;
      if (!currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      const currentPlan = store.getUserDefaultAccountPlan(currentUser.username);
      const data = store.setUserDefaultAccountPlan(
        currentUser.username,
        store.getDefaultAccountConfig(),
        { enabled: currentPlan.enabled !== false },
      );
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/save", async (req, res) => {
    const accountId = requireAccountAccess(req, res, {
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const data = await provider.saveSettings(accountId, req.body || {});
      res.json({ ok: true, data: data || {} });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/theme", async (req, res) => {
    try {
      const theme = String((req.body || {}).theme || "");
      const data = await provider.setUITheme(theme);
      res.json({ ok: true, data: data || {} });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/settings/auto-code-refresh", (req, res) => {
    if (!req.currentUser) {
      return res.status(401).json({ ok: false, error: "未登录" });
    }
    try {
      res.json({ ok: true, data: store.getAutoCodeRefresh() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/auto-code-refresh", async (req, res) => {
    if (!req.currentUser) {
      return res.status(401).json({ ok: false, error: "未登录" });
    }

    try {
      const result = await provider.saveAutoCodeRefresh(req.body || {});
      const data = result && result.autoCodeRefresh ? result.autoCodeRefresh : result;
      res.json({ ok: true, data: data || {} });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/auto-code-refresh/run", async (req, res) => {
    const accountId = requireAccountAccess(req, res, {
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const data = await provider.refreshAccountCode(accountId);
      res.json({ ok: true, data: data || {} });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/offline-reminder", async (req, res) => {
    const accountId = requireAccountAccess(req, res, {
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const currentUser = req.currentUser;
      if (!currentUser) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      if (
        Number(body.offlineDeleteSec || 0) > 0 &&
        !requireDangerConfirmation(req, res, "ENABLE_OFFLINE_DELETE")
      ) {
        return;
      }

      const data = store.setOfflineReminder
        ? store.setOfflineReminder(body, accountId)
        : {};
      if (Number(body.offlineDeleteSec || 0) > 0) {
        logger.warn("更新下线提醒离线删除设置", {
          user: currentUser.username,
          accountId,
          offlineDeleteSec: Number(body.offlineDeleteSec || 0),
          channel: String(body.channel || ""),
          confirmation: "ENABLE_OFFLINE_DELETE",
        });
      }
      res.json({ ok: true, data: data || {} });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/settings/offline-reminder/test", async (req, res) => {
    const accountId = requireAccountAccess(req, res, {
      getAccountIdFromRequest,
      canAccessAccount,
    });
    if (!accountId) return;

    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const config = getOfflineReminderConfig(store, accountId, body);
      const result = await sendOfflineReminderTest(config);
      if (!result) {
        return res
          .status(400)
          .json({ ok: false, error: "发送失败：无返回结果" });
      }
      if (result.error) {
        return res.status(400).json({ ok: false, error: result.error });
      }
      if (result.ok === false) {
        return res.status(400).json({
          ok: false,
          error: result.msg || "发送失败",
          data: result,
        });
      }
      res.json({ ok: true, data: result, message: result.msg || "发送成功" });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/settings", async (req, res) => {
    try {
      const accountId = getAccountIdFromRequest(req);
      if (accountId && !canAccessAccount(req, accountId)) {
        return res.status(403).json({ ok: false, error: "无权访问此账号" });
      }
      res.json({
        ok: true,
        data: buildSettingsPayload(store, accountId),
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/settings/default", (req, res) => {
    try {
      const data = store.getDefaultAccountConfig
        ? store.getDefaultAccountConfig()
        : null;
      if (!data) {
        return res.status(500).json({ ok: false, error: "无法获取默认配置" });
      }
      res.json({ ok: true, data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}

module.exports = { registerAdminSettingsRoutes };
