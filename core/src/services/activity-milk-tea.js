const catalog = require('../activity-data/milk-tea-20261015.json');
const { serializeMutation, businessError, positiveDecimal } = require('./activity-center-helpers');
const NON_NEGATIVE_INTEGER = /^\d+$/;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
function toBigIntCount(value) {
  const text = String(value ?? '');
  return NON_NEGATIVE_INTEGER.test(text) ? BigInt(text) : null;
}

function normalizeWireMaps(value) {
  if (Array.isArray(value)) return value.map(normalizeWireMaps);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const normalized = key.length === 8 && [...key].some(char => char.charCodeAt(0) < 32) ? require('protobufjs/minimal').util.longFromHash(key, false).toString() : key;
    return [normalized, normalizeWireMaps(item)];
  }));
}
const WINDOW = { startTime: 1792029600, settleTime: 1794671999, endTime: 1794844799 };
const ACTIONS = { create: [53, 'create_shop'], rename: [54, 'rename_shop'], shop: [55, 'get_shop'], hireList: [56, 'get_hire_list'], hire: [57, 'hire'], workshop: [58, 'get_workshop'], cashier: [59, 'claim_cashier'], boost: [60, 'boost'], upgrade: [61, 'upgrade'], craft: [62, 'craft'], work: [63, 'get_work_page'], wages: [64, 'claim_wages'], interact: [65, 'interact'], rank: [66, 'get_rank'], sales: [67, 'get_sales_log'], hireDisabled: [68, 'set_hire_disable'] };
const AUTO_ACTIONS = { milk_tea_cashier: 'cashier', milk_tea_wages: 'wages', milk_tea_upgrade: 'upgrade', milk_tea_craft: 'craft', milk_tea_boost: 'boost', milk_tea_hire: 'hire', milk_tea_seed_buy: 'buy', milk_tea_share_daily: 'shareDaily', milk_tea_share_rewards: 'shareRewards', milk_tea_fund_rewards: 'fundRewards' };
function phase(now, window = WINDOW) { return now < window.startTime ? 'upcoming' : now > window.endTime ? 'ended' : now >= window.settleTime ? 'settling' : 'business'; }
// Official S4ShopUI: available, sold out, locked; then configured order.
function compareShopGoods(a, b) {
  const group = goods => !goods.unlocked ? 3 : Number(goods.remaining) === 0 ? 2 : 1;
  return group(a) - group(b) || Number(a.order || 0) - Number(b.order || 0);
}
const ACTION_LABELS = { create: '开业', rename: '修改店名', hire: '雇佣员工', cashier: '领取收益', boost: '使用宣传喇叭', upgrade: '升级店铺', craft: '制作奶茶', wages: '领取工资', interact: '打工互动', hireDisabled: '设置被雇佣状态', buy: '购买商品', shareDaily: '领取每日快乐值', shareRewards: '领取快乐值奖励', fundRewards: '领取成长基金奖励' };
function normalizeHireOptions(input = {}) {
  return {
    durationId: [1, 2, 3].includes(Number(input.durationId)) ? Number(input.durationId) : 1,
    talentId: [0, 9001, 9002, 9003, 9004].includes(Number(input.talentId)) ? Number(input.talentId) : 0,
  };
}
function selectHireCandidate(candidates, input, now) {
  const { talentId } = normalizeHireOptions(input);
  const idle = entry => entry?.friend?.gid && Number(entry.state) === 0
    && Number(entry.state_until_at || 0) <= now && Number(entry.rehire_available_at || 0) <= now;
  const friends = (candidates.friends || []).filter(entry => !entry.is_robot && idle(entry));
  const robots = (candidates.robots || []).filter(idle);
  if (talentId === 9004) return robots[0];
  return friends.find(entry => !talentId || Number(entry.talent_id) === talentId)
    || friends[0] || robots[0];
}
function createMilkTeaService({ types, sendMsgAsync, getBag, getBagItems, getServerTimeSec, itemDto, accountId = '', getUserState = () => ({}), log = require('../utils/utils').log }) {
  const fail = message => { throw businessError('MILK_TEA_UNAVAILABLE', message); };
  const list = value => Array.isArray(value) ? value : [];
  const plain = (type, value) => type.toObject(value, { longs: String, defaults: true });
  let pendingRead;
  async function rpc(method, requestType, replyType, input) {
    const { body } = await sendMsgAsync('gamepb.activitypb.ActivityService', method, Buffer.from(requestType.encode(requestType.fromObject(input)).finish()));
    return normalizeWireMaps(plain(replyType, replyType.decode(body)));
  }
  async function op(action, input = {}, id = '2026110101') {
    const [cmd, suffix] = ACTIONS[action]; const selector = `milk_tea_${suffix}`;
    const reply = await rpc('Operate', types.MilkTeaOperateRequest, types.MilkTeaOperateReply, { id, cmd, [selector]: input });
    if (reply.id !== id || Number(reply.cmd) !== cmd || !reply[selector]) fail('活动响应不匹配，请刷新后查看');
    return reply[selector];
  }
  async function bag() {
    const inventory = [...list(getBagItems(await getBag()))];
    // Base currencies can live in account state rather than BagReply.items.
    const account = getUserState() || {};
    if (!inventory.some(item => String(item.id) === '1001') && account.gold != null)
      inventory.push({ id: '1001', count: String(account.gold) });
    return inventory;
  }
  function available(costs, inventory, count = 1) {
    const requestedCount = toBigIntCount(count);
    if (!requestedCount || requestedCount === 0n || costs.length === 0) return false;
    return costs.every(cost => {
      if (Number(cost.id) === 1004) return false;
      const costCount = toBigIntCount(cost.count);
      if (!costCount || costCount === 0n) return false;
      const owned = inventory
        .filter(item => String(item.id) === String(cost.id))
        .reduce((sum, item) => sum + (toBigIntCount(item.count) || 0n), 0n);
      return owned >= costCount * requestedCount;
    });
  }
  function maximumPurchase(goods, inventory) {
    if (!goods.unlocked || goods.paid || !goods.costs.length) return 0;
    let maximum = toBigIntCount(goods.remaining);
    if (maximum === null || maximum === 0n) return 0;
    for (const cost of goods.costs) {
      const costCount = toBigIntCount(cost.count);
      if (Number(cost.id) === 1004 || costCount === null || costCount === 0n) return 0;
      const owned = inventory
        .filter(item => String(item.id) === String(cost.id))
        .reduce((sum, item) => sum + (toBigIntCount(item.count) || 0n), 0n);
      const affordable = owned / costCount;
      if (affordable < maximum) maximum = affordable;
    }
    return Number(maximum > MAX_SAFE_BIGINT ? MAX_SAFE_BIGINT : maximum);
  }
  async function read() {
    const reply = await rpc('GetGroup', types.ActivityGetGroupRequest, types.MilkTeaGetGroupReply, { id: '2026110100' });
    if (reply.group?.head?.id !== '2026110100') fail('未读取到奶茶热销中活动');
    const children = list(reply.group.children); const node = children.find(x => x.head?.id === '2026110101');
    if (!node) {
      throw businessError('MILK_TEA_NOT_PARTICIPATING', '当前账号未参与奶茶热销中活动');
    }
    if (!node.milk_tea?.summary) {
      const fields = Object.keys(node).filter(key => key !== 'head');
      fail(`活动协议读取失败：子活动 2026110101 缺少 milk_tea.summary（返回字段: ${fields.join(', ') || '无'}）`);
    }
    const head = node.head; const now = getServerTimeSec();
    const window = { startTime: Number(head.start_time), endTime: Number(head.end_time), settleTime: Number(head.settle_start_time) };
    if (!window.startTime || !window.endTime || !window.settleTime) fail('活动时间无效');
    const state = { id: head.id, title: head.name, ...window, serverTime: now, phase: phase(now, window), summary: node.milk_tea.summary, rules: head.desc };
    if (!['business', 'settling'].includes(state.phase)) return state;
    const opened = Number(state.summary.shop_open_at) > 0;
    const shop = opened ? await op('shop') : { shop: null };
    const workshop = opened ? await op('workshop') : { recipes: [] };
    const work = await op('work'); const inventory = await bag();
    const recipes = list(workshop.recipes).map(recipe => ({ ...recipe, config: catalog.MilkTeaRecipeConfig.find(x => String(x.recipe_id) === recipe.recipe_id), fruits: inventory.filter(x => String(x.id) === String(catalog.MilkTeaRecipeConfig.find(c => String(c.recipe_id) === recipe.recipe_id)?.fruit_item_id?.split(':')[0])).map(x => ({ ...itemDto(x), uid: String(x.uid) })) }));
    const goods = list(children.find(x => x.head?.id === '2026110102')?.shop?.goods).map(g => {
      const purchaseLimit = toBigIntCount(g.purchase_limit);
      const purchasedCount = toBigIntCount(g.purchased_count);
      const remaining = purchaseLimit !== null && purchasedCount !== null && purchaseLimit > purchasedCount
        ? Number(purchaseLimit - purchasedCount > MAX_SAFE_BIGINT ? MAX_SAFE_BIGINT : purchaseLimit - purchasedCount)
        : 0;
      return { ...g, items: list(g.item).map(itemDto), costs: list(g.cost).map(itemDto), remaining, unlocked: list(g.cond_hints).every(x => x.satisfied), affordable: available(list(g.cost), inventory), paid: Number(g.diamond_cost_count) > 0 || list(g.cost).some(x => Number(x.id) === 1004) };
    });
    for (const good of goods) good.maxPurchasable = state.phase !== 'business' && good.category_tag === 'seed' ? 0 : maximumPurchase(good, inventory);
    goods.sort(compareShopGoods);
    // QQ native subscription URLs contain signatures; never expose them to web or logs.
    delete work.hire_subscribe_qq_jump_url; delete work.hire_subscribe_template_id;
    const share = children.find(x => x.head?.id === '2026110104')?.share_reward?.summary;
    const fund = children.find(x => x.head?.id === '2026110103')?.growth_fund;
    const levels = catalog.MilkTeaStoreLevelConfig.map(level => ({ ...level,
      rewards: String(level.rewards || '').split(';').filter(Boolean).map(pair => { const [id, count] = pair.split(':'); return itemDto({ id, count }); }),
      recipe_names: String(level.recipe_ids_string || '').split(';').map(id => catalog.MilkTeaRecipeConfig.find(recipe => String(recipe.recipe_id) === id)?.recipe_name).filter(Boolean),
    }));
    const shareView = share ? { ...share, milestones: list(share.milestones).map(tier => ({ ...tier, rewards: list(tier.rewards).map(itemDto) })) } : null;
    const fundView = fund ? { ...fund, unlock_cost: list(fund.unlock_cost).map(itemDto), tiers: list(fund.tiers).map(tier => ({ ...tier, reward: list(tier.reward).map(itemDto) })) } : null;
    return { ...state, share: shareView, fund: fundView, shop: shop.shop, recipes, work, goods, balances: ['1001', '1004', '1041', '1042'].map(id => itemDto({ id, count: inventory.filter(x => String(x.id) === id).reduce((n, x) => n + (toBigIntCount(x.count) || 0n), 0n).toString() })), levels, durations: catalog.MilkTeaHireDurationConfig, interactions: catalog.MilkTeaInteractionType };
  }
  function getMilkTea() { if (!pendingRead) pendingRead = read().finally(() => { pendingRead = null; }); return pendingRead; }
  async function mutate(action, input = {}) {
    if (!ACTIONS[action] && !['buy', 'shareDaily', 'shareRewards', 'fundRewards'].includes(action)) fail('活动操作无效');
    const state = await getMilkTea(); const inventory = await bag(); const now = getServerTimeSec();
    state.phase = phase(now, state);
    if (!['business', 'settling'].includes(state.phase)) fail('活动未开始或已结束');
    if (state.phase !== 'business' && !['cashier', 'wages', 'buy', 'shareDaily', 'shareRewards', 'fundRewards'].includes(action)) fail('结算期不支持此操作');
    if (!['create', 'shareDaily', 'shareRewards', 'fundRewards'].includes(action) && !Number(state.summary.shop_open_at)) fail('请先开业');
    let params = {};
    let detail = {};
    if (action === 'create' || action === 'rename') {
      const name = String(input.shopName || '').trim(); const cfg = catalog.MilkTeaActivityConfig[0];
      if ([...name].length < cfg.name_min_length || [...name].length > cfg.name_max_length || (/[<>]/.test(name) || [...name].some(char => char.charCodeAt(0) < 32))) fail('店名需为2至8个字符');
      if (action === 'create' && Number(state.summary.shop_open_at)) fail('店铺已开业');
      if (action === 'rename' && now < Number(state.summary.rename_cd_until_at)) fail('店名修改冷却中'); params = { shop_name: name };
    }
    if (action === 'cashier' && !list(state.shop.pending_rewards).some(x => (toBigIntCount(x.count) || 0n) > 0n)) fail('暂无可领取收益');
    if (action === 'wages' && !state.summary.has_unclaimed_wage) fail('暂无可领取工资');
    if (action === 'upgrade' && (!state.summary.can_upgrade || (toBigIntCount(state.shop.total_revenue) || 0n) < (toBigIntCount(state.shop.next_level_revenue) || 0n) || !(toBigIntCount(state.shop.next_level_revenue) || 0n))) fail('营业额未达到升级要求');
    if (action === 'boost') { if (!available([{ id: state.shop.sales_item_id, count: '1' }], inventory)) fail('宣传喇叭不足'); params = { count: 1 }; }
    if (action === 'craft') {
      const eligible = new Set(state.recipes.filter(x => x.unlocked && x.is_advanced).map(x => x.config?.fruit_item_id?.split(':')[0]));
      const fruits = inventory.filter(x => eligible.has(String(x.id)) && (toBigIntCount(x.count) || 0n) > 0n && Number(x.uid) > 0);
      const wanted = input.fruitUids == null ? fruits.map(x => String(x.uid)) : list(input.fruitUids).map(x => positiveDecimal(x, 'MILK_TEA_UNAVAILABLE', '果实UID'));
      if (!wanted.length || wanted.some(uid => !fruits.some(x => String(x.uid) === uid))) fail('没有可加工的已解锁活动果实'); params = { fruit_uids: [...new Set(wanted)] };
    }
    if (action === 'hire') {
      const duration = catalog.MilkTeaHireDurationConfig.find(x => x.duration_id === Number(input.durationId || 1));
      if (!duration || state.settleTime - now < duration.min_remaining_business_sec) fail('剩余营业时间不足');
      const slot = Number(input.slotIndex ?? 0); const count = catalog.MilkTeaStoreLevelConfig.find(x => x.level === Number(state.shop.level))?.employee_slot_count || 0;
      if (!Number.isInteger(slot) || slot < 0 || slot >= count || state.shop.slots.some(x => Number(x.slot_index) === slot && Number(x.end_at) > now)) fail('员工位置不可用');
      const candidates = await op('hireList', { duration_id: duration.duration_id });
      const target = input.autoSelect === true ? selectHireCandidate(candidates, input, now)
        : input.targetGid == null ? list(candidates.robots).find(x => Number(x.state) === 0)
          : [...list(candidates.friends), ...list(candidates.robots)].find(x => x.friend.gid === String(input.targetGid) && Number(x.state) === 0);
      if (!target && input.autoSelect === true) return { ok: true, skipped: true, reason: '没有符合策略的空闲员工' };
      if (!target || !available([{ id: '1041', count: candidates.wage_total }], inventory)) fail('没有可雇佣员工或奶茶券不足');
      detail = { employeeName: String(target.friend.name || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 60), slotIndex: slot, durationId: duration.duration_id, hours: duration.duration_sec / 3600, talentId: Number(target.talent_id), employeeType: target.is_robot ? '实习员工' : '好友', fallbackUsed: input.autoSelect === true && Number(input.talentId || 0) !== 0 && Number(target.talent_id) !== Number(input.talentId), wage: String(candidates.wage_total) };
      params = { hires: [{ slot_index: slot, duration_id: duration.duration_id, target_gid: target.friend.gid }] };
    }
    if (action === 'interact') {
      const shift = state.work.my_shift; if (!shift || Number(shift.end_at) <= now || state.work.interact_done || Number(shift.interact_count) >= Number(shift.interact_limit)) fail('当前班次不可互动');
      const type = Number(input.interactionType); if (!catalog.MilkTeaInteractionType.some(x => x.interaction_id === type)) fail('互动类型无效');params = { target_gid: shift.employer.gid, interaction_type: type };
    }
    if (action === 'rank' || action === 'sales' || action === 'hireList' || action === 'shop' || action === 'work' || action === 'workshop') fail('只读动作请使用查询接口');
    if (action === 'hireDisabled') params = { hire_disabled: input.disabled === true };
    if (['shareDaily', 'shareRewards', 'fundRewards'].includes(action)) {
      const cmd = action === 'shareDaily' ? 74 : action === 'shareRewards' ? 71 : 76;
      if (action === 'shareDaily' && (!state.share?.daily || state.share.daily.daily_reward_claimed)) fail('今日已领取');
      if (action === 'shareRewards' && !state.share?.milestones?.some(x => Number(x.state) === 2)) fail('暂无可领取档位');
      if (action === 'fundRewards') {
        if (!state.fund?.unlocked) fail('尚未购买成长基金');
        if (!state.fund.tiers.some(x => Number(x.state) === 2)) fail('暂无可领取基金奖励');
      }
      const id = action === 'fundRewards' ? '2026110103' : '2026110104';
      const reply = await rpc('Operate', types.MilkTeaOperateRequest, types.MilkTeaOperateReply, { id, cmd });
      if (reply.id !== id || Number(reply.cmd) !== cmd) fail('活动响应不匹配');
    } else if (action === 'buy') {
      const goods = state.goods.find(x => x.id === String(input.goodsId)); const count = Number(input.count ?? 1);
      if (!goods || !Number.isSafeInteger(count) || count < 1 || count > goods.remaining || !goods.unlocked || goods.paid || !available(goods.cost, inventory, count)) fail('商品未解锁、限购已用完或资源不足（不支持钻石购买）');
      if (state.phase !== 'business' && goods.category_tag === 'seed') fail('结算期不能购买活动种子');
      const reply = await rpc('Operate', types.MilkTeaOperateRequest, types.MilkTeaOperateReply, { id: '2026110102', cmd: 1, shop_buy: { goods_id: goods.id, count } });
      if (reply.id !== '2026110102' || Number(reply.cmd) !== 1) fail('商店响应不匹配');
    } else {
      const result = await op(action, params);
      if (action === 'hire' && (!result.results?.length || result.results.some(entry => !entry.success))) fail('雇佣失败，请刷新员工列表后重试');
    }
    pendingRead = null; return { ok: true, detail, activity: await getMilkTea() };
  }
  const skippedLogs = new Map();
  const operateMilkTea = (action, params) => serializeMutation(async () => {
    const label = ACTION_LABELS[action] || '未知操作';
    const meta = {
      module: 'activity',
      event: `奶茶热销中${label}`,
      ...(accountId ? { accountId: String(accountId) } : {}),
    };
    try {
      const result = await mutate(action, params);
      if (result.skipped) {
        const now = getServerTimeSec();
        if (!skippedLogs.has(action) || now - skippedLogs.get(action) >= 600) {
          log('活动', `奶茶热销中${label}跳过：${result.reason}`, { ...meta, result: 'skip' });
          skippedLogs.set(action, now);
        }
      } else {
        skippedLogs.delete(action);
        const detail = result.detail || {};
        const hire = action === 'hire' ? `：${detail.employeeType}${detail.employeeName ? `「${detail.employeeName}」` : ''}，${catalog.MilkTeaTalentConfig.find(x => x.talent_id === detail.talentId)?.talent_name || '未知类型'}，${detail.hours}小时，奶茶券${detail.wage}${detail.fallbackUsed ? '（已兜底）' : ''}` : '';
        log('活动', `奶茶热销中${label}完成${hire}`, { ...meta, result: 'success', ...detail });
      }
      return result;
    } catch (error) {
      log('活动', `奶茶热销中${label}失败：${error.message}`, { ...meta, result: 'error' });
      error.milkTeaLogged = true;
      throw error;
    }
  });
  async function milkTeaRecords(kind, input = {}) {
    const state = await getMilkTea(); if (!['business', 'settling'].includes(state.phase)) fail('活动无效');
    if (kind === 'rank') return op('rank', { page: Math.max(1, Math.min(100, Number(input.page) || 1)) });
    if (kind === 'sales') {
      const log = await op('sales', { day: Number(input.day) || 0 });
      const rewards = list(log.items).map(itemDto);
      for (const [id, count] of [['1041', log.token], ['1001', log.coin]]) {
        if ((toBigIntCount(count) || 0n) > 0n && !rewards.some(item => String(item.id) === id)) rewards.unshift(itemDto({ id, count }));
      }
      return { ...log, rewards, drinks: Object.entries(log.cups_by_recipe || {}).map(([id, cups]) => {
        const recipe = catalog.MilkTeaRecipeConfig.find(item => String(item.recipe_id) === id);
        return { recipe_id: id, cups, name: recipe?.recipe_name || '', image: recipe?.image || '' };
      }) };
    }
    if (kind === 'hireList') return op('hireList', { duration_id: Number(input.durationId) || 1 });
    fail('查询类型无效');
  }
  return { getMilkTea, operateMilkTea, milkTeaRecords };
}
function reserveMilkTeaFruit(itemId, enabled, now) {
  return enabled === true && phase(now) === 'business' && catalog.MilkTeaRecipeConfig.some(recipe => Number(recipe.fruit_item_id?.split(':')[0]) === Number(itemId));
}
module.exports = { createMilkTeaService, WINDOW, ACTIONS, AUTO_ACTIONS, phase, normalizeWireMaps, reserveMilkTeaFruit, compareShopGoods, normalizeHireOptions, selectHireCandidate };
