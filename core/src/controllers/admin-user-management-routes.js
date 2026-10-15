const userStore = require("../models/user-store");

function registerAdminUserManagementRoutes({
  app,
  adminRequired,
  invalidateAdminSessions,
  provider,
  getAccountsForUser,
}) {
  // ============ 卡密管理 API ============
  app.get("/api/admin/cards", adminRequired, (_req, res) => {
    try {
      const cards = userStore.getAllCards();
      res.json({ ok: true, data: cards });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/admin/cards", adminRequired, (req, res) => {
    try {
      const { description, days, count, type, isFree } = req.body || {};
      if (!description || days === undefined) {
        return res.status(400).json({ ok: false, error: "请提供描述和天数" });
      }
      const cardType = type === "quota" ? "quota" : "time";
      const freeFlag = Boolean(isFree);
      if (count && Number.parseInt(count, 10) > 1) {
        const cards = userStore.createCardsBatch(
          description,
          days,
          Number.parseInt(count, 10),
          cardType,
          freeFlag
        );
        return res.json({ ok: true, data: cards, batch: true, count: cards.length });
      }
      const card = userStore.createCard(description, days, cardType, freeFlag);
      res.json({ ok: true, data: card });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/admin/cards/batch-delete", adminRequired, (req, res) => {
    try {
      const { codes } = req.body || {};
      if (!Array.isArray(codes) || codes.length === 0) {
        return res.status(400).json({ ok: false, error: "请提供要删除的卡密列表" });
      }
      const result = userStore.deleteCardsBatch(codes);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/admin/cards/:code", adminRequired, (req, res) => {
    try {
      const { code } = req.params;
      const updates = req.body || {};
      const card = userStore.updateCard(code, updates);
      if (!card) {
        return res.status(404).json({ ok: false, error: "卡密不存在" });
      }
      res.json({ ok: true, data: card });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.delete("/api/admin/cards/:code", adminRequired, (req, res) => {
    try {
      const { code } = req.params;
      const ok = userStore.deleteCard(code);
      if (!ok) {
        return res.status(404).json({ ok: false, error: "卡密不存在" });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 设置卡密领取功能状态
  app.post("/api/admin/card-claim/status", adminRequired, (req, res) => {
    try {
      const { enabled } = req.body || {};
      const status = userStore.setCardClaimStatus(enabled);
      res.json({ ok: true, enabled: status.enabled });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/admin/card-claim/records", adminRequired, (_req, res) => {
    try {
      const records = userStore.getCardClaimRecords();
      res.json({ ok: true, data: records });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ============ 用户管理 API ============
  app.get("/api/admin/users", adminRequired, (_req, res) => {
    try {
      const users = userStore.getAllUsers();
      // 获取当前所有运行中的账号，计算每个用户名下的正常在线挂机数
      const allAccounts = typeof getAccountsForUser === 'function' ? getAccountsForUser() : [];
      const runningCountByUser = {};

      // 仅统计唯一的正常在线运行账号
      const countedEntities = new Set();
      for (const acc of allAccounts) {
        const u = acc.username || 'admin';
        const entityKey = acc.uin ? `qq_${acc.uin}` : (acc.openId ? `wx_${acc.openId}` : (acc.wxid ? `wx_${acc.wxid}` : `id_${acc.id}`));
        if (countedEntities.has(entityKey)) continue;

        let isRunning = false;
        try {
          if (provider && typeof provider.isAccountRunning === 'function') {
            isRunning = provider.isAccountRunning(acc.id);
          }
        } catch {}
        if (isRunning) {
          countedEntities.add(entityKey);
          runningCountByUser[u] = (runningCountByUser[u] || 0) + 1;
        }
      }

      const usersWithBotStats = users.map(u => ({
        ...u,
        createdAt: u.createdAt || u.created_at || (u.card ? u.card.createdAt : null) || null,
        runningAccountsCount: runningCountByUser[u.username] || 0,
      }));

      res.json({ ok: true, data: usersWithBotStats });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/admin/users-with-password", adminRequired, (_req, res) => {
    try {
      const users = userStore.getAllUsersWithPassword();
      res.json({ ok: true, data: users });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/admin/users/clear-expired", adminRequired, (_req, res) => {
    try {
      const result = userStore.clearExpiredUsers();
      if (result.ok && result.deletedCount > 0) {
        if (typeof invalidateAdminSessions === "function") {
          invalidateAdminSessions((session) =>
            result.deletedUsers.includes(session.username)
          );
        }
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/admin/users/:username", adminRequired, (req, res) => {
    try {
      const { username } = req.params;
      const updates = req.body || {};
      const user = userStore.updateUser(username, updates);
      if (!user) {
        return res.status(404).json({ ok: false, error: "用户不存在" });
      }
      res.json({ ok: true, data: user });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/admin/users/:username/edit", adminRequired, (req, res) => {
    try {
      const { username } = req.params;
      const { newUsername, password, accountLimit, expiresAt, isPermanent } =
        req.body || {};
      const result = userStore.editUser(username, {
        newUsername,
        password,
        accountLimit,
        expiresAt,
        isPermanent,
      });
      if (!result.ok) {
        return res.status(400).json(result);
      }
      res.json({ ok: true, data: result.user });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.delete("/api/admin/users/:username", adminRequired, (req, res) => {
    try {
      const { username } = req.params;
      const currentUser = req.currentUser;
      if (currentUser && currentUser.username === username) {
        return res.status(400).json({ ok: false, error: "不能删除自己的账号" });
      }
      const result = userStore.deleteUser(username, true);
      if (!result.ok) {
        return res.status(400).json(result);
      }
      if (typeof invalidateAdminSessions === "function") {
        invalidateAdminSessions((session) => session.username === username);
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });


  // ============ 微信 / 隔离全局配置 ============
  let globalWxConfig = { userIsolation: true };
  app.get("/api/admin/wx-config", adminRequired, (_req, res) => {
    res.json({ ok: true, data: globalWxConfig });
  });
  app.post("/api/admin/wx-config", adminRequired, (req, res) => {
    globalWxConfig = { ...globalWxConfig, ...(req.body || {}) };
    res.json({ ok: true, data: globalWxConfig });
  });

  // ============ 应用宝服务配置 ============
  let globalYybConfig = {
    enabled: false,
    apiUrl: "",
    token: "",
    timeout: 10000,
  };
  const userYybConfigs = new Map();

  app.get("/api/admin/yyb-config", adminRequired, (_req, res) => {
    res.json({ ok: true, data: globalYybConfig });
  });
  app.post("/api/admin/yyb-config", adminRequired, (req, res) => {
    globalYybConfig = { ...globalYybConfig, ...(req.body || {}) };
    res.json({ ok: true, data: globalYybConfig });
  });

  // 用户自己的 YYB 配置
  app.get("/api/user/yyb-config", (req, res) => {
    const username = req.currentUser?.username;
    if (!username) return res.status(401).json({ ok: false, error: "未登录" });
    const userCfg = userYybConfigs.get(username) || null;
    res.json({ ok: true, data: userCfg });
  });
  app.post("/api/user/yyb-config", (req, res) => {
    const username = req.currentUser?.username;
    if (!username) return res.status(401).json({ ok: false, error: "未登录" });
    userYybConfigs.set(username, req.body || {});
    res.json({ ok: true, data: req.body });
  });
  app.delete("/api/user/yyb-config", (req, res) => {
    const username = req.currentUser?.username;
    if (!username) return res.status(401).json({ ok: false, error: "未登录" });
    userYybConfigs.delete(username);
    res.json({ ok: true });
  });

  // 管理员查看所有用户的 YYB 配置
  app.get("/api/admin/yyb-user-configs", adminRequired, (_req, res) => {
    try {
      const allUsers = userStore.getAllUsers();
      const result = allUsers.map((u) => {
        const yybCfg = userYybConfigs.get(u.username) || null;
        return {
          username: u.username,
          role: u.role,
          accountLimit: u.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT,
          yybConfig: yybCfg,
          yybAccountCount: 0,
          yybOnlineCount: 0,
          yybOfflineCount: 0,
        };
      });
      res.json({ ok: true, data: result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get("/api/admin/yyb-user-configs/:username", adminRequired, (req, res) => {
    const { username } = req.params;
    const yybCfg = userYybConfigs.get(username) || null;
    res.json({ ok: true, data: yybCfg ? { username, yybConfig: yybCfg } : null });
  });

  app.post("/api/admin/yyb-user-configs/:username", adminRequired, (req, res) => {
    const { username } = req.params;
    userYybConfigs.set(username, req.body || {});
    res.json({ ok: true, data: { username, yybConfig: req.body } });
  });

  app.delete("/api/admin/yyb-user-configs/:username", adminRequired, (req, res) => {
    const { username } = req.params;
    userYybConfigs.delete(username);
    res.json({ ok: true });
  });

  app.get("/api/admin/yyb-account-list", adminRequired, (_req, res) => {
    res.json({ ok: true, data: [] });
  });

  app.post("/api/admin/users/:username/renew", adminRequired, (req, res) => {
    try {
      const { username } = req.params;
      const { cardCode } = req.body || {};
      if (!cardCode) {
        return res.status(400).json({ ok: false, error: "请提供卡密" });
      }
      const result = userStore.renewUser(username, cardCode);
      if (!result.ok) {
        return res.status(400).json(result);
      }
      res.json({
        ok: true,
        data: {
          card: result.card,
          accountLimit: result.accountLimit,
          cardType: result.cardType,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

module.exports = { registerAdminUserManagementRoutes };
