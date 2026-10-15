const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildIllustratedItem,
  getSeedShopGoodsMap,
  sortIllustratedItems,
} = require('../src/controllers/admin-illustrated-helpers');

test('illustrated items are sorted by tier and then item id', () => {
  const items = sortIllustratedItems([
    { seedId: 204007, illustratedTier: 4 },
    { seedId: 204003, illustratedTier: 3 },
    { seedId: 204006, illustratedTier: 4 },
    { seedId: 204004, illustratedTier: 3 },
  ]);

  assert.deepEqual(
    items.map(item => item.seedId),
    [204003, 204004, 204006, 204007],
  );
});

test('items without a tier are placed after configured illustrated tiers', () => {
  const items = sortIllustratedItems([
    { seedId: 204007 },
    { seedId: 204006, illustratedTier: 4 },
  ]);

  assert.deepEqual(
    items.map(item => item.seedId),
    [204006, 204007],
  );
});

test('illustrated item exposes server-provided mutant wish progress', () => {
  const item = buildIllustratedItem({
    seed_id: 204009,
    illustrated_tier: 4,
    guarantee_info: {
      progress_type: 4,
      current: 14,
      total: 60,
    },
  }, {
    seedGoodsMap: new Map(),
    userLevel: 1,
    adminLogger: { info() {} },
    nongmeFruitMap: new Map(),
  });

  assert.deepEqual(item.wishProgress, {
    type: 4,
    current: 14,
    total: 60,
  });
});

test('seed shop lookup warning is rate limited per account', async () => {
  const warnings = [];
  const options = {
    provider: { getShopInfo: async () => { throw new Error('temporary failure'); } },
    accountId: 'illustrated-warning-rate-limit-test',
    adminLogger: { warn: (...args) => warnings.push(args) },
    tolerateFailure: true,
  };

  await getSeedShopGoodsMap(options);
  await getSeedShopGoodsMap(options);

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], '图鉴可购买判断暂不可用');
});
