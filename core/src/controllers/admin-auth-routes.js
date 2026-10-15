const userStore = require("../models/user-store");

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const list = String(forwarded).split(",");
    return list[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || "127.0.0.1";
}

function registerAdminAuthRoutes({ app, createAdminSession, updateAdminSessions, requireAdminToken }) {
  // 登录接口
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body || {};
    const clientIp = getClientIp(req);
    if (!username || !password) {
      return res.status(401).json({ ok: false, error: "请输入用户名和密码" });
    }

    const user = userStore.validateUser(username, password, clientIp);
    if (user && user.error) {
      const statusCode =
        user.error === "rate_limit" ? 429 : user.error === "locked" ? 423 : 401;
      return res.status(statusCode).json({
        ok: false,
        error: user.message,
        errorType: user.error,
        remainingMs: user.remainingMs,
      });
    }

    if (!user) {
      return res.status(401).json({ ok: false, error: "用户名或密码错误" });
    }

    if (user.role !== "admin" && user.role !== "super_admin") {
      if (user.card && user.card.enabled === false) {
        return res.status(403).json({ ok: false, error: "账号已被封禁，请联系管理员" });
      }
      if (user.card && user.card.expiresAt) {
        if (user.card.expiresAt < Date.now()) {
          return res.status(403).json({ ok: false, error: "账号已过期，请续费后重新登录" });
        }
      }
    }

    const token = createAdminSession(user);
    return res.json({
      ok: true,
      data: {
        token,
        role: user.role,
        card: user.card,
        accountLimit: user.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT || 2,
        user: { username: user.username },
        mustChangePassword: user.mustChangePassword || false,
      },
    });
  });

  // 注册接口
  app.post("/api/register", (req, res) => {
    const { username, password, cardCode } = req.body || {};
    if (!username || !password || !cardCode) {
      return res.status(400).json({ ok: false, error: "请填写完整注册信息" });
    }
    const result = userStore.registerUser(username, password, cardCode);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json({ ok: true, data: result.user });
  });

  // 查询卡密信息（用于续费前预览）
  app.get("/api/card/info/:code", (req, res) => {
    try {
      const { code } = req.params;
      const cards = userStore.getAllCards();
      const card = cards.find((c) => c.code === code);
      if (!card) {
        return res.status(404).json({ ok: false, error: "卡密不存在" });
      }
      if (!card.enabled) {
        return res.status(400).json({ ok: false, error: "卡密已被禁用" });
      }
      if (card.usedBy) {
        return res.status(400).json({ ok: false, error: "卡密已被使用" });
      }
      res.json({
        ok: true,
        data: {
          type: card.type || "time",
          days: card.days,
          description: card.description,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 用户登录后自续费接口
  app.post("/api/user/renew", requireAdminToken, (req, res) => {
    const { cardCode } = req.body || {};
    const username = req.currentUser?.username;
    if (!username) {
      return res.status(401).json({ ok: false, error: "未登录" });
    }
    if (!cardCode) {
      return res.status(400).json({ ok: false, error: "请提供卡密" });
    }
    const result = userStore.renewUser(username, cardCode);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    // 同步更新已存在会话
    if (typeof updateAdminSessions === "function") {
      updateAdminSessions(
        (session) => session.username === username,
        (session) => {
          session.card = result.card;
          session.accountLimit = result.accountLimit;
        }
      );
    }
    res.json({
      ok: true,
      data: {
        card: result.card,
        accountLimit: result.accountLimit,
        cardType: result.cardType,
      },
    });
  });

  // 公开续费接口（无需登录）
  app.post("/api/public/renew", (req, res) => {
    try {
      const clientIp = getClientIp(req);
      const rateCheck = userStore.checkRateLimit ? userStore.checkRateLimit(clientIp) : { allowed: true };
      if (!rateCheck.allowed) {
        return res.status(429).json({
          ok: false,
          error: rateCheck.message,
          errorType: "rate_limit",
          remainingMs: rateCheck.remainingMs,
        });
      }
      const { username, cardCode } = req.body || {};
      if (!username) {
        return res.status(400).json({ ok: false, error: "请提供用户名" });
      }
      if (!cardCode) {
        return res.status(400).json({ ok: false, error: "请提供卡密" });
      }
      const result = userStore.renewUser(username, cardCode);
      if (!result.ok) {
        return res.status(400).json(result);
      }
      if (typeof updateAdminSessions === "function") {
        updateAdminSessions(
          (session) => session.username === username,
          (session) => {
            session.card = result.card;
            session.accountLimit = result.accountLimit;
          }
        );
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

  // 找回密码 - 验证卡密归属
  app.post("/api/public/reset-password/verify", (req, res) => {
    try {
      const { username, cardCode } = req.body || {};
      if (!username || !cardCode) {
        return res.status(400).json({ ok: false, error: "请提供用户名和卡密" });
      }
      const result = userStore.verifyCardOwnership(username, cardCode);
      if (!result.ok) {
        return res.status(400).json(result);
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 找回密码 - 重置密码
  app.post("/api/public/reset-password/confirm", (req, res) => {
    try {
      const { username, cardCode, newPassword } = req.body || {};
      if (!username || !cardCode || !newPassword) {
        return res.status(400).json({ ok: false, error: "请提供用户名、卡密和新密码" });
      }
      const result = userStore.resetPasswordByCard(username, cardCode, newPassword);
      if (!result.ok) {
        return res.status(400).json(result);
      }
      res.json({ ok: true, message: result.message });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 修改密码接口
  app.post("/api/user/change-password", requireAdminToken, (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    const username = req.currentUser?.username;
    if (!username) {
      return res.status(401).json({ ok: false, error: "未登录" });
    }
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: "请提供原密码和新密码" });
    }
    const result = userStore.changePassword(username, oldPassword, newPassword);
    res.json(result);
  });

  // 获取当前用户信息
  app.get("/api/user/me", requireAdminToken, (req, res) => {
    const user = req.currentUser;
    if (!user) {
      return res.status(401).json({ ok: false, error: "未登录" });
    }
    const allUsers = userStore.getAllUsers();
    const latestUser = allUsers.find((u) => u.username === user.username) || user;
    res.json({
      ok: true,
      data: {
        username: latestUser.username,
        role: latestUser.role,
        card: latestUser.card,
        accountLimit: latestUser.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT || 2,
        mustChangePassword: latestUser.mustChangePassword || false,
      },
    });
  });

  // 卡密公开领取状态与领取接口
  app.get("/api/card-claim/status", (_req, res) => {
    try {
      const status = userStore.getCardClaimStatus();
      res.json({ ok: true, enabled: status.enabled });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/card-claim/claim", (req, res) => {
    try {
      const ua = req.headers["user-agent"] || "";
      const username = req.body?.username || null;
      userStore.clearExpiredClaimRecords();
      const result = userStore.claimCardByUA(ua, username);
      if (!result.ok) {
        const response = { ok: false, error: result.error };
        if (result.remainingMs) response.remainingMs = result.remainingMs;
        return res.status(400).json(response);
      }
      res.json({
        ok: true,
        cardCode: result.cardCode,
        days: result.days,
        description: result.description,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 兼容老客户端的 token 验证
  app.get("/api/auth/validate", requireAdminToken, (req, res) => {
    if (req.currentUser) {
      return res.json({ ok: true, data: { valid: true, user: req.currentUser } });
    }
    return res.status(401).json({ ok: false, error: "无效的登录凭据" });
  });
}

module.exports = { registerAdminAuthRoutes };
