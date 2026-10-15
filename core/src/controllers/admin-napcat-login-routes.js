const napcatLogin = require('../services/napcat-login');

function owner(req) { return String(req.currentUser?.username || ''); }
function sendError(res, error) { res.status(400).json({ ok: false, error: error.message || 'NapCat 登录失败' }); }

function registerAdminNapcatLoginRoutes({ app, store }) {
  app.get('/api/napcat-login/capability', (_req, res) => {
    const captureCfg = store && typeof store.getCaptureConfig === 'function' ? store.getCaptureConfig() : {};
    const qqAllowed = captureCfg.qqQrEnabled !== false;
    res.json({ ok: true, data: { enabled: qqAllowed && napcatLogin.isConfigured() } });
  });
  app.post('/api/napcat-login/tasks', async (req, res) => {
    try { res.json({ ok: true, data: await napcatLogin.create(owner(req), { refresh: req.body?.refresh === true }) }); } catch (error) { sendError(res, error); }
  });
  app.post('/api/napcat-login/tasks/:id/status', async (req, res) => {
    try { res.json({ ok: true, data: await napcatLogin.status(req.params.id, owner(req)) }); } catch (error) { sendError(res, error); }
  });
  app.post('/api/napcat-login/tasks/:id/code', async (req, res) => {
    try { res.json({ ok: true, data: { ...await napcatLogin.code(req.params.id, owner(req)), appId: napcatLogin.APP_ID } }); } catch (error) { sendError(res, error); }
  });
  app.post('/api/napcat-login/tasks/:id/cancel', async (req, res) => {
    try { await napcatLogin.cancel(req.params.id, owner(req)); res.json({ ok: true }); } catch (error) { sendError(res, error); }
  });
}

module.exports = { registerAdminNapcatLoginRoutes };
