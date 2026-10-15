/**
 * Admin Panel Controller
 * QQ Farm Automation Bot - 管理面板服务器
 *
 * 提供 Express + Socket.IO 管理面板后端：
 * - 默认管理员会话
 * - 账号管理（增删改查/启动停止/备注）
 * - 农场操作（种植/施肥/铲除/收获）
 * - 好友管理（列表/操作/拉黑）
 * - 商店/图鉴/活动/背包
 * - 系统设置/公告/代理/二维码登录
 * - 实时状态推送（WebSocket）
 */
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { Server: SocketIOServer } = require("socket.io");
const {
  CONFIG,
  updateRuntimeConfig,
  getRuntimeConfig,
  getDefaultSystemConfig,
} = require("../config/config");
const { getDataFile, getResourcePath } = require("../config/runtime-paths");
const store = require("../models/store");
const { addOrUpdateAccount, deleteAccount } = store;
const { findAccountByRef } = require("../services/account-resolver");
const { createModuleLogger } = require("../services/logger");
const { createScheduler } = require("../services/scheduler");
const adminScheduler = createScheduler("admin");
const { registerAdminActivityRoutes } = require("./admin-activity-routes");
const {
  registerAdminAccountRuntimeRoutes,
} = require("./admin-account-runtime-routes");
const { registerAdminAccountRoutes } = require("./admin-account-routes");
const { registerAdminAnalyticsRoutes } = require("./admin-analytics-routes");
const { registerAdminRankingRoutes } = require("./admin-ranking-routes");
const { createAdminAccountAccess } = require("./admin-account-access");
const { registerAdminAuthRoutes } = require("./admin-auth-routes");
const { registerAdminUserManagementRoutes } = require("./admin-user-management-routes");
const { registerAdminBagRoutes } = require("./admin-bag-routes");
const { registerAdminCareerRoutes } = require("./admin-career-routes");
const { registerAdminCaptureRoutes, setEmbeddedCapture } = require("./admin-capture-routes");
const { createCaptureCore } = require("../capture/index");
const { registerAdminCurrentUserRoutes } = require("./admin-current-user-routes");
const {
  registerAdminFarmOperationRoutes,
} = require("./admin-farm-operation-routes");
const {
  registerAdminFarmResourceRoutes,
} = require("./admin-farm-resource-routes");
const { registerAdminFriendRoutes } = require("./admin-friend-routes");
const { registerAdminIllustratedRoutes } = require("./admin-illustrated-routes");
const { registerAdminPetRoutes } = require("./admin-pet-routes");
const {
  registerAdminPlantBlacklistRoutes,
} = require("./admin-plant-blacklist-routes");
const { registerAdminProxyRoutes } = require("./admin-proxy-routes");
const { registerAdminPublicInfoRoutes } = require("./admin-public-info-routes");
const { registerAdminQrLoginRoutes } = require("./admin-qr-login-routes");
const { registerAdminNapcatLoginRoutes } = require("./admin-napcat-login-routes");
const { createAdminRouteHelpers } = require("./admin-route-helpers");
const { registerAdminSettingsRoutes } = require("./admin-settings-routes");
const { registerAdminShopRoutes } = require("./admin-shop-routes");
const { createAdminSessionManager } = require("./admin-session-manager");
const { registerAdminSystemRoutes } = require("./admin-system-routes");
const userStore = require("../models/user-store");

const adminLogger = createModuleLogger("admin");
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];
const PUBLIC_API_PATHS = new Set([
  "/login",
  "/auto-login",
  "/register",
  "/public/renew",
  "/public/reset-password/verify",
  "/public/reset-password/confirm",
  "/card-claim/status",
  "/card-claim/claim",
  "/qr/create",
  "/qr/check",
  "/game-version",
  "/public/login-links",
  "/changelog",
  "/health",
  "/activities/status",
]);
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const LOG_SNAPSHOT_LIMIT = 100;
const HTTP_REQUEST_TIMEOUT_MS = 120 * 1000;
const HTTP_HEADERS_TIMEOUT_MS = 16 * 1000;
const HTTP_KEEP_ALIVE_TIMEOUT_MS = 5 * 1000;
const HTTP_CONNECTION_IDLE_TIMEOUT_MS = 30 * 1000;
const HTTP_CLOSE_WAIT_SWEEP_MS = 5000;

let app = null;
let server = null;
let provider = null;
let io = null;
let embeddedCaptureCore = null;

function emitRealtimeStatus(accountId, status) {
  if (!io) return;
  accountId = String(accountId || "").trim();
  if (!accountId) return;
  io.to(`account:${  accountId}`).emit("status:update", {
    accountId,
    status,
  });
}

function emitRealtimeLog(logEntry) {
  if (!io) return;
  const safeLogEntry = logEntry && typeof logEntry === "object" ? logEntry : {};
  const accountId = String(safeLogEntry.accountId || "").trim();
  if (!accountId) return;
  io.to(`account:${  accountId}`).emit("log:new", safeLogEntry);
}

function emitRealtimeAccountLog(logEntry) {
  if (!io) return;
  const safeLogEntry = logEntry && typeof logEntry === "object" ? logEntry : {};
  const accountId = String(safeLogEntry.accountId || "").trim();
  if (!accountId) return;
  io.to(`account:${  accountId}`).emit("account-log:new", safeLogEntry);
}

function configureCorsMiddleware(expressApp) {
  expressApp.use((req, res, next) => {
    const allowedOrigins = CONFIG.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS;
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    } else if (!origin) {
      res.header("Access-Control-Allow-Origin", "*");
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS, PUT");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, x-account-id, x-admin-token",
    );
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    return next();
  });
}

function configureStaticAssets(expressApp, webDist) {
  if (fs.existsSync(webDist)) {
    expressApp.use(express.static(webDist));
    return;
  }
  adminLogger.warn("web build not found", { webDist });
  expressApp.get("/", (req, res) =>
    res.send("web build not found. Please build the web project."),
  );
}

function registerAuthGate(expressApp, requireAdminToken) {
  expressApp.use("/api", (req, res, next) => {
    if (
      PUBLIC_API_PATHS.has(req.path)
      || req.path.startsWith("/public/capture-certificate/")
    ) return next();
    return requireAdminToken(req, res, next);
  });
}

function registerLogoutRoute(expressApp, invalidateAdminSessionAndDisconnect) {
  expressApp.post("/api/logout", (req, res) => {
    const token = req.adminToken;
    if (token) invalidateAdminSessionAndDisconnect(token);
    res.json({ ok: true });
  });
}

function registerHealthRoute(expressApp) {
  expressApp.get("/api/health", (req, res) => {
    res.json({
      ok: true,
      status: "ok",
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
  });
}

function registerRequestTimeoutGuard(expressApp) {
  expressApp.use((req, res, next) => {
    if (req.path === "/api/health") return next();

    const timeout = setTimeout(() => {
      if (res.headersSent || res.writableEnded || res.destroyed) return;
      res.locals.requestTimedOut = true;
      res.status(503).json({
        ok: false,
        error: "Request Timeout",
      });
    }, HTTP_REQUEST_TIMEOUT_MS);

    res.on("finish", () => clearTimeout(timeout));
    res.on("close", () => clearTimeout(timeout));
    return next();
  });
}

function registerSpaFallback(expressApp, webDist) {
  expressApp.get("*", (req, res) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/game-config")) {
      return res.status(404).json({
        ok: false,
        error: "Not Found",
      });
    }
    if (fs.existsSync(webDist)) {
      return res.sendFile(path.join(webDist, "index.html"));
    }
    return res
      .status(404)
      .send("web build not found. Please build the web project.");
  });
}

function configureHttpServerTimeouts(httpServer) {
  httpServer.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
  httpServer.headersTimeout = HTTP_HEADERS_TIMEOUT_MS;
  httpServer.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
  httpServer.timeout = HTTP_CONNECTION_IDLE_TIMEOUT_MS;
  httpServer.setTimeout(HTTP_CONNECTION_IDLE_TIMEOUT_MS, (socket) => {
    socket.destroy();
  });
}

function trackHttpConnections(httpServer) {
  const sockets = new Set();
  const sweepTimer = setInterval(() => {
    for (const socket of sockets) {
      if (socket.destroyed) {
        sockets.delete(socket);
        continue;
      }
      if (socket.readableEnded || socket.writableEnded) {
        socket.destroy();
        sockets.delete(socket);
      }
    }
  }, HTTP_CLOSE_WAIT_SWEEP_MS);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();

  httpServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.setKeepAlive(false);
    socket.setTimeout(HTTP_CONNECTION_IDLE_TIMEOUT_MS);
    socket.on("end", () => {
      socket.destroy();
      sockets.delete(socket);
    });
    socket.on("timeout", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });
  httpServer.on("close", () => {
    clearInterval(sweepTimer);
    for (const socket of sockets) {
      socket.destroy();
    }
    sockets.clear();
  });
}

function leaveAccountRooms(socket) {
  for (const room of socket.rooms) {
    if (room.startsWith("account:")) socket.leave(room);
  }
}

function hasElevatedAdminRole(session) {
  return session.role === "admin" || session.role === "super_admin";
}

function getSocketHandshakeToken(socket) {
  const authToken =
    socket.handshake.auth && socket.handshake.auth.token
      ? String(socket.handshake.auth.token)
      : "";
  const headerToken =
    socket.handshake.headers && socket.handshake.headers["x-admin-token"]
      ? String(socket.handshake.headers["x-admin-token"])
      : "";
  return authToken || headerToken;
}

/**
 * 启动嵌入本进程的抓包服务核心。
 * 需要 CA 生成与 proto 加载，均在后台上完成（core.ready）。
 */
function startEmbeddedCaptureService() {
  try {
    const captureConfig = store.getCaptureConfig();
    if (captureConfig.enabled !== true) {
      adminLogger.info("抓包服务未启动（enabled=false）");
      return null;
    }
    if (captureConfig.embedded === false) {
      adminLogger.info("抓包服务未嵌入本进程（embedded=false，使用独立服务）");
      return null;
    }
    if (embeddedCaptureCore) return embeddedCaptureCore;
    const captureLog = (level, message, extra) => {
      const fn = adminLogger[level] || adminLogger.info;
      fn.call(adminLogger, message, extra);
    };
    const core = createCaptureCore({ log: captureLog });
    embeddedCaptureCore = core;
    setEmbeddedCapture(core);
    core.ready.catch((error) => {
      adminLogger.warn("抓包服务嵌入初始化失败", { error: error.message });
    });
    adminLogger.info("抓包服务已嵌入本进程：手机代理端口 18000");
    return core;
  } catch (error) {
    adminLogger.warn("抓包服务嵌入启动失败", { error: error.message });
    return null;
  }
}

function ensureEmbeddedCaptureService() {
  return startEmbeddedCaptureService();
}

async function stopEmbeddedCaptureService() {
  const core = embeddedCaptureCore;
  embeddedCaptureCore = null;
  setEmbeddedCapture(null);
  if (!core || typeof core.stop !== "function") return;
  try {
    await core.stop();
  } catch (error) {
    adminLogger.warn("抓包服务嵌入停止失败", { error: error.message });
  }
}

function startAdminServer(dataProvider) {
  if (app) return;
  provider = dataProvider;
  app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "256kb" }));

  const adminSessionManager = createAdminSessionManager({
    logger: adminLogger,
    getIo: () => io,
  });
  const {
    cleanupInvalidAdminSessions,
    createAdminSession,
    getSession: getAdminSession,
    hasToken: hasAdminToken,
    invalidateAdminSessionAndDisconnect,
    invalidateAdminSessions,
    requireAdminToken,
    updateAdminSessions,
  } = adminSessionManager;

  const adminAccountAccess = createAdminAccountAccess({
    store,
    getProvider: () => provider,
  });
  const {
    canAccessAccount,
    getAccessibleAccountIdsForUser,
    getAccessibleAccountIdsFromRequest,
    getAccountIdFromRequest,
    getAccountsForUser,
    resolveAccountReference,
  } = adminAccountAccess;

  const adminRouteHelpers = createAdminRouteHelpers({
    store,
    userStore,
    logger: adminLogger,
    getProvider: () => provider,
  });
  const {
    requireAdminRole,
    requireDangerConfirmation,
    requireSuperAdminRole,
    sendProviderError,
  } = adminRouteHelpers;

  const webDist = path.join(__dirname, "../../../web/dist");
  configureCorsMiddleware(app);
  configureStaticAssets(app, webDist);
  app.use("/game-config", express.static(getResourcePath("gameConfig")));
  const loginAssetsDir = getDataFile("login-assets");
  fs.mkdirSync(loginAssetsDir, { recursive: true });
  app.use(
    "/login-assets",
    express.static(loginAssetsDir, {
      dotfiles: "deny",
      setHeaders(res, filePath) {
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (path.extname(filePath).toLowerCase() === ".svg") {
          res.setHeader(
            "Content-Security-Policy",
            "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
          );
        }
      },
    }),
  );
  app.use("/login-assets", (req, res) => res.sendStatus(404));
  adminScheduler.setIntervalTask("session_cleanup", FIVE_MINUTES_MS, cleanupInvalidAdminSessions, {
    preventOverlap: true,
  });

  registerAdminAuthRoutes({
    app,
    logger: adminLogger,
    userStore,
    requireAdminToken,
    createAdminSession,
    updateAdminSessions,
  });

  registerHealthRoute(app);
  registerAuthGate(app, requireAdminToken);
  registerAdminUserManagementRoutes({
    app,
    adminRequired: adminRouteHelpers.adminRequired,
    invalidateAdminSessions,
    provider,
    getAccountsForUser,
  });

  // ============ 定时巡查与到期账号自动熔断释放内存 ============
  function sweepExpiredUsersAndStopWorkers() {
    try {
      const now = Date.now();
      const allUsers = typeof userStore.getAllUsers === 'function' ? userStore.getAllUsers() : [];
      const expiredUsernames = [];

      for (const u of allUsers) {
        if (u.role === 'admin' || u.role === 'super_admin') continue;
        if (u.card && u.card.expiresAt && u.card.expiresAt < now) {
          expiredUsernames.push(u.username);
        }
      }

      if (expiredUsernames.length > 0) {
        // 1. 踢出这些用户的在线 Session
        if (typeof invalidateAdminSessions === 'function') {
          invalidateAdminSessions((session) => expiredUsernames.includes(session.username));
        }

        // 2. 停用这些用户名下正在运行的农场 Worker 实例，彻底释放服务器内存和 CPU
        const allAccounts = typeof getAccountsForUser === 'function' ? getAccountsForUser() : [];
        for (const username of expiredUsernames) {
          const userAccounts = allAccounts.filter(a => a.username === username);
          for (const acc of userAccounts) {
            if (provider && typeof provider.isAccountRunning === 'function' && provider.isAccountRunning(acc.id)) {
              if (typeof provider.stopAccount === 'function') {
                provider.stopAccount(acc.id);
                if (provider.addAccountLog) {
                  provider.addAccountLog(
                    'expired_auto_stop',
                    `用户【${username}】授权已到期，系统已自动停止农场挂机实例并释放内存`,
                    String(acc.id),
                    acc.name || String(acc.id),
                  );
                }
              }
            }
          }
        }
      }
    } catch (err) {
      adminLogger.warn(`过期账号自动熔断巡查异常: ${err.message}`);
    }
  }

  // 服务启动后 15 秒执行初次清理，之后每 5 分钟自动巡查一次
  setTimeout(sweepExpiredUsersAndStopWorkers, 15000);
  setInterval(sweepExpiredUsersAndStopWorkers, 5 * 60 * 1000);
  registerRequestTimeoutGuard(app);
  registerAdminPublicInfoRoutes({
    app,
    provider,
    store,
    userStore,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerLogoutRoute(app, invalidateAdminSessionAndDisconnect);

  registerAdminFarmResourceRoutes({
    app,
    provider,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminPetRoutes({
    app,
    provider,
    store,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminFriendRoutes({
    app,
    provider,
    store,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminPlantBlacklistRoutes({
    app,
    provider,
    store,
    requireAdminToken,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminShopRoutes({
    app,
    provider,
    adminLogger,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminActivityRoutes({
    app,
    provider,
    requireAdminToken,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminIllustratedRoutes({
    app,
    provider,
    adminLogger,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminCareerRoutes({
    app,
    provider,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminBagRoutes({
    app,
    provider,
    store,
    emitRealtimeLog,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminAccountRuntimeRoutes({
    app,
    provider,
    resolveAccountReference,
    canAccessAccount,
  });
  registerAdminFarmOperationRoutes({
    app,
    provider,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminAnalyticsRoutes({ app });
  registerAdminRankingRoutes({ app, store, provider });
  registerAdminSettingsRoutes({
    app,
    provider,
    store,
    logger: adminLogger,
    getAccountIdFromRequest,
    canAccessAccount,
    requireDangerConfirmation,
  });
  registerAdminSystemRoutes({
    app,
    store,
    logger: adminLogger,
    requireAdminToken,
    requireAdminRole,
    requireSuperAdminRole,
    requireDangerConfirmation,
    getDefaultSystemConfig,
    getRuntimeConfig,
    updateRuntimeConfig,
  });
    // 抓包服务默认随应用启动嵌入运行（监听 18000 端口）
  ensureEmbeddedCaptureService();
  registerAdminCaptureRoutes({
    app,
    store,
    provider,
    userStore,
    logger: adminLogger,
    requireAdminRole,
    requireDangerConfirmation,
    canAccessAccount,
    resolveAccountReference,
    ensureEmbeddedCaptureService,
    stopEmbeddedCaptureService,
  });
  registerAdminCurrentUserRoutes({
    app,
    requireAdminToken,
    requireAdminRole,
    userStore,
    store,
  });
  registerAdminAccountRoutes({
    app,
    provider,
    getIo: () => io,
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
  });
  registerAdminQrLoginRoutes({ app });
  registerAdminNapcatLoginRoutes({ app, store });
  registerAdminProxyRoutes({ app, logger: adminLogger });
  registerSpaFallback(app, webDist);

  const subscribeSocketToAccount = (socket, accountRef = "") => {
    const rawAccountRef = String(accountRef || "").trim();
    const accountId =
      rawAccountRef && rawAccountRef !== "all"
        ? resolveAccountReference(rawAccountRef)
        : "";
    const token = socket.data.adminToken;
    const session = token ? getAdminSession(token) : null;

    if (accountId && session) {
      const accounts = getAccountsForUser();
      const account = accounts.find((item) => item.id === accountId);
      if (!account || account.username !== session.username) {
        socket.emit("subscribed", {
          accountId: "all",
          error: "无权访问此账号",
        });
        leaveAccountRooms(socket);
        socket.join("account:all");
        socket.data.accountId = "";
        return;
      }
    }

    leaveAccountRooms(socket);
    if (accountId) {
      socket.join(`account:${  accountId}`);
      socket.data.accountId = accountId;
    } else {
      socket.join("account:all");
      socket.data.accountId = "";
    }
    socket.emit("subscribed", {
      accountId: socket.data.accountId || "all",
    });

    try {
      const subscribedAccountId = socket.data.accountId || "";
      const socketUser = socket.data.user;
      if (
        subscribedAccountId &&
        provider &&
        typeof provider.getStatus === "function"
      ) {
        const status = provider.getStatus(subscribedAccountId);
        socket.emit("status:update", {
          accountId: subscribedAccountId,
          status,
        });
      }
      if (provider && typeof provider.getLogs === "function") {
        let logs = provider.getLogs(subscribedAccountId, {
          limit: LOG_SNAPSHOT_LIMIT,
        });
        if (!Array.isArray(logs)) logs = [];
        if (socketUser) {
          const accessibleAccountIds = getAccessibleAccountIdsForUser(socketUser);
          logs = logs.filter((logEntry) => {
            const logAccountId = logEntry.accountId || logEntry.id;
            // 仅对明确属于该用户账号的日志放行；如果该用户尚未添加账号，不推送系统启动日志，避免空白账号产生误导
            if (!logAccountId) {
              return accessibleAccountIds.length > 0 && socketUser.role === 'admin';
            }
            return accessibleAccountIds.includes(logAccountId);
          });
        }
        socket.emit("logs:snapshot", {
          accountId: subscribedAccountId || "all",
          logs,
        });
      }
      if (provider && typeof provider.getAccountLogs === "function") {
        let accountLogs = provider.getAccountLogs(LOG_SNAPSHOT_LIMIT);
        if (!Array.isArray(accountLogs)) accountLogs = [];
        if (subscribedAccountId) {
          accountLogs = accountLogs.filter((logEntry) => {
            const logAccountId = String(logEntry.accountId || logEntry.id || "");
            return logAccountId === subscribedAccountId;
          });
        }
        if (socketUser) {
          const accessibleAccountIds = getAccessibleAccountIdsForUser(socketUser);
          accountLogs = accountLogs.filter((logEntry) => {
            const logAccountId = logEntry.accountId || logEntry.id;
            return accessibleAccountIds.includes(logAccountId);
          });
        }
        socket.emit("account-logs:snapshot", {
          logs: accountLogs,
        });
      }
    } catch {}
  };

  const adminPort = CONFIG.adminPort || 3007;
  server = app.listen(adminPort, "0.0.0.0", () => {
    adminLogger.info("admin panel started", {
      url: `http://localhost:${  adminPort}`,
      port: adminPort,
    });
  });
  configureHttpServerTimeouts(server);
  trackHttpConnections(server);

  io = new SocketIOServer(server, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    pingInterval: 20000,
    pingTimeout: 10000,
    connectTimeout: 10000,
    maxHttpBufferSize: 256 * 1024,
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      allowedHeaders: ["x-admin-token", "x-account-id"],
    },
  });
  io.use((socket, next) => {
    const token = getSocketHandshakeToken(socket);
    if (!token || !hasAdminToken(token)) {
      return next(new Error("Unauthorized"));
    }
    socket.data.adminToken = token;
    socket.data.user = getAdminSession(token);
    return next();
  });
  io.on("connection", (socket) => {
    const initialAccountId =
      (socket.handshake.auth && socket.handshake.auth.accountId) ||
      (socket.handshake.query && socket.handshake.query.accountId) ||
      "";
    subscribeSocketToAccount(socket, initialAccountId);
    socket.emit("ready", { ok: true, ts: Date.now() });
    socket.on("subscribe", (payload) => {
      const safePayload = payload && typeof payload === "object" ? payload : {};
      subscribeSocketToAccount(socket, safePayload.accountId || "");
    });
  });
}

module.exports = {
  startAdminServer,
  emitRealtimeStatus,
  emitRealtimeLog,
  emitRealtimeAccountLog,
};
