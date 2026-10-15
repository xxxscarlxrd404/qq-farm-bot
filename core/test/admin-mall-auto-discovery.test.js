const assert = require('node:assert/strict');
const test = require('node:test');

const {
  compareMallGoods,
  shouldExposeMallGoods,
} = require('../src/controllers/admin-mall-routes');

test('automatically exposes activity goods while keeping unrelated regular goods hidden', () => {
  assert.equal(shouldExposeMallGoods({ goods_id: 1042, is_activity: true }), true);
  assert.equal(shouldExposeMallGoods({ goods_id: 1043, end_time: 1893456000 }), true);
  assert.equal(shouldExposeMallGoods({ goods_id: 1015 }), false);
  assert.equal(shouldExposeMallGoods({ goods_id: 1002 }), true);
});

test('keeps server order for discovered activities and fixed order for featured goods', () => {
  const goods = [
    { goodsId: 1006, isActivity: false, sourceOrder: 9 },
    { goodsId: 1043, isActivity: true, sourceOrder: 2 },
    { goodsId: 1002, isActivity: false, sourceOrder: 8 },
    { goodsId: 1042, isActivity: true, sourceOrder: 1 },
  ].sort(compareMallGoods);
  assert.deepEqual(goods.map(item => item.goodsId), [1042, 1043, 1002, 1006]);
});
