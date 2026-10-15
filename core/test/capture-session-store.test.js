const test = require('node:test');
const assert = require('node:assert/strict');

const { createSessionStore } = require('../src/capture/session-store');

const config = { autoStopSec: 900, sessionTtlMs: 3600_000 };

test('createSession initializes empty state', () => {
  const store = createSessionStore({ config });
  const session = store.createSession('s1', 'qq');
  assert.equal(session.platform, 'qq');
  assert.equal(session.code, '');
  assert.equal(session.friendGids.size, 0);
  assert.equal(session.proxy.running, false);
  assert.ok(session.publicInfo.mitmProxyAutoStopSec > 0);
});

test('addCode stores only the first non-empty code', () => {
  const store = createSessionStore({ config });
  const session = store.createSession('s1', 'qq');
  store.addCode(session, { code: 'code-1', openId: 'open-1' });
  store.addCode(session, { code: 'code-2', openId: 'open-2' });
  assert.equal(session.code, 'code-1');
  assert.equal(session.openId, 'open-1');
});

test('addFriendGids deduplicates and marks complete', () => {
  const store = createSessionStore({ config });
  const session = store.createSession('s1', 'qq');
  store.addFriendGids(session, { gids: [10001, 10002, 10001], source: 'A', complete: false });
  store.addFriendGids(session, { gids: [10003], source: 'B', complete: true });
  assert.deepEqual([...session.friendGids], [10001, 10002, 10003]);
  assert.equal(session.friendListComplete, true);
  assert.equal(session.friendSource, 'B');
});

test('buildSnapshot exposes bot-contract shape', () => {
  const store = createSessionStore({ config });
  const session = store.createSession('s1', 'qq');
  store.setProxyInfo(session, {
    port: 19000,
    startedAt: new Date().toISOString(),
    host: '100.64.0.2',
    addresses: [{ address: '100.64.0.2', kind: 'tailscale' }],
    running: true,
    status: 'running',
    autoStopSec: 900,
  });
  store.addCode(session, { code: 'login-code', openId: 'open-1' });
  store.addFriendGids(session, { gids: [10001], source: 'gamepb.friendpb.FriendService.GetAll', complete: true });

  const snapshot = store.buildSnapshot(session);
  assert.equal(snapshot.channels.qq.status, 'captured');
  assert.equal(snapshot.channels.qq.codes[0].code, 'login-code');
  assert.equal(snapshot.channels.qq.codes[0].openid, 'open-1');
  assert.deepEqual(snapshot.friends.items, [{ gid: '10001' }]);
  assert.equal(snapshot.friends.complete, true);
  assert.equal(snapshot.publicInfo.host, '100.64.0.2');
  assert.equal(snapshot.publicInfo.addresses[0].kind, 'tailscale');
  assert.equal(snapshot.proxy.running, true);
});

test('setProxyError surfaces the error in snapshot', () => {
  const store = createSessionStore({ config });
  const session = store.createSession('s1', 'qq');
  store.setProxyError(session, '证书签发失败');
  const snapshot = store.buildSnapshot(session);
  assert.equal(snapshot.proxy.status, 'error');
  assert.equal(snapshot.proxy.error, '证书签发失败');
});

test('cleanupExpired removes stale sessions', () => {
  const store = createSessionStore({ config: { ...config, sessionTtlMs: 1000 } });
  const session = store.createSession('s1', 'qq');
  session.updatedAt = Date.now() - 5000;
  store.cleanupExpired();
  assert.equal(store.getSession('s1'), null);
});
