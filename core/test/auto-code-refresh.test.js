const test = require('node:test');
const assert = require('node:assert/strict');

const { createAutoCodeRefreshService } = require('../src/runtime/auto-code-refresh');

function createService(account, logs) {
  return createAutoCodeRefreshService({
    store: {
      getAutoCodeRefresh: () => ({ enabled: false, intervalMinutes: 60 }),
    },
    getAccounts: () => ({ accounts: [account] }),
    addOrUpdateAccount: () => {},
    resolveWorkerControls: () => ({}),
    log: (...args) => logs.push(args),
    addAccountLog: () => {},
  });
}

test('QQ accounts do not emit a missing wxid warning during Code refresh scheduling', () => {
  const logs = [];
  const service = createService({ id: 'qq-1', name: 'QQ account', platform: 'qq' }, logs);

  service.scheduleAccount('qq-1');

  assert.deepEqual(logs, []);
});

test('WeChat accounts still report a missing wxid during Code refresh scheduling', () => {
  const logs = [];
  const service = createService({ id: 'wx-1', name: 'WeChat account', platform: 'wx' }, logs);

  service.scheduleAccount('wx-1');

  assert.equal(logs.length, 1);
  assert.equal(logs[0][1], '自动刷新 Code 未启动: 账号缺少 wxid');
});

test('all WeChat accounts use the same global refresh interval', () => {
  const logs = [];
  const accountIds = [];
  const accounts = [
    { id: 'wx-1', name: 'WeChat one', platform: 'wx', wxid: 'wxid-1' },
    { id: 'wx-2', name: 'WeChat two', platform: 'wx', wxid: 'wxid-2' },
  ];
  const service = createAutoCodeRefreshService({
    store: {
      getAutoCodeRefresh: (...args) => {
        accountIds.push(args);
        return { enabled: true, intervalMinutes: 2, maxRetries: 100 };
      },
    },
    getAccounts: () => ({ accounts }),
    addOrUpdateAccount: () => {},
    resolveWorkerControls: () => ({}),
    log: (...args) => logs.push(args),
    addAccountLog: () => {},
  });

  service.scheduleAccount('wx-1');
  service.scheduleAccount('wx-2');
  service.stopAccount('wx-1');
  service.stopAccount('wx-2');

  assert.deepEqual(accountIds, [[], []]);
  assert.equal(logs.length, 2);
  assert.match(logs[0][1], /间隔 2 分钟/);
  assert.match(logs[1][1], /间隔 2 分钟/);
});
