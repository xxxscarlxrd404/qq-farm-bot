<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import { useUserStore } from '@/stores/user'

interface RankingItem {
  rank: number
  id: string
  name: string
  accountName: string
  platform: 'qq' | 'wx'
  username: string
  avatar: string
  level: number
  isOnline: boolean
  gains: {
    gold: number
    exp: number
    steal: number
    harvest: number
    operations: number
  }
}

interface PublicCareer {
  id?: string
  username?: string
  name: string
  avatar: string
  level: number
  platform: 'qq' | 'wx'
  isOnline: boolean
  totalHarvestCount: number
  totalStealCount: number
  topItems: Array<{
    name: string
    image?: string
    harvestCount: number
  }>
  cached?: boolean
}

const userStore = useUserStore()
const isAdmin = computed(() => userStore.isAdmin)
const currentUsername = computed(() => userStore.username)

// 判断账号是否属于当前登录用户
function isMyAccount(itemOrCareer: RankingItem | PublicCareer | null | undefined) {
  if (!itemOrCareer || !currentUsername.value) return false
  return String(itemOrCareer.username || '').toLowerCase() === String(currentUsername.value).toLowerCase()
}

// 昵称脱敏逻辑：管理员直接全显；普通用户本人全显，他人仅显示第一个字 + 后面固定5个*
function formatDisplayName(itemOrCareer: RankingItem | PublicCareer | null | undefined) {
  if (!itemOrCareer) return '农友'
  const rawName = String(itemOrCareer.name || '').trim() || '农友'
  if (isAdmin.value || isMyAccount(itemOrCareer)) {
    return rawName
  }
  const firstChar = Array.from(rawName)[0] || '*'
  return `${firstChar}*****`
}

const loading = ref(false)
const list = ref<RankingItem[]>([])
const currentRange = ref<'day' | 'week' | 'month'>('day')
const currentMetric = ref<'gold' | 'steal'>('gold')

// 农友生涯弹窗状态
const showCareerModal = ref(false)
const careerLoading = ref(false)
const careerData = ref<PublicCareer | null>(null)

const RANGES = [
  { key: 'day', label: '日榜' },
  { key: 'week', label: '周榜' },
  { key: 'month', label: '月榜' },
] as const

const METRICS = [
  { key: 'gold', label: '收益', imgIcon: '/game-config/resource-icons/gold.png', unit: '金币' },
  { key: 'steal', label: '偷菜', imgIcon: '/game-config/career/steal.png', unit: '次' },
] as const

// 用户名脱敏处理：管理员展示全部；普通用户强制固定显示 6 位（第一位 + **** + 最后一位）
function formatMaskedUsername(name: string) {
  if (!name) return '******'
  if (isAdmin.value) return name

  const str = String(name).trim()
  const first = str[0] || '*'
  const last = str.length > 1 ? str[str.length - 1] : '*'
  return `${first}****${last}`
}

async function fetchRanking() {
  loading.value = true
  try {
    const res = await api.get(`/api/ranking?range=${currentRange.value}&metric=${currentMetric.value}`)
    if (res.data && res.data.ok) {
      list.value = res.data.data.list || []
    }
  } catch (err) {
    console.error('获取排行榜失败:', err)
  } finally {
    loading.value = false
  }
}

async function openUserCareer(item: RankingItem) {
  showCareerModal.value = true
  careerLoading.value = true
  careerData.value = null
  try {
    const res = await api.get(`/api/ranking/career/${item.id}`)
    if (res.data && res.data.ok) {
      careerData.value = {
        ...res.data.data,
        id: item.id,
        username: item.username,
      }
    }
  } catch (err) {
    console.error('加载农友生涯失败:', err)
  } finally {
    careerLoading.value = false
  }
}

function selectRange(range: 'day' | 'week' | 'month') {
  currentRange.value = range
  fetchRanking()
}

function selectMetric(metric: 'gold' | 'steal') {
  currentMetric.value = metric
  fetchRanking()
}

function formatNumber(val: number) {
  const num = Number(val || 0)
  if (!num) return '0'
  // 亿级单位支持 (>= 100,000,000)
  if (num >= 100000000) {
    const y = num / 100000000
    const str = (y >= 100 ? y.toFixed(1) : y.toFixed(2)).replace(/\.0+$|(?<=\.\d)0+$/g, '')
    return `${str}亿`
  }
  // 万级单位支持 (>= 10,000)
  if (num >= 10000) {
    const w = num / 10000
    const str = (w >= 100 ? w.toFixed(1) : w.toFixed(2)).replace(/\.0+$|(?<=\.\d)0+$/g, '')
    return `${str}万`
  }
  return num.toLocaleString('zh-CN')
}

function formatCompactNumber(val: number) {
  const num = Number(val || 0)
  if (num >= 100000000) {
    return `${(num / 100000000).toFixed(2).replace(/\.0+$|(?<=\.\d)0+$/g, '')}亿`
  }
  if (num >= 10000) {
    return `${(num / 10000).toFixed(1).replace(/\.0$/, '')}万`
  }
  return formatNumber(num)
}

function getRankTrophy(rank: number) {
  if (rank === 1) return '/ranking/rank1.svg'
  if (rank === 2) return '/ranking/rank2.svg'
  if (rank === 3) return '/ranking/rank3.svg'
  return ''
}

onMounted(() => {
  fetchRanking()
})
</script>

<template>
  <div class="w-full">
    <!-- 合并为一体化大卡片 -->
    <div class="liquid-card relative overflow-hidden rounded-2xl p-3.5 sm:p-5">
      <!-- 头部：标题与周期筛选 (日榜 / 周榜 / 月榜) -->
      <div class="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div class="flex items-center gap-2">
          <!-- 专属本站排行领奖台图标（完美自适应主题色） -->
          <div class="h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/25 p-1.5 shadow-sm text-emerald-600 dark:text-emerald-400">
            <span
              class="h-full w-full bg-current inline-block"
              style="mask: url(/ranking/rank.svg) no-repeat center / contain; -webkit-mask: url(/ranking/rank.svg) no-repeat center / contain;"
            />
          </div>
          <h1 class="text-lg sm:text-xl font-extrabold tracking-tight text-gray-900 dark:text-white">
            本站排行
          </h1>
        </div>

        <div class="flex items-center gap-1 p-0.8 rounded-xl bg-white/40 dark:bg-white/5 border border-white/40 dark:border-white/10 backdrop-blur-md shadow-inner self-start sm:self-auto">
          <button
            v-for="r in RANGES"
            :key="r.key"
            class="px-3 py-1 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-200"
            :class="currentRange === r.key
              ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-500/20 scale-[1.02]'
              : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-white/20'"
            @click="selectRange(r.key)"
          >
            {{ r.label }}
          </button>
        </div>
      </div>

      <!-- 维度切换胶囊 (收益 / 偷菜) -->
      <div class="mt-2.5 flex flex-wrap gap-1.5 pt-2.5 border-t border-gray-200/40 dark:border-gray-700/40">
        <button
          v-for="m in METRICS"
          :key="m.key"
          class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
          :class="currentMetric === m.key
            ? 'bg-white/85 dark:bg-gray-800/85 text-gray-900 dark:text-white shadow-sm border border-white/60 dark:border-white/15'
            : 'bg-transparent text-gray-500 dark:text-gray-400 hover:bg-white/30 dark:hover:bg-white/5'"
          @click="selectMetric(m.key)"
        >
          <img :src="m.imgIcon" :alt="m.label" class="h-3.5 w-3.5 shrink-0 object-contain">
          <span>{{ m.label }}</span>
        </button>
      </div>

      <!-- 列表直接融入同一卡片内部，无间隔缝隙 -->
      <div class="mt-3 pt-3 border-t border-gray-200/40 dark:border-gray-700/40 min-h-[300px]">
        <div v-if="loading" class="flex flex-col items-center justify-center py-16 text-gray-400">
          <div class="i-carbon-circle-dash text-3xl animate-spin text-emerald-500" />
          <span class="mt-2 text-xs">正在获取荣耀战报...</span>
        </div>

        <div v-else-if="!list.length" class="flex flex-col items-center justify-center py-16 text-gray-400">
          <div class="i-carbon-chart-relationship text-4xl opacity-40 mb-2" />
          <span class="text-xs">暂无榜单数据，快去农场开始劳作吧！</span>
        </div>

        <div v-else class="space-y-2">
          <!-- 榜单列表项目 -->
          <div
            v-for="item in list"
            :key="item.id"
            class="liquid-row flex items-center justify-between gap-2 p-2.5 sm:p-3 rounded-xl transition-all duration-200"
            :class="{
              'ring-1 ring-amber-500/30 bg-amber-500/5': item.rank === 1,
              'ring-1 ring-slate-400/20 bg-slate-400/5': item.rank === 2,
              'ring-1 ring-amber-700/20 bg-amber-700/5': item.rank === 3,
            }"
          >
            <!-- 左侧：名次 + 头像（点击弹出生涯） + 昵称 + 等级 + 平台 + 归属 -->
            <div class="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
              <!-- 名次展示 -->
              <div class="w-8 h-8 sm:w-9 sm:h-9 flex shrink-0 items-center justify-center">
                <img
                  v-if="item.rank <= 3"
                  :src="getRankTrophy(item.rank)"
                  :alt="`第${item.rank}名`"
                  class="w-full h-full object-contain drop-shadow-sm transition-transform duration-200 hover:scale-110"
                >
                <div
                  v-else
                  class="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg font-extrabold font-mono text-xs sm:text-sm bg-black/5 dark:bg-white/5 text-gray-500 dark:text-gray-400 border border-black/10 dark:border-white/10"
                >
                  {{ item.rank }}
                </div>
              </div>

              <!-- 头像及在线状态点（纯净头像，点击查看生涯名片） -->
              <div
                class="relative shrink-0 cursor-pointer group"
                title="点击查看农友生涯名片"
                @click="openUserCareer(item)"
              >
                <img
                  :src="item.avatar || '/icon.png'"
                  alt="头像"
                  referrerpolicy="no-referrer"
                  class="w-10 h-10 sm:w-11 sm:h-11 rounded-xl object-cover ring-2 ring-white/80 dark:ring-white/10 shadow-sm transition-transform duration-200 group-hover:scale-105 active:scale-95"
                  @error="(e: any) => e.target.src = '/icon.png'"
                >
                <span
                  class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-white dark:ring-gray-900"
                  :class="item.isOnline ? 'bg-emerald-500' : 'bg-gray-400'"
                  :title="item.isOnline ? '正在运行中' : '离线'"
                />
              </div>

              <!-- 右侧两行排版：完全复刻账号设置页视觉 -->
              <div class="flex flex-col min-w-0 justify-center">
                <!-- 第一行：昵称 + 等级徽章 -->
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span
                    class="font-bold text-gray-900 dark:text-white truncate text-sm cursor-pointer hover:underline"
                    :title="isMyAccount(item) ? item.name : '农友昵称已加密'"
                    @click="openUserCareer(item)"
                  >
                    {{ formatDisplayName(item) }}
                  </span>
                  
                  <span class="text-xs text-amber-500 font-bold font-mono shrink-0">
                    Lv.{{ item.level }}
                  </span>
                </div>

                <!-- 第二行：账号设置同款平台胶囊 + 归属用户 -->
                <div class="mt-0.5 flex items-center gap-2">
                  <span
                    class="rounded px-1.5 py-0.2 text-[10px] font-medium leading-tight shrink-0"
                    :class="item.platform === 'wx'
                      ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'"
                  >
                    {{ item.platform === 'wx' ? '微信' : 'QQ' }}
                  </span>

                  <!-- 用户归属（已精简：去除“归属:”字样，只留小图标与用户名） -->
                  <div class="flex items-center text-[11px] text-gray-400 font-mono">
                    <span class="flex items-center gap-1">
                      <div class="i-carbon-user text-[11px] opacity-75" />
                      <strong class="text-gray-600 dark:text-gray-300 font-medium">{{ formatMaskedUsername(item.username) }}</strong>
                    </span>
                    <!-- 本人账号归属标签 -->
                    <span
                      v-if="isMyAccount(item)"
                      class="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] font-extrabold bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm ring-1 ring-white/50 dark:ring-white/10"
                    >
                      我
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 右侧：收益数值展示 -->
            <div class="flex items-center gap-1.5 shrink-0 pl-1">
              <!-- 偷菜榜专属：水平镜像的偷取小手图标 -->
              <img
                v-if="currentMetric === 'steal'"
                src="/game-config/career/steal.png"
                alt="偷菜"
                class="h-3.5 w-3.5 shrink-0 object-contain -scale-x-100"
              />
              <span
                class="text-sm sm:text-base font-extrabold font-mono"
                :class="{
                  'text-amber-500': currentMetric === 'gold',
                  'text-orange-500': currentMetric === 'steal',
                }"
              >
                {{ currentMetric === 'gold' ? '+' : '' }}{{ formatNumber(item.gains[currentMetric] ?? item.gains.gold) }}
              </span>
              <!-- 收益榜时展示上方金币图标；偷菜榜时保留“次” -->
              <img
                v-if="currentMetric === 'gold'"
                src="/game-config/resource-icons/gold.png"
                alt="金币"
                class="h-3.5 w-3.5 shrink-0 object-contain"
              />
              <span v-else class="text-xs text-gray-400 font-normal">
                {{ METRICS.find(m => m.key === currentMetric)?.unit }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 农友专属脱敏生涯名片弹窗 (全通透液态毛玻璃) -->
    <Teleport to="body">
      <Transition name="snappy-modal">
        <div
          v-if="showCareerModal"
          class="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/45 backdrop-blur-md"
          @click.self="showCareerModal = false"
        >
        <div class="liquid-card relative max-w-md w-full rounded-3xl p-5 sm:p-6 shadow-2xl border border-white/60 dark:border-white/15 overflow-hidden">
          <!-- 关闭按钮 -->
          <button
            class="absolute top-4 right-4 h-8 w-8 flex items-center justify-center rounded-full bg-white/40 dark:bg-white/10 text-gray-500 hover:text-gray-800 dark:hover:text-white transition"
            @click="showCareerModal = false"
          >
            <div class="i-carbon-close text-xl" />
          </button>

          <!-- 加载中 -->
          <div v-if="careerLoading" class="py-16 flex flex-col items-center justify-center text-gray-400">
            <div class="i-carbon-circle-dash text-4xl animate-spin text-emerald-500 mb-3" />
            <span class="text-sm">正在调取农友生涯名片...</span>
          </div>

          <!-- 生涯内容（100% 安全脱敏：无 GID、无资产余额、无私人配置） -->
          <div v-else-if="careerData" class="space-y-4">
            <!-- 头部身份信息 -->
            <div class="flex items-center gap-3.5 pr-8">
              <div class="relative shrink-0">
                <img
                  :src="careerData.avatar || '/icon.png'"
                  alt="头像"
                  class="w-14 h-14 rounded-2xl object-cover ring-2 ring-white/80 dark:ring-white/20 shadow-md"
                  @error="(e: any) => e.target.src = '/icon.png'"
                >
                <span
                  class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-white dark:ring-gray-900"
                  :class="careerData.isOnline ? 'bg-emerald-500' : 'bg-gray-400'"
                />
              </div>

              <div class="flex flex-col min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h3 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">
                    {{ formatDisplayName(careerData) }}
                  </h3>
                  <span
                    v-if="isMyAccount(careerData)"
                    class="px-1.5 py-0.2 rounded-full text-[10px] font-extrabold bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm ring-1 ring-white/50 dark:ring-white/10"
                  >
                    我
                  </span>
                  <span class="text-xs text-amber-500 font-bold font-mono shrink-0">
                    Lv.{{ careerData.level }}
                  </span>
                </div>
                <div class="flex items-center gap-2 mt-1">
                  <span
                    class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                    :class="careerData.platform === 'wx'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                      : 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30'"
                  >
                    {{ careerData.platform === 'wx' ? '微信农友' : 'QQ农友' }}
                  </span>
                  <span class="text-[11px] text-gray-400">
                    {{ careerData.isOnline ? '实时在线' : '离线战报' }}
                  </span>
                </div>
              </div>
            </div>

            <!-- 核心生涯数据面板 -->
            <div class="grid grid-cols-2 gap-2.5 pt-2">
              <div class="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-white/50 dark:bg-white/5 border border-white/60 dark:border-white/10 text-center shadow-sm">
                <div class="flex items-center gap-1.5 text-xs text-orange-600 dark:text-orange-300 font-medium mb-1">
                  <img src="/game-config/career/harvest.png" alt="收获" class="h-5 w-5 object-contain">
                  <span>历史累计收获</span>
                </div>
                <div class="text-lg sm:text-xl font-extrabold font-mono text-orange-600 dark:text-orange-400">
                  {{ formatCompactNumber(careerData.totalHarvestCount) }}
                </div>
              </div>

              <div class="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-white/50 dark:bg-white/5 border border-white/60 dark:border-white/10 text-center shadow-sm">
                <div class="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-300 font-medium mb-1">
                  <img src="/game-config/career/steal.png" alt="偷菜" class="h-5 w-5 object-contain">
                  <span>摘取好友作物</span>
                </div>
                <div class="text-lg sm:text-xl font-extrabold font-mono text-rose-600 dark:text-rose-400">
                  {{ formatCompactNumber(careerData.totalStealCount) }}
                </div>
              </div>
            </div>

            <!-- 最常种植的作物 (若有) -->
            <div v-if="careerData.topItems && careerData.topItems.length" class="pt-2">
              <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                🌾 代表性丰收作物
              </div>
              <div class="grid grid-cols-3 gap-2">
                <div
                  v-for="crop in careerData.topItems.slice(0, 3)"
                  :key="crop.name"
                  class="flex flex-col items-center p-2 rounded-xl bg-white/40 dark:bg-white/5 border border-white/40 dark:border-white/5 text-center"
                >
                  <img v-if="crop.image" :src="crop.image" :alt="crop.name" class="h-8 w-8 object-contain mb-1">
                  <div class="text-xs font-bold text-gray-800 dark:text-gray-200 truncate max-w-full">
                    {{ crop.name }}
                  </div>
                  <div class="text-[10px] text-gray-400 font-mono">
                    收 {{ formatCompactNumber(crop.harvestCount) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
  </div>
</template>

<style scoped>
.liquid-card {
  background: var(--liquid-glass-bg);
  backdrop-filter: var(--liquid-glass-blur);
  -webkit-backdrop-filter: var(--liquid-glass-blur);
  border: 1px solid var(--liquid-glass-border);
  box-shadow: var(--liquid-glass-shadow);
}

.liquid-row {
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.8), 0 2px 8px rgba(15, 23, 42, 0.02);
}

.dark .liquid-row {
  background: rgba(30, 41, 59, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.1);
}

.liquid-row:hover {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(255, 255, 255, 0.95);
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.9), 0 8px 20px rgba(15, 23, 42, 0.05);
}

.dark .liquid-row:hover {
  background: rgba(51, 65, 85, 0.65);
  border-color: rgba(255, 255, 255, 0.18);
}

/* 极速灵动弹出动画（150ms 弹力曲线，干脆利落） */
.snappy-modal-enter-active,
.snappy-modal-leave-active {
  transition: opacity 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

.snappy-modal-enter-active .liquid-card,
.snappy-modal-leave-active .liquid-card {
  transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.15s ease;
  will-change: transform, opacity;
}

.snappy-modal-enter-from {
  opacity: 0;
}

.snappy-modal-enter-from .liquid-card {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}

.snappy-modal-leave-to {
  opacity: 0;
}

.snappy-modal-leave-to .liquid-card {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}

</style>
