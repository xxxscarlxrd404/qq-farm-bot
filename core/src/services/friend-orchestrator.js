const { CONFIG } = require('../config/config');
const {
  isAutomationOn,
  getFriendBlacklist,
  getAutoAcceptFriendMinLevel,
  getKnownFriendGids,
  applyConfigSnapshot,
  getFriendBadRetryDate,
  readFriendDogInfoCache,
} = require('../models/store');
const { getUserState, isConnected, networkEvents } = require('../utils/network');
const { toNum, log, logWarn, randomDelay } = require('../utils/utils');
const { setOperationLimitsCallback } = require('./farm');
const { createScheduler } = require('./scheduler');
const {
  getAllFriends,
  extractReplyFriends,
  inFriendQuietHours,
  postToMaster,
  normalizeFriendGids,
  syncKnownFriendGidsFromFriends,
  acceptFriends,
  getApplications,
  enterFriendFarm,
  leaveFriendFarm,
  handleFriendEnterError,
  clearAllInvalidKnownFriendGidCooldown,
} = require('./friend-api');
const {
  checkDailyReset,
  canOperate,
  canOperateBad,
  getCanGetHelpExp,
  getHelpAutoDisabledByLimit,
  updateOperationLimits,
} = require('./friend-operation-limits');
const {
  visitFriend,
  visitFriendForSteal,
  visitFriendForHelp,
} = require('./friend-visit');
const { buildFriendVisitPlan } = require('./friend-visit-plan');
const { selectFriendVisitBatch } = require('./friend-visit-pacing');
const {
  observeFriendSummary,
  observeFriendLands,
  claimDueFriends,
  isCalibrationDue,
  markCalibrated,
  selectCalibrationFriends,
  getNextStealDelayMs,
  resetFriendMaturityPlans,
} = require('./friend-maturity-plan');
const { sellAllFruits } = require('./warehouse');
const {
  getFriendsList,
  setFriendsListCache,
} = require('./friend-land-analyzer');

// ===== State =====
let isCheckingFriends = false;
let friendLoopRunning = false;
let externalSchedulerMode = false;
const friendScheduler = createScheduler('friend');
let badExecutedOnStartup = false;
let consecutiveBadFailureCount = 0;
let dogInfoBootstrapAttempted = false;
let dogInfoBootstrapReadyAt = 0;
let onFriendLandsObserved = null;

const BAD_FAILURE_LIMIT = 3;

// ===== Helpers =====

function isTransientNetworkError(err) {
  const msg = String((err && err.message) || '');
  if (!msg) return false;
  return [
    '连接未打开',
    '请求超时',
    '请求已中断',
    '连接关闭',
    '发送失败',
    '请求队列已满',
  ].some(kw => msg.includes(kw));
}

function clearFriendsListCache() {
  setFriendsListCache(null);
}

async function bootstrapFriendDogInfoCacheIfNeeded() {
  if (dogInfoBootstrapAttempted) return;
  if (Date.now() < dogInfoBootstrapReadyAt) return;

  const accountId = process.env.FARM_ACCOUNT_ID || '';
  if (!accountId) return;
  if (!isAutomationOn('friend') || !isConnected()) return;

  const dogInfoCache = readFriendDogInfoCache(accountId);
  if (dogInfoCache && Object.keys(dogInfoCache).length > 0) return;

  dogInfoBootstrapAttempted = true;
  log('好友', '护主犬缓存将随好友成熟计划和实际访问渐进补齐', {
    module: 'friend',
    event: '好友信息渐进同步',
    source: 'friend_loop_bootstrap',
  });
}

function syncAutomationPatchToMaster(patch) {
  postToMaster({
    type: 'automation_patch',
    patch,
  });
}

function resetBadFailureCount() {
  consecutiveBadFailureCount = 0;
}

function isFriendBadPaused() {
  const accountId = process.env.FARM_ACCOUNT_ID || '';
  const retryDate = getFriendBadRetryDate(accountId);
  if (!retryDate) return false;
  // Generic target failures no longer pause all bad operations. Clear a pause
  // persisted by older versions so the corrected limit logic takes effect now.
  applyConfigSnapshot({ friendBadRetryDate: '' }, { accountId });
  syncAutomationPatchToMaster({ friendBadRetryDate: '' });
  resetBadFailureCount();
  return false;
}

function recordBadFailure(reason, context = {}) {
  consecutiveBadFailureCount += 1;
  log('好友', `捣乱失败 ${consecutiveBadFailureCount}/${BAD_FAILURE_LIMIT}: ${reason || '未知错误'}`, {
    module: 'friend',
    event: '捣乱失败计数',
    result: 'error',
    failureCount: consecutiveBadFailureCount,
    failureLimit: BAD_FAILURE_LIMIT,
    reason,
    ...context,
  });

  // A target-specific failure does not prove the shared daily limit is exhausted.
  // Keep scanning other friends; operation_limits is the authoritative stop signal.
  if (consecutiveBadFailureCount >= BAD_FAILURE_LIMIT) resetBadFailureCount();
  return false;
}

function isIgnorableBadFailureMessage(message) {
  const text = String(message || '');
  if (!text) return true;
  return [
    '??',
    'No target',
    '?????',
    '1001046',
    'used up',
    'no target',
    '没有可捣乱土地',
    '捣乱失败或今日次数已用完',
    '今日次数已用完',
    '次数已用完',
    '已经放过',
    '来晚一步',
  ].some(kw => text.includes(kw));
}

function trackBadVisitResult(result, target, context = {}) {
  const count = Number(
    result && (
      result.count
      || (Number(result.bugCount || 0) + Number(result.weedCount || 0))
    ) || 0
  );
  if (count > 0) {
    resetBadFailureCount();
    return false;
  }

  const message = String(result && result.message || '').trim();
  if (isIgnorableBadFailureMessage(message)) return false;

  return recordBadFailure(message, {
    friendName: target && target.name,
    friendGid: target && target.gid,
    ...context,
  });
}

// ===== Main friend check routine =====

/**
 * Main friend check routine: visits friends to steal, help, and/or put weeds/bugs.
 * Called by the loop or triggered externally.
 */
async function checkFriends(options = {}) {
  const userState = getUserState();
  if (!isAutomationOn('friend') || !isConnected()) return false;

  await bootstrapFriendDogInfoCacheIfNeeded();

  const accountId = process.env.FARM_ACCOUNT_ID || '';
  const helpEnabled = !!isAutomationOn('friend_help');
  const stealEnabled = !!isAutomationOn('friend_steal');
  const badEnabled = !!isAutomationOn('friend_bad');

  const onlyHelp = options.onlyHelp || false;
  const onlySteal = options.onlySteal || false;
  const onlyBad = options.onlyBad || false;
  const ignoreExpLimit = options.ignoreExpLimit || false;

  const doHelp = onlyHelp ? true : (onlySteal || onlyBad ? false : helpEnabled);
  const doSteal = onlySteal ? true : (onlyHelp || onlyBad ? false : stealEnabled);
  const doBad = onlyBad ? true : (onlyHelp || onlySteal ? false : badEnabled);

  const shouldRun = doHelp || doSteal || doBad;

  if (isCheckingFriends || !userState.gid || !shouldRun) return false;
  if (inFriendQuietHours()) return false;

  isCheckingFriends = true;
  checkDailyReset();

  try {
    const allFriendsReply = await getAllFriends();
    const rawFriends = extractReplyFriends(allFriendsReply);
    for (const friend of rawFriends) observeFriendSummary(friend);

    if (rawFriends.length === 0) {
      log('好友', '没有好友', {
        module: 'friend',
        event: '好友扫描',
        result: 'empty',
      });
      return false;
    }

    const blacklist = new Set(getFriendBlacklist(accountId));
    const dogInfoCache = readFriendDogInfoCache(accountId);
    const guardDogGidSet = new Set();
    if (dogInfoCache && typeof dogInfoCache === 'object') {
      for (const [gidStr, dog] of Object.entries(dogInfoCache)) {
        if (dog && Number(dog.dogId) === 90021) {
          guardDogGidSet.add(Number(gidStr));
        }
      }
    }
    const expLimitEnabled = !!isAutomationOn('friend_help_exp_limit');
    const helpExpReached = expLimitEnabled && !getCanGetHelpExp();

    // ---- Build target lists ----
    const stealTargets = [];
    const helpTargets = [];
    const visitedGids = new Set();

    // Steal targets: friends with stealable crops
    if (doSteal) {
      for (const friend of rawFriends) {
        const gid = toNum(friend.gid);
        if (gid === userState.gid) continue;
        if (visitedGids.has(gid)) continue;
        if (blacklist.has(gid)) continue;

        const name = friend.remark || friend.name || `GID:${gid}`;
        const plant = friend.plant;
        const stealNum = plant ? toNum(plant.steal_plant_num) : 0;
        const level = toNum(friend.level);

        if (stealNum > 0) {
          stealTargets.push({ gid, name, stealNum, level });
        }
        visitedGids.add(gid);
      }
    }

    // Help targets
    if (doHelp) {
      if (helpExpReached && guardDogGidSet.size > 0) {
        // Experience limit reached — only help guard dog friends
        for (const friend of rawFriends) {
          const gid = toNum(friend.gid);
          if (gid === userState.gid) continue;
          if (!guardDogGidSet.has(gid)) continue;
          if (blacklist.has(gid)) continue;

          const name = friend.remark || friend.name || `GID:${gid}`;
          const plant = friend.plant;
          const dryNum = plant ? toNum(plant.dry_num) : 0;
          const weedNum = plant ? toNum(plant.weed_num) : 0;
          const insectNum = plant ? toNum(plant.insect_num) : 0;

          if (dryNum > 0 || weedNum > 0 || insectNum > 0) {
            helpTargets.push({
              gid,
              name,
              dryNum,
              weedNum,
              insectNum,
              dogId: 0x15FA5, // 90021
              hasGuardDog: true,
            });
          }
        }

        if (helpTargets.length > 0) {
          log('好友', `找到 ${helpTargets.length} 个需要帮助的护主犬好友`, {
            module: 'friend',
            event: '护主犬好友巡查',
            helpCount: helpTargets.length,
          });
        }
      } else {
        for (const friend of rawFriends) {
          const gid = toNum(friend.gid);
          if (gid === userState.gid) continue;
          if (blacklist.has(gid)) continue;

          const name = friend.remark || friend.name || `GID:${gid}`;
          const plant = friend.plant;
          const dryNum = plant ? toNum(plant.dry_num) : 0;
          const weedNum = plant ? toNum(plant.weed_num) : 0;
          const insectNum = plant ? toNum(plant.insect_num) : 0;

          if (dryNum > 0 || weedNum > 0 || insectNum > 0) {
            const dogId = toNum(friend.dogId);
            const hasGuardDog = guardDogGidSet.has(gid) || dogId === 90021;
            helpTargets.push({
              gid,
              name,
              dryNum,
              weedNum,
              insectNum,
              dogId,
              hasGuardDog,
            });
          }
        }
      }
    }

    // Sort: steal by level desc, help by need desc (guard dogs first)
    stealTargets.sort((a, b) => b.level - a.level);
    helpTargets.sort((a, b) => {
      if (a.hasGuardDog !== b.hasGuardDog) return a.hasGuardDog ? -1 : 1;
      const aTotal = a.dryNum + a.weedNum + a.insectNum;
      const bTotal = b.dryNum + b.weedNum + b.insectNum;
      return bTotal - aTotal;
    });

    // ---- Execute ----
    const tally = { steal: 0, water: 0, weed: 0, bug: 0, putBug: 0, putWeed: 0 };

    const combinedVisitPlanRaw = doSteal && doHelp && !helpExpReached
      ? buildFriendVisitPlan({ stealTargets, helpTargets })
      : [];
    const combinedVisitPlan = selectFriendVisitBatch(combinedVisitPlanRaw, {
      accountId,
      mode: 'combined',
    });

    // A combined visit lets visitFriend perform all enabled operations while the
    // friend farm is open, so a friend present in both lists is entered once.
    if (combinedVisitPlan.length > 0) {
      for (const target of combinedVisitPlan) {
        try {
          await visitFriend(target, tally, userState.gid, userState.accountId);
        } catch {
          // Skip individual failures
        }
        await randomDelay(500, 1200);
      }
    } else if (stealTargets.length === 0 && helpTargets.length === 0 && rawFriends.length > 0) {
      // 哪怕好友既无可偷也无需帮忙，也保底串门进入 1 位好友农场，完成每日“在1个好友农场进行互动”任务
      const firstFriend = rawFriends.find(f => toNum(f.gid) !== userState.gid && !blacklist.has(toNum(f.gid)));
      if (firstFriend) {
        const fgid = toNum(firstFriend.gid);
        const fname = firstFriend.remark || firstFriend.name || `GID:${fgid}`;
        try {
          const { enterFriendFarm, leaveFriendFarm } = require('./friend-api');
          await enterFriendFarm(fgid);
          await sleep(600);
          await leaveFriendFarm(fgid);
          log('好友', `日常串门互动: 拜访好友 [${fname}] 农场`, {
            module: 'friend', event: '好友互动', result: 'ok', friendGid: fgid, friendName: fname
          });
        } catch (_) {}
      }
    }

    // Steal-only runs retain their narrower behaviour.
    if (combinedVisitPlan.length === 0 && stealTargets.length > 0 && doSteal) {
      const visitBatch = selectFriendVisitBatch(stealTargets, { accountId, mode: 'steal' });
      for (const target of visitBatch) {
        if (!canOperate(0x2714)) break; // 10004 = steal
        try {
          await visitFriendForSteal(target, tally, userState.gid, userState.accountId);
        } catch {
          // Skip individual failures
        }
        await randomDelay(500, 1500);
      }
    }

    // Auto-sell after stealing
    if (tally.steal > 0) {
      try {
        await sellAllFruits();
      } catch {
        // Ignore sell errors
      }
    }

    // Help
    if (combinedVisitPlan.length === 0 && helpTargets.length > 0 && doHelp) {
      const visitBatch = selectFriendVisitBatch(helpTargets, { accountId, mode: 'help' });
      for (const target of visitBatch) {
        try {
          await visitFriendForHelp(
            target, tally, userState.gid, userState.accountId,
            ignoreExpLimit, helpExpReached
          );
        } catch {
          // Skip individual failures
        }
        await randomDelay(
          helpExpReached ? 300 : 500,
          helpExpReached ? 700 : 1000
        );
      }
    }

    // Bad (put weeds/insects)
    if (doBad && !isFriendBadPaused()) {
      log('好友', '开始自动放虫放草', {
        module: 'friend',
        event: '开始自动放虫放草',
      });

      const badCandidates = [];
      const badVisited = new Set();

      for (const friend of rawFriends) {
        const gid = toNum(friend.gid);
        if (gid === userState.gid) continue;
        if (badVisited.has(gid)) continue;
        if (blacklist.has(gid)) continue;

        const name = friend.remark || friend.name || `GID:${gid}`;
        const plant = friend.plant;
        const stealNum = plant ? toNum(plant.steal_plant_num) : 0;
        const dryNum = plant ? toNum(plant.dry_num) : 0;
        const weedNum = plant ? toNum(plant.weed_num) : 0;
        const insectNum = plant ? toNum(plant.insect_num) : 0;

        // Target friends with empty farms (no crops, no issues)
        if (stealNum === 0 && dryNum === 0 && weedNum === 0 && insectNum === 0) {
          const level = toNum(friend.level);
          badCandidates.push({ gid, name, level });
        }
        badVisited.add(gid);
      }

      badCandidates.sort((a, b) => b.level - a.level);

      const topTargets = selectFriendVisitBatch(badCandidates, { accountId, mode: 'bad' });

      if (topTargets.length > 0) {
        log('好友',
          `找到 ${badCandidates.length} 个可捣乱的好友，按等级从高到低处理`,
          {
            module: 'friend',
            event: '放虫放草好友列表',
            totalCount: badCandidates.length,
            topCount: topTargets.length,
          }
        );

        for (let i = 0; i < topTargets.length; i++) {
          const target = topTargets[i];
          if (!canOperateBad()) {
            log('好友', '放虫放草次数已用完，停止执行', {
              module: 'friend',
              event: '放虫放草次数用完',
            });
            break;
          }

          try {
            const result = await visitFriend(target, tally, userState.gid, userState.accountId);
            if (trackBadVisitResult(result, target, { source: 'friend_check' })) {
              break;
            }
          } catch (err) {
            if (recordBadFailure(err && err.message, {
              friendName: target.name,
              friendGid: target.gid,
              source: 'friend_check',
            })) {
              break;
            }
          }
          await randomDelay(500, 1500);
        }
      }
    }

    // ---- Summary ----
    const summary = [];
    if (tally.steal > 0) summary.push(`偷${tally.steal}`);
    if (tally.weed > 0) summary.push(`除草${tally.weed}`);
    if (tally.bug > 0) summary.push(`除虫${tally.bug}`);
    if (tally.water > 0) summary.push(`浇水${tally.water}`);
    if (tally.putBug > 0) summary.push(`放虫${tally.putBug}`);
    if (tally.putWeed > 0) summary.push(`放草${tally.putWeed}`);

    const visited = stealTargets.length + helpTargets.length;
    if (summary.length > 0) {
      log('好友', `巡查完成 → ${summary.join('/')}`, {
        module: 'friend',
        event: '好友巡查循环',
        result: 'ok',
        visited,
        summary,
      });
    }

    return summary.length > 0;
  } catch (err) {
    if (!isTransientNetworkError(err)) {
      logWarn('好友', `巡查异常: ${err.message}`);
    }
    return false;
  } finally {
    isCheckingFriends = false;
  }
}

async function runScheduledStealCheck() {
  const accountId = process.env.FARM_ACCOUNT_ID || '';
  const userState = getUserState();
  if (!isAutomationOn('friend') || !isAutomationOn('friend_steal') || !isConnected()) {
    return getNextStealDelayMs();
  }
  if (isCheckingFriends || !userState.gid || inFriendQuietHours()) {
    return 60 * 1000;
  }

  isCheckingFriends = true;
  const tally = { steal: 0, water: 0, weed: 0, bug: 0, putBug: 0, putWeed: 0 };
  try {
    const targets = new Map();
    for (const target of claimDueFriends({ limit: 12 })) targets.set(toNum(target.gid), target);

    let rawFriends = [];
    if (isCalibrationDue()) {
      const allFriendsReply = await getAllFriends();
      rawFriends = extractReplyFriends(allFriendsReply);
      const blacklist = new Set(getFriendBlacklist(accountId));
      for (const friend of rawFriends) {
        const gid = toNum(friend && friend.gid);
        if (!gid || gid === userState.gid || blacklist.has(gid)) continue;
        observeFriendSummary(friend);
        if (toNum(friend.plant && friend.plant.steal_plant_num) > 0) {
          targets.set(gid, {
            gid,
            name: friend.remark || friend.name || `GID:${gid}`,
          });
        }
      }
      markCalibrated();
    }

    const visitTargets = [...targets.values()].slice(0, 12);
    for (const target of visitTargets) {
      if (!canOperate(0x2714)) break;
      try {
        await visitFriendForSteal(target, tally, userState.gid, accountId);
      } catch (err) {
        if (!isTransientNetworkError(err)) {
          logWarn('好友', `定时偷菜检查失败: ${target.name || target.gid}: ${err.message}`);
        }
      }
      await randomDelay(800, 1600);
    }

    if (rawFriends.length > 0) {
      const visited = new Set(visitTargets.map(item => toNum(item.gid)));
      const calibrationTargets = selectCalibrationFriends(
        rawFriends.filter(friend => !visited.has(toNum(friend && friend.gid))),
        { limit: 3 }
      );
      for (const friend of calibrationTargets) {
        const gid = toNum(friend && friend.gid);
        if (!gid || gid === userState.gid) continue;
        try {
          await enterFriendFarm(gid);
          await leaveFriendFarm(gid);
        } catch (err) {
          handleFriendEnterError(gid, friend.name || `GID:${gid}`, err);
        }
        await randomDelay(800, 1600);
      }
    }

    if (tally.steal > 0) {
      try { await sellAllFruits(); } catch { }
    }
  } catch (err) {
    if (!isTransientNetworkError(err)) logWarn('好友', `成熟计划校准失败: ${err.message}`);
    markCalibrated(Date.now(), 60 * 1000);
  } finally {
    isCheckingFriends = false;
  }
  return getNextStealDelayMs();
}

// ===== Friend check loop =====

async function friendCheckLoop() {
  if (externalSchedulerMode) return;
  if (!friendLoopRunning) return;

  await bootstrapFriendDogInfoCacheIfNeeded();

  await checkFriends();

  if (!friendLoopRunning) return;

  const interval = Math.max(30000, CONFIG.friendCheckInterval);
  friendScheduler.setTimeoutTask('friend_check_loop', interval, () => friendCheckLoop());
}

function startFriendCheckLoop(opts = {}) {
  if (friendLoopRunning) return;

  externalSchedulerMode = !!opts.externalScheduler;
  friendLoopRunning = true;
  dogInfoBootstrapAttempted = false;
  dogInfoBootstrapReadyAt = Date.now() + (2 * 60 * 1000);

  // Sync operation limits callback
  setOperationLimitsCallback(updateOperationLimits);

  // Listen for friend application events
  networkEvents.on('friendApplicationReceived', onFriendApplicationReceived);
  if (onFriendLandsObserved) networkEvents.off('friendLandsObserved', onFriendLandsObserved);
  onFriendLandsObserved = payload => {
    const gid = toNum(payload && payload.gid);
    if (!gid) return;
    observeFriendLands(gid, payload.lands || [], {
      name: payload.name || '',
      source: payload.source || 'lands',
    });
  };
  networkEvents.on('friendLandsObserved', onFriendLandsObserved);

  if (!externalSchedulerMode) {
    // Start after a 2-minute delay
    const initialDelay = 2 * 60 * 1000;
    log('好友', '好友巡查循环将在 2 分钟后启动', {
      module: 'friend',
      event: '好友巡查延迟启动',
      delayMs: initialDelay,
    });
    friendScheduler.setTimeoutTask('friend_check_loop', initialDelay, () => friendCheckLoop());
  }

  // Bootstrap: periodically check for pending applications
  friendScheduler.setTimeoutTask(
    'friend_check_bootstrap_applications',
    30 * 1000,
    () => checkAndAcceptApplications()
  );
}

function stopFriendCheckLoop() {
  friendLoopRunning = false;
  externalSchedulerMode = false;
  dogInfoBootstrapAttempted = false;
  dogInfoBootstrapReadyAt = 0;
  clearAllInvalidKnownFriendGidCooldown();
  networkEvents.off('friendApplicationReceived', onFriendApplicationReceived);
  if (onFriendLandsObserved) {
    networkEvents.off('friendLandsObserved', onFriendLandsObserved);
    onFriendLandsObserved = null;
  }
  resetFriendMaturityPlans();
  friendScheduler.clearAll();
}

function refreshFriendCheckLoop(delayMs = 0) {
  if (!friendLoopRunning || externalSchedulerMode) return;
  friendScheduler.setTimeoutTask(
    'friend_check_loop',
    Math.max(0, delayMs),
    () => friendCheckLoop()
  );
}

// ===== Friend application handling =====

function onFriendApplicationReceived(applications) {
  syncKnownFriendGidsFromFriends(Array.isArray(applications) ? applications : []);
  if (!isAutomationOn('friend_auto_accept') || !isAutomationOn('friend') || !isConnected()) return;

  const names = applications
    .map(app => app.name || `GID:${toNum(app.gid)}`)
    .join(', ');
  log('申请', `收到 ${applications.length} 个好友申请: ${names}`);

  for (const app of applications) {
    log('申请',
      `申请详情: name=${app.name}, gid=${toNum(app.gid)}, level=${app.level}, levelType=${typeof app.level}`
    );
  }

  const minLevel = getAutoAcceptFriendMinLevel();
  let toAccept = applications;

  if (minLevel > 0) {
    toAccept = applications.filter(app => {
      const level = toNum(app.level) || 0;
      const name = app.name || `GID:${toNum(app.gid)}`;
      log('申请', `${name} 等级: ${level}, 最低要求: ${minLevel}级`);
      if (level >= minLevel) return true;
      log('申请', `${name} 等级 ${level} < ${minLevel}，跳过`);
      return false;
    });
  }

  if (toAccept.length === 0) return;

  const gids = toAccept.map(app => toNum(app.gid));
  acceptFriendsWithRetry(gids);
}

async function checkAndAcceptApplications() {
  try {
    if (!isAutomationOn('friend_auto_accept') || !isAutomationOn('friend') || !isConnected()) return;

    const reply = await getApplications();
    const apps = reply.applications || [];
    if (apps.length === 0) return;

    const names = apps
      .map(app => app.name || `GID:${toNum(app.gid)}`)
      .join(', ');
    log('申请', `发现 ${apps.length} 个待处理申请: ${names}`);

    const minLevel = getAutoAcceptFriendMinLevel();
    let toAccept = apps;

    if (minLevel > 0) {
      toAccept = apps.filter(app => {
        const level = toNum(app.level) || 0;
        const name = app.name || `GID:${toNum(app.gid)}`;
        log('申请', `${name} 等级: ${level}, 最低要求: ${minLevel}级`);
        if (level >= minLevel) return true;
        log('申请', `${name} 等级 ${level} < ${minLevel}，跳过`);
        return false;
      });
    }

    if (toAccept.length === 0) return;

    const gids = toAccept.map(app => toNum(app.gid));
    await acceptFriendsWithRetry(gids);
  } catch {
    // Ignore application check errors
  }
}

async function acceptFriendsWithRetry(gids) {
  if (gids.length === 0) return;

  try {
    const reply = await acceptFriends(gids);
    const friends = reply.friends || [];

    if (friends.length > 0) {
      const names = friends
        .map(f => f.name || f.remark || `GID:${toNum(f.gid)}`)
        .join(', ');
      log('申请', `已同意 ${friends.length} 人: ${names}`);

      // Sync accepted GIDs to known friends list
      const newGids = friends
        .map(f => toNum(f.gid))
        .filter(g => g > 0);

      if (newGids.length > 0) {
        const currentGids = normalizeFriendGids(getKnownFriendGids());
        const mergedGids = normalizeFriendGids([...currentGids, ...newGids]);

        if (mergedGids.length !== currentGids.length) {
          const accountId = process.env.FARM_ACCOUNT_ID || '';
          applyConfigSnapshot(
            { knownFriendGids: mergedGids },
            { persist: false, accountId }
          );

          const synced = postToMaster({
            type: 'known_friend_gids_sync',
            gids: mergedGids,
          });

          if (!synced) {
            applyConfigSnapshot(
              { knownFriendGids: mergedGids },
              { persist: true, accountId }
            );
          }

          log('申请', `已将 ${newGids.length} 人加入好友列表`, {
            module: 'friend',
            event: '好友加入列表',
            result: 'ok',
          });
        }

        // Refresh friends list cache
        clearFriendsListCache();
        try {
          await getFriendsList(true);
          log('申请', '已刷新好友列表', {
            module: 'friend',
            event: '刷新好友列表',
            result: 'ok',
          });
        } catch (err) {
          logWarn('申请', `刷新好友列表失败: ${err.message}`);
        }
      }
    }
  } catch (err) {
    logWarn('申请', `同意失败: ${err.message}`);
  }
}

// ===== Bad on startup =====

/**
 * Run a one-time "bad" operation on startup to put weeds/insects on friends' farms.
 */
async function runBadOnceOnStartup(force = false) {
  if (!force && badExecutedOnStartup) return;

  const badEnabled = isAutomationOn('friend_bad');
  if (!badEnabled) return;
  if (isFriendBadPaused()) return;

  const userState = getUserState();
  if (!userState.gid) {
    log('好友', '用户未登录，无法执行放虫放草', {
      module: 'friend',
      event: '放虫放草未登录',
    });
    return;
  }

  const accountId = process.env.FARM_ACCOUNT_ID || '';
  const label = force ? '开启自动捣乱后立即执行' : '启动时放虫放草';

  log('好友', `========== ${label}开始 ==========`, {
    module: 'friend',
    event: `${label}开始`,
  });

  try {
    const allFriendsReply = await getAllFriends();
    const rawFriends = extractReplyFriends(allFriendsReply);

    if (rawFriends.length === 0) {
      log('好友', '没有好友，放虫放草结束', {
        module: 'friend',
        event: '没有游戏好友',
      });
      return;
    }

    const blacklist = new Set(getFriendBlacklist(accountId));
    const badCandidates = [];
    const badVisited = new Set();

    for (const friend of rawFriends) {
      const gid = toNum(friend.gid);
      if (gid === userState.gid) continue;
      if (badVisited.has(gid)) continue;
      if (blacklist.has(gid)) continue;

      const name = friend.remark || friend.name || `GID:${gid}`;
      const plant = friend.plant;
      const stealNum = plant ? toNum(plant.steal_plant_num) : 0;
      const dryNum = plant ? toNum(plant.dry_num) : 0;
      const weedNum = plant ? toNum(plant.weed_num) : 0;
      const insectNum = plant ? toNum(plant.insect_num) : 0;

      if (stealNum === 0 && dryNum === 0 && weedNum === 0 && insectNum === 0) {
        const level = toNum(friend.level);
        badCandidates.push({ gid, name, level });
      }
      badVisited.add(gid);
    }

    badCandidates.sort((a, b) => b.level - a.level);

    const topCount = badCandidates.length;
    const topTargets = badCandidates.slice(0, topCount);

    log('好友',
      `找到 ${badCandidates.length} 个可捣乱的好友，处理等级最高的前${topTargets.length}个`,
      {
        module: 'friend',
        event: '放虫放草好友列表',
        totalCount: badCandidates.length,
        topCount: topTargets.length,
      }
    );

    const tally = { steal: 0, water: 0, weed: 0, bug: 0, putBug: 0, putWeed: 0 };
    let processedCount = 0;

    for (let i = 0; i < topTargets.length; i++) {
      const target = topTargets[i];
      if (!canOperateBad()) {
        log('好友', `放虫放草次数已用完，停止执行。已处理 ${processedCount} 个好友`, {
          module: 'friend',
          event: '放虫放草次数用完',
          processedCount,
        });
        break;
      }

      log('好友',
        `${label} ${i + 1}/${topTargets.length}: ${target.name} (等级${target.level})`,
        {
          module: 'friend',
          event: '放虫放草处理好友',
          index: i + 1,
          total: topTargets.length,
          friendName: target.name,
          level: target.level,
        }
      );

      try {
        const result = await visitFriend(target, tally, userState.gid, accountId);
        processedCount++;
        if (trackBadVisitResult(result, target, { source: 'startup_bad' })) {
          break;
        }
      } catch (err) {
        log('好友', `放虫放草失败: ${target.name}, 错误: ${err.message}`, {
          module: 'friend',
          event: '放虫放草失败',
          friendName: target.name,
          error: err.message,
        });
        if (recordBadFailure(err && err.message, {
          friendName: target.name,
          friendGid: target.gid,
          source: 'startup_bad',
        })) {
          break;
        }
      }
      await randomDelay(500, 1500);
    }

    badExecutedOnStartup = true;

    const summary = [];
    if (tally.putBug > 0) summary.push(`放虫${tally.putBug}`);
    if (tally.putWeed > 0) summary.push(`放草${tally.putWeed}`);

    log('好友',
      `========== ${label}结束 ========== 处理${processedCount}人${ 
        summary.length > 0 ? ` → ${summary.join('/')}` : ''}`,
      {
        module: 'friend',
        event: `${label}结束`,
        processedCount,
        summary,
      }
    );
  } catch (err) {
    if (!isTransientNetworkError(err)) {
      logWarn('好友', `${label}异常: ${err.message}`);
    }
  }
}

// ===== Status queries =====

function isHelpExpLimitReached() {
  return getHelpAutoDisabledByLimit();
}

function isCheckingFriendsRunning() {
  return isCheckingFriends;
}

// ===== Sync friends from external GID list =====

async function syncFriendsFromGids(gids) {
  const newGids = normalizeFriendGids(gids);
  if (newGids.length === 0) return [];

  const currentGids = normalizeFriendGids(getKnownFriendGids());
  const mergedGids = normalizeFriendGids([...currentGids, ...newGids]);

  if (mergedGids.length !== currentGids.length) {
    const accountId = process.env.FARM_ACCOUNT_ID || '';
    applyConfigSnapshot(
      { knownFriendGids: mergedGids },
      { persist: false, accountId }
    );

    const synced = postToMaster({
      type: 'known_friend_gids_sync',
      gids: mergedGids,
    });

    if (!synced) {
      applyConfigSnapshot(
        { knownFriendGids: mergedGids },
        { persist: true, accountId }
      );
    }

    log('好友',
      `批量添加 ${newGids.length} 个好友GID，当前共 ${mergedGids.length} 个`,
      {
        module: 'friend',
        event: '批量添加好友GID',
        result: 'ok',
        addedCount: newGids.length,
        totalKnownGids: mergedGids.length,
      }
    );
  }

  clearFriendsListCache();
  return await getFriendsList(true);
}

// ===== Exports =====
module.exports = {
  checkFriends,
  runScheduledStealCheck,
  startFriendCheckLoop,
  stopFriendCheckLoop,
  refreshFriendCheckLoop,
  runBadOnceOnStartup,
  isHelpExpLimitReached,
  isCheckingFriendsRunning,
  clearFriendsListCache,
  syncFriendsFromGids,
};
