/**
 * 萌宠成长日记（S3）自动化层测试
 *
 * 覆盖：自动化开关的默认值 / 允许名单 / 活动窗口强制关闭，
 * 以及 runPetDiaryAutomation 的执行顺序与限额约束。
 * 全部使用夹具，不连真实服务端。
 */
const assert = require('node:assert');
const test = require('node:test');

const store = require('../src/models/store');

const PET_DIARY_KEYS = [
    'pet_diary_adopt',
    'pet_diary_feed',
    'pet_diary_draw',
    'pet_diary_story_claim',
    'pet_diary_seed_claim',
    'pet_diary_solar_claim',
    'pet_diary_treasure_open',
    'pet_diary_compensation_claim',
    'pet_diary_battle',
    'pet_diary_charm_equip',
];

// PET_DIARY_ACTIVITY_WINDOW 的两份字面量必须一致
const WINDOW_START = 1789005600;
const WINDOW_END = 1791820799;

// ---- 设置项契约 ----

test('萌宠自动化开关都有默认值且默认关闭', () => {
    const def = store.getDefaultAccountConfig();
    for (const key of PET_DIARY_KEYS) {
        assert.strictEqual(
            def.automation[key], false,
            `${key} 必须存在于 DEFAULT_AUTOMATION 且默认为 false`,
        );
    }
});

test('萌宠开关能通过配置边界的允许名单', () => {
    // ALLOWED_AUTOMATION_KEYS 由 DEFAULT_AUTOMATION 派生，
    // 缺默认值的键会在 normalizeAccountConfig 中被静默丢弃。
    store.applyConfigSnapshot(
        { automation: Object.fromEntries(PET_DIARY_KEYS.map(key => [key, true])) },
        { persist: false },
    );
    const automation = store.getAutomation();
    for (const key of PET_DIARY_KEYS) {
        assert.strictEqual(automation[key], true, `${key} 不应被允许名单丢弃`);
    }
});

test('前后端活动时间窗字面量一致', () => {
    // core/src/models/store.js 与 web/src/constants/activity-windows.ts 是手工同步的
    // 两份字面量。不一致会导致设置页显示后端已强制关闭的开关。
    const backend = require('node:fs')
        .readFileSync(require('node:path').join(__dirname, '../src/models/store.js'), 'utf8');
    assert.ok(
        backend.includes(`startTime: ${WINDOW_START}`) && backend.includes(`endTime: ${WINDOW_END}`),
        'store.js 中的萌宠活动窗口与预期不符',
    );

    const frontend = require('node:fs')
        .readFileSync(require('node:path').join(__dirname, '../../web/src/constants/activity-windows.ts'), 'utf8');
    assert.ok(
        frontend.includes(`${WINDOW_START} * 1000`) && frontend.includes(`${WINDOW_END} * 1000`),
        'activity-windows.ts 中的萌宠活动窗口与 store.js 不一致',
    );
});

// ---- worker 执行顺序与控制流回归 ----

function workerSource() {
    return require('node:fs')
        .readFileSync(require('node:path').join(__dirname, '../src/core/worker.js'), 'utf8');
}

test('雨落成诗活动结束不得 return 掉后续活动', () => {
    // 原实现是 `if (rainPoem?.active === false) return;`。萌宠日记排在最后，
    // 一旦雨落成诗结束就永远不会执行，且没有任何日志线索。
    const source = workerSource();
    assert.ok(
        !/if \(rainPoem\?\.active === false\) return;/.test(source),
        '雨落成诗的活动结束判定不得用裸 return，否则会跳过后面所有活动',
    );
    assert.ok(
        source.includes('if (rainPoem?.active !== false) {'),
        '应改为只包住雨落成诗自身的代码块',
    );
});

test('选锦囊必须排在投喂之后', () => {
    // canChoose 要求 stage 2（已成年），而成年靠投喂累积 7000 成长值换来。
    // 若选锦囊排在投喂前，刚成年的那一轮永远选不到锦囊，要等下一次轮询。
    const source = workerSource();
    const feedIndex = source.indexOf("'投喂', () => true, 'feed'");
    const charmIndex = source.indexOf("'选择锦囊'");
    assert.ok(feedIndex > 0, '未找到投喂步骤');
    assert.ok(charmIndex > 0, '未找到选锦囊步骤');
    assert.ok(charmIndex > feedIndex, '选锦囊必须排在投喂之后');
});

test('比熊只在成年且活动奖励已领取后进入宠物激活', () => {
    const source = workerSource();
    const claimIndex = source.indexOf("'领取比熊'");
    const activateIndex = source.indexOf('activateBichonIfEligible');
    assert.ok(claimIndex > 0 && activateIndex > claimIndex, '宠物激活必须排在活动领取之后');
    const activationBlock = source.slice(activateIndex - 500, activateIndex + 100);
    assert.ok(activationBlock.includes('pet.nurture?.adult === true'), '激活必须要求比熊成年');
    assert.ok(activationBlock.includes('pet.nurture?.dogGranted === true'), '激活必须要求活动奖励已领取');
});

test('宝藏判定用服务器时钟而非快照时间戳', () => {
    // pet.serverTime 是快照抓取时刻，一轮跑下来可能已过去几分钟，
    // 只会偏小，导致中途成熟的宝藏被漏掉、精准唤醒算得偏晚。
    const source = workerSource();
    const fn = source.slice(
        source.indexOf('async function runPetDiaryAutomation'),
        source.indexOf('async function runStarActivityAutoClaims'),
    );
    assert.ok(fn.includes('getServerTimeSec'), '应使用漂移校正后的服务器时钟');
    assert.ok(
        !fn.includes('Number(pet.serverTime'),
        '不得用快照里的 pet.serverTime 做时间判定',
    );
});

test('锦囊自动化只选不刷新，不消耗任何货币', () => {
    // 免费刷新每日仅 1 次，池内锦囊均为正向效果，盲目重摇再取 pool[0] 期望收益为零。
    // 且 refreshCharm 走点券路径需要 expectedPaidRefreshCount，自动化绝不应触碰。
    const source = workerSource();
    const fn = source.slice(
        source.indexOf('async function runPetDiaryAutomation'),
        source.indexOf('async function runStarActivityAutoClaims'),
    );
    assert.ok(!fn.includes("'refreshCharm'"), '自动化不应调用 refreshCharm');
    assert.ok(!fn.includes('tickets'), '自动化不应出现点券支付路径');
    assert.ok(!fn.includes('allowDiamonds'), '自动化不应出现钻石路径');
});

test('step 的前置判定在 try 内，异常不得逃出', () => {
    const source = workerSource();
    const stepStart = source.indexOf('const step = async (enabled, event, ready, action');
    assert.ok(stepStart > 0, '未找到 step 定义');
    const body = source.slice(stepStart, stepStart + 260);
    assert.ok(
        body.indexOf('try {') < body.indexOf('!ready()'),
        'ready() 必须在 try 内，否则异常会逃出并跳过其余全部活动自动化',
    );
});

test('活动窗口内为 UTC+8 的整点起 / 当日 23:59:59 止', () => {
    // 日限重置与定时唤醒都依赖服务器时区判断，这里锁定窗口的本地语义。
    const startLocal = new Date((WINDOW_START + 8 * 3600) * 1000).toISOString();
    const endLocal = new Date((WINDOW_END + 8 * 3600) * 1000).toISOString();
    assert.ok(startLocal.endsWith('T10:00:00.000Z'), `起始时间 UTC+8 应为整点，实际 ${startLocal}`);
    assert.ok(endLocal.endsWith('T23:59:59.000Z'), `结束时间 UTC+8 应为当日末秒，实际 ${endLocal}`);
});


test('夺宝开关在活动开始前和结束后强制关闭，边界有效', () => {
    for (const [now, expected] of [[WINDOW_START - 1, false], [WINDOW_START, true],
        [WINDOW_END, true], [WINDOW_END + 1, false]]) {
        const automation = { pet_diary_battle: true };
        store._test.disableHiddenActivityAutomation(automation, now);
        assert.strictEqual(automation.pet_diary_battle, expected);
    }
});
