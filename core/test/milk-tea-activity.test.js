const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const protobuf = require('protobufjs');
const { createMilkTeaService, WINDOW, phase, AUTO_ACTIONS, normalizeWireMaps } = require('../src/services/activity-milk-tea');
const root = new protobuf.Root().loadSync(path.join(__dirname, '../src/proto/milk-tea.proto'), { keepCase: true });
const type = name => root.lookupType(`gamepb.activitypb.${name}`);
const vectors = require('../src/activity-data/milk-tea-protocol-vectors.json');
const fixtures = require('../src/activity-data/milk-tea-response-fixtures.json');
const types = Object.fromEntries(['MilkTeaOperateRequest', 'MilkTeaOperateReply', 'MilkTeaGetGroupReply', 'GetGroupRequest'].map(name => [name === 'GetGroupRequest' ? 'ActivityGetGroupRequest' : name, type(name)]));
test('official encoder fixed vectors retain every command, selector and nested parameter', () => {
  for (const vector of vectors) {
    const T = type('MilkTeaOperateRequest');
    assert.equal(Buffer.from(T.encode(T.fromObject(vector.request)).finish()).toString('hex'), vector.hex, vector.action);
    const reply = T.toObject(T.decode(Buffer.from(vector.hex, 'hex')), { longs: String });
    assert.equal(reply.id, '2026110101');
    assert.equal(Number(reply.cmd), vector.request.cmd);
  }
});
test('missing purchase counters fail closed without a BigInt conversion error', async () => {
  const { service } = setup({
    goods: [{ id: 301, name: '限购字段缺失', cost: [{ id: 1001, count: 10000 }], category_tag: 'seed' }],
  });
  const state = await service.getMilkTea();
  assert.equal(state.goods[0].remaining, 0);
  assert.equal(state.goods[0].maxPurchasable, 0);
});
test('missing milk tea node or summary reports response metadata', async () => {
  const noNode = setup({ groupChildren: [] });
  await assert.rejects(noNode.service.getMilkTea(), error => error.code === 'MILK_TEA_NOT_PARTICIPATING');

  const noSummary = setup({ groupChildren: [{ head: { id: '2026110101' }, shop: { goods: [] } }] });
  await assert.rejects(noSummary.service.getMilkTea(), /子活动 2026110101 缺少 milk_tea\.summary/);
});
test('recorded shop and workshop preserve map keys, stock, employee and prices', () => {
  const T = types.MilkTeaOperateReply; const data = normalizeWireMaps(T.toObject(T.decode(T.encode(T.fromObject(fixtures[282])).finish()), { longs: String }));
  assert.equal(data.milk_tea_get_shop.shop.drink_cups['2'], '19');
  assert.equal(data.milk_tea_get_shop.shop.effective_cups_per_hour, '42');
  assert.equal(data.milk_tea_get_shop.shop.slots[0].employee.name, '实习员工');
  assert.equal(fixtures[283].milk_tea_get_workshop.recipes[0].stock_cups, '-1');
});
test('business and settlement boundaries fail closed', () => {
  assert.equal(phase(WINDOW.startTime - 1), 'upcoming');
  assert.equal(phase(WINDOW.startTime), 'business');
  assert.equal(phase(WINDOW.settleTime - 1), 'business');
  assert.equal(phase(WINDOW.settleTime), 'settling');
  assert.equal(phase(WINDOW.endTime), 'settling');
  assert.equal(phase(WINDOW.endTime + 1), 'ended');
});
function setup({ now = WINDOW.startTime + 100, diamond = false, unlocked = true, salesLog, panels = false, fundUnlocked = false, fundState = 1, inventory = [{ id: 1001, count: 1000000 }], account = {}, accountId = '', hireList, hireSuccess = true, groupChildren, goods } = {}) {
  const calls = [];
  const logs = [];
  const group = { group: { head: { id: '2026110100' }, children: [{ head: { id: '2026110101', start_time: WINDOW.startTime, end_time: WINDOW.endTime, settle_start_time: WINDOW.settleTime }, milk_tea: { summary: { shop_open_at: WINDOW.startTime, level: 1 } } }, { head: { id: '2026110102' }, shop: { goods: goods || [{ id: 301, name: '森野甜莓种子', item: [{ id: 20525, count: 1 }], cost: [{ id: diamond ? 1004 : 1001, count: 10000 }], purchase_limit: 108, purchased_count: 0, category_tag: 'seed', cond_hints: [{ satisfied: unlocked, target: 3 }] }] } }] } };
  if (groupChildren) group.group.children = groupChildren;
  if (panels) group.group.children.push(
    { head: { id: '2026110104' }, share_reward: { summary: { current_score: 10, milestones: [{ tier_id: 1, threshold: 10, state: 2, rewards: [{ id: '80014', count: '1' }] }] } } },
    { head: { id: '2026110103' }, growth_fund: { unlocked: fundUnlocked, unlock_cost: [{ id: '1004', count: '360' }], tiers: [{ tier_id: 1, state: fundState, conditions: [{ type: 'milk_tea_store_level', current_value: 1, target_value: 1, reached: true }], reward: [{ id: '29005', count: '2' }] }] } }
  );
  const service = createMilkTeaService({ accountId, log: (...args) => logs.push(args), types, getServerTimeSec: () => now, getUserState: () => account, getBag: async () => inventory, getBagItems: x => x, itemDto: x => ({ ...x, name: '夹具物品' }), sendMsgAsync: async (_, method, bytes) => {
    if (method === 'GetGroup') return { body: types.MilkTeaGetGroupReply.encode(types.MilkTeaGetGroupReply.fromObject(group)).finish() };
    const req = types.MilkTeaOperateRequest.toObject(types.MilkTeaOperateRequest.decode(bytes), { longs: String });calls.push(req);
    const fixture = Number(req.cmd) === 56 && hireList ? { id: req.id, cmd: req.cmd, milk_tea_get_hire_list: hireList } : Number(req.cmd) === 57 ? { id: req.id, cmd: req.cmd, milk_tea_hire: { results: [{ success: hireSuccess }] } } : Number(req.cmd) === 55 ? fixtures[282] : Number(req.cmd) === 58 ? fixtures[283] : Number(req.cmd) === 63 ? fixtures[206] : Number(req.cmd) === 67 && salesLog ? { id: req.id, cmd: req.cmd, milk_tea_get_sales_log: salesLog } : { id: req.id, cmd: req.cmd };
    const response = hireList && Number(req.cmd) === 55 ? { ...fixture, milk_tea_get_shop: { shop: { ...fixture.milk_tea_get_shop.shop, slots: [] } } } : fixture;
    return { body: types.MilkTeaOperateReply.encode(types.MilkTeaOperateReply.fromObject(response)).finish() };
  } });return { service, calls, logs };
}
test('locked goods and diamonds cannot reach mutation RPC', async () => {
  for (const opts of [{ diamond: true }, { unlocked: false }]) {
    const { service, calls } = setup(opts);
    await assert.rejects(service.operateMilkTea('buy', { goodsId: 301 }), /商品未解锁/);
    assert.ok(!calls.some(x => Number(x.cmd) === 1));
  }
});
test('settlement blocks seed purchases and all production actions', async () => {
  const { service, calls } = setup({ now: WINDOW.settleTime });
  await assert.rejects(service.operateMilkTea('buy', { goodsId: 301 }), /结算期/);
  await assert.rejects(service.operateMilkTea('boost'), /结算期/);
  assert.ok(!calls.some(x => [1, 60].includes(Number(x.cmd))));
});
test('reads coalesce and expired activities send no Operate', async () => {
  const { service, calls } = setup({ now: WINDOW.endTime + 1 });
  const first = service.getMilkTea();assert.equal(first, service.getMilkTea());
  assert.equal((await first).phase, 'ended');assert.equal(calls.length, 0);
  await assert.rejects(service.operateMilkTea('cashier'), /已结束/);assert.equal(calls.length, 0);
});
test('expired persisted automation flags cannot restart', () => {
  const { disableHiddenActivityAutomation } = require('../src/models/store')._test;
  for (const now of [WINDOW.startTime - 1, WINDOW.endTime + 1]) {
    const config = Object.fromEntries(Object.keys(AUTO_ACTIONS).map(key => [key, true]));
    disableHiddenActivityAutomation(config, now);assert.ok(Object.values(config).every(x => x === false));
  }
  const config = Object.fromEntries(Object.keys(AUTO_ACTIONS).map(key => [key, true]));
  disableHiddenActivityAutomation(config, WINDOW.settleTime);
  assert.equal(config.milk_tea_boost, false);assert.equal(config.milk_tea_cashier, true);
});
test('official local assets exist and sha256 matches', () => {
  const dir = path.join(__dirname, '../../web/public/activity/milk-tea');
  for (const asset of JSON.parse(fs.readFileSync(path.join(dir, 'assets.json')))) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, asset.file))).digest('hex'), asset.sha256, asset.file);
});
test('golden sprout is a 2x2 event plant', () => {
  const config = require('../src/config/gameConfig');config.loadConfigs();
  assert.equal(config.getPlantBySeedId(29005).size, 2);
});

test('automatic selling reserves event fruit only while automatic crafting is enabled in business phase', () => {
  const { reserveMilkTeaFruit } = require('../src/services/activity-milk-tea');
  assert.equal(reserveMilkTeaFruit(40525, true, WINDOW.startTime), true);
  assert.equal(reserveMilkTeaFruit(49005, true, WINDOW.startTime), true);
  assert.equal(reserveMilkTeaFruit(40525, false, WINDOW.startTime), false);
  assert.equal(reserveMilkTeaFruit(40525, true, WINDOW.settleTime), false);
  assert.equal(reserveMilkTeaFruit(40002, true, WINDOW.startTime), false);
});

test('manual shop purchase uses the same checked mutation envelope', async () => {
  const { service, calls } = setup();
  const result = await service.operateMilkTea('buy', { goodsId: 301, count: 2 });
  assert.equal(result.ok, true);
  const request = calls.find(x => Number(x.cmd) === 1);
  assert.equal(request.id, '2026110102');
  assert.deepEqual(request.shop_buy, { goods_id: '301', count: '2' });
  await assert.rejects(service.operateMilkTea('buy', { goodsId: 301, count: 109 }), /商品未解锁/);
});

test('web references resolve to local assets', () => {
  const component = ['MilkTeaActivityPanel.vue', 'MilkTeaShopDialogs.vue', 'MilkTeaRewardIcon.vue'].map(file => fs.readFileSync(path.join(__dirname, '../../web/src/components/activity', file), 'utf8')).join('\n');
  for (const [, name] of component.matchAll(/img\('([^']+)'\)/g)) assert.ok(fs.existsSync(path.join(__dirname, '../../web/public/activity/milk-tea', `${name}.png`)), name);
});


test('level preview carries configured rewards and recipe names without changing official thresholds', async () => {
  const { service } = setup();
  const state = await service.getMilkTea();
  assert.equal(state.levels[1].revenue_required, 14000);
  assert.deepEqual(state.levels[1].rewards.map(item => [item.id, item.count]), [['29005', '2'], ['1042', '2'], ['80011', '10']]);
  assert.deepEqual(state.levels[0].recipe_names, ['普通奶茶', '甜莓奶茶', '金露云酪']);
});

test('sales log normalizes recorded recipe counts and rewards without duplicating currencies', async () => {
  const { service } = setup({ salesLog: { day: 20261015, token: '715', coin: '160000', cups: '125', cups_by_recipe: { 1: '105', 2: '20' }, items: [{ id: '1041', count: '715' }, { id: '1042', count: '1' }] } });
  const log = await service.milkTeaRecords('sales');
  assert.equal(log.drinks.find(item => item.recipe_id === '2').name, '甜莓奶茶');
  assert.equal(log.drinks.find(item => item.recipe_id === '1').cups, '105');
  assert.equal(log.rewards.filter(item => item.id === '1041').length, 1);
  assert.equal(log.rewards.find(item => item.id === '1001').count, '160000');
  assert.equal(log.rewards.find(item => item.id === '1042').count, '1');
});

test('share and fund panels retain claim states, conditions and normalized reward metadata', async () => {
  const { service } = setup({ panels: true });
  const state = await service.getMilkTea();
  assert.equal(state.share.current_score, 10);
  assert.equal(state.share.milestones[0].state, 2);
  assert.equal(state.share.milestones[0].rewards[0].name, '夹具物品');
  assert.equal(state.fund.unlocked, false);
  assert.equal(state.fund.unlock_cost[0].count, '360');
  assert.equal(state.fund.tiers[0].conditions[0].target_value, '1');
  assert.equal(state.fund.tiers[0].reward[0].id, '29005');
  await assert.rejects(service.operateMilkTea('fundRewards'), /尚未购买成长基金/);
});

test('fund bear decorations and happiness reward resolve to local official icons', () => {
  const config = require('../src/config/gameConfig');
  config.loadConfigs();
  for (let id = 210041; id <= 210048; id++) {
    const image = config.getItemImageById(id);
    assert.ok(image.startsWith('/activity/milk-tea/icon_'), String(id));
    assert.ok(fs.existsSync(path.join(__dirname, '../../web/public', image)), image);
  }
});

test('exchange quantity maximum respects inventory, locks, diamonds and settlement', async () => {
  const { service } = setup();
  assert.equal((await service.getMilkTea()).goods[0].maxPurchasable, 100);
  await assert.rejects(service.operateMilkTea('buy', { goodsId: 301, count: 101 }), /资源不足/);
  for (const count of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(service.operateMilkTea('buy', { goodsId: 301, count }), /商品未解锁/);
  }
  for (const options of [{ diamond: true }, { unlocked: false }, { now: WINDOW.settleTime }]) {
    assert.equal((await setup(options).service.getMilkTea()).goods[0].maxPurchasable, 0);
  }
});

 test('growth fund requires purchase even when a tier reports claimable', async () => {
  for (const fundUnlocked of [false, true]) {
    for (const fundState of [1, 2, 3]) {
      const { service, calls } = setup({ panels: true, fundUnlocked, fundState });
      if (fundUnlocked && fundState === 2) {
        assert.equal((await service.operateMilkTea('fundRewards')).ok, true);
        assert.equal(calls.filter(x => Number(x.cmd) === 76).length, 1);
      } else {
        await assert.rejects(service.operateMilkTea('fundRewards'), fundUnlocked ? /暂无可领取基金奖励/ : /尚未购买成长基金/);
        assert.ok(!calls.some(x => Number(x.cmd) === 76));
      }
      assert.ok(!calls.some(x => Number(x.cmd) === 75), 'never purchase the fund');
    }
  }
});

test('exchange uses official available, sold-out, locked groups and configured order', () => {
  const { compareShopGoods } = require('../src/services/activity-milk-tea');
  const goods = [
    { id: 'locked-first', unlocked: false, remaining: 1, order: 1 },
    { id: 'available-later', unlocked: true, remaining: 2, order: 20, background_type: 1 },
    { id: 'sold-out', unlocked: true, remaining: 0, order: 0 },
    { id: 'available-first', unlocked: true, remaining: 1, order: 10, background_type: 3 },
    { id: 'locked-later', unlocked: false, remaining: 0, order: 2 },
  ];
  assert.deepEqual(goods.sort(compareShopGoods).map(goods => goods.id), ['available-first', 'available-later', 'sold-out', 'locked-first', 'locked-later']);
});

test('shop uses account gold when bag omits base currency, without double counting', async () => {
  const { service, calls } = setup({ inventory: [], account: { gold: 75000 } });
  const state = await service.getMilkTea();
  assert.equal(state.goods[0].maxPurchasable, 7);
  assert.equal(state.balances.find(item => String(item.id) === '1001').count, '75000');
  await service.operateMilkTea('buy', { goodsId: 301, count: 7 });
  assert.equal(calls.find(call => Number(call.cmd) === 1).shop_buy.count, '7');
  await assert.rejects(service.operateMilkTea('buy', { goodsId: 301, count: 8 }), /资源不足/);
  const withBag = await setup({ inventory: [{ id: 1001, count: 20000 }], account: { gold: 75000 } }).service.getMilkTea();
  assert.equal(withBag.goods[0].maxPurchasable, 2);
  assert.equal((await setup({ inventory: [], account: { gold: 9999 } }).service.getMilkTea()).goods[0].maxPurchasable, 0);
});

test('batch shop quantity matches latest official encoder reconstruction', () => {
  const request = types.MilkTeaOperateRequest;
  for (const [count, hex] of [[7, '08ad021007'], [70, '08ad021046']]) {
    const message = request.fromObject({ id: '2026110102', cmd: 1, shop_buy: { goods_id: '301', count } });
    const nested = root.lookupType('gamepb.activitypb.ShopBuyReq');
    assert.equal(Buffer.from(nested.encode(message.shop_buy).finish()).toString('hex'), hex);
    const decoded = request.toObject(request.decode(request.encode(message).finish()), { longs: String });
    assert.equal(decoded.shop_buy.count, String(count));
  }
});

const { selectHireCandidate, normalizeHireOptions } = require('../src/services/activity-milk-tea');
const employee = (gid, talent, extra = {}) => ({ friend: { gid: String(gid) }, talent_id: talent, state: 0, ...extra });
test('hire chooses first matching idle friend, then other idle friends, then interns', () => {
  const other = employee(1, 9002), matching = employee(2, 9001), robot = employee(3, 9004, { is_robot: true });
  const candidates = { friends: [employee(4, 9001, { state: 1 }), other, matching, employee(5, 9001)], robots: [robot] };
  assert.equal(selectHireCandidate(candidates, { talentId: 9001 }, 100), matching);
  assert.equal(selectHireCandidate(candidates, { talentId: 9003 }, 100), other);
  assert.equal(selectHireCandidate(candidates, { talentId: 0 }, 100), other);
  assert.equal(selectHireCandidate(candidates, { talentId: 9004 }, 100), robot);
  candidates.friends = [employee(6, 9001, { rehire_available_at: 101 }), employee(7, 9001, { state_until_at: 101 }), employee(8, 9001, { state: 2 })];
  assert.equal(selectHireCandidate(candidates, { talentId: 9001 }, 100), robot);
  candidates.robots[0].state = 1;
  assert.equal(selectHireCandidate(candidates, { talentId: 9001 }, 100), undefined);
  assert.equal(selectHireCandidate({}, {}, 100), undefined);
  assert.deepEqual(normalizeHireOptions({ durationId: 'bad', talentId: 123 }), { durationId: 1, talentId: 0 });
  assert.deepEqual(normalizeHireOptions({ durationId: '3', talentId: '9001' }), { durationId: 3, talentId: 9001 });
});
test('automatic hire uses selected duration and candidate in the shared validated action', async () => {
  for (const durationId of [1, 2, 3]) {
    const { service, calls } = setup({ inventory: [{ id: 1041, count: 1000 }], hireList: { duration_id: durationId, wage_total: 270, friends: [employee(111, 9002), employee(222, 9001)] } });
    await service.operateMilkTea('hire', { autoSelect: true, durationId, talentId: 9001 });
    assert.deepEqual(calls.find(x => Number(x.cmd) === 57).milk_tea_hire.hires, [{ slot_index: 0, duration_id: durationId, target_gid: '222' }]);
  }
});
test('automatic hire skips no candidates and blocks insufficient wages, time and failed hires', async () => {
  const empty = setup({ hireList: { wage_total: 40 } });
  assert.equal((await empty.service.operateMilkTea('hire', { autoSelect: true })).skipped, true);
  assert.ok(!empty.calls.some(x => Number(x.cmd) === 57));
  for (const options of [
    { inventory: [], expected: /奶茶券不足/ },
    { now: WINDOW.settleTime - 600, expected: /剩余营业时间不足/ },
    { hireSuccess: false, expected: /雇佣失败/ },
  ]) {
    const { expected, ...overrides } = options;
    const { service, calls } = setup({ inventory: [{ id: 1041, count: 1000 }], hireList: { wage_total: 130, friends: [employee(222, 9001)] }, ...overrides });
    await assert.rejects(service.operateMilkTea('hire', { autoSelect: true, durationId: 2 }), expected);
    if (overrides.hireSuccess !== false) assert.ok(!calls.some(x => Number(x.cmd) === 57));
  }
});
test('hire preferences retain numeric values through config patch and reload normalization', () => {
  const store = require('../src/models/store');
  const accountId = '__milk_tea_hire_preferences_test__';
  const options = { persist: false, accountId };
  store.applyConfigSnapshot({ automation: { milk_tea_hire_duration: '3', milk_tea_hire_talent: '9002' } }, options);
  // A second patch normalizes the previously stored snapshot as config loading does.
  const saved = store.applyConfigSnapshot({}, options).automation;
  assert.equal(saved.milk_tea_hire_duration, 3);
  assert.equal(saved.milk_tea_hire_talent, 9002);
  const invalid = store.applyConfigSnapshot({ automation: { milk_tea_hire_duration: 99, milk_tea_hire_talent: 'unknown' } }, options).automation;
  assert.equal(invalid.milk_tea_hire_duration, 1);
  assert.equal(invalid.milk_tea_hire_talent, 0);
});

test('milk tea logs localized outcomes, hire fallback and skips without dumping payloads', async () => {
  const { service, logs } = setup({ accountId: 'test-account-2', inventory: [{ id: 1041, count: 1000 }], hireList: { wage_total: 40, friends: [employee(222, 9002)] } });
  await service.operateMilkTea('hire', { autoSelect: true, talentId: 9001 });
  assert.match(logs[0][1], /雇佣员工完成.*好友.*金牌宣传.*4小时.*40.*已兜底/);
  assert.equal(logs[0][2].module, 'activity');
  assert.equal(logs[0][2].result, 'success');
  assert.equal(logs[0][2].accountId, 'test-account-2');
  assert.ok(!JSON.stringify(logs).includes('222'));
  const empty = setup({ hireList: { wage_total: 40 } });
  await empty.service.operateMilkTea('hire', { autoSelect: true });
  await empty.service.operateMilkTea('hire', { autoSelect: true });
  assert.equal(empty.logs.length, 1);
  assert.equal(empty.logs[0][2].result, 'skip');
  const rejected = setup({ hireList: { wage_total: 40, friends: [employee(222, 9001)] } });
  await assert.rejects(rejected.service.operateMilkTea('hire', { autoSelect: true }));
  assert.equal(rejected.logs[0][2].result, 'error');
  assert.match(rejected.logs[0][1], /奶茶券不足/);
});
