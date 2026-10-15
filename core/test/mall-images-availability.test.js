const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { registerAdminMallRoutes } = require('../src/controllers/admin-mall-routes');
const sources = require('../src/gameConfig/MallImageSupplement.json');
const ts = require('../../web/node_modules/typescript');
const availabilitySource = fs.readFileSync(path.join(__dirname, '../../web/src/composables/shop/useShopAvailability.ts'), 'utf8');
const availabilityModule = { exports: {} };
new Function('exports', ts.transpileModule(availabilitySource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(availabilityModule.exports);
const { createShopAvailability } = availabilityModule.exports;

async function listGoods(discounts, balances) {
  let handler;
  registerAdminMallRoutes({
    app: { get: (_, fn) => { handler = fn; }, post() {} },
    provider: { getStatus: () => ({ connection: { connected: true }, status: balances }), getMallGoods: async () => discounts },
    getAccountIdFromRequest: () => 'fixture', canAccessAccount: () => true,
    adminLogger: { error: assert.fail },
  });
  let result;
  await handler({}, { json: value => { result = value; } });
  assert.equal(result.ok, true);
  return result.data;
}

test('all eight mall goods resolve existing official images and verified sources', async () => {
  const goods = await listGoods(sources.entries.map(entry => ({ goods_id: entry.goodsId, is_activity: true })), {});
  assert.equal(goods.length, 8);
  for (const item of goods) {
    assert.ok(item.images.length, String(item.goodsId));
    for (const url of item.images) assert.ok(fs.existsSync(path.join(__dirname, '../src/gameConfig', decodeURIComponent(url.replace('/game-config/', '')))));
  }
  for (const entry of sources.entries.filter(entry => entry.file)) {
    const bytes = fs.readFileSync(path.join(__dirname, '../src/gameConfig/seed_images_named', entry.file));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  }
});

test('available goods distinguish affordability from sale availability and preserve sold-out limits', async () => {
  const [item, soldOut] = await listGoods([
    { goods_id: 1051, is_activity: true, price: Buffer.from('08ec07100c', 'hex') },
    { goods_id: 1050, is_activity: true, limit: Buffer.from('080110021802', 'hex') },
  ], { diamond: 0 });
  assert.equal(item.canBuy, true);
  assert.equal(soldOut.canBuy, false);
  const availability = createShopAvailability({ currentLevel: () => 200, currentGold: () => 0, currentCoupon: () => 0, currentDiamond: () => 0, userGoldBean: () => 0 });
  assert.equal(availability.canAffordMall(item), false);
  assert.equal(availability.getMallStatusLabel(item), '钻石不足');
  assert.equal(availability.getMallStatusLabel({ ...item, currencyBalance: 12 }), '可购买');
  assert.equal(availability.getMallStatusLabel(soldOut), '已售罄');
  assert.equal(availability.getMallStatusLabel({ ...item, currencyId: 1005 }), '金豆豆不足');
});
