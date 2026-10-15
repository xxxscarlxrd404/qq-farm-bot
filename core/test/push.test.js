const test = require('node:test');
const assert = require('node:assert/strict');

const { sendPushooMessage, sendWxPusherMessage, sendWxPusherWechatMessage } = require('../src/services/push');
const { createReloginReminderService } = require('../src/runtime/relogin-reminder');

test('WxPusher SPT sends through the simple-push API and recognizes success', async () => {
  let request;
  const result = await sendWxPusherMessage({
    token: 'SPT_test',
    title: '账号下线提醒',
    content: '测试账号已下线',
  }, async (...args) => {
    request = args;
    return { data: { code: 1000, msg: '成功' } };
  });

  assert.equal(request[0], 'https://wxpusher.zjiecode.com/api/send/message/simple-push');
  assert.deepEqual(request[1], {
    spt: 'SPT_test',
    content: '测试账号已下线',
    summary: '账号下线提醒',
    contentType: 1,
  });
  assert.equal(result.ok, true);
});

test('WxPusher SPT rejects non-SPT tokens and returns API errors', async () => {
  let requestCount = 0;
  const post = async () => {
    requestCount += 1;
    return { data: { code: 1001, msg: '参数错误' } };
  };

  await assert.rejects(
    sendWxPusherMessage({ token: 'AT_test', title: '标题', content: '内容' }, post),
    /必须以 SPT_ 开头/,
  );
  assert.equal(requestCount, 0);

  const result = await sendWxPusherMessage({
    token: 'SPT_test',
    title: '标题',
    content: '内容',
  }, post);
  assert.equal(result.ok, false);
  assert.equal(result.code, '1001');
  assert.equal(result.msg, '参数错误');
});

test('WxPusher standard API sends to a UID without requiring topic IDs', async () => {
  let request;
  const result = await sendWxPusherWechatMessage({
    token: 'AT_test',
    wxPusherUid: 'UID_test',
    title: '账号下线提醒',
    content: '测试账号已下线',
  }, async (...args) => {
    request = args;
    return { data: { code: 1000, msg: '发送成功' } };
  });

  assert.equal(request[0], 'https://wxpusher.zjiecode.com/api/send/message');
  assert.deepEqual(request[1], {
    appToken: 'AT_test',
    uids: ['UID_test'],
    content: '测试账号已下线',
    summary: '账号下线提醒',
    contentType: 1,
  });
  assert.equal('topicIds' in request[1], false);
  assert.equal(result.ok, true);
});

test('WxPusher standard API requires a subscribed recipient UID', async () => {
  let requestCount = 0;
  await assert.rejects(
    sendWxPusherWechatMessage({ token: 'AT_test', title: '标题', content: '内容' }, async () => {
      requestCount += 1;
      return { data: { code: 1000 } };
    }),
    /接收者 UID 不能为空/,
  );
  assert.equal(requestCount, 0);
});

test('Qmsg path rejects unrelated providers', async () => {
  await assert.rejects(
    sendPushooMessage({
      channel: 'smtp',
      token: 'unused',
      title: '标题',
      content: '内容',
    }),
    /仅支持 Qmsg 酱或 Bark 推送/,
  );
});

test('offline reminders route WxPusher SPT notifications', async () => {
  const sent = [];
  let requestedAccountId = '';
  const service = createReloginReminderService({
    store: {
      getOfflineReminder: (accountId) => {
        requestedAccountId = accountId;
        return {
          channel: 'wxpusher',
          token: 'SPT_test',
          title: '下线提醒',
          msg: '账号掉线',
        };
      },
    },
    miniProgramLoginSession: null,
    sendPushooMessage: async () => {
      throw new Error('Qmsg should not be selected');
    },
    sendWxPusherMessage: async payload => {
      sent.push(payload);
      return { ok: true, msg: '成功' };
    },
    log: () => {},
    addAccountLog: () => {},
    getAccounts: () => ({ accounts: [{ id: 'a1', username: 'owner' }] }),
    addOrUpdateAccount: () => {},
    resolveWorkerControls: () => ({}),
  });

  await service.triggerOfflineReminder({
    accountId: 'a1',
    accountName: '测试账号',
    username: 'owner',
    reason: 'ws_400',
  });

  assert.equal(sent.length, 1);
  assert.equal(requestedAccountId, 'a1');
  assert.equal(sent[0].channel, 'wxpusher');
  assert.equal(sent[0].token, 'SPT_test');
  assert.match(sent[0].content, /原因: ws_400/);
});

test('offline reminders route standard WxPusher notifications to the configured UID', async () => {
  const sent = [];
  const service = createReloginReminderService({
    store: {
      getOfflineReminder: () => ({
        channel: 'wxpusher_wechat',
        token: 'AT_test',
        wxPusherUid: 'UID_test',
        title: '下线提醒',
        msg: '账号掉线',
      }),
    },
    miniProgramLoginSession: null,
    sendPushooMessage: async () => {
      throw new Error('Qmsg/Bark should not be selected');
    },
    sendWxPusherMessage: async () => {
      throw new Error('SPT should not be selected');
    },
    sendWxPusherWechatMessage: async payload => {
      sent.push(payload);
      return { ok: true, msg: '成功' };
    },
    log: () => {},
    addAccountLog: () => {},
    getAccounts: () => ({ accounts: [] }),
    addOrUpdateAccount: () => {},
    resolveWorkerControls: () => ({}),
  });

  await service.triggerOfflineReminder({ accountId: 'a1', accountName: '测试账号' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].token, 'AT_test');
  assert.equal(sent[0].wxPusherUid, 'UID_test');
});

test('offline reminders retain Qmsg support', async () => {
  const sent = [];
  const service = createReloginReminderService({
    store: {
      getOfflineReminder: () => ({
        channel: 'qmsg',
        token: 'qmsg-key',
        title: '下线提醒',
        msg: '账号掉线',
      }),
    },
    miniProgramLoginSession: null,
    sendPushooMessage: async payload => {
      sent.push(payload);
      return { ok: true, msg: '成功' };
    },
    log: () => {},
    addAccountLog: () => {},
    getAccounts: () => ({ accounts: [] }),
    addOrUpdateAccount: () => {},
    resolveWorkerControls: () => ({}),
  });

  await service.triggerOfflineReminder({ accountId: 'a1', accountName: '测试账号' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'qmsg');
  assert.equal(sent[0].token, 'qmsg-key');
});

test('offline reminders route Bark notifications through pushoo', async () => {
  const sent = [];
  const service = createReloginReminderService({
    store: {
      getOfflineReminder: () => ({
        channel: 'bark',
        token: 'https://api.day.app/bark-device-key/',
        title: '下线提醒',
        msg: '账号掉线',
      }),
    },
    miniProgramLoginSession: null,
    sendPushooMessage: async payload => {
      sent.push(payload);
      return { ok: true, msg: '成功' };
    },
    sendWxPusherMessage: async () => {
      throw new Error('WxPusher should not be selected');
    },
    log: () => {},
    addAccountLog: () => {},
    getAccounts: () => ({ accounts: [] }),
    addOrUpdateAccount: () => {},
    resolveWorkerControls: () => ({}),
  });

  await service.triggerOfflineReminder({ accountId: 'a1', accountName: '测试账号' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'bark');
  assert.equal(sent[0].token, 'https://api.day.app/bark-device-key/');
  assert.match(sent[0].content, /账号掉线/);
});
