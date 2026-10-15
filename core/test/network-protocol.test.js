const assert = require('node:assert/strict');
const test = require('node:test');

const { DEFAULT_CLIENT_VERSION, resolveClientVersion } = require('../src/config/config');
const { loadProto } = require('../src/utils/proto');
const { buildHeartbeatBody, buildLoginBody } = require('../src/utils/network');

const OFFICIAL_LOGIN_BODY =
  '180022002a1c0a11312e31342e302e345f3230323630393131120757696e646f777330003a0731323334353637'
  + '42180a0012001a0022002a086f746865722d717130023a0042004a00';
const OFFICIAL_HEARTBEAT_BODY = '08f9d6ffc5041211312e31342e302e345f32303236303931311800';

test.before(async () => loadProto());

test('default client protocol is upgraded without replacing custom versions', () => {
  assert.equal(DEFAULT_CLIENT_VERSION, '1.14.0.4_20260911');
  assert.equal(resolveClientVersion('1.13.0.5_20260723'), DEFAULT_CLIENT_VERSION);
  assert.equal(resolveClientVersion('1.13.2.9_20260723'), DEFAULT_CLIENT_VERSION);
  assert.equal(resolveClientVersion('1.15.0.2_20261001'), '1.15.0.2_20261001');
  assert.equal(resolveClientVersion('custom-build'), 'custom-build');
});

test('default login request reproduces the 1.14.0.4 official capture', () => {
  assert.equal(buildLoginBody().toString('hex'), OFFICIAL_LOGIN_BODY);
});

test('custom device protocol keeps its explicit fingerprint fields', () => {
  const body = buildLoginBody({
    enabled: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14)',
    deviceBrand: 'Xiaomi',
    deviceModel: 'Xiaomi 14 Ultra',
    deviceId: 'device-14-ultra',
  });
  assert.notEqual(body.toString('hex'), OFFICIAL_LOGIN_BODY);
});

test('heartbeat request reproduces the official capture', () => {
  assert.equal(buildHeartbeatBody(1220537209).toString('hex'), OFFICIAL_HEARTBEAT_BODY);
});
