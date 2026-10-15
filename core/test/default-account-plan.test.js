const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-default-plan-'));
process.env.FARM_DATA_DIR = dataDir;

const store = require('../src/models/store');

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('default plans preserve selected account and automation settings only', () => {
  const plan = store.setUserDefaultAccountPlan('alice', {
    plantingStrategy: 'max_profit',
    automation: { farm: true, friend: true, friend_auto_accept: false },
    intervals: { farmMin: 7, farmMax: 9 },
    friendBlacklist: [10001],
    knownFriendGids: [10002],
    goldenBugKeepCount: 5,
    goldenBugRoundLimit: 12,
    offlineReminder: { token: 'secret' },
  });

  assert.equal(plan.exists, true);
  assert.equal(plan.enabled, true);
  assert.equal(plan.config.plantingStrategy, 'max_profit');
  assert.equal(plan.config.automation.farm, true);
  assert.equal(plan.config.automation.friend_auto_accept, false);
  assert.equal(plan.config.intervals.farmMin, 7);
  assert.equal(plan.config.goldenBugKeepCount, 5);
  assert.equal(plan.config.goldenBugRoundLimit, 12);
  assert.equal('friendBlacklist' in plan.config, false);
  assert.equal('knownFriendGids' in plan.config, false);
  assert.equal('offlineReminder' in plan.config, false);
  assert.equal('autoCodeRefresh' in plan.config, false);
});

test('auto Code refresh uses one global setting with bounded retries', () => {
  assert.deepEqual(store.getAutoCodeRefresh(), {
    enabled: true,
    intervalMinutes: 2,
    maxRetries: 8,
  });

  const saved = store.setAutoCodeRefresh({
    enabled: true,
    intervalMinutes: 5,
    maxRetries: 150,
  });
  assert.deepEqual(saved, {
    enabled: true,
    intervalMinutes: 5,
    maxRetries: 100,
  });
  assert.equal('autoCodeRefresh' in store.getConfigSnapshot('account-1'), false);
  assert.deepEqual(store.getAutoCodeRefresh('account-1'), saved);
  assert.deepEqual(store.getAutoCodeRefresh('account-2'), saved);
});

test('offline reminders are isolated by account and retain credentials per channel', () => {
  store.setOfflineReminder({
    channel: 'qmsg',
    channelCredentials: {
      qmsg: { token: 'qmsg-key', wxPusherUid: '' },
      wxpusher: { token: '', wxPusherUid: '' },
      wxpusher_wechat: { token: '', wxPusherUid: '' },
      bark: { token: '', wxPusherUid: '' },
    },
  }, 'account-1');
  store.setOfflineReminder({
    channel: 'wxpusher',
    channelCredentials: {
      qmsg: { token: 'qmsg-key', wxPusherUid: '' },
      wxpusher: { token: 'SPT_account_1', wxPusherUid: '' },
      wxpusher_wechat: { token: '', wxPusherUid: '' },
      bark: { token: '', wxPusherUid: '' },
    },
  }, 'account-1');

  const accountOne = store.getOfflineReminder('account-1');
  const accountTwo = store.getOfflineReminder('account-2');
  assert.equal(accountOne.channel, 'wxpusher');
  assert.equal(accountOne.channelCredentials.qmsg.token, 'qmsg-key');
  assert.equal(accountOne.channelCredentials.wxpusher.token, 'SPT_account_1');
  assert.equal(accountTwo.channel, 'qmsg');
  assert.equal(accountTwo.channelCredentials.qmsg.token, '');
});

test('new accounts inherit an enabled user default plan', () => {
  const accounts = store.addOrUpdateAccount({
    name: 'Alice farm',
    username: 'alice',
    code: 'code-1',
  });
  const created = accounts.accounts.at(-1);
  const config = store.getConfigSnapshot(created.id);

  assert.equal(created.platform, 'wx');
  assert.equal(config.plantingStrategy, 'max_profit');
  assert.equal(config.automation.farm, true);
  assert.equal(config.automation.friend_auto_accept, false);
  assert.equal(config.intervals.farmMin, 7);
  assert.equal(config.goldenBugKeepCount, 5);
  assert.equal(config.goldenBugRoundLimit, 12);
});

test('saving an existing default plan overwrites it on disk', () => {
  const before = store.getUserDefaultAccountPlan('alice');
  const saved = store.setUserDefaultAccountPlan('alice', {
    ...before.config,
    plantingStrategy: 'level',
    automation: { ...before.config.automation, farm: false, task: true },
  });

  const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8'));
  assert.equal(saved.config.plantingStrategy, 'level');
  assert.equal(saved.config.automation.farm, false);
  assert.equal(saved.config.automation.task, true);
  assert.equal(persisted.userDefaultAccountPlans.alice.config.plantingStrategy, 'level');
  assert.equal(persisted.userDefaultAccountPlans.alice.config.automation.farm, false);
  assert.equal(persisted.userDefaultAccountPlans.alice.config.automation.task, true);
});

test('disabled plans do not change new account defaults', () => {
  store.setUserDefaultAccountPlan('bob', {
    plantingStrategy: 'max_profit',
    automation: { farm: true },
  }, { enabled: false });

  const accounts = store.addOrUpdateAccount({
    name: 'Bob farm',
    username: 'bob',
    code: 'code-2',
  });
  const created = accounts.accounts.at(-1);
  const config = store.getConfigSnapshot(created.id);
  const defaults = store.getDefaultAccountConfig();

  assert.equal(config.plantingStrategy, defaults.plantingStrategy);
  assert.equal(config.automation.farm, defaults.automation.farm);
});

test('a saved plan can be applied to an existing account', () => {
  store.setUserDefaultAccountPlan('bob', {
    plantingStrategy: 'level',
    automation: { task: true },
  });
  const account = store.getAccountsByUser('bob').accounts[0];
  const config = store.applyUserDefaultAccountPlan('bob', account.id);

  assert.equal(config.plantingStrategy, 'level');
  assert.equal(config.automation.task, true);
});
