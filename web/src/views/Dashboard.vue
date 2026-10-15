<script setup lang="ts">
import type { RuntimeLogEntry } from '@/utils/runtime-log'
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import api from '@/api'
import AccountCareerModal from '@/components/AccountCareerModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { formatCouponAmount, formatGoldAmount, formatGoldBeanAmount } from '@/utils/number-format'
import { compactRuntimeLogs, matchesRuntimeLog, normalizeRuntimeLog } from '@/utils/runtime-log'

const statusStore = useStatusStore()
const accountStore = useAccountStore()
const bagStore = useBagStore()
const toastStore = useToastStore()
const userStore = useUserStore()

const {
  status,
  logs: statusLogs,
  accountLogs: statusAccountLogs,
  realtimeConnected,
  currentStatusReady,
} = storeToRefs(statusStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { dashboardItems } = storeToRefs(bagStore)

const logContainer = ref<HTMLElement | null>(null)
const autoScroll = ref(true)
const lastBagFetchAt = ref(0)
const illustratedLevels = ref({ crop: 0, mutant: 0 })
let illustratedLevelRequestId = 0
const clearingLogs = ref(false)
const refreshingLogs = ref(false)
const pendingLogCount = ref(0)
const logScrollStates = new Map<string, { top: number, atBottom: boolean }>()

const filter = reactive({
  module: '',
  event: '',
  keyword: '',
})

const hasActiveLogFilter = computed(() =>
  !!(filter.module || filter.event || filter.keyword),
)
const currentAccountDisconnected = computed(() =>
  currentStatusReady.value && !status.value?.connection?.connected,
)

const allLogs = computed(() => {
  const merged = [
    ...(statusLogs.value || []).map((log: any) => normalizeRuntimeLog(log)),
    ...(statusAccountLogs.value || []).map((log: any) => normalizeRuntimeLog(log, true)),
  ]
  const unique = new Map<string, RuntimeLogEntry>()
  for (const log of merged)
    unique.set(log.id, log)
  return [...unique.values()].sort((a, b) => a.ts - b.ts)
})

const filteredLogs = computed(() => allLogs.value.filter((log) => {
  return matchesRuntimeLog(log, filter)
}))

const visibleLogs = computed(() => compactRuntimeLogs(filteredLogs.value))

const modules = [
  { label: '全部模块', value: '' },
  { label: '农场', value: 'farm' },
  { label: '好友', value: 'friend' },
  { label: '仓库', value: 'warehouse' },
  { label: '商城', value: 'shop' },
  { label: '任务', value: 'task' },
  { label: '活动', value: 'activity' },
  { label: '宠物', value: 'pet' },
  { label: '系统', value: 'system' },
]

const events = [
  { label: '全部事件', value: '' },
  { label: '农场巡查', value: '农场循环' },
  { label: '收获作物', value: '收获作物' },
  { label: '清理枯枝', value: '铲除植物' },
  { label: '种植种子', value: '种植种子' },
  { label: '施加化肥', value: '施肥' },
  { label: '土地提醒', value: '土地推送通知' },
  { label: '选择种子', value: '选择种子' },
  { label: '购买种子', value: '购买种子' },
  { label: '购买化肥', value: '购买化肥' },
  { label: '开启礼盒', value: '开启化肥礼包' },
  { label: '获取任务', value: '扫描任务' },
  { label: '完成任务', value: '领取任务' },
  { label: '免费礼包', value: 'mall_free_gifts' },
  { label: '分享奖励', value: 'daily_share' },
  { label: '会员礼包', value: 'vip_daily_gift' },
  { label: '月卡礼包', value: 'month_card_gift' },
  { label: '图鉴奖励', value: '图鉴奖励' },
  { label: '邮箱领取', value: 'email_rewards' },
  { label: '出售成功', value: 'sell_success' },
  { label: '神秘商人', value: '神秘商人自动购买' },
  { label: '土地升级', value: '升级土地' },
  { label: '土地解锁', value: '解锁土地' },
  { label: '好友巡查', value: '好友巡查循环' },
  { label: '访问好友', value: '进入农场' },
  { label: '激活宠物', value: '激活宠物' },
  { label: '派出宠物', value: '派出宠物' },
  { label: '召回宠物', value: '召回宠物' },
  { label: '喂食宠物', value: '喂食宠物' },
  { label: '资本模式派出', value: '资本模式派出' },
  { label: '资本模式召回', value: '资本模式召回' },
  { label: '有机化肥检测', value: 'check_fertilizer_organic' },
  { label: '普通化肥检测', value: 'check_fertilizer_normal' },
  { label: '化肥自动购买检测', value: 'check_fertilizer' },
]

const eventLabelMap: Record<string, string> = Object.fromEntries(
  events.filter(event => event.value).map(event => [event.value, event.label]),
)

const displayName = computed(() => {
  const account = accountStore.currentAccount
  const gameName = status.value?.status?.name

  if (gameName)
    return gameName

  if (currentAccountDisconnected.value) {
    if (account)
      return account.nick || account.name || '未登录'
    return '未登录'
  }

  if (account)
    return account.nick || account.name || '未命名'

  return '未命名'
})

/*
const expRate = computed(() => '0/小时')
const timeToLevel = computed(() => '')
*/

const fertilizerNormal = computed(() => dashboardItems.value.find((item: any) => Number(item.id) === 1011))
const fertilizerOrganic = computed(() => dashboardItems.value.find((item: any) => Number(item.id) === 1012))

const nextFarmCheck = ref('--:--:--')
const nextHelpCheck = ref('--:--:--')
const nextStealCheck = ref('--:--:--')
const localUptime = ref(0)

let localNextFarmRemainSec = 0
let localNextHelpRemainSec = 0
let localNextStealRemainSec = 0
const farmCountdownTotal = ref(1)
const helpCountdownTotal = ref(1)
const stealCountdownTotal = ref(1)


// Task modal moved to AccountSettingsTab

function resetDashboardState() {
  illustratedLevelRequestId += 1
  illustratedLevels.value = { crop: 0, mutant: 0 }
  lastBagFetchAt.value = 0
  localUptime.value = 0
  localNextFarmRemainSec = 0
  localNextHelpRemainSec = 0
  localNextStealRemainSec = 0
  farmCountdownTotal.value = 1
  helpCountdownTotal.value = 1
  stealCountdownTotal.value = 1
  nextFarmCheck.value = '--:--:--'
  nextHelpCheck.value = '--:--:--'
  nextStealCheck.value = '--:--:--'
}

function syncCountdownTotal(total: typeof farmCountdownTotal, remain: number, previousRemain: number) {
  if (remain > previousRemain || total.value <= 1)
    total.value = Math.max(1, remain)
}

function getCountdownProgress(remain: number, total: number) {
  return Math.max(0, Math.min(100, (remain / Math.max(1, total)) * 100))
}

function getCountdownRingStyle(remain: number, total: number, color: string) {
  const progress = getCountdownProgress(remain, total)
  return {
    background: `conic-gradient(${color} ${progress}%, color-mix(in srgb, ${color} 14%, transparent) 0)`,
  }
}

const OP_META: Record<string, { label: string, icon: string, color: string }> = {
  harvest: { label: '收获', icon: 'i-carbon-crop-growth', color: 'text-green-500' },
  water: { label: '浇水', icon: 'i-carbon-rain-drop', color: 'text-blue-400' },
  weed: { label: '除草', icon: 'i-carbon-cut', color: 'text-yellow-500' },
  bug: { label: '除虫', icon: 'i-carbon-pest', color: 'text-red-400' },
  farming: { label: '一键务农', icon: 'i-carbon-clean', color: 'text-teal-500' },
  fertilize: { label: '施肥', icon: 'i-carbon-chemistry', color: 'text-emerald-500' },
  plant: { label: '种植', icon: 'i-carbon-tree', color: 'text-lime-500' },
  steal: { label: '偷菜', icon: 'i-carbon-run', color: 'text-orange-500' },
  helpWater: { label: '帮浇水', icon: 'i-carbon-rain-drop', color: 'text-blue-300' },
  goldenBugClear: { label: '清黄金虫', icon: 'i-carbon-clean', color: 'text-amber-500' },
  goldenBugPut: { label: '放黄金虫', icon: 'i-carbon-pest', color: 'text-yellow-500' },
  helpWeed: { label: '帮除草', icon: 'i-carbon-cut', color: 'text-yellow-400' },
  helpBug: { label: '帮除虫', icon: 'i-carbon-pest', color: 'text-red-300' },
  taskClaim: { label: '任务', icon: 'i-carbon-task-complete', color: 'text-indigo-500' },
  sell: { label: '出售', icon: 'i-carbon-shopping-cart', color: 'text-pink-500' },
  tongQiGift: { label: '同气礼包', icon: 'i-carbon-gift', color: 'text-rose-500' },
}

const filteredOperations = computed(() => {
  const operations = status.value?.operations || {}
  const result: Record<string, number> = {}

  for (const key of Object.keys(operations)) {
    if (key !== 'upgrade' && key !== 'levelUp')
      result[key] = operations[key]
  }

  return result
})

function getEventLabel(event: string) {
  if (event === 'check_fertilizer_organic') return '有机化肥检测'
  if (event === 'check_fertilizer_normal') return '普通化肥检测'
  if (event === 'check_fertilizer') return '化肥检测'
  return eventLabelMap[event] || event
}

function formatBucketTime(item: any) {
  if (!item)
    return '0.0h'
  if (item.hoursText)
    return item.hoursText.replace('小时', 'h')
  return `${(Number(item.count || 0) / 3600).toFixed(1)}h`
}

function updateCountdowns() {
  if (!currentAccountId.value || currentAccountDisconnected.value || !status.value?.connection?.connected) {
    localUptime.value = 0
    nextFarmCheck.value = '账号未登录'
    nextHelpCheck.value = '账号未登录'
    nextStealCheck.value = '账号未登录'
    return
  }

  localUptime.value++

  if (localNextFarmRemainSec > 0) {
    localNextFarmRemainSec--
    nextFarmCheck.value = formatDuration(localNextFarmRemainSec)
  }
  else {
    nextFarmCheck.value = '检查中...'
  }

  if (localNextHelpRemainSec > 0) {
    localNextHelpRemainSec--
    nextHelpCheck.value = formatDuration(localNextHelpRemainSec)
  }
  else {
    nextHelpCheck.value = '检查中...'
  }

  if (localNextStealRemainSec > 0) {
    localNextStealRemainSec--
    nextStealCheck.value = formatDuration(localNextStealRemainSec)
  }
  else {
    nextStealCheck.value = '检查中...'
  }
}

watch(status, (newVal) => {
  if (newVal?.nextChecks) {
    const farmRemainSec = newVal.nextChecks.farmRemainSec || 0
    const helpRemainSec = newVal.nextChecks.helpRemainSec || 0
    const stealRemainSec = newVal.nextChecks.stealRemainSec || 0
    syncCountdownTotal(farmCountdownTotal, farmRemainSec, localNextFarmRemainSec)
    syncCountdownTotal(helpCountdownTotal, helpRemainSec, localNextHelpRemainSec)
    syncCountdownTotal(stealCountdownTotal, stealRemainSec, localNextStealRemainSec)
    localNextFarmRemainSec = farmRemainSec
    localNextHelpRemainSec = helpRemainSec
    localNextStealRemainSec = stealRemainSec
    updateCountdowns()
  }

  if (newVal?.uptime !== undefined)
    localUptime.value = newVal.uptime
}, { deep: true })

function formatDuration(seconds: number) {
  if (seconds <= 0)
    return '00:00:00'

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainSeconds = Math.floor(seconds % 60)
  const pad = (value: number) => value.toString().padStart(2, '0')

  if (days > 0)
    return `${days}天 ${pad(hours)}:${pad(minutes)}:${pad(remainSeconds)}`
  return `${pad(hours)}:${pad(minutes)}:${pad(remainSeconds)}`
}

function getLogTagClass(tag: string) {
  if (tag === '错误')
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  if (tag === '系统')
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (tag === '活动')
    return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
  if (tag === '宠物')
    return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300'
  if (tag === '警告')
    return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
  return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
}

function getLogRowClass(log: RuntimeLogEntry) {
  if (log.level === 'error')
    return 'border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/20'
  if (log.level === 'warn')
    return 'border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20'
  return 'border-transparent hover:bg-white/55 dark:hover:bg-gray-800/45'
}

function getLogMsgClass(tag: string) {
  if (tag === '错误')
    return 'text-red-600 dark:text-red-400'
  return 'text-gray-700 dark:text-gray-300'
}

function formatLogTime(timeStr: string) {
  if (!timeStr)
    return ''
  const parts = timeStr.split(' ')
  return parts.length > 1 ? parts[1] : timeStr
}

function formatLogTimeRange(log: RuntimeLogEntry) {
  const start = formatLogTime(log.time)
  if (!log.lastTs || log.lastTs === log.ts)
    return start
  return `${start}–${new Date(log.lastTs).toLocaleTimeString('zh-CN', { hour12: false })}`
}

function getLogScrollStateKey() {
  return [currentAccountId.value, filter.module, filter.event, filter.keyword].join('|')
}

function restoreLogScroll() {
  nextTick(() => {
    const element = logContainer.value
    if (!element)
      return
    const saved = logScrollStates.get(getLogScrollStateKey())
    if (saved && !saved.atBottom) {
      element.scrollTop = saved.top
      autoScroll.value = false
    }
    else {
      scrollToBottom()
    }
  })
}

async function refreshRuntimeLogs() {
  if (!currentAccountId.value || refreshingLogs.value)
    return
  refreshingLogs.value = true
  try {
    await Promise.all([
      statusStore.fetchLogs(currentAccountId.value, { limit: 300 }),
      statusStore.fetchAccountLogs(currentAccountId.value, 300),
    ])
    toastStore.success('日志已刷新')
  }
  finally {
    refreshingLogs.value = false
  }
}

function getOpName(key: string | number) {
  return OP_META[String(key)]?.label || String(key)
}

function getOpIcon(key: string | number) {
  return OP_META[String(key)]?.icon || 'i-carbon-circle-dash'
}

function getOpColor(key: string | number) {
  return OP_META[String(key)]?.color || 'text-gray-400'
}

function getExpPercent(progress: any) {
  if (!progress || !progress.needed)
    return 0
  return Math.min(100, Math.max(0, (progress.current / progress.needed) * 100))
}

async function refreshBag(force = false) {
  if (!currentAccountId.value || !currentAccount.value?.running || !currentStatusReady.value || !status.value?.connection?.connected)
    return

  const now = Date.now()
  if (!force && now - lastBagFetchAt.value < 2500)
    return

  lastBagFetchAt.value = now
  await bagStore.fetchBag(currentAccountId.value)
}

async function refreshIllustratedLevels() {
  if (!currentAccountId.value || !status.value?.connection?.connected)
    return

  const accountId = currentAccountId.value
  const requestId = ++illustratedLevelRequestId
  const headers = { 'x-account-id': accountId }
  try {
    const [crop, mutant] = await Promise.all([
      api.get('/api/illustrated', { params: { illustrated_type: 1 }, headers }),
      api.get('/api/illustrated', { params: { illustrated_type: 2 }, headers }),
    ])
    if (requestId !== illustratedLevelRequestId || accountId !== currentAccountId.value)
      return
    illustratedLevels.value = {
      crop: Number(crop.data?.data?.level) || 0,
      mutant: Number(mutant.data?.data?.level) || 0,
    }
  }
  catch {
    if (requestId === illustratedLevelRequestId)
      illustratedLevels.value = { crop: 0, mutant: 0 }
  }
}

async function refresh(forceReloadLogs = false) {
  if (!currentAccountId.value)
    return

  const account = currentAccount.value
  if (!account)
    return

  // 首次加载、断线回退时走 HTTP；实时连接正常时优先依赖 WS 推送。
  if (!realtimeConnected.value) {
    await statusStore.fetchStatus(currentAccountId.value)
    await statusStore.fetchAccountLogs(currentAccountId.value)
  }

  if (forceReloadLogs || !realtimeConnected.value)
    await statusStore.fetchLogs(currentAccountId.value, { limit: 300 })

  // 仅在账号运行且连接稳定后再拉背包，避免启动阶段出现 500。
  await refreshBag()
  if (currentAccountId.value && currentAccount.value?.running) statusStore.fetchDailyGifts(currentAccountId.value)
}

function syncRealtimeAccount() {
  if (currentAccountId.value)
    statusStore.connectRealtime(currentAccountId.value)
}

function onLogFilterChange() {
  pendingLogCount.value = 0
  restoreLogScroll()
}

function onLogSearchTrigger() {
  pendingLogCount.value = 0
  restoreLogScroll()
}

watch(currentAccountId, async (newId, oldId) => {
  if (oldId !== undefined && newId !== oldId) {
    statusStore.clearAccountScopedData()
    bagStore.clearBag()
    resetDashboardState()
  }
  syncRealtimeAccount()
  await refresh(true)
  await refreshIllustratedLevels()
  scrollToBottom()
})

watch(() => status.value?.connection?.connected, (connected) => {
  if (connected) {
    refreshBag(true)
    refreshIllustratedLevels()
  }
})

watch(() => JSON.stringify(status.value?.operations || {}), (next, prev) => {
  if (!realtimeConnected.value || next === prev)
    return
  refreshBag()
})

function onLogScroll(event: Event) {
  const element = event.target as HTMLElement
  if (!element)
    return
  autoScroll.value = element.scrollHeight - element.scrollTop - element.clientHeight < 50
  logScrollStates.set(getLogScrollStateKey(), { top: element.scrollTop, atBottom: autoScroll.value })
  if (autoScroll.value)
    pendingLogCount.value = 0
}

async function clearLogs() {
  if (!currentAccountId.value)
    return
  if (!window.confirm('确认清空当前账号的页面运行记录？此操作不会删除磁盘诊断日志。'))
    return

  clearingLogs.value = true
  try {
    const { data } = await api.delete('/api/logs')
    if (data?.ok) {
      toastStore.success('日志已清空')
      await refresh(true)
    }
    else {
      toastStore.error(`清空失败: ${data?.error || '未知错误'}`)
    }
  }
  catch (error: any) {
    const message = error?.response?.data?.error || error?.message || '请求失败'
    toastStore.error(`清空失败: ${message}`)
  }
  finally {
    clearingLogs.value = false
  }
}

watch(filteredLogs, (next, previous) => {
  nextTick(() => {
    if (logContainer.value && autoScroll.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
      pendingLogCount.value = 0
    }
    else if (next.length > (previous?.length || 0)) {
      pendingLogCount.value += next.length - (previous?.length || 0)
    }
  })
}, { deep: true })

function scrollToBottom() {
  nextTick(() => {
    if (logContainer.value)
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    autoScroll.value = true
    pendingLogCount.value = 0
  })
}

onMounted(async () => {
  statusStore.setRealtimeLogsEnabled(true)
  syncRealtimeAccount()
  await refresh()
  await refreshIllustratedLevels()
  scrollToBottom()
})

// Auto refresh fallback every 10s (WS 断开或启用筛选时回退 HTTP)
useIntervalFn(refresh, 10000)
// Countdown timer (every 1s)
useIntervalFn(updateCountdowns, 1000)

const showCareerModal = ref(false)
const careerLoading = ref(false)
const careerError = ref('')
const careerItems = ref<any[]>([])
const careerProfile = ref<Record<string, any>>({})
const avatarLoadFailed = ref(false)

function liveAccountAvatar() {
  if (!currentStatusReady.value)
    return ''
  return String(
    status.value?.status?.avatar
    || status.value?.status?.avatarUrl
    || status.value?.status?.avatar_url
    || '',
  ).trim()
}

const currentAvatar = computed(() => {
  const acc = currentAccount.value
  if (!acc)
    return '/default-user-avatar.png'
  const explicit = liveAccountAvatar() || String(acc.avatar || '').trim()
  if (explicit)
    return explicit
  const qq = String(acc.uin || acc.qq || '').trim()
  if (qq && /^\d+$/.test(qq))
    return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`
  return '/default-user-avatar.png'
})

watch(() => currentAccountId.value, () => {
  avatarLoadFailed.value = false
})

async function loadCareer() {
  const accountId = String(currentAccountId.value || '').trim()
  if (!accountId)
    return
  careerLoading.value = true
  careerError.value = ''
  try {
    const { data } = await api.get('/api/career', {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(data?.error || '生涯记录读取失败')
    careerProfile.value = data.data || {}
    careerItems.value = data.data?.items || []
  }
  catch (error: any) {
    careerError.value = error?.response?.data?.error || error?.message || '生涯记录读取失败'
  }
  finally {
    careerLoading.value = false
  }
}

function openCareer() {
  if (!currentAccount.value)
    return
  showCareerModal.value = true
  loadCareer()
}

</script>

<template>
  <div class="flex flex-col gap-5 pt-1 md:h-full md:min-h-0 md:overflow-hidden md:pt-2">
    <!-- 一体化全景控制台卡片（集成：身份、等级、经验、核心资产、物资、图鉴） -->
    <div class="ui-card relative overflow-hidden rounded-2xl p-4 sm:p-5 transition-all shadow-md">
      <!-- 顶部：身份、等级、在线状态与运行时长 -->
      <div class="flex items-center justify-between gap-2 border-b border-gray-100/70 pb-2.5 dark:border-gray-800/70">
        <div class="flex items-center gap-2.5 min-w-0">
          <div
            class="relative h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-xl ring-2 ring-white/80 cursor-pointer shadow-md transition-transform duration-200 hover:scale-105 active:scale-95 bg-white/40"
            title="查看个人生涯记录"
            @click="openCareer"
          >
            <img
              v-if="!avatarLoadFailed"
              :src="currentAvatar"
              :alt="displayName"
              referrerpolicy="no-referrer"
              class="h-full w-full object-cover"
              @error="avatarLoadFailed = true"
            >
            <div
              v-else
              class="h-full w-full flex items-center justify-center bg-blue-500/10 text-blue-600 dark:bg-blue-400/20 dark:text-blue-300 font-bold text-sm"
            >
              {{ displayName.slice(0, 1) }}
            </div>
          </div>

          <div class="min-w-0 flex-1">
            <!-- 第一行：昵称 + 等级徽章 -->
            <div class="flex items-center gap-2">
              <span class="truncate text-base font-bold sm:text-lg" :title="displayName">
                {{ displayName }}
              </span>
              <span class="shrink-0 rounded-md bg-blue-100 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                Lv.{{ status?.status?.level || 0 }}
              </span>
            </div>

            <!-- 第二行：账号设置同款平台胶囊 + 到期时间 -->
            <div class="mt-0.5 flex items-center gap-2">
              <span
                class="rounded px-1.5 py-0.2 text-[10px] font-medium leading-tight shrink-0"
                :class="(currentAccount?.platform || status?.status?.platform) === 'wx'
                  ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'"
              >
                {{ (currentAccount?.platform || status?.status?.platform) === 'wx' ? '微信' : 'QQ' }}
              </span>

              <span class="truncate text-xs text-gray-400 font-mono">
                <span v-if="userStore.userCard">到期：{{ userStore.expireTimeText }}</span>
                <span v-else>永久有效</span>
              </span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 sm:gap-3 shrink-0 ml-auto">
          <div class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" :class="status?.connection?.connected ? 'bg-green-100/80 text-green-700 dark:bg-green-900/30 dark:text-green-300' : currentStatusReady ? 'bg-red-100/80 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'">
            <span class="h-2 w-2 rounded-full" :class="status?.connection?.connected ? 'bg-green-500 animate-pulse' : currentStatusReady ? 'bg-red-500' : 'bg-gray-400'" />
            <span>{{ status?.connection?.connected ? '在线' : currentStatusReady ? '离线' : '检查中' }}</span>
          </div>
          <div class="flex items-center gap-1 text-xs text-gray-400 font-mono">
            <div class="i-fas-clock text-purple-400" />
            <span>{{ formatDuration(localUptime) }}</span>
          </div>
        </div>
      </div>

      <!-- 经验条（纯粹极简布局：左侧标识，右侧数值） -->
      <div class="py-2">
        <div class="mb-1.5 flex items-center justify-between text-xs text-gray-500 font-mono">
          <span class="flex items-center gap-1">
            <span class="i-fas-bolt text-amber-500 text-[11px]" />
            <span class="font-semibold text-gray-600 dark:text-gray-300">经验 EXP</span>
          </span>

          <span class="font-medium text-gray-600 dark:text-gray-300">
            {{ status?.levelProgress?.current || 0 }} / {{ status?.levelProgress?.needed || '?' }}
          </span>
        </div>

        <div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
          <div
            class="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
            :style="{ width: `${getExpPercent(status?.levelProgress)}%` }"
          />
        </div>
      </div>

      <!-- 核心资产：4 宫格数据矩阵 -->
      <div class="grid grid-cols-4 gap-2 py-2">
        <div class="flex flex-col items-center justify-center rounded-xl bg-gray-50/70 py-2 dark:bg-gray-800/40">
          <div class="flex items-center gap-1 text-xs text-gray-500 mb-0.5">
            <img src="/game-config/resource-icons/gold.png" alt="金币" class="h-4 w-4 shrink-0 object-contain">
            <span>金币</span>
          </div>
          <div class="text-base font-bold sm:text-lg text-yellow-600 dark:text-yellow-500 truncate max-w-full px-1">
            {{ formatGoldAmount(status?.status?.gold || 0) }}
          </div>
          <div
            v-if="(status?.sessionGoldGained || 0) !== 0"
            class="text-[10px] font-mono leading-none"
            :class="(status?.sessionGoldGained || 0) > 0 ? 'text-green-500' : 'text-red-500'"
          >
            {{ (status?.sessionGoldGained || 0) > 0 ? '+' : '' }}{{ formatGoldAmount(status?.sessionGoldGained || 0) }}
          </div>
        </div>

        <div class="flex flex-col items-center justify-center rounded-xl bg-gray-50/70 py-2 dark:bg-gray-800/40">
          <div class="flex items-center gap-1 text-xs text-gray-500 mb-0.5">
            <img src="/game-config/resource-icons/coupon.png" alt="点券" class="h-4 w-4 shrink-0 object-contain">
            <span>点券</span>
          </div>
          <div class="text-base font-bold sm:text-lg text-emerald-500 dark:text-emerald-400 truncate max-w-full px-1">
            {{ formatCouponAmount(status?.status?.coupon || 0) }}
          </div>
          <div
            v-if="(status?.sessionCouponGained || 0) !== 0"
            class="text-[10px] font-mono leading-none"
            :class="(status?.sessionCouponGained || 0) > 0 ? 'text-green-500' : 'text-red-500'"
          >
            {{ (status?.sessionCouponGained || 0) > 0 ? '+' : '' }}{{ formatCouponAmount(status?.sessionCouponGained || 0) }}
          </div>
        </div>

        <div class="flex flex-col items-center justify-center rounded-xl bg-gray-50/70 py-2 dark:bg-gray-800/40">
          <div class="flex items-center gap-1 text-xs text-gray-500 mb-0.5">
            <img src="/game-config/resource-icons/diamond.png" alt="钻石" class="h-4 w-4 shrink-0 object-contain">
            <span>钻石</span>
          </div>
          <div class="text-base font-bold sm:text-lg text-cyan-600 dark:text-cyan-400 truncate max-w-full px-1">
            {{ formatCouponAmount(status?.status?.diamond || 0) }}
          </div>
        </div>

        <div class="flex flex-col items-center justify-center rounded-xl bg-gray-50/70 py-2 dark:bg-gray-800/40">
          <div class="flex items-center gap-1 text-xs text-gray-500 mb-0.5">
            <img src="/game-config/resource-icons/gold-bean.png" alt="金豆" class="h-4 w-4 shrink-0 object-contain">
            <span>金豆</span>
          </div>
          <div class="text-base font-bold sm:text-lg text-amber-500 dark:text-amber-400 truncate max-w-full px-1">
            {{ formatGoldBeanAmount(status?.status?.goldBean || 0) }}
          </div>
        </div>
      </div>

      <!-- 辅助物资与图鉴（紧凑胶囊通栏：普通肥、作物图鉴、有机肥、超变图鉴） -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-gray-100/70 dark:border-gray-800/70">
        <div class="flex items-center justify-between rounded-lg px-2.5 py-1.5 bg-gray-50/50 dark:bg-gray-800/30">
          <div class="flex items-center gap-1.5 text-xs text-gray-500">
            <img src="/game-config/resource-icons/fertilizer-normal.png" alt="普通化肥" class="h-4 w-4 shrink-0 object-contain">
            <span>普通化肥</span>
          </div>
          <span class="text-xs font-bold text-gray-700 dark:text-gray-200">{{ formatBucketTime(fertilizerNormal) }}</span>
        </div>

        <div class="flex items-center justify-between rounded-lg px-2.5 py-1.5 bg-gray-50/50 dark:bg-gray-800/30">
          <div class="flex items-center gap-1.5 text-xs text-gray-500">
            <img src="/game-config/resource-icons/illustrated-crop.png" alt="作物图鉴" class="h-4 w-4 shrink-0 object-contain">
            <span>作物图鉴</span>
          </div>
          <span class="text-xs font-bold text-gray-700 dark:text-gray-200">Lv.{{ illustratedLevels.crop }}</span>
        </div>

        <div class="flex items-center justify-between rounded-lg px-2.5 py-1.5 bg-gray-50/50 dark:bg-gray-800/30">
          <div class="flex items-center gap-1.5 text-xs text-gray-500">
            <img src="/game-config/resource-icons/fertilizer-organic.png" alt="有机化肥" class="h-4 w-4 shrink-0 object-contain">
            <span>有机化肥</span>
          </div>
          <span class="text-xs font-bold text-gray-700 dark:text-gray-200">{{ formatBucketTime(fertilizerOrganic) }}</span>
        </div>

        <div class="flex items-center justify-between rounded-lg px-2.5 py-1.5 bg-gray-50/50 dark:bg-gray-800/30">
          <div class="flex items-center gap-1.5 text-xs text-gray-500">
            <img src="/game-config/resource-icons/illustrated-mutant.png" alt="超变图鉴" class="h-4 w-4 shrink-0 object-contain">
            <span>超变图鉴</span>
          </div>
          <span class="text-xs font-bold text-gray-700 dark:text-gray-200">Lv.{{ illustratedLevels.mutant }}</span>
        </div>
      </div>
    </div>

    <div class="flex flex-1 flex-col items-stretch gap-5 md:min-h-0 md:flex-row">
      <div class="flex flex-1 flex-col gap-5 md:min-h-0 md:w-3/4">
        <div class="ui-card flex flex-1 flex-col rounded-lg p-3 md:min-h-0 md:overflow-hidden sm:p-5">
          <div class="mb-4 flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h3 class="flex items-center gap-2 text-lg font-medium">
                <div class="i-carbon-document" />
                <span>运行日志</span>
                <span class="text-xs text-gray-400 font-normal">{{ visibleLogs.length }} 条</span>
              </h3>
            </div>

            <div class="flex flex-wrap items-center gap-2 text-sm">
              <BaseInput
                v-model="filter.keyword"
                placeholder="搜索日志内容"
                class="min-w-48 flex-1 sm:max-w-72"
                clearable
                @keyup.enter="onLogSearchTrigger"
                @clear="onLogSearchTrigger"
              />

              <BaseSelect
                v-model="filter.module"
                :options="modules"
                class="w-36"
                @change="onLogFilterChange"
              />

              <BaseSelect
                v-model="filter.event"
                :options="events"
                class="w-36"
                @change="onLogFilterChange"
              />

              <BaseButton
                v-if="hasActiveLogFilter"
                variant="ghost"
                size="sm"
                @click="Object.assign(filter, { module: '', event: '', keyword: '' }); onLogFilterChange()"
              >
                <div class="i-carbon-filter-remove mr-1" />
                重置
              </BaseButton>

              <BaseButton
                variant="secondary"
                size="sm"
                :loading="refreshingLogs"
                @click="refreshRuntimeLogs"
              >
                <div class="i-carbon-renew mr-1" />
                刷新
              </BaseButton>

              <BaseButton
                variant="secondary"
                size="sm"
                :loading="clearingLogs"
                @click="clearLogs"
              >
                <div class="i-carbon-trash-can mr-1" />
                清空
              </BaseButton>
            </div>
          </div>

          <div ref="logContainer" class="ui-subtle-panel relative max-h-[50vh] min-h-0 flex-1 overflow-x-hidden overflow-y-auto rounded-lg p-1.5 text-sm md:max-h-none sm:p-2" @scroll="onLogScroll">
            <div v-if="!visibleLogs.length" class="py-8 text-center text-gray-400">
              <div class="i-carbon-document-blank mx-auto mb-3 text-3xl text-gray-300" />
              <div class="text-sm text-gray-500 dark:text-gray-400">
                {{ hasActiveLogFilter ? '没有符合条件的日志' : '暂无日志' }}
              </div>
              <div class="mt-1 text-xs text-gray-400">
                {{ hasActiveLogFilter ? '可以调整或重置筛选条件。' : '运行账号后，这里会持续追加巡查、种植、任务和出售记录。' }}
              </div>
            </div>
            <div
              v-for="log in visibleLogs"
              :key="log.id"
              class="grid grid-cols-1 mb-0.5 gap-x-2 gap-y-1 border rounded-md px-2.5 py-1.5 transition-colors sm:grid-cols-[auto_1fr] sm:gap-y-0"
              :class="getLogRowClass(log)"
            >
              <span class="select-none whitespace-nowrap pt-0.5 text-xs text-gray-400 font-mono">{{ formatLogTimeRange(log) }}</span>
              <div class="min-w-0">
                <div class="flex flex-wrap items-start gap-1">
                  <span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-bold" :class="getLogTagClass(log.tag)">{{ log.tag }}</span>
                  <span v-if="log.event && log.source !== 'account'" class="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-500 dark:bg-blue-900/20 dark:text-blue-400">{{ getEventLabel(log.event) }}</span>
                  <span class="min-w-0 break-words leading-5" :class="getLogMsgClass(log.tag)">{{ log.msg }}</span>
                  <span v-if="(log.repeatCount || 1) > 1" class="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600 font-medium dark:bg-gray-700 dark:text-gray-300">×{{ log.repeatCount }}</span>
                </div>
              </div>
            </div>

            <button
              v-if="pendingLogCount"
              class="sticky bottom-2 left-1/2 z-10 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-white shadow-lg -translate-x-1/2"
              style="background: var(--theme-primary)"
              @click="scrollToBottom"
            >
              <div class="i-carbon-arrow-down" />
              {{ pendingLogCount }} 条新日志
            </button>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-4 md:min-h-0 md:w-1/4 md:overflow-hidden">
        <div class="ui-card flex shrink-0 flex-col rounded-2xl p-3.5">
          <h3 class="mb-3 flex items-center gap-2 text-base font-medium 2xl:text-lg">
            <div class="i-carbon-hourglass" />
            <span>下次检查倒计时</span>
          </h3>
          <div class="grid grid-cols-3 gap-2">
            <div class="min-w-0 flex flex-col items-center text-center">
              <div
                class="h-18 w-18 flex items-center justify-center rounded-full p-1"
                :style="getCountdownRingStyle(localNextFarmRemainSec, farmCountdownTotal, '#22c55e')"
              >
                <div class="h-full w-full flex flex-col items-center justify-center rounded-full bg-white dark:bg-gray-800">
                  <div class="i-carbon-sprout text-xl text-green-500" />
                  <span class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">农场</span>
                </div>
              </div>
              <div class="mt-1.5 w-full truncate text-sm font-bold font-mono 2xl:text-base" :title="nextFarmCheck">
                {{ nextFarmCheck }}
              </div>
            </div>
            <div class="min-w-0 flex flex-col items-center text-center">
              <div
                class="h-18 w-18 flex items-center justify-center rounded-full p-1"
                :style="getCountdownRingStyle(localNextHelpRemainSec, helpCountdownTotal, '#3b82f6')"
              >
                <div class="h-full w-full flex flex-col items-center justify-center rounded-full bg-white dark:bg-gray-800">
                  <div class="i-carbon-user-multiple text-xl text-blue-500" />
                  <span class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">帮助</span>
                </div>
              </div>
              <div class="mt-1.5 w-full truncate text-sm font-bold font-mono 2xl:text-base" :title="nextHelpCheck">
                {{ nextHelpCheck }}
              </div>
            </div>
            <div class="min-w-0 flex flex-col items-center text-center">
              <div
                class="h-18 w-18 flex items-center justify-center rounded-full p-1"
                :style="getCountdownRingStyle(localNextStealRemainSec, stealCountdownTotal, '#f97316')"
              >
                <div class="h-full w-full flex flex-col items-center justify-center rounded-full bg-white dark:bg-gray-800">
                  <div class="i-carbon-run text-xl text-orange-500" />
                  <span class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">偷菜</span>
                </div>
              </div>
              <div class="mt-1.5 w-full truncate text-sm font-bold font-mono 2xl:text-base" :title="nextStealCheck">
                {{ nextStealCheck }}
              </div>
            </div>
          </div>
        </div>

        <div class="ui-card min-h-0 flex flex-1 flex-col overflow-hidden rounded-2xl p-4">
          <h3 class="mb-3 flex items-center gap-2 text-base font-medium 2xl:text-lg">
            <div class="i-carbon-chart-column" />
            <span>今日统计</span>
          </h3>
          <div v-if="currentAccountDisconnected" class="ui-subtle-panel flex flex-col items-center justify-center gap-3 rounded-2xl p-5 text-center text-gray-500">
            <div class="i-carbon-connection-signal-off text-4xl text-gray-400" />
            <div class="flex flex-col">
              <div class="text-lg text-gray-700 font-medium dark:text-gray-300">
                账号未登录
              </div>
              <div class="mt-1 text-sm text-gray-400">
                请先运行账号或检查网络连接。
              </div>
            </div>
          </div>
          <div v-else-if="!Object.keys(filteredOperations).length" class="ui-subtle-panel flex flex-col items-center justify-center gap-2 rounded-2xl p-5 text-center">
            <div class="i-carbon-chart-column text-3xl text-gray-300" />
            <div class="text-sm text-gray-600 font-medium dark:text-gray-300">
              暂无主动作统计
            </div>
            <div class="text-xs text-gray-400">
              通常是刚启动、刚切换账号，或本轮巡查尚未完成。
            </div>
          </div>
          <div v-else class="grid auto-rows-fr grid-cols-2 min-h-0 flex-1 gap-1.5 2xl:gap-2">
            <div
              v-for="(val, key) in filteredOperations"
              :key="key"
              class="ui-subtle-panel min-w-0 flex items-center justify-between rounded-lg px-2 py-1.5"
            >
              <div class="min-w-0 flex items-center gap-1.5">
                <div class="text-base 2xl:text-lg" :class="[getOpIcon(key), getOpColor(key)]" />
                <div class="truncate text-xs text-gray-500 2xl:text-sm" :title="getOpName(key)">
                  {{ getOpName(key) }}
                </div>
              </div>
              <div class="text-sm font-bold 2xl:text-base">
                {{ val }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  
    <Teleport to="body">
      <AccountCareerModal
        :show="showCareerModal"
        :account="currentAccount"
        :profile="careerProfile"
        :items="careerItems"
        :loading="careerLoading"
        :error="careerError"
        @close="showCareerModal = false"
        @refresh="loadCareer"
      />
    </Teleport>
  </div>



</template>
