const { PlantPhase, PHASE_NAMES } = require('../config/config');
const {
  getPlantName,
  getPlantById,
  getPlantGrowTime,
  getSeedImageBySeedId,
  getMutantDisplayPlantId,
  getMutantPlantImageByPhase,
  getMutantEffectsByIds,
} = require('../config/gameConfig');
const {
  toNum,
  toTimeSec,
  getServerTimeSec,
  log,
  logWarn,
  randomDelay,
  sleep,
} = require('../utils/utils');
const { getGatewayHealth, getUserState } = require('../utils/network');
const { runWithRequestPriority } = require('../utils/request-priority');
const {
  getPlantBlacklist,
  getFriendBlacklist,
  readFriendDogInfoCache,
  writeFriendDogInfoCache,
} = require('../models/store');
const {
  enterFriendFarm,
  leaveFriendFarm,
  getDogName,
  handleFriendEnterError,
} = require('./friend-api');
const {
  getCurrentPhase,
  buildLandMap,
  getDisplayLandContext,
  isOccupiedSlaveLand,
  getQixiDewStatus,
} = require('./farm-land-analyzer');
const { classifyGatewayDefer, planNextSyncPacing } = require('./friend-dog-sync-pacing');

const GOLDEN_BUG_ITEM_ID = 301101;
const GOLDEN_BUG_SOCIAL_TYPE = 2;

// ===== Analyze friend lands =====

/**
 * Analyze a friend's lands and classify them into actionable categories.
 * Returns actionable ordinary-farm and golden-bug land groups.
 */
function analyzeFriendLands(lands, myGid, friendName = '', options = {}) {
  const { plantBlacklist = null } = options;
  const result = {
    stealable: [],
    stealableInfo: [],
    needWater: [],
    needWeed: [],
    needBug: [],
    canPutWeed: [],
    canPutBug: [],
    canPutGoldenBug: [],
  };

  const landMap = buildLandMap(lands);

  for (const land of lands) {
    const landId = toNum(land.id);

    // Skip slave lands in merged planting
    if (isOccupiedSlaveLand(land, landMap)) continue;

    const plant = land.plant;
    if (!plant || !plant.phases || plant.phases.length === 0) continue;

    const currentPhase = getCurrentPhase(
      plant.phases,
      false,
      `[${friendName}]土地#${landId}`,
      plant.id
    );
    if (!currentPhase) continue;

    const phase = currentPhase.phase;
    const socialItems = Array.isArray(plant.social_items) ? plant.social_items : [];
    const alreadyHasGoldenBug = socialItems.some(item => (
      toNum(item && item.item_id) === GOLDEN_BUG_ITEM_ID &&
      toNum(item && item.type) === GOLDEN_BUG_SOCIAL_TYPE
    ));

    if (phase !== PlantPhase.MATURE && phase !== PlantPhase.DEAD && !alreadyHasGoldenBug) {
      result.canPutGoldenBug.push(landId);
    }

    // Mature & stealable
    if (phase === PlantPhase.MATURE) {
      if (plant.stealable) {
        const plantId = toNum(plant.id);
        const plantName = getPlantName(plantId) || plant.name || '未知';
        const plantInfo = getPlantById(plantId);
        const seedId = plantInfo ? toNum(plantInfo.seed_id) : 0;

        // Respect plant blacklist
        if (plantBlacklist && seedId > 0 && plantBlacklist.includes(seedId)) continue;

        result.stealable.push(landId);
        result.stealableInfo.push({ landId, plantId, name: plantName });
      }
      continue;
    }

    // Dead — skip
    if (phase === PlantPhase.DEAD) continue;

    // Dry / weeds / insects
    if (toNum(plant.dry_num) > 0) result.needWater.push(landId);
    if (plant.weed_owners && plant.weed_owners.length > 0) result.needWeed.push(landId);
    if (plant.insect_owners && plant.insect_owners.length > 0) result.needBug.push(landId);

    // Can put weed / bug (limit: max 2 owners, and we haven't put one yet)
    if (phase !== PlantPhase.MATURE) {
      const weedOwners = plant.weed_owners || [];
      const bugOwners = plant.insect_owners || [];
      const alreadyPutWeed = weedOwners.some(owner => toNum(owner) === myGid);
      const alreadyPutBug = bugOwners.some(owner => toNum(owner) === myGid);

      if (weedOwners.length < 2 && !alreadyPutWeed) result.canPutWeed.push(landId);
      if (bugOwners.length < 2 && !alreadyPutBug) result.canPutBug.push(landId);
    }
  }

  return result;
}

// ===== Dog info =====

/**
 * Get a single friend's dog information by entering and leaving their farm.
 */
async function getFriendDogInfo(gid, friendName = '') {
  const numericGid = toNum(gid);
  const defaultResult = { dogId: 0, dogName: '无狗' };
  if (!numericGid) return defaultResult;

  const accountId = process.env.FARM_ACCOUNT_ID || '';
  const blacklist = new Set(getFriendBlacklist(accountId));
  if (blacklist.has(numericGid)) {
    return { dogId: 0, dogName: '无狗', blacklisted: true };
  }

  try {
    const enterReply = await enterFriendFarm(numericGid);
    await leaveFriendFarm(numericGid);

    const dogInfo = enterReply.__briefDogInfo;
    if (dogInfo && dogInfo.dogId > 0) {
      const dogId = toNum(dogInfo.dogId);
      const dogName = getDogName(dogId);
      return { dogId, dogName: dogName || '无狗' };
    }

    return { dogId: 0, dogName: '无狗' };
  } catch (err) {
    const handled = handleFriendEnterError(numericGid, friendName, err);
    if (handled.handled && handled.kind === 'blacklist') {
      return { dogId: 0, dogName: '无狗', blacklisted: true };
    }
    logWarn('好友', `获取好友 ${numericGid} 狗信息失败: ${err.message}`, {
      module: 'friend',
      event: '获取好友狗信息',
      result: 'error',
      friendGid: numericGid,
      error: err.message,
    });
    return { dogId: 0, dogName: '无狗' };
  }
}

/**
 * Batch get dog info for multiple friends.
 * Returns: { map: Map<gid, dogInfo>, failCount, blacklistCount }
 */
async function batchGetFriendDogInfo(friends) {
  const dogMap = new Map();
  const friendList = Array.isArray(friends) ? friends : [];
  let noDogCount = 0;
  let blacklistCount = 0;
  let cleanRounds = 0;
  let quota = 10;
  let roundCount = 0;
  const BATCH_LOG_INTERVAL = 30;
  const BATCH_SLEEP_MS = 1000;
  const accountId = process.env.FARM_ACCOUNT_ID || '';
  const blacklist = new Set(getFriendBlacklist(accountId));

  // Normalize entries
  const entries = friendList
    .map(entry => {
      if (typeof entry === 'object' && entry !== null) {
        return { gid: toNum(entry.gid), name: entry.name || `GID:${toNum(entry.gid)}` };
      }
      return { gid: toNum(entry), name: `GID:${toNum(entry)}` };
    })
    .filter(e => e.gid > 0);

  for (let i = 0; i < entries.length; i++) {
    const health = getGatewayHealth();
    const deferredKind = classifyGatewayDefer(health);
    if (deferredKind) {
      return {
        map: dogMap,
        failCount: noDogCount,
        blacklistCount,
        deferredGids: entries.slice(i).map(entry => entry.gid),
        deferredKind,
        retryMs: planNextSyncPacing({ cleanRounds, deferredKind }).retryMs,
      };
    }
    const entry = entries[i];
    const gid = entry.gid;

    if (blacklist.has(gid)) {
      blacklistCount++;
      dogMap.set(gid, { dogId: 0, dogName: '无狗', blacklisted: true });
      continue;
    }

    const dogInfo = await getFriendDogInfo(gid, entry.name);
    if (dogInfo.dogId === 0) noDogCount++;
    if (dogInfo.blacklisted) {
      blacklistCount++;
      blacklist.add(gid);
    }
    dogMap.set(gid, dogInfo);
    roundCount++;

    if (i < entries.length - 1) {
      await randomDelay(500, 1500);
    }

    if (roundCount >= quota && i < entries.length - 1) {
      const pacing = planNextSyncPacing({ cleanRounds });
      cleanRounds = pacing.cleanRounds;
      quota = pacing.quota;
      roundCount = 0;
      await sleep(1000);
    } else if ((i + 1) % BATCH_LOG_INTERVAL === 0 && i < entries.length - 1) {
      await sleep(BATCH_SLEEP_MS);
    }
  }

  return { map: dogMap, failCount: noDogCount, blacklistCount, deferredGids: [], deferredKind: '', retryMs: 0 };
}

// ===== Friends list =====
let friendsListCache = null;
let friendsListRefreshAt = 0;
let friendsListPending = null;
const FRIEND_LIST_REFRESH_MS = 5 * 60 * 1000;

/**
 * Get a processed friends list with dog info from cache if available.
 * Filters out fake NPCs (name "小小农夫" with level 1).
 */
async function getFriendsList(forceRefresh = false) {
  if (friendsListPending) return friendsListPending;
  if (!forceRefresh && Date.now() < friendsListRefreshAt) return friendsListCache || [];
  friendsListRefreshAt = Date.now() + FRIEND_LIST_REFRESH_MS;
  friendsListPending = fetchFriendsList();
  try {
    return await friendsListPending;
  } finally {
    friendsListPending = null;
  }
}

async function fetchFriendsList() {
  try {
    log('好友', '开始获取好友列表', {
      module: 'friend',
      event: '获取好友列表',
    });

    const { getAllFriends } = require('./friend-api');
    const allFriendsReply = await getAllFriends(true);
    const rawFriends = allFriendsReply.game_friends || [];
    const userState = getUserState();
    const accountId = process.env.FARM_ACCOUNT_ID || '';
    const dogInfoCache = accountId ? readFriendDogInfoCache(accountId) : null;

    const friends = rawFriends
      .filter(friend => {
        // Exclude self
        if (toNum(friend.gid) === userState.gid) return false;
        // Exclude fake NPC
        if (
          (friend.name === '小小农夫' || friend.remark === '小小农夫') &&
          toNum(friend.level) === 1
        ) {
          return false;
        }
        return true;
      })
      .map(friend => {
        const gid = toNum(friend.gid);
        const cachedDog = dogInfoCache && dogInfoCache[gid] ? dogInfoCache[gid] : null;
        return {
          gid,
          name: friend.remark || friend.name || `GID:${gid}`,
          avatarUrl: String(friend.avatar_url || '').trim(),
          level: toNum(friend.level),
          gold: toNum(friend.gold),
          dogId: cachedDog ? cachedDog.dogId : 0,
          dogName: cachedDog ? cachedDog.dogName : '',
          plant: friend.plant
            ? {
                stealNum: toNum(friend.plant.steal_plant_num),
                dryNum: toNum(friend.plant.dry_num),
                weedNum: toNum(friend.plant.weed_num),
                insectNum: toNum(friend.plant.insect_num),
              }
            : null,
        };
      })
      .sort((a, b) => {
        const cmp = (a.name || '').localeCompare(b.name || '', 'zh-CN');
        if (cmp !== 0) return cmp;
        return (a.gid || 0) - (b.gid || 0);
      });

    friendsListCache = friends;

    const cachedDogCount = dogInfoCache ? Object.keys(dogInfoCache).length : 0;
    log('好友',
      `获取好友列表成功，共 ${friends.length} 位好友${ 
        cachedDogCount > 0 ? `，已从缓存加载 ${cachedDogCount} 个狗信息` : ''}`,
      {
        module: 'friend',
        event: '获取好友列表',
        result: 'ok',
        count: friends.length,
        cachedDogInfoCount: cachedDogCount,
      }
    );

    return friends;
  } catch (err) {
    log('好友', `获取好友列表失败: ${err.message}`, {
      module: 'friend',
      event: '获取好友列表',
      result: 'error',
      error: err.message,
    });
    return [];
  }
}

/**
 * Fetch dog info for all friends in the list.
 * Caches guard dog (护主犬, id=90021) info locally.
 */
async function fetchFriendsDogInfo() {
  const accountId = process.env.FARM_ACCOUNT_ID || '';
  let friends = friendsListCache;

  if (!friends || friends.length === 0) {
    friends = await getFriendsList(true);
  }

  if (!friends || friends.length === 0) {
    return { ok: false, error: '好友列表为空，请先获取好友列表' };
  }

  const dogTargets = friends.map(f => ({
    gid: toNum(f.gid),
    name: f.name || `GID:${toNum(f.gid)}`,
  }));

  const syncResult = await runWithRequestPriority('background', () => batchGetFriendDogInfo(dogTargets));
  const { map: dogMap, failCount, blacklistCount } = syncResult;

  const allDogFriends = {};
  for (const friend of friends) {
    const dogInfo = dogMap.get(friend.gid);
    if (dogInfo) {
      friend.dogId = dogInfo.dogId;
      friend.dogName = dogInfo.dogName;
      friend.blacklisted = dogInfo.blacklisted || false;
      if (friend.dogId > 0) {
        allDogFriends[friend.gid] = {
          dogId: friend.dogId,
          dogName: friend.dogName,
        };
      }
    }
  }

  friendsListCache = friends;

  // Persist all dog info to disk cache
  if (accountId && syncResult.deferredGids.length === 0) {
    writeFriendDogInfoCache(accountId, allDogFriends);
  }

  const guardDogCount = friends.filter(f => f.dogId === 90021).length;
  const otherDogCount = friends.filter(f => f.dogId > 0 && f.dogId !== 90021).length;
  const totalDogCount = guardDogCount + otherDogCount;

  log('好友',
    `获取狗信息完成：共 ${friends.length} 位好友，其中养狗 ${totalDogCount} 位 (护主犬 ${guardDogCount} / 其他宠物犬 ${otherDogCount})，无狗 ${failCount} 位，黑名单 ${blacklistCount} 位`,
    {
      module: 'friend',
      event: '狗信息',
      result: 'ok',
      count: friends.length,
      totalDogCount,
      guardDogCount,
      otherDogCount,
      failCount,
      blacklistCount,
    }
  );

  return {
    ok: syncResult.deferredGids.length === 0,
    complete: syncResult.deferredGids.length === 0,
    friends,
    failCount,
    blacklistCount,
    guardDogCount,
    deferredGids: syncResult.deferredGids,
    deferredKind: syncResult.deferredKind,
    retryMs: syncResult.retryMs,
  };
}

// ===== Friend lands detail =====

/**
 * Get a friend's lands in detail (for frontend display).
 */
async function getFriendLandsDetail(gid) {
  try {
    const enterReply = await enterFriendFarm(gid);
    const lands = enterReply.lands || [];
    const userState = getUserState();
    const plantBlacklist = getPlantBlacklist(userState.accountId);
    const analysis = analyzeFriendLands(lands, userState.gid, '', { plantBlacklist });
    await leaveFriendFarm(gid);

    const detailLands = [];
    const serverTimeSec = getServerTimeSec();
    const landMap = buildLandMap(lands);

    for (const land of lands) {
      const landId = toNum(land.id);
      const landLevel = toNum(land.level);
      const isUnlocked = !!land.unlocked;
      const { sourceLand, occupiedByMaster, masterLandId, occupiedLandIds } =
        getDisplayLandContext(land, landMap);

      // Locked land
      if (!isUnlocked) {
        detailLands.push({
          id: landId,
          unlocked: false,
          status: 'locked',
          plantName: '',
          phaseName: '未解锁',
          level: landLevel,
          needWater: false,
          needWeed: false,
          needBug: false,
          occupiedByMaster: false,
          masterLandId: 0,
          occupiedLandIds: [],
          plantSize: 1,
        });
        continue;
      }

      const targetPlant = (sourceLand && sourceLand.plant) || land.plant;

      // Empty land
      if (!targetPlant || !targetPlant.phases || targetPlant.phases.length === 0) {
        detailLands.push({
          id: landId,
          unlocked: true,
          status: 'empty',
          plantName: '',
          phaseName: '空地',
          level: landLevel,
          occupiedByMaster,
          masterLandId,
          occupiedLandIds,
          plantSize: 1,
        });
        continue;
      }

      const currentPhase = getCurrentPhase(targetPlant.phases, false, '', targetPlant.id);
      if (!currentPhase) {
        detailLands.push({
          id: landId,
          unlocked: true,
          status: 'empty',
          plantName: '',
          phaseName: '',
          level: landLevel,
          occupiedByMaster,
          masterLandId,
          occupiedLandIds,
          plantSize: 1,
        });
        continue;
      }

      const phase = currentPhase.phase;
      const plantId = toNum(targetPlant.id);
      const mutantConfigIds = targetPlant.mutant_config_ids || [];
      const displayPlantId = getMutantDisplayPlantId(plantId, mutantConfigIds);
      const plantName = getPlantName(displayPlantId) || getPlantName(plantId) || targetPlant.name || '未知';
      const plantInfo = getPlantById(plantId);
      const seedId = toNum(plantInfo && plantInfo.seed_id);
      const seedImage = seedId > 0 ? getSeedImageBySeedId(seedId) : '';
      const plantImage = getMutantPlantImageByPhase(plantId, mutantConfigIds, toNum(currentPhase.image_phase));
      const plantSize = Math.max(1, toNum(plantInfo && plantInfo.size) || 1);
      const totalSeasons = Math.max(1, toNum(plantInfo && plantInfo.seasons) || 1);
      const currentSeasonRaw = toNum(targetPlant.season);
      const currentSeason =
        currentSeasonRaw > 0 ? Math.min(currentSeasonRaw, totalSeasons) : 1;
      const phaseName = currentPhase.phaseName || PHASE_NAMES[phase] || '';

      // Compute maturity time
      const maturePhase = Array.isArray(targetPlant.phases)
        ? targetPlant.phases
          .filter(p => p && toTimeSec(p.begin_time) > 0)
          .sort((left, right) => toTimeSec(right.begin_time) - toTimeSec(left.begin_time))[0]
        : null;
      const matureTimeSec = maturePhase ? toTimeSec(maturePhase.begin_time) : 0;
      const matureInSec = matureTimeSec > serverTimeSec ? matureTimeSec - serverTimeSec : 0;
      const phaseStartTime = toTimeSec(currentPhase.begin_time);
      const nextPhaseData = Array.isArray(targetPlant.phases)
        ? targetPlant.phases
          .filter(item => item && toTimeSec(item.begin_time) > phaseStartTime)
          .sort((left, right) => toTimeSec(left.begin_time) - toTimeSec(right.begin_time))[0]
        : null;
      const phaseEndTime = nextPhaseData ? toTimeSec(nextPhaseData.begin_time) : 0;
      const totalGrowTime = getPlantGrowTime(plantId);

      // Determine status
      let status = 'growing';
      if (phase === PlantPhase.MATURE) {
        status = targetPlant.stealable ? 'stealable' : 'harvested';
      } else if (phase === PlantPhase.DEAD) {
        status = 'dead';
      }

      // Mutant effects
      const mutantEffects = getMutantEffectsByIds(mutantConfigIds);
      const qixiDew = getQixiDewStatus(targetPlant);

      detailLands.push({
        id: landId,
        unlocked: true,
        status,
        plantName,
        plantId,
        displayPlantId,
        seedId,
        seedImage,
        plantImage,
        phase,
        imagePhase: toNum(currentPhase.image_phase),
        phaseName,
        currentSeason,
        totalSeason: totalSeasons,
        level: landLevel,
        matureInSec,
        phaseStartTime,
        phaseEndTime,
        totalGrowTime,
        needWater: toNum(targetPlant.dry_num) > 0,
        needWeed: targetPlant.weed_owners && targetPlant.weed_owners.length > 0,
        needBug: targetPlant.insect_owners && targetPlant.insect_owners.length > 0,
        occupiedByMaster,
        masterLandId,
        occupiedLandIds,
        plantSize,
        mutantEffects,
        qixiDew,
      });
    }

    return { lands: detailLands, summary: analysis };
  } catch {
    return { lands: [], summary: {} };
  }
}

// ===== Cache accessors =====

function getFriendsListCache() {
  return friendsListCache;
}

function setFriendsListCache(cache) {
  friendsListCache = cache;
  friendsListRefreshAt = cache ? Date.now() + FRIEND_LIST_REFRESH_MS : 0;
}

// ===== Exports =====
module.exports = {
  analyzeFriendLands,
  getFriendDogInfo,
  batchGetFriendDogInfo,
  getFriendsList,
  fetchFriendsDogInfo,
  getFriendLandsDetail,
  getFriendsListCache,
  setFriendsListCache,
};
