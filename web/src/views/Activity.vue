<script setup lang="ts">
import type { ActivityLabels } from '@/components/activity/types'
import { storeToRefs } from 'pinia'
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import api from '@/api'
import CharityFlowerActivityPanel from '@/components/activity/CharityFlowerActivityPanel.vue'
import RainPoemActivityPanel from '@/components/activity/RainPoemActivityPanel.vue'
import SolarTermsActivityPanel from '@/components/activity/SolarTermsActivityPanel.vue'
import WishShareActivityPanel from '@/components/activity/WishShareActivityPanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { CHARITY_FLOWER_ACTIVITY_WINDOW, isWithinActivityWindowMs, PET_DIARY_ACTIVITY_WINDOW, RAIN_POEM_ACTIVITY_WINDOW, SHARE_REWARD_ACTIVITY_WINDOW, WISH_SIGN_ACTIVITY_WINDOW } from '@/constants/activity-windows'
import { useAccountStore } from '@/stores/account'
import { useActivityStore } from '@/stores/activity'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const MilkTeaActivityPanel = defineAsyncComponent(() => import('@/components/activity/MilkTeaActivityPanel.vue'))
const PetDiaryActivityPanel = defineAsyncComponent(() => import('@/components/activity/PetDiaryActivityPanel.vue'))

const L: ActivityLabels = {
  title: '活动中心',
  currentAccount: '当前账号',
  none: '未选择',
  needAccount: '请先选择账号，再查看活动数据。',
  refresh: '刷新',
  loading: '正在加载活动数据...',
  empty: '暂无数据',
  warningTitle: '活动提示',
  heluTitle: '心许千灯星垂野',
  giftLotusTab: '观星礼录',
  shopTab: '星砂兑换商店',
  journeyTab: '千星游记',
  notesTab: '节令小札',
  pool: '奖池',
  recent: '最近结果',
  freeRemain: '免费剩余',
  paidRemain: '点券剩余',
  dailyUsed: '今日已用',
  dailyRemain: '今日剩余',
  helu: '星砂',
  heluBalance: '星砂余额',
  exchangeGoods: '兑换奖励',
  drawOne: '点亮',
  drawBatch: '一键点亮',
  drawDone: '点亮完成',
  batchDone: '点亮完成',
  drawFail: '点亮失败',
  exchangeDone: '兑换成功：',
  exchangeFail: '兑换失败',
  canExchange: '立即兑换',
  unavailable: '暂不可用',
  owned: '已拥有',
  noHelu: '星砂不足',
  unsupportedCurrency: '暂不支持该货币',
  priceLabel: '价格',
  stateLabel: '状态',
  drawCostLabel: '操作说明',
  freeDraw: '免费',
  paidDraw: '消耗',
  recentCost: '本次消耗',
  rewardPoolCount: '星宿奖励',
  exchangeCount: '兑换奖励',
  typeFallback: '活动奖励',
  gold: '金币',
  coupon: '点券',
  activityCurrency: '星砂',
  defaultHeluTitle: '心许千灯星垂野',
  decorationLabel: '装扮',
  subActivityUnavailable: '暂未读取到活动数据。',
  activityStatus: '活动状态',
}

const accountStore = useAccountStore()
const activityStore = useActivityStore()
const toast = useToastStore()
const userStore = useUserStore()
const { currentAccountId } = storeToRefs(accountStore)
const {
  rainPoemActivity,
  rainPoemLoading,
  charityFlowerActivity,
  charityFlowerLoading,
  wishSignActivity,
  wishSignLoading,
  shareRewardActivity,
  shareRewardLoading,
} = storeToRefs(activityStore)

const nowMs = ref(Date.now())
let nowTimer: ReturnType<typeof window.setInterval> | null = null
const rainPoemActivityActive = computed(() => isWithinActivityWindowMs(RAIN_POEM_ACTIVITY_WINDOW, nowMs.value))
const charityFlowerActivityActive = computed(() => isWithinActivityWindowMs(CHARITY_FLOWER_ACTIVITY_WINDOW, nowMs.value))
const wishSignActivityActive = computed(() => isWithinActivityWindowMs(WISH_SIGN_ACTIVITY_WINDOW, nowMs.value))
const shareRewardActivityActive = computed(() => isWithinActivityWindowMs(SHARE_REWARD_ACTIVITY_WINDOW, nowMs.value))
const petDiaryActivityActive = computed(() => isWithinActivityWindowMs(PET_DIARY_ACTIVITY_WINDOW, nowMs.value))
const selectedActivity = ref<string | null>(null)
const activityStatusFilter = ref<'active' | 'upcoming' | 'ended'>('active')
const activityDirectoryWindows = ref<Array<{ id: number, title: string, startTime: number, endTime: number, imageUrl?: string }>>([])
interface ActivityDirectoryNode {
  id: number
  parentId?: number
  title?: string
  type?: number
  status?: number
  startTime?: number
  endTime?: number
  visible?: boolean
  enabled?: boolean
  sort?: number
  features?: Record<string, boolean>
  children?: ActivityDirectoryNode[]
  payload?: Record<string, unknown> | null
  error?: string
}
interface ActivityClientPreview {
  source: string
  entryId: number
  entryUid: string
  modules: Array<{ title: string, description: string }>
  pending: string[]
}

const ACTIVITY_CLIENT_PREVIEWS: Array<{ ids: number[], title: string, preview: ActivityClientPreview }> = [
  {
    ids: [2026090900, 2026090901],
    title: '公益小红花',
    preview: {
      source: '最新版官方客户端生成协议、delayRes 配置与 Prefab',
      entryId: 2026090901,
      entryUid: 'CharityRedFlower',
      modules: [
        { title: '个人与活动进度', description: '客户端已预置个人进度、活动总进度及进度条界面。' },
        { title: '小红花与阶段礼物', description: '已发现小红花展示、阶段条目和礼物界面，共有 5 个静态阶段素材。' },
        { title: '好友互动', description: '已发现赠送、分享、好友助力及授权相关界面。' },
        { title: '装扮线索', description: '客户端包含“穿戴”状态素材，但奖励内容和取得条件尚未下发。' },
      ],
      pending: [],
    },
  },
]
const activityDirectoryActivities = ref<ActivityDirectoryNode[]>([])
const activityDirectoryGroups = ref<ActivityDirectoryNode[]>([])
const unknownActivityIds = ref(new Set<number>())
const activityScanLoading = ref(false)
const ACTIVITY_REFRESH_INTERVAL_MS = 30_000

function activityWindowStatus(window: { startMs: number, endMs: number }): 'upcoming' | 'active' | 'ended' {
  if (nowMs.value < window.startMs)
    return 'upcoming'
  if (nowMs.value > window.endMs)
    return 'ended'
  return 'active'
}

const activityCards = computed(() => {
  const groups: Array<{ id: number, title: string, startTime: number, endTime: number, imageUrl?: string, activityIds: number[] }> = []
  for (const item of activityDirectoryWindows.value) {
    const existing = groups.find(group => group.title === item.title
      && group.startTime <= item.endTime && item.startTime <= group.endTime)
    if (existing) {
      existing.activityIds.push(item.id)
      existing.startTime = Math.min(existing.startTime, item.startTime)
      existing.endTime = Math.max(existing.endTime, item.endTime)
      if (!existing.imageUrl && item.imageUrl)
        existing.imageUrl = item.imageUrl
      if (!String(existing.id).endsWith('00') && String(item.id).endsWith('00'))
        existing.id = item.id
    }
    else {
      groups.push({ ...item, activityIds: [item.id] })
    }
  }
  const source = groups.length
    ? groups
    : [{
        id: 2026070300,
        title: '雨落成诗',
        startTime: RAIN_POEM_ACTIVITY_WINDOW.startMs / 1000,
        endTime: RAIN_POEM_ACTIVITY_WINDOW.endMs / 1000,
        activityIds: [2026070300],
      }]
  if (!source.some(group => group.activityIds.includes(2026110100)))
    source.push({ id: 2026110100, title: '奶茶热销中', startTime: 1792029600, endTime: 1794844799, activityIds: [2026110100] })
  const cards = source.map((group) => {
    const adaptedKey = group.id === 2026090100
      ? 'pet-diary' as const
      : group.activityIds.includes(2026070300) ? 'rain-poem' as const : group.activityIds.includes(2026090900) ? 'charity-flower' as const : null
    const adapted = group.activityIds.includes(2026110100) ? 'milk-tea' as const : group.activityIds.includes(2026092400) ? 'wish-sign' as const : group.activityIds.includes(2026092500) ? 'share-reward' as const : adaptedKey
    const window = { startMs: group.startTime * 1000, endMs: group.endTime * 1000 }
    const hue = Math.abs(group.id * 37) % 360
    return {
      permanent: false,
      key: String(group.id),
      activityIds: group.activityIds,
      adaptedKey: adapted,
      title: adapted === 'pet-diary' ? '萌宠日记' : group.title || `活动 ${group.id}`,
      description: adapted
        ? adapted === 'milk-tea' ? '经营奶茶小店、兑换商店与兼职工作' : adapted === 'pet-diary' ? '查看比熊成长、爪印手记、拾物小铺与比熊赠礼' : adapted === 'charity-flower' ? '查看爱心、公益进度与奖励状态' : adapted === 'wish-sign' ? '查看祈愿状态、祈愿池和每日奖励' : adapted === 'share-reward' ? '查看每日快乐值与档位进度' : '查看天气、每日进度与气象研究'
        : ACTIVITY_CLIENT_PREVIEWS.some(item => item.title === group.title || item.ids.some(id => group.activityIds.includes(id)))
          ? '已读取客户端静态预览，动态规则待服务端开放'
          : '暂未适配详情',
      icon: {
        '': 'i-carbon-calendar',
        'milk-tea': 'i-carbon-cafe',
        'pet-diary': 'i-fa-solid-paw',
        'charity-flower': 'i-carbon-favorite',
        'rain-poem': 'i-carbon-rain-heavy',
        'wish-sign': 'i-carbon-sun',
        'share-reward': 'i-carbon-share',
      }[adapted || ''] || 'i-carbon-calendar',
      image: adapted === 'milk-tea' ? '/activity/milk-tea/img_s4Main_bg.png' : adapted === 'pet-diary' ? '/activity/pet-diary/scene-home-adult.webp?v=20260912' : adapted === 'wish-sign' ? '/activity/wish-sign/card-bg.svg' : adapted === 'share-reward' ? '/activity/share-reward/card-bg.svg' : group.imageUrl || (adapted === 'rain-poem' ? '/activity/rain-poem/day-rain-bg.jpg' : ''),
      imagePosition: adapted === 'pet-diary' ? 'center 64%' : 'center',
      window,
      updatedMs: window.startMs,
      status: activityWindowStatus(window),
      pending: !adapted && group.activityIds.some(id => unknownActivityIds.value.has(id)),
      backgroundStyle: {
        background: `radial-gradient(circle at 84% 18%, hsl(${(hue + 42) % 360} 82% 68% / 0.38), transparent 34%), radial-gradient(circle at 12% 92%, hsl(${(hue + 310) % 360} 75% 58% / 0.26), transparent 38%), linear-gradient(135deg, hsl(${hue} 52% 38%), hsl(${(hue + 32) % 360} 58% 18%))`,
      },
    }
  })
  cards.push({ permanent: true, key: 'solar-terms', activityIds: [], adaptedKey: null, title: '节令小札', description: '查看各节令赠礼与领取状态', icon: 'i-carbon-notebook', image: '', imagePosition: 'center', window: { startMs: 0, endMs: 0 }, updatedMs: Date.parse('2026-10-15T00:00:00+08:00'), status: 'active', pending: false, backgroundStyle: { background: '#385c46' } })
  return cards.sort((left, right) => {
    return right.updatedMs - left.updatedMs
      || right.window.startMs - left.window.startMs
  })
})
const filteredActivityCards = computed(() => activityCards.value.filter(card => card.status === activityStatusFilter.value))
const selectedActivityCard = computed(() => activityCards.value.find(card => card.key === selectedActivity.value) || null)
const selectedActivityClientPreview = computed(() => {
  const card = selectedActivityCard.value
  if (!card)
    return null
  return ACTIVITY_CLIENT_PREVIEWS.find(item => item.title === card.title
    || item.ids.some(id => card.activityIds.includes(id)))?.preview || null
})
const selectedActivityDetails = computed(() => {
  const card = selectedActivityCard.value
  if (!card)
    return []
  const ids = new Set(card.activityIds.map(Number))
  const matchingGroups = activityDirectoryGroups.value.filter(group => ids.has(Number(group.id))
    || (group.title && group.title === card.title))
  if (matchingGroups.length)
    return matchingGroups

  const matchingActivities = activityDirectoryActivities.value.filter(node => ids.has(Number(node.id))
    || ids.has(Number(node.parentId))
    || (node.title && node.title === card.title))
  if (!matchingActivities.length)
    return []
  const byId = new Map(matchingActivities.map(node => [Number(node.id), { ...node, children: [] as ActivityDirectoryNode[] }]))
  const roots: ActivityDirectoryNode[] = []
  for (const node of byId.values()) {
    const parent = byId.get(Number(node.parentId))
    if (parent)
      parent.children?.push(node)
    else
      roots.push(node)
  }
  return roots
})
const activityStatusFilters = [
  { key: 'active' as const, label: '进行中' },
  { key: 'upcoming' as const, label: '未开始' },
  { key: 'ended' as const, label: '已结束' },
]

function formatActivityDateTime(timestampMs: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestampMs))
}

function applyActivityDirectoryReport(report: any) {
  activityDirectoryWindows.value = Array.isArray(report?.online?.activityWindows) ? report.online.activityWindows : []
  activityDirectoryActivities.value = Array.isArray(report?.online?.activities) ? report.online.activities : []
  activityDirectoryGroups.value = Array.isArray(report?.online?.groups) ? report.online.groups : []
  unknownActivityIds.value = new Set((report?.online?.unknownActivityIds || []).map(Number))
}

function flattenActivityDetails(node: ActivityDirectoryNode): ActivityDirectoryNode[] {
  return [node, ...(node.children || []).flatMap(flattenActivityDetails)]
}

function activityFeatureLabels(node: ActivityDirectoryNode) {
  const labels: Record<string, string> = {
    exchangeShop: '兑换商店',
    randomShop: '随机商店',
    draw: '抽奖',
    starRecord: '图鉴',
    qixiBridge: '阶段建设',
    qixiGift: '好友赠礼',
    weatherTasks: '活动任务',
    weatherResearch: '阶段研究',
  }
  return Object.entries(node.features || {}).filter(([, enabled]) => enabled).map(([key]) => labels[key] || key)
}

function activityRuleSections(nodes: ActivityDirectoryNode[]) {
  return nodes.flatMap(flattenActivityDetails).flatMap((node) => {
    const tips = node.payload?.tips
    if (!tips || typeof tips !== 'object')
      return []
    const value = tips as Record<string, unknown>
    const lines = Array.isArray(value.txt)
      ? value.txt.filter(item => typeof item === 'string' || typeof item === 'number').map(item => String(item).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim()).filter(Boolean)
      : []
    return lines.length ? [{ id: node.id, title: String(value.title || '活动说明').replace(/<[^>]+>/g, ''), lines }] : []
  })
}

async function loadActivityDirectory() {
  try {
    const { data } = await api.get('/api/activity/directory')
    applyActivityDirectoryReport({ online: data })
  }
  catch {
    // 活动中心仍可使用本地已登记活动作为回退。
  }
}

async function rescanActivityDirectory() {
  activityScanLoading.value = true
  try {
    const { data } = await api.post('/api/activity/update/scan')
    applyActivityDirectoryReport(data.report)
    toast.success('活动目录已更新')
  }
  catch (error: any) {
    toast.error(error?.response?.data?.error || error.message || '活动目录更新失败')
  }
  finally {
    activityScanLoading.value = false
  }
}

async function refreshAll() {
  const accountId = currentAccountId.value
  if (!accountId || rainPoemLoading.value)
    return

  const requests = []
  if (rainPoemActivityActive.value)
    requests.push(activityStore.fetchRainPoemActivity(String(accountId)))
  if (charityFlowerActivityActive.value)
    requests.push(activityStore.fetchCharityFlowerActivity(String(accountId)))
  if (wishSignActivityActive.value)
    requests.push(activityStore.fetchWishSignActivity(String(accountId)))
  if (shareRewardActivityActive.value)
    requests.push(activityStore.fetchShareRewardActivity(String(accountId)))
  await Promise.all(requests)
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    nowMs.value = Date.now()
    refreshAll()
  }
}

watch(currentAccountId, () => {
  activityStore.clearActivityData()
  refreshAll()
})
watch(rainPoemActivityActive, (active) => {
  if (active) {
    refreshAll()
  }
  else {
    selectedActivity.value = null
    activityStore.clearActivityData()
  }
})
// 活动窗口结束时把用户退回列表。不再调 refreshAll / clearActivityData：
// 萌宠日记状态归 usePetDiaryStore，clearActivityData 会连带清掉其他活动的数据。
watch(petDiaryActivityActive, (active) => {
  if (!active && selectedActivityCard.value?.adaptedKey === 'pet-diary')
    selectedActivity.value = null
})
onMounted(() => {
  nowTimer = window.setInterval(() => {
    nowMs.value = Date.now()
    if (document.visibilityState === 'visible')
      refreshAll()
  }, ACTIVITY_REFRESH_INTERVAL_MS)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  refreshAll()
  loadActivityDirectory()
})
onUnmounted(() => {
  if (nowTimer)
    window.clearInterval(nowTimer)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <section class="space-y-4">
    <section v-if="!selectedActivity" class="space-y-4">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex items-baseline gap-2">
            <h1 class="text-lg text-gray-900 font-semibold dark:text-white">
              活动中心
            </h1>
            <span class="text-xs text-gray-400">{{ activityCards.length }} 个活动</span>
          </div>
          <div class="inline-flex rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800" role="group" aria-label="活动状态筛选">
            <button
              v-for="filter in activityStatusFilters"
              :key="filter.key"
              class="rounded-md px-2.5 py-1 text-xs transition"
              :class="activityStatusFilter === filter.key ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'"
              :aria-pressed="activityStatusFilter === filter.key"
              @click="activityStatusFilter = filter.key"
            >
              {{ filter.label }}
            </button>
          </div>
        </div>
        <BaseButton v-if="userStore.isAdmin" variant="secondary" :loading="activityScanLoading" @click="rescanActivityDirectory">
          <span class="i-carbon-renew mr-1.5" />
          更新活动目录
        </BaseButton>
      </header>

      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <button
          v-for="card in filteredActivityCards"
          :key="card.key"
          class="group relative min-h-52 overflow-hidden rounded-lg text-left text-white shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-cyan-500"
          :class="card.status === 'ended' ? 'cursor-not-allowed grayscale saturate-0' : 'hover:-translate-y-0.5 hover:shadow-lg'"
          :disabled="card.status === 'ended'"
          @click="selectedActivity = card.key"
        >
          <img v-if="card.image" :src="card.image" alt="" class="absolute inset-0 h-full w-full object-cover transition duration-500" :style="{ objectPosition: card.imagePosition }" :class="card.status === 'active' && 'group-hover:scale-105'">
          <div v-else class="absolute inset-0" :style="card.backgroundStyle">
            <div class="absolute h-40 w-40 border border-white/15 rounded-full -right-8 -top-10" />
            <div class="absolute top-12 h-24 w-24 border border-white/10 rounded-full -right-2" />
            <span class="i-carbon-calendar absolute bottom-2 right-5 text-7xl text-white/8" />
          </div>
          <div class="absolute inset-0 from-[#071621]/90 via-[#102b3c]/30 to-transparent bg-gradient-to-t" />
          <div v-if="card.status === 'ended'" class="absolute inset-0 bg-gray-600/35" />
          <div class="relative min-h-52 flex flex-col justify-between p-5">
            <div class="flex items-start justify-between gap-3">
              <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium backdrop-blur-sm" :class="card.status === 'active' ? 'bg-cyan-100/90 text-cyan-950' : 'bg-gray-100/85 text-gray-700'">
                <span :class="card.status === 'active' ? card.icon : card.status === 'upcoming' ? 'i-carbon-time' : 'i-carbon-checkmark'" />
                {{ card.permanent ? '常驻活动' : card.status === 'active' ? '进行中' : card.status === 'upcoming' ? '未开始' : '已结束' }}
              </span>
              <span v-if="card.pending" class="rounded-full bg-amber-100/90 px-2.5 py-1 text-xs text-amber-900 font-medium">待适配</span>
              <span v-else-if="card.status === 'active' && card.adaptedKey" class="i-carbon-arrow-up-right text-xl text-white/80 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
            <div>
              <h2 class="text-2xl font-semibold">
                {{ card.title }}
              </h2>
              <p class="mt-1 text-sm text-cyan-50/80">
                {{ card.permanent ? '按各节令开放时间领取' : `${formatActivityDateTime(card.window.startMs)} — ${formatActivityDateTime(card.window.endMs)}` }}
              </p>
              <div class="mt-4 flex items-center gap-2 text-xs text-white/65">
                <span :class="card.icon" class="shrink-0 text-base text-cyan-200" />
                {{ card.description }}
              </div>
            </div>
          </div>
        </button>
      </div>
      <div v-if="!filteredActivityCards.length" class="border border-gray-200 rounded-lg border-dashed p-8 text-center text-sm text-gray-500 dark:border-gray-700">
        当前筛选条件下暂无活动
      </div>
    </section>

    <SolarTermsActivityPanel v-else-if="selectedActivity === 'solar-terms'" :labels="L" @back="selectedActivity = null" />
    <div v-else-if="selectedActivityCard?.adaptedKey === 'rain-poem' && selectedActivityCard.status === 'active'" class="space-y-3">
      <button class="inline-flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-gray-900 dark:hover:text-white" @click="selectedActivity = null">
        <span class="i-carbon-arrow-left" />
        返回活动列表
      </button>
      <RainPoemActivityPanel
        v-if="rainPoemActivityActive && currentAccountId"
        :activity="rainPoemActivity"
        :loading="rainPoemLoading"
        @refresh="refreshAll"
      />
      <div v-else-if="rainPoemActivityActive && !currentAccountId" class="rounded-lg bg-white p-10 text-center text-sm text-gray-500 shadow dark:bg-gray-800">
        {{ L.needAccount }}
      </div>
    </div>
    <div v-else-if="selectedActivityCard?.adaptedKey === 'charity-flower' && selectedActivityCard.status === 'active'" class="space-y-3">
      <button class="inline-flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-gray-900 dark:hover:text-white" @click="selectedActivity = null">
        <span class="i-carbon-arrow-left" />返回活动列表
      </button>
      <CharityFlowerActivityPanel v-if="charityFlowerActivityActive && currentAccountId" :activity="charityFlowerActivity" :loading="charityFlowerLoading" @refresh="refreshAll" />
      <div v-else-if="charityFlowerActivityActive && !currentAccountId" class="rounded-lg bg-white p-10 text-center text-sm text-gray-500 shadow dark:bg-gray-800">
        {{ L.needAccount }}
      </div>
    </div>
    <div v-else-if="selectedActivityCard?.adaptedKey === 'wish-sign' && selectedActivityCard.status === 'active'" class="space-y-3">
      <button class="inline-flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-gray-900 dark:hover:text-white" @click="selectedActivity = null">
        <span class="i-carbon-arrow-left" />返回活动列表
      </button>
      <WishShareActivityPanel v-if="wishSignActivityActive && currentAccountId" kind="wish" :activity="wishSignActivity" :loading="wishSignLoading" @refresh="refreshAll" />
      <div v-else-if="wishSignActivityActive && !currentAccountId" class="rounded-lg bg-white p-10 text-center text-sm text-gray-500 shadow dark:bg-gray-800">
        {{ L.needAccount }}
      </div>
    </div>
    <div v-else-if="selectedActivityCard?.adaptedKey === 'share-reward' && selectedActivityCard.status === 'active'" class="space-y-3">
      <button class="inline-flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-gray-900 dark:hover:text-white" @click="selectedActivity = null">
        <span class="i-carbon-arrow-left" />返回活动列表
      </button>
      <WishShareActivityPanel v-if="shareRewardActivityActive && currentAccountId" kind="share" :activity="shareRewardActivity" :loading="shareRewardLoading" @refresh="refreshAll" />
      <div v-else-if="shareRewardActivityActive && !currentAccountId" class="rounded-lg bg-white p-10 text-center text-sm text-gray-500 shadow dark:bg-gray-800">
        {{ L.needAccount }}
      </div>
    </div>
    <!--
      萌宠日记面板自带游戏风格顶栏与返回按钮，且直接读 usePetDiaryStore，
      因此不外挂返回按钮、不传 activity/loading/error props。
    -->
    <div v-else-if="selectedActivityCard?.adaptedKey === 'milk-tea' && selectedActivityCard.status === 'active'">
      <MilkTeaActivityPanel @back="selectedActivity = null" />
    </div>
    <div v-else-if="selectedActivityCard?.adaptedKey === 'pet-diary' && selectedActivityCard.status === 'active'">
      <PetDiaryActivityPanel v-if="petDiaryActivityActive && currentAccountId" @back="selectedActivity = null" />
      <div v-else-if="petDiaryActivityActive && !currentAccountId" class="space-y-3">
        <button class="inline-flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-gray-900 dark:hover:text-white" @click="selectedActivity = null">
          <span class="i-carbon-arrow-left" />返回活动列表
        </button>
        <div class="rounded-lg bg-white p-10 text-center text-sm text-gray-500 shadow dark:bg-gray-800">
          {{ L.needAccount }}
        </div>
      </div>
    </div>
    <div v-else-if="selectedActivityCard" class="space-y-3">
      <button class="inline-flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-gray-900 dark:hover:text-white" @click="selectedActivity = null">
        <span class="i-carbon-arrow-left" />
        返回活动列表
      </button>
      <section class="overflow-hidden rounded-lg bg-white shadow-sm dark:bg-gray-800">
        <div class="relative min-h-48 overflow-hidden text-white">
          <img v-if="selectedActivityCard.image" :src="selectedActivityCard.image" alt="" class="absolute inset-0 h-full w-full object-cover">
          <div v-else class="absolute inset-0" :style="selectedActivityCard.backgroundStyle" />
          <div class="absolute inset-0 from-[#071621]/95 via-[#102b3c]/75 to-[#102b3c]/25 bg-gradient-to-r" />
          <div class="relative min-h-48 flex flex-col justify-end p-6">
            <span class="mb-3 w-fit rounded-full bg-amber-100/90 px-2.5 py-1 text-xs text-amber-900 font-medium">
              {{ selectedActivityCard.status === 'upcoming' ? '未开始' : '进行中' }}
            </span>
            <h1 class="text-3xl font-semibold">
              {{ selectedActivityCard.title }}
            </h1>
            <p class="mt-2 text-sm text-white/75">
              {{ formatActivityDateTime(selectedActivityCard.window.startMs) }} — {{ formatActivityDateTime(selectedActivityCard.window.endMs) }}
            </p>
          </div>
        </div>
        <div class="grid gap-4 p-6 sm:grid-cols-3">
          <div>
            <div class="text-xs text-gray-400">
              活动 ID
            </div>
            <div class="mt-1 text-sm text-gray-800 font-mono dark:text-gray-100">
              {{ selectedActivityCard.key }}
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-400">
              当前状态
            </div>
            <div class="mt-1 text-sm text-gray-800 dark:text-gray-100">
              {{ selectedActivityCard.status === 'upcoming' ? '等待开始' : '活动进行中' }}
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-400">
              分析状态
            </div>
            <div class="mt-1 text-sm text-gray-800 dark:text-gray-100">
              {{ selectedActivityClientPreview ? '客户端静态信息已解析' : selectedActivityCard.pending ? '已发现，等待功能适配' : selectedActivityCard.adaptedKey ? '已适配' : '已收录活动时间' }}
            </div>
          </div>
        </div>
        <div class="border-t border-gray-100 p-6 dark:border-gray-700">
          <section v-if="selectedActivityClientPreview" class="mb-5 border border-cyan-200 rounded-lg bg-cyan-50/60 p-4 dark:border-cyan-900 dark:bg-cyan-950/20">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="flex items-center gap-2">
                  <span class="i-carbon-application-web text-lg text-cyan-700 dark:text-cyan-300" />
                  <h2 class="text-gray-900 font-semibold dark:text-white">
                    客户端静态预解析
                  </h2>
                </div>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {{ selectedActivityClientPreview.source }}
                </p>
              </div>
              <span class="rounded-full bg-cyan-100 px-2.5 py-1 text-xs text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-200">非实时数据</span>
            </div>
            <div class="grid mt-4 gap-3 sm:grid-cols-2">
              <div class="rounded-lg bg-white/80 p-3 dark:bg-gray-900/50">
                <div class="text-xs text-gray-400">
                  实际入口子活动 ID
                </div>
                <code class="mt-1 block text-sm text-gray-800 dark:text-gray-100">{{ selectedActivityClientPreview.entryId }}</code>
              </div>
              <div class="rounded-lg bg-white/80 p-3 dark:bg-gray-900/50">
                <div class="text-xs text-gray-400">
                  客户端入口 UID
                </div>
                <code class="mt-1 block text-sm text-gray-800 dark:text-gray-100">{{ selectedActivityClientPreview.entryUid }}</code>
              </div>
            </div>
            <div class="grid mt-3 gap-2 sm:grid-cols-2">
              <article v-for="module in selectedActivityClientPreview.modules" :key="module.title" class="rounded-lg bg-white/80 p-3 dark:bg-gray-900/50">
                <h3 class="text-sm text-gray-800 font-medium dark:text-gray-100">
                  {{ module.title }}
                </h3>
                <p class="mt-1 text-xs text-gray-500 leading-5 dark:text-gray-400">
                  {{ module.description }}
                </p>
              </article>
            </div>
            <div class="mt-3 border border-amber-200 rounded-lg bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
              <p class="text-xs text-amber-800 font-medium dark:text-amber-200">
                仍待服务端确认
              </p>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <span v-for="item in selectedActivityClientPreview.pending" :key="item" class="rounded bg-white/80 px-2 py-1 text-xs text-amber-700 dark:bg-gray-900/50 dark:text-amber-200">{{ item }}</span>
              </div>
            </div>
          </section>
          <template v-if="selectedActivityDetails.length">
            <div class="flex items-baseline gap-2">
              <h2 class="text-gray-900 font-semibold dark:text-white">
                扫描内容
              </h2>
              <span class="text-xs text-gray-400">{{ selectedActivityDetails.flatMap(flattenActivityDetails).length }} 个节点</span>
            </div>
            <div class="mt-3 space-y-3">
              <article v-for="group in selectedActivityDetails" :key="group.id" class="border border-gray-200 rounded-lg p-4 dark:border-gray-700">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 class="text-gray-900 font-medium dark:text-white">
                      {{ group.title || selectedActivityCard.title }}
                    </h3>
                    <code class="mt-1 block text-xs text-gray-400">ID {{ group.id }}<template v-if="group.type != null"> · 类型 {{ group.type }}</template></code>
                  </div>
                  <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-200">
                    {{ group.enabled === false ? '未启用' : group.visible === false ? '未展示' : '服务端已收录' }}
                  </span>
                </div>
                <div v-if="group.children?.length" class="grid mt-4 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <div v-for="node in group.children" :key="node.id" class="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/40">
                    <div class="flex items-start justify-between gap-2">
                      <span class="text-sm text-gray-800 font-medium dark:text-gray-100">{{ node.title || `功能节点 ${node.id}` }}</span>
                      <code class="shrink-0 text-xs text-gray-400">{{ node.id }}</code>
                    </div>
                    <div v-if="activityFeatureLabels(node).length" class="mt-2 flex flex-wrap gap-1.5">
                      <span v-for="label in activityFeatureLabels(node)" :key="label" class="rounded bg-cyan-50 px-1.5 py-0.5 text-[11px] text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-200">{{ label }}</span>
                    </div>
                    <p v-else class="mt-2 text-xs text-gray-400">
                      已发现节点，玩法字段尚未确认
                    </p>
                  </div>
                </div>
                <p v-else-if="group.error" class="mt-3 text-sm text-amber-700 dark:text-amber-300">
                  读取详情失败：{{ group.error }}
                </p>
                <p v-else class="mt-3 text-sm text-gray-500">
                  服务端仅返回活动基础信息，暂未发现子功能节点。
                </p>
              </article>
            </div>
            <div v-if="activityRuleSections(selectedActivityDetails).length" class="mt-5 space-y-3">
              <section v-for="section in activityRuleSections(selectedActivityDetails)" :key="section.id" class="rounded-lg bg-gray-50 p-4 dark:bg-gray-900/40">
                <h3 class="text-gray-900 font-medium dark:text-white">
                  {{ section.title }}
                </h3>
                <p v-for="(line, index) in section.lines" :key="`${section.id}-${index}`" class="mt-2 whitespace-pre-line text-sm text-gray-600 leading-6 dark:text-gray-300">
                  {{ line }}
                </p>
              </section>
            </div>
          </template>
          <div v-else class="border border-gray-200 rounded-lg border-dashed p-6 text-center dark:border-gray-700">
            <p class="text-sm text-gray-500">
              服务端当前只返回活动名称和时间，尚未下发可展示的动态节点或规则。
            </p>
            <p class="mt-1 text-xs text-gray-400">
              {{ selectedActivityClientPreview ? '上方内容来自官方客户端静态资源，不代表最终玩法规则。' : '活动开放后重新扫描可能取得更多只读信息。' }}
            </p>
          </div>
        </div>
      </section>
    </div>
    <div v-else-if="!currentAccountId" class="rounded-lg bg-white p-10 text-center text-sm text-gray-500 shadow dark:bg-gray-800">
      {{ L.needAccount }}
    </div>
    <div v-else class="space-y-3">
      <button class="inline-flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-gray-900 dark:hover:text-white" @click="selectedActivity = null">
        <span class="i-carbon-arrow-left" />
        返回活动列表
      </button>
      <div class="rounded-lg bg-white p-10 text-center text-sm text-gray-500 shadow dark:bg-gray-800">
        活动信息已更新，请返回列表重新选择。
      </div>
    </div>
  </section>
</template>
