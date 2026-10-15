
/**
 * 自动检测并完成成长任务中的【购买种子】任务（不做种植，只做购买）
 */
async function checkAndExecuteGrowthBuySeedTasks() {
  if (!isAutomationOn('task') || !isConnected()) return;

  try {
    const reply = await getTaskInfo();
    const taskInfo = reply && reply.task_info ? reply.task_info : {};
    const growthTasks = buildGrowthTasks(taskInfo);

    // 寻找未完成、已解锁且未领取的成长任务
    for (const t of growthTasks) {
      if (!t.is_unlocked || t.is_claimed) continue;
      const progress = Math.max(0, toNum(t.progress));
      const total = Math.max(0, toNum(t.total_progress));
      if (total <= 0 || progress >= total) continue;

      const desc = String(t.desc || '');
      // 正则匹配：例如 "购买6个胡萝卜种子" 或 "购买 6 个 胡萝卜 种子"
      const match = desc.match(/购买\s*(\d+)\s*个\s*([^种子\s]+)/);
      if (!match) continue;

      const targetCount = Number(match[1]) || total;
      const plantName = match[2].trim();
      const needCount = Math.max(0, targetCount - progress);
      if (needCount <= 0) continue;

      // 根据植物名称匹配种子与商品
      const { getAllSeeds } = require('../config/gameConfig');
      const allSeeds = getAllSeeds();
      const matchedSeed = allSeeds.find(s => s.name === plantName || s.name.includes(plantName) || plantName.includes(s.name));
      if (!matchedSeed) {
        logWarn('任务', `成长任务未找到匹配的种子商品: ${plantName}`);
        continue;
      }

      const seedId = Number(matchedSeed.seedId);
      const { getSeedShopId, getShopInfo, buyGoods } = require('./farm-api');
      const shopId = await getSeedShopId();
      const shop = await getShopInfo(shopId);
      const goods = (shop.goods_list || []).find(item => toNum(item.item_id) === seedId && item.unlocked);

      if (!goods) {
        logWarn('任务', `种子商店未找到商品: ${plantName}种子 (ID:${seedId})`);
        continue;
      }

      const price = toNum(goods.price);
      const { getUserState } = require('../utils/network');
      const userState = getUserState();
      const affordable = price > 0 ? Math.floor((userState.gold || 0) / price) : needCount;
      const finalBuyCount = Math.min(needCount, affordable);

      if (finalBuyCount <= 0) {
        logWarn('任务', `金币不足，无法购买任务所需 ${plantName}种子 x${needCount}`);
        continue;
      }

      log('任务', `检测到成长任务【${desc}】(当前进度:${progress}/${total})，正在自动购买 ${plantName}种子 x${finalBuyCount}...`, {
        module: 'task', event: '成长任务购买', taskId: t.id, plantName, count: finalBuyCount,
      });

      await buyGoods(toNum(goods.id), finalBuyCount, price);
      if (userState.gold) {
        userState.gold = Math.max(0, userState.gold - finalBuyCount * price);
      }

      log('任务', `成功购买 ${plantName}种子 x${finalBuyCount}！任务已推进`, {
        module: 'task', event: '成长任务购买完成', result: 'ok',
      });

      // 稍作等待后重新拉取并立即领取该任务奖励
      await sleep(1000);
      await checkAndClaimTasks();
    }
  } catch (err) {
    if (!isTransientError(err)) {
      logWarn('任务', `执行成长购买种子任务失败: ${err.message}`);
    }
  }
}

/**
 * 任务系统服务 - 每日任务、成长任务、活跃奖励自动领取
 *
 * 功能：
 * - 扫描并领取每日/成长/主线任务
 * - 处理每日/每周活跃奖励
 * - 领取图鉴奖励（点券）
 * - 响应任务推送通知进行实时领取
 */
const { isAutomationOn } = require('../models/store');
const { sendMsgAsync, isConnected, networkEvents } = require('../utils/network');
const { types } = require('../utils/proto');
const { toLong, toNum, log, logWarn, sleep } = require('../utils/utils');
const { createScheduler } = require('./scheduler');
const { recordOperation } = require('./stats');
const { getItemById } = require('../config/gameConfig');

// ---- 状态 ----

let checking = false;
let taskClaimDoneDateKey = '';
let taskClaimLastAt = 0;
let cachedTaskInfo = null;
let lastTaskInfoFetchedAt = 0;

const taskScheduler = createScheduler('task');

// 时区偏移（UTC+8）
const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;

// ---- 日期工具（使用服务器时间 UTC+8） ----

function getDateKey() {
  const { getServerTimeSec } = require('../utils/utils');
  const serverSec = getServerTimeSec();
  const timestampMs = serverSec > 0 ? serverSec * 1000 : Date.now();
  const date = new Date(timestampMs + UTC8_OFFSET_MS);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ---- 错误判断 ----

/**
 * 判断是否为瞬时网络错误（可忽略不报警）
 */
function isTransientError(err) {
  const msg = String(err && err.message || '');
  if (!msg) return false;
  return [
    '连接未打开',
    '请求超时',
    '请求已中断',
    '连接关闭',
    '发送失败',
    '请求队列已满',
  ].some((keyword) => msg.includes(keyword));
}

// ---- RPC 调用 ----

async function getTaskInfo(force = false) {
  const now = Date.now();
  if (!force && cachedTaskInfo && now - lastTaskInfoFetchedAt < 15000) {
    return { task_info: cachedTaskInfo };
  }
  const request = types.TaskInfoRequest.encode(
    types.TaskInfoRequest.create({})
  ).finish();
  const { body } = await sendMsgAsync('gamepb.taskpb.TaskService', 'TaskInfo', request);
  const reply = types.TaskInfoReply.decode(body);
  if (reply && reply.task_info) {
    cachedTaskInfo = reply.task_info;
    lastTaskInfoFetchedAt = Date.now();
  }
  return reply;
}

async function claimTaskReward(taskId, doShared = false) {
  const request = types.ClaimTaskRewardRequest.encode(
    types.ClaimTaskRewardRequest.create({ id: toLong(taskId), do_shared: doShared })
  ).finish();
  const { body } = await sendMsgAsync('gamepb.taskpb.TaskService', 'ClaimTaskReward', request);
  const reply = types.ClaimTaskRewardReply.decode(body);
  if (reply && reply.task_info) {
    cachedTaskInfo = reply.task_info;
    lastTaskInfoFetchedAt = Date.now();
  }
  return reply;
}

/**
 * 领取活跃奖励（日活跃/周活跃）
 */
async function claimDailyReward(type, pointIds) {
  if (!types.ClaimDailyRewardRequest || !types.ClaimDailyRewardReply) {
    return { items: [] };
  }
  const request = types.ClaimDailyRewardRequest.encode(
    types.ClaimDailyRewardRequest.create({
      type: Number(type) || 0,
      point_ids: (pointIds || []).map((id) => toLong(id)),
    })
  ).finish();
  const { body } = await sendMsgAsync('gamepb.taskpb.TaskService', 'ClaimDailyReward', request);
  return types.ClaimDailyRewardReply.decode(body);
}

async function claimAllIllustratedRewards() {
  if (!types.ClaimAllRewardsV2Request || !types.ClaimAllRewardsV2Reply) {
    return { items: [], bonus_items: [] };
  }
  const request = types.ClaimAllRewardsV2Request.encode(
    types.ClaimAllRewardsV2Request.create({ only_claimable: true })
  ).finish();
  const { body } = await sendMsgAsync(
    'gamepb.illustratedpb.IllustratedService',
    'ClaimAllRewardsV2',
    request
  );
  return types.ClaimAllRewardsV2Reply.decode(body);
}

/**
 * 从背包获取点券余额（物品 ID=500）
 */
async function getTicketBalanceFromBag() {
  try {
    const { getBag, getBagItems } = require('./warehouse');
    const bag = await getBag();
    const items = getBagItems(bag);
    for (const item of items || []) {
      if (toNum(item && item.id) === 500) {
        return Math.max(0, toNum(item && item.count));
      }
    }
    return 0;
  } catch (_) {
    return 0;
  }
}

// ---- 奖励摘要 ----
// 1001→金币, 1002→经验, 200→点券

function getRewardSummary(rewards) {
  const parts = [];
  for (const r of rewards) {
    const id = toNum(r.id);
    const count = toNum(r.count);
    if (id === 1001 || id === 500001) {
      parts.push(`金币${count}`);
    } else if (id === 1002 || id === 500002) {
      parts.push(`经验${count}`);
    } else if (id === 200) {
      parts.push(`点券${count}`);
    } else {
      const info = getItemById(id);
      const name = info && info.name ? String(info.name) : `物品#${id}`;
      parts.push(`${name}x${count}`);
    }
  }
  return parts.join('/');
}

// ---- 任务格式化 ----

function formatTask(task, category = 'main') {
  return {
    id: toNum(task.id),
    desc: task.desc || `任务#${toNum(task.id)}`,
    category,
    progress: toNum(task.progress),
    totalProgress: toNum(task.total_progress),
    isClaimed: task.is_claimed,
    isUnlocked: task.is_unlocked,
    shareMultiple: toNum(task.share_multiple),
    rewards: (task.rewards || []).map((r) => ({
      id: toNum(r.id),
      count: toNum(r.count),
    })),
    canClaim:
      task.is_unlocked &&
      !task.is_claimed &&
      toNum(task.progress) >= toNum(task.total_progress) &&
      toNum(task.total_progress) > 0,
  };
}

/**
 * 分析任务列表，返回可领取的任务
 */
function analyzeTaskList(tasks, category = 'main') {
  const claimable = [];
  for (const task of tasks) {
    const formatted = formatTask(task, category);
    if (formatted.canClaim) claimable.push(formatted);
  }
  return claimable;
}

/**
 * 构建每日任务列表（回退：从 tasks + growth_tasks 中筛选 task_type=2 的）
 */
function buildDailyTasksForDebug(taskInfoRaw) {
  const info = taskInfoRaw && typeof taskInfoRaw === 'object' ? taskInfoRaw : {};
  const dailyTasks = Array.isArray(info.daily_tasks) ? info.daily_tasks : [];
  if (dailyTasks.length > 0) return dailyTasks;

  const allTasks = [
    ...(Array.isArray(info.tasks) ? info.tasks : []),
    ...(Array.isArray(info.growth_tasks) ? info.growth_tasks : []),
  ];
  return allTasks.filter((t) => toNum(t && t.task_type) === 2);
}

function summarizeDailyTaskProgress(dailyTasksRaw) {
  const dailyTasks = Array.isArray(dailyTasksRaw) ? dailyTasksRaw : [];
  const visibleTasks = dailyTasks.slice(0, 3);
  const completedCount = visibleTasks.filter((task) => {
    const progress = toNum(task && task.progress);
    const total = toNum(task && task.total_progress);
    // The server can reset progress after a reward is claimed. In that state
    // is_claimed is the authoritative completion signal.
    return !!(task && task.is_claimed) || (total > 0 && progress >= total);
  }).length;
  const visibleTarget = visibleTasks.length;

  return {
    doneToday: visibleTarget > 0 && completedCount >= visibleTarget,
    completedCount,
    // Keep the usual 3-task target when data is temporarily unavailable, but
    // never infer completion from an empty task list.
    totalCount: visibleTarget || 3,
  };
}

/**
 * 构建成长任务列表。
 * 新版服务端可能把任务统一放在 tasks 中，仅通过 task_type=1 区分。
 */
function buildGrowthTasks(taskInfoRaw) {
  const info = taskInfoRaw && typeof taskInfoRaw === 'object' ? taskInfoRaw : {};
  const growthTasks = Array.isArray(info.growth_tasks) ? info.growth_tasks : [];
  if (growthTasks.length > 0) return growthTasks;

  const tasks = Array.isArray(info.tasks) ? info.tasks : [];
  return tasks.filter((t) => toNum(t && t.task_type) === 1);
}

// ---- 活跃奖励处理 ----

/**
 * 检查并领取活跃奖励（日活跃 type=1，周活跃 type=2）
 */
async function checkAndClaimActives(actives) {
  const list = Array.isArray(actives) ? actives : [];
  let scanned = 0;
  let claimed = 0;
  let errors = 0;

  for (const active of list) {
    const type = toNum(active.type);
    const rewards = active.rewards || [];
    const pending = rewards.filter((r) => toNum(r.status) === 2); // ActiveStatus.DONE = 2
    if (!pending.length) continue;

    scanned += pending.length;
    const pointIds = pending.map((r) => toNum(r.point_id)).filter((id) => id > 0);
    if (!pointIds.length) continue;

    const label = type === 1 ? '日活跃' : type === 2 ? '周活跃' : `活跃${type}`;

    try {
      log('活跃', `${label} 发现 ${pointIds.length} 个可领取奖励`, {
        module: 'task', event: '扫描活跃奖励', result: 'ok', activeType: type, count: pointIds.length,
      });

      const result = await claimDailyReward(type, pointIds);
      const items = result.items || [];

      if (items.length > 0) {
        log('活跃', `${label} 领取: ${getRewardSummary(items)}`, {
          module: 'task', event: '领取活跃奖励', result: 'ok', activeType: type, count: items.length,
        });
      }

      claimed += pointIds.length;
      await sleep(300);
    } catch (err) {
      errors += 1;
      log('活跃', `${label} 领取失败: ${err.message}`, {
        module: 'task', event: '领取活跃奖励', result: 'error', activeType: type,
      });
    }
  }

  return { scanned, claimed, errors };
}

// ---- 图鉴奖励处理 ----

async function checkAndClaimIllustratedRewards() {
  try {
    const beforeTicket = await getTicketBalanceFromBag();
    const reply = await claimAllIllustratedRewards();
    const allItems = [
      ...(Array.isArray(reply && reply.items) ? reply.items : []),
      ...(Array.isArray(reply && reply.bonus_items) ? reply.bonus_items : []),
    ];
    const afterTicket = await getTicketBalanceFromBag();
    const ticketGain = Math.max(0, afterTicket - beforeTicket);

    if (ticketGain <= 0) return false;

    log('任务', `领取成功: 点券${ticketGain}`, {
      module: 'task', event: '图鉴奖励', result: 'ok', scope: 'illustrated', count: allItems.length,
    });

    taskClaimDoneDateKey = getDateKey();
    taskClaimLastAt = Date.now();
    recordOperation('taskClaim', 1);
    return true;
  } catch (_) {
    return false;
  }
}

// ---- 任务领取 ----

/**
 * 领取单个任务
 */
async function doClaim(task) {
  const tryClaim = async (doShare) => {
    const shareLabel = doShare ? ` (${task.shareMultiple || 2}倍)` : '';
    const result = await claimTaskReward(task.id, doShare);
    const items = result.items || [];
    const summary = items.length > 0 ? getRewardSummary(items) : '无';
    const categoryLabel =
      task.category === 'daily' ? '每日任务' :
      task.category === 'growth' ? '成长任务' : '任务';

    log('任务', `领取(${categoryLabel}): ${task.desc}${shareLabel} → ${summary}`, {
      module: 'task', event: '领取任务', result: 'ok', taskId: task.id, shared: doShare,
    });

    task.isClaimed = true;
    taskClaimDoneDateKey = getDateKey();
    taskClaimLastAt = Date.now();
    recordOperation('taskClaim', 1);
    await sleep(300);
    return true;
  };

  const initialShare = task.shareMultiple > 1;
  const isAlreadyClaimed = (e) => String(e && e.message || '').includes('1008002') || String(e && e.message || '').includes('已领取');

  try {
    return await tryClaim(initialShare);
  } catch (err) {
    if (isAlreadyClaimed(err)) {
      task.isClaimed = true;
      taskClaimDoneDateKey = getDateKey();
      return true;
    }
    if (initialShare) {
      logWarn('任务', `任务[${task.desc}]分享翻倍领取失败(${err.message})，正在尝试普通领取...`);
      try {
        await sleep(300);
        return await tryClaim(false);
      } catch (fallbackErr) {
        if (isAlreadyClaimed(fallbackErr)) {
          task.isClaimed = true;
          taskClaimDoneDateKey = getDateKey();
          return true;
        }
        logWarn('任务', `任务[${task.desc}]普通领取失败: ${fallbackErr.message}`);
        return false;
      }
    }
    logWarn('任务', `任务[${task.desc}]领取失败: ${err.message}`);
    return false;
  }
}

async function claimTasksFromList(tasks) {
  if (!isAutomationOn('task')) return;
  for (const task of tasks) {
    await doClaim(task);
  }
}

// ---- 主检查流程 ----

async function checkAndClaimTasks() {
  if (checking) return;
  if (!isAutomationOn('task')) return;
  if (!isConnected()) return;

  checking = true;

  try {
    const reply = await getTaskInfo();
    if (!reply.task_info) {
      checking = false;
      return;
    }

    const taskInfo = reply.task_info;

    // 收集可领取任务
    const dailyTasks = buildDailyTasksForDebug(taskInfo);
    const dailyClaimable = analyzeTaskList(dailyTasks, 'daily');
    const growthClaimable = analyzeTaskList(taskInfo.growth_tasks || [], 'growth');
    const mainClaimable = analyzeTaskList(taskInfo.tasks || [], 'main');
    const allClaimable = [...dailyClaimable, ...growthClaimable, ...mainClaimable];

    if (allClaimable.length > 0) {
      log('任务', `发现 ${allClaimable.length} 个可领取任务`, {
        module: 'task', event: '扫描任务', result: 'ok', count: allClaimable.length,
      });

      if (dailyClaimable.length > 0) {
        log('任务', `每日任务可领取: ${dailyClaimable.map((t) => t.desc).join('，')}`, {
          module: 'task', event: '扫描任务', result: 'ok', count: dailyClaimable.length, scope: 'daily',
        });
      }

      let dailyClaimed = 0;
      for (const task of allClaimable) {
        const success = await doClaim(task);
        if (task.category === 'daily' && success) dailyClaimed += 1;
      }

      if (dailyClaimable.length > 0 && dailyClaimed === 0) {
        log('任务', '每日任务本次未领取成功', {
          module: 'task', event: '领取任务', result: 'none', scope: 'daily',
        });
      }
    }

    // 活跃奖励
    await checkAndClaimActives(taskInfo.actives || []);
    // 图鉴奖励
    await checkAndClaimIllustratedRewards();
    // 自动执行成长任务中的购买种子任务（只做购买）
    await checkAndExecuteGrowthBuySeedTasks();
  } catch (err) {
    if (isTransientError(err)) return;
    logWarn('任务', `检查任务失败: ${err.message}`, {
      module: 'task', event: '扫描任务', result: 'error',
    });
  } finally {
    checking = false;
  }
}

// ---- 推送通知处理 ----

/**
 * 响应服务端推送的任务信息通知
 */
function onTaskInfoNotify(payload) {
  if (!payload) return;
  cachedTaskInfo = payload;
  lastTaskInfoFetchedAt = Date.now();
  if (!isAutomationOn('task')) return;

  const claimable = [
    ...analyzeTaskList(payload.daily_tasks || [], 'daily'),
    ...analyzeTaskList(payload.growth_tasks || [], 'growth'),
    ...analyzeTaskList(payload.tasks || [], 'main'),
  ];

  const actives = payload.actives || [];
  const hasClaimable = claimable.length > 0;

  if (!hasClaimable && actives.length === 0) return;

  if (hasClaimable) {
    log('任务', `有 ${claimable.length} 个任务可领取，准备自动领取...`, {
      module: 'task', event: '领取任务', result: 'plan', count: claimable.length,
    });
  }

  taskScheduler.setTimeoutTask('task_claim_debounce', 5000, async () => {
    if (hasClaimable) await claimTasksFromList(claimable);
    await checkAndClaimActives(actives);
    await checkAndClaimIllustratedRewards();
  });
}

// ---- 生命周期 ----

function initTaskSystem() {
  cleanupTaskSystem();
  networkEvents.on('taskInfoNotify', onTaskInfoNotify);
  taskScheduler.setTimeoutTask('task_init_bootstrap', 15000, () => {
    checkAndClaimTasks();
  });
  // 周期性轮询领取每日/成长任务及活跃奖励（每 5 分钟自动扫描并静默领取）
  taskScheduler.setIntervalTask('task_periodic_claim', 300000, () => {
    checkAndClaimTasks();
  });
}

function cleanupTaskSystem() {
  networkEvents.off('taskInfoNotify', onTaskInfoNotify);
  taskScheduler.clearAll();
  checking = false;
}

// ---- 导出 ----

module.exports = {
  getTaskInfo,
  checkAndClaimTasks,
  initTaskSystem,
  cleanupTaskSystem,
  claimTaskReward,
  doClaim,
  buildDailyTasksForDebug,
  buildGrowthTasks,
  summarizeDailyTaskProgress,

  getTaskClaimDailyState: () => ({
    key: 'task_claim',
    doneToday: taskClaimDoneDateKey === getDateKey(),
    lastClaimAt: taskClaimLastAt,
  }),

  /**
   * 获取每日任务状态（仿 App 返回格式）
   */
  getTaskDailyStateLikeApp: async () => {
    try {
      const reply = await getTaskInfo();
      const taskInfo = (reply && reply.task_info) ? reply.task_info : {};
      const dailyTasks = buildDailyTasksForDebug(taskInfo);
      const progressSummary = summarizeDailyTaskProgress(dailyTasks);

      const unlocked = dailyTasks.filter((t) => {
        const isUnlocked = !!(t && t.is_unlocked);
        const isClaimed = !!(t && t.is_claimed);
        const total = toNum(t && t.total_progress);
        return isUnlocked && !isClaimed && total > 0;
      });

      const claimable = analyzeTaskList(dailyTasks, 'daily');

      return {
        key: 'task_claim',
        doneToday: progressSummary.doneToday,
        lastClaimAt: taskClaimLastAt,
        claimableCount: claimable.length,
        pendingCount: unlocked.length,
        completedCount: progressSummary.completedCount,
        totalCount: progressSummary.totalCount,
      };
    } catch (_) {
      return {
        key: 'task_claim',
        doneToday: false,
        lastClaimAt: taskClaimLastAt,
        claimableCount: 0,
        pendingCount: 0,
        completedCount: 0,
        totalCount: 3,
      };
    }
  },

  /**
   * 获取成长任务状态（仿 App 返回格式）
   */
  getGrowthTaskStateLikeApp: async () => {
    try {
      const reply = await getTaskInfo();
      const taskInfo = (reply && reply.task_info) ? reply.task_info : {};
      const growthTasks = buildGrowthTasks(taskInfo);

      const tasks = growthTasks.map((t) => {
        const progress = Math.max(0, toNum(t && t.progress));
        const total = Math.max(0, toNum(t && t.total_progress));
        const isClaimed = !!(t && t.is_claimed);
        const isUnlocked = !!(t && t.is_unlocked);
        const isCompleted = total > 0 && progress >= total;

        return {
          id: toNum(t && t.id),
          desc: (t && t.desc) || `成长任务#${toNum(t && t.id)}`,
          progress,
          totalProgress: total,
          isClaimed,
          isUnlocked,
          isCompleted,
        };
      });

      const totalCount = tasks.length;
      const completedCount = tasks.filter((t) => t.isCompleted).length;

      return {
        key: 'growth_task',
        doneToday: totalCount > 0 && completedCount >= totalCount,
        completedCount,
        totalCount,
        tasks,
      };
    } catch (_) {
      return {
        key: 'growth_task',
        doneToday: false,
        completedCount: 0,
        totalCount: 0,
        tasks: [],
      };
    }
  },
};
