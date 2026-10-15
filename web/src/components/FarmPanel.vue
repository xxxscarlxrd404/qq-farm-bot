<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import FarmScene from '@/components/FarmScene.vue'
import { useAccountStore } from '@/stores/account'
import { useFarmStore } from '@/stores/farm'
import { useStatusStore } from '@/stores/status'

const farmStore = useFarmStore()
const accountStore = useAccountStore()
const statusStore = useStatusStore()
const { lands, summary, weather, loading, dogSkillGiftPendingCount, dogSkillGiftLoading, dogSkillGiftError } = storeToRefs(farmStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { status, loading: statusLoading, realtimeConnected, currentStatusReady } = storeToRefs(statusStore)

const operating = ref(false)
const farmLoaded = ref(false)
const confirmVisible = ref(false)
const farmViewport = ref<HTMLElement | null>(null)
const farmStageWidth = ref<number | null>(null)
const FARM_CANVAS_WIDTH = 1200
const FARM_CANVAS_HEIGHT = 650
type PendingLandAction = 'fertilize' | 'remove'

const confirmConfig = ref({
  title: '',
  message: '',
  opType: '',
  bulkAction: '' as 'removeAll' | '',
  landAction: '' as PendingLandAction | '',
  land: null as any | null,
  type: 'primary' as 'primary' | 'danger',
})

async function executeOperate() {
  if (!currentAccountId.value)
    return

  const config = confirmConfig.value
  if (!config.opType && !config.bulkAction && (!config.landAction || !config.land))
    return

  confirmVisible.value = false
  operating.value = true
  try {
    if (config.opType) {
      await farmStore.operate(currentAccountId.value, config.opType)
    }
    else if (config.bulkAction === 'removeAll') {
      await farmStore.removeAllPlants(currentAccountId.value)
    }
    else if (config.landAction === 'fertilize') {
      await farmStore.fertilizeLand(currentAccountId.value, Number(config.land.id))
    }
    else if (config.landAction === 'remove') {
      await farmStore.removePlant(currentAccountId.value, Number(config.land.id))
    }
  }
  finally {
    operating.value = false
  }
}

function handleOperate(opType: string) {
  if (!currentAccountId.value)
    return

  const confirmMap: Record<string, string> = {
    harvest: '确定要收获所有成熟作物吗？',
    clear: '确定要执行一键务农吗？将自动浇水、除草、除虫。',
    plant: '确定要一键种植吗？(根据策略配置)',
    upgrade: '确定要升级所有可升级的土地吗？(消耗金币)',
    all: '确定要执行一键全收吗？将依次执行收获、务农、种植与升级。',
  }

  confirmConfig.value = {
    title: '确认操作',
    message: confirmMap[opType] || '确定执行此操作吗？',
    opType,
    bulkAction: '',
    landAction: '',
    land: null,
    type: 'primary',
  }
  confirmVisible.value = true
}

function handleRemoveAllPlants() {
  if (!currentAccountId.value)
    return

  confirmConfig.value = {
    title: '确认一键铲除',
    message: '确定要铲除全部已种植作物吗？此操作不可恢复。',
    opType: '',
    bulkAction: 'removeAll',
    landAction: '',
    land: null,
    type: 'danger',
  }
  confirmVisible.value = true
}

function getLandActionName(land: any) {
  return `#${land?.id ?? '-'} ${land?.plantName || '该作物'}`
}

function handleLandFertilize(land: any) {
  if (!currentAccountId.value)
    return

  confirmConfig.value = {
    title: '确认催熟',
    message: `确定要对 ${getLandActionName(land)} 使用有机肥料催熟吗？`,
    opType: '',
    bulkAction: '',
    landAction: 'fertilize',
    land,
    type: 'primary',
  }
  confirmVisible.value = true
}

function handleLandRemove(land: any) {
  if (!currentAccountId.value)
    return

  confirmConfig.value = {
    title: '确认铲除',
    message: `确定要铲除 ${getLandActionName(land)} 吗？此操作不可恢复。`,
    opType: '',
    bulkAction: '',
    landAction: 'remove',
    land,
    type: 'danger',
  }
  confirmVisible.value = true
}

const operations = [
  { type: 'harvest', label: '收获', icon: 'i-carbon-wheat', color: 'bg-blue-600 hover:bg-blue-700' },
  { type: 'clear', label: '一键务农', icon: 'i-carbon-clean', color: 'bg-teal-600 hover:bg-teal-700' },
  { type: 'plant', label: '种植', icon: 'i-carbon-sprout', color: 'bg-green-600 hover:bg-green-700' },
  { type: 'upgrade', label: '升级土地', icon: 'i-carbon-upgrade', color: 'bg-purple-600 hover:bg-purple-700' },
  { type: 'all', label: '一键全收', icon: 'i-carbon-flash', color: 'bg-orange-600 hover:bg-orange-700' },
]

async function refresh() {
  if (currentAccountId.value) {
    const acc = currentAccount.value
    if (!acc)
      return

    try {
      if (!realtimeConnected.value) {
        await statusStore.fetchStatus(currentAccountId.value)
      }

      if (acc.running) {
        await Promise.all([
          farmStore.fetchLands(currentAccountId.value),
          farmStore.fetchDogSkillGiftStatus(currentAccountId.value),
        ])
      }
    }
    finally {
      farmLoaded.value = true
    }
  }
}

async function claimDogSkillGifts() {
  if (currentAccountId.value)
    await farmStore.claimDogSkillGifts(currentAccountId.value)
}

const showInitialLoading = computed(() =>
  !farmLoaded.value && (loading.value || statusLoading.value),
)

const farmStageStyle = computed(() => farmStageWidth.value
  ? { width: `${farmStageWidth.value}px` }
  : undefined)

function updateFarmStageSize() {
  const viewport = farmViewport.value
  if (!viewport || window.innerWidth < 640) {
    farmStageWidth.value = null
    return
  }
  const documentTop = viewport.getBoundingClientRect().top + window.scrollY
  const availableHeight = Math.max(240, window.innerHeight - documentTop - 72)
  const availableWidth = viewport.parentElement?.clientWidth || FARM_CANVAS_WIDTH
  // 保持 1200×650 比例并限制在当前一屏内；外层 viewport 同步收窄，不再露出第二层背景。
  farmStageWidth.value = Math.min(availableWidth, FARM_CANVAS_WIDTH, availableHeight * FARM_CANVAS_WIDTH / FARM_CANVAS_HEIGHT)
}

watch(currentAccountId, (newId, oldId) => {
  if (oldId !== undefined && newId !== oldId) {
    farmLoaded.value = false
    farmStore.clearFarmData()
    statusStore.clearAccountScopedData()
  }
  refresh()
}, { immediate: true })

watch(() => currentAccount.value?.running, () => {
  refresh()
})

const { pause, resume } = useIntervalFn(() => {
  if (lands.value) {
    lands.value = lands.value.map((l: any) =>
      l.matureInSec > 0 ? { ...l, matureInSec: l.matureInSec - 1 } : l,
    )
  }
}, 1000)

const { pause: pauseRefresh, resume: resumeRefresh } = useIntervalFn(refresh, 60000)

resume()
resumeRefresh()
onMounted(() => {
  window.addEventListener('resize', updateFarmStageSize)
  updateFarmStageSize()
})
onUnmounted(() => {
  pause()
  pauseRefresh()
  window.removeEventListener('resize', updateFarmStageSize)
})
</script>

<template>
  <div
    class="space-y-4"
    :class="{ 'farm-panel-modal-open': confirmVisible }"
  >
    <div class="ui-card-elevated rounded-2xl p-4 sm:p-5 shadow-sm transition-all">
      <!-- Header with Title and Actions -->
      <div class="flex flex-col items-stretch justify-between gap-3 border-b border-gray-100/70 pb-3 mb-3 sm:flex-row sm:items-center dark:border-gray-800/70">
        <h3 class="flex items-center gap-2 text-lg font-bold">
          <div class="i-carbon-grid text-xl" />
          土地详情
        </h3>
        <div class="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          <button
            v-for="op in operations"
            :key="op.type"
            class="flex items-center justify-center gap-1.5 rounded px-3 py-2 text-sm text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            :class="op.color"
            :disabled="operating"
            @click="handleOperate(op.type)"
          >
            <div :class="op.icon" />
            <span class="hidden sm:inline">{{ op.label }}</span>
            <span class="sm:hidden">{{ op.type === 'clear' ? '务农' : op.label.replace('一键', '') }}</span>
          </button>
          <button
            class="flex items-center justify-center gap-1.5 rounded bg-red-600 px-3 py-2 text-sm text-white transition disabled:cursor-not-allowed hover:bg-red-700 disabled:opacity-50"
            :disabled="operating"
            @click="handleRemoveAllPlants"
          >
            <div class="i-carbon-trash-can" />
            一键铲除
          </button>
        </div>
      </div>

      <div
        v-if="dogSkillGiftPendingCount > 0"
        class="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
      >
        <div class="i-carbon-gift text-xl" />
        <div class="min-w-0 flex-1">
          待拾取同气连枝礼包 ×{{ dogSkillGiftPendingCount }}
        </div>
        <button
          class="rounded bg-amber-600 px-3 py-1.5 text-white hover:bg-amber-700 disabled:opacity-50"
          :disabled="dogSkillGiftLoading"
          @click="claimDogSkillGifts"
        >
          {{ dogSkillGiftLoading ? '拾取中…' : '拾取' }}
        </button>
      </div>
      <div v-else-if="dogSkillGiftError" class="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
        {{ dogSkillGiftError }}
      </div>

      <!-- Summary (无死白灰带，全透液态微晶胶囊) -->
      <div class="grid grid-cols-4 gap-2 p-2 sm:p-3 text-xs sm:flex sm:flex-wrap sm:gap-3 rounded-xl bg-black/5 dark:bg-white/5 backdrop-blur-md mb-2">
        <div class="flex items-center justify-center gap-1 rounded-full px-2.5 py-1 font-semibold border border-orange-300/60 bg-orange-50/80 text-orange-700 dark:border-orange-500/30 dark:bg-orange-950/40 dark:text-orange-300 shadow-2xs">
          <div class="i-carbon-clean text-[11px]" />
          <span>可收: {{ summary?.harvestable || 0 }}</span>
        </div>
        <div class="flex items-center justify-center gap-1 rounded-full px-2.5 py-1 font-semibold border border-emerald-300/60 bg-emerald-50/80 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300 shadow-2xs">
          <div class="i-carbon-sprout text-[11px]" />
          <span>生长: {{ summary?.growing || 0 }}</span>
        </div>
        <div class="flex items-center justify-center gap-1 rounded-full px-2.5 py-1 font-semibold border border-slate-200/80 bg-white/70 text-slate-700 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300 shadow-2xs">
          <div class="i-carbon-checkbox text-[11px]" />
          <span>空闲: {{ summary?.empty || 0 }}</span>
        </div>
        <div class="flex items-center justify-center gap-1 rounded-full px-2.5 py-1 font-semibold border border-red-300/60 bg-red-50/80 text-red-700 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-300 shadow-2xs">
          <div class="i-carbon-warning text-[11px]" />
          <span>枯萎: {{ summary?.dead || 0 }}</span>
        </div>
      </div>

      <!-- Grid -->
      <div class="p-2 sm:p-4">
        <div v-if="showInitialLoading" class="flex justify-center py-12">
          <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
        </div>

        <div v-else-if="!currentAccountId" class="flex flex-col items-center justify-center gap-4 rounded-lg bg-white p-12 text-center text-gray-500 shadow dark:bg-gray-800">
          <div class="i-carbon-user-offline text-4xl text-gray-400" />
          <div>
            <div class="text-lg text-gray-700 font-medium dark:text-gray-300">
              未登录账号
            </div>
            <div class="mt-1 text-sm text-gray-400">
              请先添加农场账号
            </div>
          </div>
        </div>

        <div v-else-if="!lands || lands.length === 0" class="flex justify-center py-12 text-gray-500">
          暂无土地数据
        </div>

        <div v-else-if="currentStatusReady && !status?.connection?.connected" class="flex flex-col items-center justify-center gap-4 rounded-lg bg-white p-12 text-center text-gray-500 shadow dark:bg-gray-800">
          <div class="i-carbon-connection-signal-off text-4xl text-gray-400" />
          <div>
            <div class="text-lg text-gray-700 font-medium dark:text-gray-300">
              账号未登录
            </div>
            <div class="mt-1 text-sm text-gray-400">
              请先运行账号或检查网络连接
            </div>
          </div>
        </div>

        <div v-else>
          <div ref="farmViewport">
            <FarmScene
              :lands="lands"
              :weather="weather"
              :style="farmStageStyle"
              @fertilize="handleLandFertilize"
              @remove="handleLandRemove"
            />
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="confirmVisible"
      :title="confirmConfig.title"
      :message="confirmConfig.message"
      :type="confirmConfig.type"
      @confirm="executeOperate"
      @close="confirmVisible = false"
      @cancel="confirmVisible = false"
    />
  </div>
</template>
