const axios = require('axios');

let pushoo = null;
try {
  pushoo = require('pushoo').default;
} catch {
  pushoo = null;
}

function assertRequiredText(name, value) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${name} 不能为空`);
  return text;
}

function firstText(raw, keys) {
  if (!raw || typeof raw !== 'object') return '';
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return '';
}

function flattenValues(input, depth = 0, output = []) {
  if (depth > 3 || input === undefined || input === null) return output;
  if (typeof input !== 'object') {
    output.push(String(input));
    return output;
  }
  if (Array.isArray(input)) {
    for (const item of input) flattenValues(item, depth + 1, output);
    return output;
  }
  for (const value of Object.values(input)) flattenValues(value, depth + 1, output);
  return output;
}

function parsePushResult(result) {
  const raw = result && typeof result === 'object' ? result : { data: result };
  const status = String(raw.status || raw.Status || '').toLowerCase();
  const codeValue = raw.code ?? raw.errcode ?? raw.errCode ?? raw.retcode ?? raw.errorCode ?? raw.statusCode;
  const code = codeValue === undefined || codeValue === null ? '' : String(codeValue);
  const msg = firstText(raw, ['msg', 'message', 'errmsg', 'errMsg', 'error_description', 'description'])
    || (raw.error && typeof raw.error === 'object' ? firstText(raw.error, ['message', 'msg', 'errmsg']) : '')
    || (typeof result === 'string' ? result : '');

  const valuesText = flattenValues(raw).join(' ');
  const successText = /成功|执行成功|发送成功|ok|success|delivered successfully/i.test(`${msg} ${valuesText}`);
  const failureText = /失败|错误|error|fail|invalid|unauthorized|forbidden|denied/i.test(`${msg} ${status}`);
  const explicitError = !!raw.error || status === 'error' || status === 'failed' || raw.ok === false || raw.success === false;
  const successFlag = raw.ok === true || raw.success === true || raw.result === 'success';
  const successCode = code === '' || code === '0' || code === 'ok' || code === 'success' || code === '200' || code === '204';
  const ok = !explicitError && !failureText && (successFlag || successCode || successText || status === 'success');

  return {
    ok,
    code: code || (ok ? 'ok' : 'error'),
    msg: msg || (ok ? '发送成功' : '发送失败'),
    raw,
  };
}

/**
 * 通过 pushoo 发送 Qmsg 酱或 Bark 通知。
 * @param {object} payload
 * @param {string} payload.token
 * @param {string} payload.title
 * @param {string} payload.content
 * @returns {Promise<{ ok: boolean, code: string, msg: string, raw: object }>} Push result.
 */
async function sendPushooMessage(payload = {}) {
  if (!pushoo) {
    throw new Error('缺少 pushoo 依赖，请在 core 目录执行 npm install');
  }

  const channel = assertRequiredText('推送渠道', payload.channel).toLowerCase();
  if (!['qmsg', 'bark'].includes(channel)) throw new Error('仅支持 Qmsg 酱或 Bark 推送');
  const token = assertRequiredText(channel === 'bark' ? 'Bark Key 或服务器 URL' : 'Qmsg 酱 Key', payload.token);
  const title = assertRequiredText('推送标题', payload.title);
  const content = assertRequiredText('推送内容', payload.content);

  const result = await pushoo(channel, { token, title, content });
  return parsePushResult(result);
}

/**
 * Send a plain-text notification through WxPusher's Simple Push Token API.
 * @param {object} payload
 * @param {string} payload.token
 * @param {string} payload.title
 * @param {string} payload.content
 * @returns {Promise<{ ok: boolean, code: string, msg: string, raw: object }>} Push result.
 */
async function sendWxPusherMessage(payload = {}, post = axios.post) {
  const spt = assertRequiredText('WxPusher SPT', payload.token);
  if (!spt.startsWith('SPT_')) throw new Error('WxPusher SPT 必须以 SPT_ 开头');
  const title = assertRequiredText('推送标题', payload.title);
  const content = assertRequiredText('推送内容', payload.content);
  const response = await post('https://wxpusher.zjiecode.com/api/send/message/simple-push', {
    spt,
    content,
    summary: title.slice(0, 100),
    contentType: 1,
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  const raw = response && response.data;
  const code = raw && raw.code !== undefined ? String(raw.code) : '';
  const ok = code === '1000';
  return {
    ok,
    code: code || 'error',
    msg: String(raw && (raw.msg || raw.message) || (ok ? '发送成功' : 'WxPusher 消息发送失败')),
    raw,
  };
}

/**
 * Send a notification through WxPusher's standard API to one subscribed UID.
 * @param {object} payload
 * @param {string} payload.token WxPusher application token.
 * @param {string} payload.wxPusherUid Subscribed recipient UID.
 * @param {string} payload.title
 * @param {string} payload.content
 * @returns {Promise<{ ok: boolean, code: string, msg: string, raw: object }>} Push result.
 */
async function sendWxPusherWechatMessage(payload = {}, post = axios.post) {
  const appToken = assertRequiredText('WxPusher AppToken', payload.token);
  const uid = assertRequiredText('WxPusher 接收者 UID', payload.wxPusherUid);
  const title = assertRequiredText('推送标题', payload.title);
  const content = assertRequiredText('推送内容', payload.content);
  const response = await post('https://wxpusher.zjiecode.com/api/send/message', {
    appToken,
    uids: [uid],
    content,
    summary: title.slice(0, 100),
    contentType: 1,
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  const raw = response && response.data;
  const code = raw && raw.code !== undefined ? String(raw.code) : '';
  const ok = code === '1000';
  return {
    ok,
    code: code || 'error',
    msg: String(raw && (raw.msg || raw.message) || (ok ? '发送成功' : 'WxPusher 微信消息发送失败')),
    raw,
  };
}

module.exports = {
  sendPushooMessage,
  sendWxPusherMessage,
  sendWxPusherWechatMessage,
};
