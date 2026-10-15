function registerAdminPetRoutes({ app, provider, store, getAccountIdFromRequest, canAccessAccount, sendProviderError }) {
  const accountIdFor = (req, res) => {
    const id = getAccountIdFromRequest(req);
    if (!id) { res.status(400).json({ ok: false, error: '缺少账号标识' }); return ''; }
    if (!canAccessAccount(req, id)) { res.status(403).json({ ok: false, error: '无权访问此账号' }); return ''; }
    return id;
  };
  const route = (method, path, operation) => app[method](path, async (req, res) => {
    const id = accountIdFor(req, res);
    if (!id) return;
    try { res.json({ ok: true, data: await operation(id, req.body || {}) }); }
    catch (error) { sendProviderError(res, error); }
  });
  route('get', '/api/dog/info', async id => {
    const overview = await provider.getPetOverview(id);
    const store = require('../models/store');
    const autoCfg = store.getAutomation ? store.getAutomation(id) : {};
    return {
      ...overview,
      autoBuyFood: autoCfg.auto_buy_dog_food === true,
      autoFeedDog: autoCfg.auto_feed_dog === true,
    };
  });

  route('post', '/api/dog/auto-config', async (id, body) => {
    const store = require('../models/store');
    const autoCfg = store.getAutomation ? store.getAutomation(id) : {};
    if (body.autoBuyFood !== undefined) {
      autoCfg.auto_buy_dog_food = body.autoBuyFood === true;
      if (typeof store.setAutomation === 'function') {
        store.setAutomation('auto_buy_dog_food', autoCfg.auto_buy_dog_food, id);
      }
    }
    if (body.autoFeedDog !== undefined) {
      autoCfg.auto_feed_dog = body.autoFeedDog === true;
      if (typeof store.setAutomation === 'function') {
        store.setAutomation('auto_feed_dog', autoCfg.auto_feed_dog, id);
      }
    }
    if (provider && typeof provider.broadcastConfig === 'function') {
      provider.broadcastConfig(id);
    }
    return { ok: true, autoBuyFood: autoCfg.auto_buy_dog_food, autoFeedDog: autoCfg.auto_feed_dog };
  });
  route('post', '/api/dog/activate', (id, body) => provider.activateDog(id, Number(body.dogId)));
  route('post', '/api/dog/deploy', (id, body) => provider.deployDog(id, Number(body.dogId)));
  route('post', '/api/dog/withdraw', id => provider.withdrawDog(id));
  route('post', '/api/dog/feed', (id, body) => provider.feedDog(id, Number(body.foodId), Number(body.count) || 1));
  route('get', '/api/dog/protect-logs', id => provider.getProtectLogs(id));
  app.get('/api/dog/capital-mode', (req, res) => {
    const id = accountIdFor(req, res); if (!id) return;
    res.json({ ok: true, data: store.getCapitalMode(id) });
  });
  app.post('/api/dog/capital-mode', (req, res) => {
    const id = accountIdFor(req, res); if (!id) return;
    try {
      const capitalMode = store.setCapitalMode(id, req.body || {});
      if (provider.broadcastConfig) provider.broadcastConfig(id);
      res.json({ ok: true, data: { capitalMode } });
    } catch (error) { sendProviderError(res, error); }
  });
}

module.exports = { registerAdminPetRoutes };
