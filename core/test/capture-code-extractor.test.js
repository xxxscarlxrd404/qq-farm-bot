const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractLoginInfo,
  extractQuery,
  isCaptureHost,
  isValidCode,
  matchesHostPattern,
  parseHttpHead,
  scanJsonBody,
} = require('../src/capture/code-extractor');

const DEFAULT_CONFIG = {
  captureHosts: ['*.nqf.qq.com', 'q.qq.com', '*.qzone.qq.com'],
  gatewayHosts: ['*.nqf.qq.com'],
};

test('parseHttpHead parses request line and headers', () => {
  const head = Buffer.from(
    'GET /prod/ws?code=ABC123 HTTP/1.1\r\nHost: gate-obt.nqf.qq.com\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
  );
  const parsed = parseHttpHead(head);
  assert.equal(parsed.method, 'GET');
  assert.equal(parsed.target, '/prod/ws?code=ABC123');
  assert.equal(parsed.headers.host, 'gate-obt.nqf.qq.com');
  assert.equal(parsed.isUpgrade, true);
});

test('parseHttpHead returns null for empty input', () => {
  assert.equal(parseHttpHead(Buffer.alloc(0)), null);
  assert.equal(parseHttpHead(null), null);
});

test('extractQuery parses code and openID with URL decoding', () => {
  const params = extractQuery('/prod/ws?platform=qq&code=a%2Bb&openID=open-id-1&code=second');
  assert.equal(params.get('code'), 'a+b');
  assert.equal(params.get('openID'), 'open-id-1');
});

test('matchesHostPattern supports wildcard domains', () => {
  assert.equal(matchesHostPattern('gate-obt.nqf.qq.com', '*.nqf.qq.com'), true);
  assert.equal(matchesHostPattern('cdn-resource.nqf.qq.com', '*.nqf.qq.com'), true);
  assert.equal(matchesHostPattern('nqf.qq.com', '*.nqf.qq.com'), true);
  assert.equal(matchesHostPattern('qq.com', '*.nqf.qq.com'), false);
  assert.equal(matchesHostPattern('gate.nqf.qq.com.evil.com', '*.nqf.qq.com'), false);
  assert.equal(matchesHostPattern('q.qq.com', 'q.qq.com'), true);
});

test('isCaptureHost checks configured patterns', () => {
  assert.equal(isCaptureHost('gate-obt.nqf.qq.com', DEFAULT_CONFIG), true);
  assert.equal(isCaptureHost('q.qq.com', DEFAULT_CONFIG), true);
  assert.equal(isCaptureHost('api.baidu.com', DEFAULT_CONFIG), false);
});

test('extractLoginInfo extracts code from gateway websocket url', () => {
  const head = Buffer.from(
    `GET /prod/ws?platform=qq&os=ios&ver=1&code=LOGIN-CODE-1234567890&openID=openid-1 HTTP/1.1\r\n`
    + `Host: gate-obt.nqf.qq.com\r\nUpgrade: websocket\r\n\r\n`,
  );
  const info = extractLoginInfo({ host: 'gate-obt.nqf.qq.com', head, config: DEFAULT_CONFIG });
  assert.equal(info.code, 'LOGIN-CODE-1234567890');
  assert.equal(info.openId, 'openid-1');
  assert.equal(info.matched, true);
});

test('extractLoginInfo rejects short codes on non-gateway hosts', () => {
  const head = Buffer.from(
    'GET /api/session?code=abc HTTP/1.1\r\nHost: q.qq.com\r\n\r\n',
  );
  const info = extractLoginInfo({ host: 'q.qq.com', head, config: DEFAULT_CONFIG });
  assert.equal(info.code, '');
  assert.equal(info.matched, false);
});

test('extractLoginInfo accepts long codes on non-gateway hosts', () => {
  const head = Buffer.from(
    'GET /api/login?code=0123456789abcdefghijklmnopqrstuv HTTP/1.1\r\nHost: q.qq.com\r\n\r\n',
  );
  const info = extractLoginInfo({ host: 'q.qq.com', head, config: DEFAULT_CONFIG });
  assert.equal(info.code, '0123456789abcdefghijklmnopqrstuv');
});

test('extractLoginInfo accepts short codes on websocket upgrade', () => {
  const head = Buffer.from(
    'GET /ws?code=SHORT HTTP/1.1\r\nHost: q.qq.com\r\nUpgrade: websocket\r\n\r\n',
  );
  const info = extractLoginInfo({ host: 'q.qq.com', head, config: DEFAULT_CONFIG });
  assert.equal(info.code, 'SHORT');
});

test('extractLoginInfo scans JSON request body for code/openid', () => {
  const head = Buffer.from('POST /api/login HTTP/1.1\r\nHost: q.qq.com\r\nContent-Type: application/json\r\n\r\n');
  const body = Buffer.from(JSON.stringify({ code: 'BODY-CODE-0123456789abcdef', openid: 'openid-body' }));
  const info = extractLoginInfo({ host: 'q.qq.com', head, body, config: DEFAULT_CONFIG });
  assert.equal(info.code, 'BODY-CODE-0123456789abcdef');
  assert.equal(info.openId, 'openid-body');
});

test('isValidCode filters noise values', () => {
  assert.equal(isValidCode('0', {}), false);
  assert.equal(isValidCode('true', {}), false);
  assert.equal(isValidCode('', {}), false);
  assert.equal(isValidCode('abc', {}), false);
  assert.equal(isValidCode('abcd', { isUpgrade: true }), true);
  assert.equal(isValidCode('abcd', { gatewayHost: true }), true);
  assert.equal(isValidCode('0123456789abcdef', {}), true);
});

test('scanJsonBody finds nested code fields', () => {
  const result = scanJsonBody(JSON.stringify({ data: { nested: { code: 'nested-code', open_id: 'nested-openid' } } }));
  assert.equal(result.code, 'nested-code');
  assert.equal(result.openId, 'nested-openid');
});
