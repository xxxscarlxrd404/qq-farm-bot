const path = require('node:path');
const process = require('node:process');
const { readJsonFile, writeJsonFileAtomic } = require('../services/json-db');

function getHistoryFilePath(accountId) {
  const baseDir = process.env.FARM_DATA_DIR || path.join(__dirname, '../../data');
  return path.join(baseDir, 'stats', `history_${accountId}.json`);
}

function getStatsFilePath(accountId) {
  const baseDir = process.env.FARM_DATA_DIR || path.join(__dirname, '../../data');
  return path.join(baseDir, 'stats', `${accountId}.json`);
}

function getCareerCacheFilePath(accountId) {
  const baseDir = process.env.FARM_DATA_DIR || path.join(__dirname, '../../data');
  return path.join(baseDir, 'stats', `career_${accountId}.json`);
}

function getTodayKey() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 记录或更新当天的收益历史
 */
function recordDailyHistory(accountId, dateKey, gains) {
  try {
    const file = getHistoryFilePath(accountId);
    const history = readJsonFile(file, {}) || {};
    if (!history[dateKey]) {
      history[dateKey] = {
        gold: 0,
        exp: 0,
        steal: 0,
        harvest: 0,
        operations: 0,
      };
    }
    history[dateKey].gold = Math.max(history[dateKey].gold || 0, gains.gold || 0);
    history[dateKey].exp = Math.max(history[dateKey].exp || 0, gains.exp || 0);
    history[dateKey].steal = Math.max(history[dateKey].steal || 0, gains.steal || 0);
    history[dateKey].harvest = Math.max(history[dateKey].harvest || 0, gains.harvest || 0);
    history[dateKey].operations = Math.max(history[dateKey].operations || 0, gains.operations || 0);
    history[dateKey].updatedAt = Date.now();
    writeJsonFileAtomic(file, history);
  } catch (err) {
    console.error(`[Ranking] 记录历史收益失败: ${err.message}`);
  }
}

/**
 * 获取某个账号在指定时间段内的累计收益（联动实时内存 + 磁盘持久化）
 */
function getAccountGains(accountId, range = 'day', liveStatus = null) {
  const todayKey = getTodayKey();
  const statsFile = getStatsFilePath(accountId);
  const currentStats = readJsonFile(statsFile, null);

  let liveGold = 0;
  let liveExp = 0;
  let liveSteal = 0;
  let liveHarvest = 0;
  let liveOps = 0;

  if (liveStatus && typeof liveStatus === 'object') {
    // 优先读取今日纯收入（只计正向增加，不计损耗），兼容兜底 sessionGoldGained
    liveGold = Math.max(0, Number(liveStatus.dailyGoldIncome ?? liveStatus.dailyIncome?.gold ?? liveStatus.sessionGoldGained) || 0);
    liveExp = Math.max(0, Number(liveStatus.dailyExpIncome ?? liveStatus.dailyIncome?.exp ?? liveStatus.sessionExpGained) || 0);
    liveSteal = Number(liveStatus.operations?.steal) || 0;
    liveHarvest = Number(liveStatus.operations?.harvest) || 0;
    liveOps = Object.values(liveStatus.operations || {}).reduce((a, b) => Number(a || 0) + Number(b || 0), 0);
  }

  let fileGold = 0;
  let fileExp = 0;
  let fileSteal = 0;
  let fileHarvest = 0;
  let fileOps = 0;

  // 若当前在线且已跨天（liveStatus 中的 date 与 todayKey 不一致），不采用旧会话增量
  if (liveStatus && liveStatus.operations) {
    const liveDate = liveStatus.date || currentStats?.date;
    if (liveDate && liveDate !== todayKey) {
      liveGold = 0;
      liveExp = 0;
      liveSteal = 0;
      liveHarvest = 0;
      liveOps = 0;
    }
  }

  if (currentStats && currentStats.date === todayKey) {
    if (currentStats.dailyIncome) {
      fileGold = Number(currentStats.dailyIncome.gold) || 0;
      fileExp = Number(currentStats.dailyIncome.exp) || 0;
    } else if (currentStats.gains) {
      fileGold = Number(currentStats.gains.gold) || 0;
      fileExp = Number(currentStats.gains.exp) || 0;
    } else if (currentStats.initialState && currentStats.lastState) {
      fileGold = Math.max(0, (Number(currentStats.lastState.gold) || 0) - (Number(currentStats.initialState.gold) || 0));
      fileExp = Math.max(0, (Number(currentStats.lastState.exp) || 0) - (Number(currentStats.initialState.exp) || 0));
    }
    fileSteal = Number(currentStats.operations?.steal) || 0;
    fileHarvest = Number(currentStats.operations?.harvest) || 0;
    fileOps = Object.values(currentStats.operations || {}).reduce((a, b) => Number(a || 0) + Number(b || 0), 0);
  } else {
    // 跨天后持久化文件尚未生成新日期，今日各项数据干净清零
    fileGold = 0;
    fileExp = 0;
    fileSteal = 0;
    fileHarvest = 0;
    fileOps = 0;
  }

  const todayGold = Math.max(liveGold, fileGold);
  const todayExp = Math.max(liveExp, fileExp);
  const todaySteal = Math.max(liveSteal, fileSteal);
  const todayHarvest = Math.max(liveHarvest, fileHarvest);
  const todayOps = Math.max(liveOps, fileOps);

  recordDailyHistory(accountId, todayKey, {
    gold: todayGold,
    exp: todayExp,
    steal: todaySteal,
    harvest: todayHarvest,
    operations: todayOps,
  });

  if (range === 'day') {
    return {
      gold: todayGold,
      exp: todayExp,
      steal: todaySteal,
      harvest: todayHarvest,
      operations: todayOps,
    };
  }

  const daysLimit = range === 'week' ? 7 : 30;
  const historyFile = getHistoryFilePath(accountId);
  const history = readJsonFile(historyFile, {}) || {};

  let totalGold = 0;
  let totalExp = 0;
  let totalSteal = 0;
  let totalHarvest = 0;
  let totalOps = 0;

  const nowMs = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  for (let i = 0; i < daysLimit; i++) {
    const targetDate = new Date(nowMs - i * oneDayMs);
    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, '0');
    const d = String(targetDate.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    const entry = history[dateStr];
    if (entry) {
      totalGold += Number(entry.gold) || 0;
      totalExp += Number(entry.exp) || 0;
      totalSteal += Number(entry.steal) || 0;
      totalHarvest += Number(entry.harvest) || 0;
      totalOps += Number(entry.operations) || 0;
    }
  }

  return {
    gold: totalGold,
    exp: totalExp,
    steal: totalSteal,
    harvest: totalHarvest,
    operations: totalOps,
  };
}

function registerAdminRankingRoutes({ app, store, provider }) {
  /**
   * GET /api/ranking?range=day&metric=gold
   */
  app.get('/api/ranking', async (req, res) => {
    try {
      const range = String(req.query.range || 'day').toLowerCase();
      const validRange = ['day', 'week', 'month'].includes(range) ? range : 'day';
      const metric = String(req.query.metric || 'gold').toLowerCase();

      const emptyAccounts = { accounts: [] };
      const storedAccounts = store.getAccounts ? store.getAccounts() : emptyAccounts;
      const accountList = Array.isArray(storedAccounts.accounts) ? storedAccounts.accounts : [];

      const rankings = [];

      // 确保农场账号唯一性：如果数据库存在历史遗留重复记录，按 uin/openId 排他去重
      const seenEntities = new Set();
      const uniqueAccountList = [];
      for (const acc of [...accountList].reverse()) {
        const entityKey = acc.uin ? `qq_${acc.uin}` : (acc.openId ? `wx_${acc.openId}` : (acc.wxid ? `wx_${acc.wxid}` : `id_${acc.id}`));
        if (!seenEntities.has(entityKey)) {
          seenEntities.add(entityKey);
          uniqueAccountList.unshift(acc);
        }
      }

      for (const acc of uniqueAccountList) {
        const accountId = String(acc.id);

        let liveStatus = null;
        let liveLevel = 0;
        let isOnline = false;

        try {
          if (provider && typeof provider.getStatus === 'function') {
            liveStatus = provider.getStatus(accountId);
            if (liveStatus && liveStatus.status) {
              liveLevel = Number(liveStatus.status.level) || 0;
              isOnline = !!liveStatus.connection?.connected;
            }
          }
        } catch {}

        const statsFile = getStatsFilePath(accountId);
        const persisted = readJsonFile(statsFile, null);
        const savedLevel = Number(persisted?.profile?.level) || 0;
        const savedNick = persisted?.profile?.name || '';

        const effectiveLevel = liveLevel || savedLevel || Number(acc.level) || 1;
        const effectiveNick = acc.nick || savedNick || acc.name || `农友 #${accountId}`;

        const gains = getAccountGains(accountId, validRange, liveStatus);

        let avatarUrl = acc.avatar || '';
        if (!avatarUrl && persisted?.profile?.avatar) {
          avatarUrl = persisted.profile.avatar;
        }
        if (!avatarUrl && acc.uin) {
          avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${acc.uin}&s=100`;
        }

        rankings.push({
          id: accountId,
          name: effectiveNick,
          accountName: acc.name,
          platform: (acc.platform || 'qq').toLowerCase(),
          username: acc.username || 'admin',
          avatar: avatarUrl,
          level: effectiveLevel,
          isOnline,
          gains: {
            gold: gains.gold,
            exp: gains.exp,
            steal: gains.steal,
            harvest: gains.harvest,
            operations: gains.operations,
          },
        });
      }

      // 过滤：当金币或偷菜数据为 0 时不予上榜（仅展示有战绩产出的账号）
      const qualified = rankings.filter(item => {
        const val = Number(item.gains[metric] ?? item.gains.gold) || 0;
        return val > 0;
      });

      // 排序
      qualified.sort((a, b) => {
        const valA = Number(a.gains[metric] ?? a.gains.gold) || 0;
        const valB = Number(b.gains[metric] ?? b.gains.gold) || 0;
        if (valB !== valA) return valB - valA;
        return Number(b.level || 0) - Number(a.level || 0);
      });

      // 为减少服务器压力与网络开销，排行榜仅展示前 15 名
      const rankedList = qualified.slice(0, 15).map((item, index) => ({
        rank: index + 1,
        ...item,
      }));

      res.json({
        ok: true,
        data: {
          range: validRange,
          metric,
          list: rankedList,
          total: rankedList.length,
          updatedAt: Date.now(),
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/ranking/career/:id
   * 公开只读脱敏生涯接口（无 GID、无财务余额、无敏感信息泄露）
   */
  app.get('/api/ranking/career/:id', async (req, res) => {
    try {
      const accountId = String(req.params.id || '');
      if (!accountId) return res.status(400).json({ ok: false, error: '缺少账号ID' });

      // 1. 查找账号基本信息
      const storedAccounts = store.getAccounts ? store.getAccounts() : { accounts: [] };
      const accountList = Array.isArray(storedAccounts.accounts) ? storedAccounts.accounts : [];
      const account = accountList.find(a => String(a.id) === accountId);
      if (!account) return res.status(404).json({ ok: false, error: '未找到该农场主' });

      let careerData = null;
      let liveStatus = null;
      try {
        if (provider && typeof provider.getStatus === 'function') {
          liveStatus = provider.getStatus(accountId);
        }
      } catch {}

      const isConnected = !!liveStatus?.connection?.connected;
      const gid = Number(account.gid || liveStatus?.status?.gid) || 0;

      // 2. 在线且有 GID 时，尝试从服务端拉取最新生涯并更新缓存
      if (isConnected && gid && typeof provider.getCareerInfo === 'function') {
        try {
          const fresh = await provider.getCareerInfo(accountId, gid);
          if (fresh) {
            careerData = fresh;
            writeJsonFileAtomic(getCareerCacheFilePath(accountId), { ...fresh, cachedAt: Date.now() });
          }
        } catch {}
      }

      // 3. 若未拉取到（如账号离线），读取历史持久化缓存
      if (!careerData) {
        careerData = readJsonFile(getCareerCacheFilePath(accountId), null);
      }

      // 4. 若仍无生涯，则基于基础 stats 构建安全兜底名片
      const statsFile = getStatsFilePath(accountId);
      const persisted = readJsonFile(statsFile, null);

      const totalHarvest = Number(careerData?.totalHarvestCount ?? persisted?.operations?.harvest ?? 0);
      const totalSteal = Number(careerData?.totalStealCount ?? persisted?.operations?.steal ?? 0);
      const items = Array.isArray(careerData?.items) ? careerData.items.slice(0, 5) : [];

      // 绝对脱敏：剔除 GID, openId, token, balance，仅保留荣誉数据
      res.json({
        ok: true,
        data: {
          name: account.nick || careerData?.name || account.name || '农友',
          avatar: account.avatar || careerData?.avatar || '',
          level: Number(liveStatus?.status?.level || persisted?.profile?.level || careerData?.level || account.level || 1),
          platform: (account.platform || 'qq').toLowerCase(),
          isOnline: isConnected,
          totalHarvestCount: totalHarvest,
          totalStealCount: totalSteal,
          topItems: items,
          cached: !isConnected,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}

module.exports = {
  registerAdminRankingRoutes,
  recordDailyHistory,
  getAccountGains,
};
