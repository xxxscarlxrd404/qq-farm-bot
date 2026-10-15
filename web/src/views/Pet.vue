<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useAccountStore } from '@/stores/account'
import { usePetStore } from '@/stores/pet'
import { useToastStore } from '@/stores/toast'

type PetTab = 'pets' | 'logs' | 'capital'

const accountStore = useAccountStore()
const petStore = usePetStore()
const toast = useToastStore()
const { currentAccountId } = storeToRefs(accountStore)
const { overview, logs, capitalMode, loading, mutating } = storeToRefs(petStore)
const tab = ref<PetTab>('pets')
const feedCounts = reactive<Record<number, number>>({})
const draft = reactive({ enabled: false, dogId: 0, leadSeconds: 10 })
const saving = ref(false)

const tabs: { key: PetTab, label: string, icon: string }[] = [
  { key: 'pets', label: '宠物管理', icon: 'i-carbon-dog-walker' },
  { key: 'logs', label: '守护记录', icon: 'i-carbon-security' },
  { key: 'capital', label: '资本模式', icon: 'i-carbon-time' },
]
const sortedDogs = computed(() => [...overview.value.dogs].sort((a, b) => Number(b.deployed) - Number(a.deployed) || Number(b.owned) - Number(a.owned) || Number(b.activatable) - Number(a.activatable) || b.rarity - a.rarity))
const ownedCount = computed(() => overview.value.dogs.filter(dog => dog.owned).length)
const deployed = computed(() => overview.value.dogs.find(dog => dog.deployed))
const foodPercent = computed(() => {
  const maximum = Math.max(overview.value.protectSeconds || 0, 1)
  return Math.min(100, Math.max(0, (overview.value.foodSeconds / maximum) * 100))
})

function getFeedCount(foodId: number) {
  return feedCounts[foodId] ?? 1
}

function setFeedCount(foodId: number, value: number, available: number) {
  const maximum = Math.max(1, Math.min(available, 99))
  feedCounts[foodId] = Math.min(maximum, Math.max(1, Math.trunc(Number(value) || 1)))
}

function invalidFeedCount(foodId: number, available: number) {
  const count = getFeedCount(foodId)
  return !Number.isInteger(count) || count < 1 || count > Math.min(available, 99)
}

function duration(seconds: number) {
  if (seconds <= 0)
    return '未补充'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days)
    return `${days}天 ${hours}小时`
  if (hours)
    return `${hours}小时 ${minutes}分钟`
  return `${minutes}分钟`
}

async function load() {
  const id = String(currentAccountId.value || '')
  if (!id)
    return
  try {
    await Promise.all([
      petStore.fetchOverview(id),
      petStore.fetchCapitalMode(id),
      tab.value === 'logs' ? petStore.fetchLogs(id) : Promise.resolve(),
    ])
    Object.assign(draft, capitalMode.value)
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '加载失败')
  }
}

const autoToggling = ref(false)

async function toggleAutoBuyFood(val: boolean) {
  const id = String(currentAccountId.value || '')
  if (!id || autoToggling.value) return
  autoToggling.value = true
  try {
    await petStore.setAutoConfig(id, { autoBuyFood: val })
    toast.success(`自动买粮已${val ? '开启' : '关闭'}`)
  } catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '设置失败')
  } finally {
    autoToggling.value = false
  }
}

async function toggleAutoFeedDog(val: boolean) {
  const id = String(currentAccountId.value || '')
  if (!id || autoToggling.value) return
  autoToggling.value = true
  try {
    await petStore.setAutoConfig(id, { autoFeedDog: val })
    toast.success(`自动喂食已${val ? '开启' : '关闭'}`)
  } catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '设置失败')
  } finally {
    autoToggling.value = false
  }
}

async function action(run: () => Promise<any>, message: string) {
  try {
    await run()
    toast.success(message)
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '操作失败')
  }
}

async function saveSettings() {
  if (saving.value)
    return
  saving.value = true
  try {
    await action(() => petStore.saveCapitalMode(String(currentAccountId.value), draft), '设置已保存')
  }
  finally {
    saving.value = false
  }
}

watch([currentAccountId, tab], load)
onMounted(load)
</script>

<template>
  <section class="pet-page flex flex-col gap-3 lg:min-h-0 lg:h-full lg:flex-1 lg:overflow-hidden">
    <header class="flex shrink-0 flex-wrap items-center justify-between gap-3">
      <div class="min-w-0 flex items-center gap-3">
        <div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--theme-primary)_12%,transparent)] text-[var(--theme-primary)]">
          <span class="i-fa-solid-paw text-xl" />
        </div>
        <div class="min-w-0">
          <h1 class="text-xl text-gray-900 font-bold sm:text-2xl dark:text-gray-100">
            宠物犬
          </h1>
          <p class="truncate text-xs text-gray-500 dark:text-gray-400">
            管理守护伙伴与狗粮补给
          </p>
        </div>
      </div>
      <BaseButton variant="secondary" size="sm" :loading="loading" :disabled="mutating || !currentAccountId" aria-label="刷新宠物数据" @click="load">
        <span v-if="!loading" class="i-carbon-renew mr-1" />刷新
      </BaseButton>
    </header>

    <nav class="flex shrink-0 gap-1 border-b border-gray-200 dark:border-gray-700" aria-label="宠物功能">
      <button
        v-for="item in tabs"
        :key="item.key"
        type="button"
        class="relative flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors sm:px-4"
        :class="tab === item.key ? 'text-[var(--theme-primary)]' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'"
        :aria-current="tab === item.key ? 'page' : undefined"
        @click="tab = item.key"
      >
        <span :class="item.icon" />{{ item.label }}
        <span v-if="tab === item.key" class="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--theme-primary)]" />
      </button>
    </nav>

    <div v-if="!currentAccountId" class="ui-card min-h-72 flex flex-1 flex-col items-center justify-center rounded-lg p-8 text-center">
      <span class="i-carbon-user-avatar mb-3 text-4xl text-gray-300 dark:text-gray-600" />
      <h2 class="text-base text-gray-800 font-semibold dark:text-gray-100">
        请选择农场账号
      </h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        选择账号后即可管理宠物与守护状态
      </p>
    </div>

    <div v-else-if="loading && !overview.dogs.length" class="ui-card min-h-72 flex flex-1 flex-col items-center justify-center rounded-lg p-8 text-center" role="status">
      <span class="i-svg-spinners-ring-resize mb-3 text-3xl text-[var(--theme-primary)]" />
      <p class="text-sm text-gray-500 dark:text-gray-400">
        正在加载宠物信息
      </p>
    </div>

    <template v-else-if="tab === 'pets'">
      <div class="pet-workspace flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.85fr)]">
        <section class="ui-card flex flex-col rounded-lg lg:min-h-0 lg:overflow-hidden">
          <div class="guardian-strip flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 p-3 sm:flex-nowrap dark:border-gray-700 sm:p-4">
            <div class="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-gray-50 dark:bg-gray-700/60">
              <img v-if="deployed?.image" :src="deployed.image" :alt="deployed.name" class="h-14 w-14 object-contain">
              <span v-else class="i-fa-solid-paw text-2xl text-gray-300 dark:text-gray-500" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="mb-1 flex flex-wrap items-center gap-2">
                <span class="text-xs text-gray-500 dark:text-gray-400">当前守护</span>
                <span class="rounded px-1.5 py-0.5 text-[11px] font-medium" :class="deployed ? 'bg-green-50 text-green-600 dark:bg-green-900/25 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'">
                  {{ deployed ? '守护中' : '未派出' }}
                </span>
              </div>
              <h2 class="truncate text-lg text-gray-900 font-semibold dark:text-gray-100">
                {{ deployed?.name || '选择一只宠物开始守护' }}
              </h2>
              <p class="mt-0.5 hidden truncate text-xs text-gray-500 sm:block dark:text-gray-400">
                {{ deployed?.desc || `已拥有 ${ownedCount} 只宠物` }}
              </p>
            </div>

            <!-- 中间偏右：极简紧凑无图标胶囊开关（一列排列） -->
            <div class="flex flex-col gap-1 shrink-0 self-center mr-1">
              <!-- 自动买粮开关 -->
              <label
                class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/75 dark:bg-gray-800/75 border border-gray-200/60 dark:border-gray-700/60 shadow-sm cursor-pointer select-none transition-all hover:bg-white dark:hover:bg-gray-800"
                title="12小时巡查检测：背包无狗粮且点券充足时，自动在商城购买狗粮礼包"
              >
                <span class="text-[10px] text-gray-500 dark:text-gray-400 font-medium">自动买粮</span>
                <input
                  type="checkbox"
                  :checked="overview.autoBuyFood"
                  :disabled="autoToggling"
                  class="relative h-3 w-5 rounded-full bg-gray-300 dark:bg-gray-600 appearance-none cursor-pointer transition-colors duration-200 ease-in-out focus:outline-none checked:bg-amber-500 checked:hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:h-2 after:w-2 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 checked:after:translate-x-2"
                  @change="toggleAutoBuyFood(($event.target as HTMLInputElement).checked)"
                />
              </label>

              <!-- 自动喂食开关 -->
              <label
                class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/75 dark:bg-gray-800/75 border border-gray-200/60 dark:border-gray-700/60 shadow-sm cursor-pointer select-none transition-all hover:bg-white dark:hover:bg-gray-800"
                title="12小时巡查检测：守护剩余不足24小时且背包有狗粮时，自动喂食补充"
              >
                <span class="text-[10px] text-gray-500 dark:text-gray-400 font-medium">自动喂食</span>
                <input
                  type="checkbox"
                  :checked="overview.autoFeedDog"
                  :disabled="autoToggling"
                  class="relative h-3 w-5 rounded-full bg-gray-300 dark:bg-gray-600 appearance-none cursor-pointer transition-colors duration-200 ease-in-out focus:outline-none checked:bg-emerald-500 checked:hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:h-2 after:w-2 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 checked:after:translate-x-2"
                  @change="toggleAutoFeedDog(($event.target as HTMLInputElement).checked)"
                />
              </label>
            </div>

            <!-- 最右侧：原版召回按钮稳稳保留 -->
            <button
              v-if="deployed"
              class="rounded-xl border border-gray-200/80 bg-white/90 px-3.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-white hover:border-gray-300 active:scale-95 dark:border-gray-700 dark:bg-gray-800/90 dark:text-gray-200 dark:hover:bg-gray-800 shrink-0 self-center"
              :disabled="mutating"
              @click="action(() => petStore.withdraw(String(currentAccountId)), '宠物已召回')"
            >
              <span class="i-carbon-pause mr-1 inline-block align-middle text-gray-500" />召回
            </button>
          </div>

          <div class="flex shrink-0 items-center justify-between gap-3 px-3 pb-1 pt-3 sm:px-4">
            <div>
              <h2 class="text-sm text-gray-900 font-semibold dark:text-gray-100">
                宠物伙伴
              </h2>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                已拥有 {{ ownedCount }} / {{ overview.dogs.length }}
              </p>
            </div>
            <span class="hidden text-xs text-gray-400 sm:block">选择伙伴切换守护</span>
          </div>

          <div v-if="!overview.dogs.length" class="flex flex-1 items-center justify-center p-8 text-sm text-gray-500 dark:text-gray-400">
            暂无宠物数据，请刷新重试
          </div>
          <div v-else class="dog-grid p-3 pt-2 sm:p-4 sm:pt-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <article
              v-for="dog in sortedDogs"
              :key="dog.id"
              class="dog-card min-w-0 flex flex-col border rounded-lg p-2.5 transition sm:p-3"
              :class="dog.deployed
                ? 'border-[var(--theme-primary)] bg-[color-mix(in_srgb,var(--theme-primary)_7%,transparent)] shadow-sm'
                : dog.owned || dog.activatable
                  ? 'border-gray-200 bg-white hover:border-[var(--theme-primary)] dark:border-gray-700 dark:bg-gray-800'
                  : 'border-gray-200 bg-gray-50 opacity-65 dark:border-gray-700 dark:bg-gray-900/30'"
            >
              <div class="min-w-0 flex items-start gap-2.5">
                <div class="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-gray-50 dark:bg-gray-700/70">
                  <img v-if="dog.image" :src="dog.image" :alt="dog.name" loading="lazy" class="h-13 w-13 object-contain">
                  <span v-else class="i-fa-solid-paw text-xl text-gray-300 dark:text-gray-500" />
                </div>
                <div class="min-w-0 flex-1 pt-0.5">
                  <div class="flex items-start justify-between gap-1">
                    <h3 class="truncate text-sm text-gray-900 font-semibold dark:text-gray-100" :title="dog.name">
                      {{ dog.name }}
                    </h3>
                    <span v-if="dog.owned" class="shrink-0 text-[11px] text-gray-400">Lv.{{ dog.level || 1 }}</span>
                  </div>
                  <p class="dog-description line-clamp-2 mt-1 text-[11px] text-gray-500 leading-4 dark:text-gray-400" :title="dog.desc || undefined">
                    {{ dog.desc || (dog.owned ? '农场守护伙伴' : dog.activatable ? '背包中有宠物卡，可激活' : '尚未获得该宠物') }}
                  </p>
                </div>
              </div>
              <button
                type="button"
                class="mt-2 h-8 w-full flex items-center justify-center gap-1 rounded-md text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-55"
                :class="dog.deployed
                  ? 'bg-[color-mix(in_srgb,var(--theme-primary)_14%,transparent)] text-[var(--theme-primary)]'
                  : dog.owned || dog.activatable
                    ? 'bg-gray-100 text-gray-700 hover:bg-[var(--theme-primary)] hover:text-white dark:bg-gray-700 dark:text-gray-200'
                    : 'bg-gray-100 text-gray-400 dark:bg-gray-800'"
                :disabled="(!dog.owned && !dog.activatable) || dog.deployed || mutating"
                @click="dog.activatable
                  ? action(() => petStore.activate(String(currentAccountId), dog.id), `${dog.name}已激活`)
                  : action(() => petStore.deploy(String(currentAccountId), dog.id), `${dog.name}已派出`)"
              >
                <span :class="dog.deployed ? 'i-carbon-checkmark-filled' : dog.owned ? 'i-carbon-play-filled' : dog.activatable ? 'i-carbon-unlocked' : 'i-carbon-locked'" />
                {{ dog.deployed ? '正在守护' : dog.owned ? '派出守护' : dog.activatable ? '激活宠物' : '尚未获得' }}
              </button>
            </article>
          </div>
        </section>

        <section class="ui-card flex flex-col rounded-lg lg:min-h-0 lg:overflow-hidden">
          <div class="shrink-0 border-b border-gray-200 p-3 dark:border-gray-700 sm:p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <span class="i-carbon-time" />守护剩余时长
                </p>
                <strong class="mt-1 block truncate text-xl text-gray-900 font-bold font-mono dark:text-gray-100" :title="duration(overview.foodSeconds)">{{ duration(overview.foodSeconds) }}</strong>
              </div>
              <span class="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-300">上限 {{ duration(overview.protectSeconds) }}</span>
            </div>
            <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
              <div class="h-full rounded-full bg-[var(--theme-primary)] transition-all" :style="{ width: `${foodPercent}%` }" />
            </div>
          </div>

          <div class="flex shrink-0 items-center justify-between px-3 pb-1 pt-3 sm:px-4">
            <div>
              <h2 class="text-sm text-gray-900 font-semibold dark:text-gray-100">
                喂食补给
              </h2>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                选择数量后立即补充
              </p>
            </div>
            <span class="i-carbon-restaurant text-lg text-gray-400" />
          </div>

          <div v-if="!overview.foods.length" class="flex flex-1 items-center justify-center p-8 text-sm text-gray-500 dark:text-gray-400">
            暂无狗粮数据
          </div>
          <div v-else class="food-list p-3 pt-2 space-y-2 sm:p-4 sm:pt-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <article v-for="food in overview.foods" :key="food.id" class="food-card border border-gray-200 rounded-lg p-2.5 dark:border-gray-700">
              <div class="min-w-0 flex items-center gap-2.5">
                <div class="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-gray-50 dark:bg-gray-700/60">
                  <img v-if="food.image" :src="food.image" :alt="food.name" loading="lazy" class="h-10 w-10 object-contain">
                  <span v-else class="i-carbon-restaurant text-lg text-gray-400" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <h3 class="truncate text-sm text-gray-900 font-medium dark:text-gray-100" :title="food.name">
                      {{ food.name }}
                    </h3>
                    <span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">库存 <b class="text-gray-900 dark:text-gray-100">{{ food.count }}</b></span>
                  </div>
                  <p class="food-duration mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                    每份延长 {{ food.days }} 天
                  </p>
                </div>
              </div>
              <div class="mt-2 flex items-center gap-2">
                <div class="h-8 flex flex-1 items-center overflow-hidden border border-gray-200 rounded-md dark:border-gray-600">
                  <button type="button" class="grid h-full w-8 shrink-0 place-items-center text-gray-500 hover:bg-gray-100 dark:text-gray-300 disabled:opacity-35 dark:hover:bg-gray-700" :disabled="!food.count || mutating || getFeedCount(food.id) <= 1" :aria-label="`减少${food.name}数量`" @click="setFeedCount(food.id, getFeedCount(food.id) - 1, food.count)">
                    <span class="i-carbon-subtract" />
                  </button>
                  <input
                    :value="getFeedCount(food.id)"
                    type="number"
                    inputmode="numeric"
                    min="1"
                    :max="Math.min(food.count, 99)"
                    :aria-label="`${food.name}喂食数量`"
                    class="h-full min-w-0 w-full border-x border-y-0 border-gray-200 bg-transparent px-1 text-center text-xs text-gray-900 outline-none dark:border-gray-600 focus:border-[var(--theme-primary)] dark:text-gray-100"
                    :disabled="!food.count || mutating"
                    @input="setFeedCount(food.id, Number(($event.target as HTMLInputElement).value), food.count)"
                  >
                  <button type="button" class="grid h-full w-8 shrink-0 place-items-center text-gray-500 hover:bg-gray-100 dark:text-gray-300 disabled:opacity-35 dark:hover:bg-gray-700" :disabled="!food.count || mutating || getFeedCount(food.id) >= Math.min(food.count, 99)" :aria-label="`增加${food.name}数量`" @click="setFeedCount(food.id, getFeedCount(food.id) + 1, food.count)">
                    <span class="i-carbon-add" />
                  </button>
                </div>
                <BaseButton size="sm" class="h-8 shrink-0 px-3!" :disabled="!food.count || mutating || invalidFeedCount(food.id, food.count)" @click="action(() => petStore.feed(String(currentAccountId), food.id, getFeedCount(food.id)), '喂食成功')">
                  喂食
                </BaseButton>
              </div>
            </article>
          </div>
        </section>
      </div>
    </template>

    <section v-else-if="tab === 'logs'" class="ui-card flex flex-col rounded-lg lg:min-h-0 lg:flex-1 lg:overflow-hidden">
      <div class="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div>
          <h2 class="flex items-center gap-2 text-base text-gray-900 font-semibold dark:text-gray-100">
            <span class="i-carbon-security text-[var(--theme-primary)]" />守护记录
          </h2>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            最近 {{ logs.length }} 条守护结果
          </p>
        </div>
      </div>
      <div v-if="!logs.length" class="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <span class="i-carbon-document-blank mb-3 text-4xl text-gray-300 dark:text-gray-600" />
        <h3 class="text-sm text-gray-800 font-medium dark:text-gray-100">
          暂无守护记录
        </h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          宠物完成守护后会显示在这里
        </p>
      </div>
      <div v-else class="divide-y divide-gray-100 dark:divide-gray-700 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <article v-for="item in logs" :key="item.id" class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30">
          <div class="grid h-9 w-9 place-items-center rounded-lg bg-green-50 text-green-600 dark:bg-green-900/25 dark:text-green-400">
            <span class="i-carbon-security" />
          </div>
          <div class="min-w-0">
            <h3 class="truncate text-sm text-gray-900 font-medium dark:text-gray-100">
              {{ item.friendName || `好友 ${item.friendGid}` }}
            </h3>
            <p class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
              {{ item.dogName || '宠物守护' }} · {{ new Date(item.timestamp * 1000).toLocaleString() }}
            </p>
          </div>
          <div class="shrink-0 text-right">
            <strong class="block text-sm text-amber-600 font-semibold font-mono dark:text-amber-400">{{ item.protectedGold }}</strong>
            <span class="text-[11px] text-gray-400">守护金币</span>
          </div>
        </article>
      </div>
    </section>

    <section v-else class="ui-card flex flex-col rounded-lg lg:min-h-0 lg:flex-1 lg:overflow-hidden">
      <div class="grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.25fr)]">
        <div class="flex flex-col justify-between border-b border-gray-200 p-5 lg:border-b-0 lg:border-r dark:border-gray-700 sm:p-6">
          <div>
            <div class="grid h-12 w-12 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--theme-primary)_12%,transparent)] text-[var(--theme-primary)]">
              <span class="i-carbon-time text-2xl" />
            </div>
            <h2 class="mt-4 text-xl text-gray-900 font-semibold dark:text-gray-100">
              定时守护
            </h2>
            <p class="mt-2 max-w-sm text-sm text-gray-500 leading-6 dark:text-gray-400">
              按作物成熟时间自动派出宠物，收获完成 5 秒后自动召回。
            </p>
          </div>
          <div class="mt-6 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span class="h-2 w-2 rounded-full" :class="draft.enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'" />当前状态：{{ draft.enabled ? '已启用' : '未启用' }}
          </div>
        </div>

        <div class="p-5 sm:p-6 lg:min-h-0 lg:overflow-y-auto">
          <label class="flex items-center justify-between gap-4 border border-gray-200 rounded-lg px-4 py-3 dark:border-gray-700">
            <span class="min-w-0">
              <strong class="block text-sm text-gray-900 font-medium dark:text-gray-100">启用资本模式</strong>
              <small class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">根据成熟时间自动安排守护</small>
            </span>
            <BaseSwitch v-model="draft.enabled" :disabled="saving" />
          </label>

          <div class="grid mt-5 gap-4 sm:grid-cols-2">
            <label class="min-w-0 text-sm text-gray-700 font-medium dark:text-gray-200">
              守护宠物
              <select v-model.number="draft.dogId" class="mt-2 h-10 w-full border border-gray-200 rounded-lg bg-[var(--input-bg)] px-3 text-sm text-gray-900 outline-none dark:border-gray-600 focus:border-[var(--theme-primary)] dark:text-gray-100 focus:ring-2 focus:ring-[color-mix(in_srgb,var(--theme-primary)_18%,transparent)]">
                <option :value="0">请选择宠物</option>
                <option v-for="dog in overview.dogs.filter(dog => dog.owned)" :key="dog.id" :value="dog.id">{{ dog.name }}</option>
              </select>
            </label>
            <label class="min-w-0 text-sm text-gray-700 font-medium dark:text-gray-200">
              提前派出时间
              <div class="relative mt-2">
                <input v-model.number="draft.leadSeconds" type="number" min="5" max="300" class="h-10 w-full border border-gray-200 rounded-lg bg-[var(--input-bg)] px-3 pr-10 text-sm text-gray-900 outline-none dark:border-gray-600 focus:border-[var(--theme-primary)] dark:text-gray-100 focus:ring-2 focus:ring-[color-mix(in_srgb,var(--theme-primary)_18%,transparent)]">
                <span class="absolute right-3 top-1/2 text-xs text-gray-400 -translate-y-1/2">秒</span>
              </div>
              <small class="mt-1.5 block text-xs text-gray-500 dark:text-gray-400">允许范围 5–300 秒</small>
            </label>
          </div>

          <div class="mt-5 flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-xs text-gray-500 leading-5 dark:bg-gray-700/40 dark:text-gray-400">
            <span class="i-carbon-information mt-0.5 shrink-0 text-[var(--theme-primary)]" />已有手动派出的宠物不会被自动替换。
          </div>

          <div class="mt-5 flex justify-end border-t border-gray-200 pt-4 dark:border-gray-700">
            <BaseButton :loading="saving" :disabled="loading || (draft.enabled && !draft.dogId) || !Number.isInteger(draft.leadSeconds) || draft.leadSeconds < 5 || draft.leadSeconds > 300" @click="saveSettings">
              <span v-if="!saving" class="i-carbon-save mr-1" />保存设置
            </BaseButton>
          </div>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.pet-page {
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
}

.dog-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 0.5rem;
}

.dog-card {
  min-height: 116px;
}

input[type='number']::-webkit-inner-spin-button,
input[type='number']::-webkit-outer-spin-button {
  appearance: none;
  margin: 0;
}

input[type='number'] {
  appearance: textfield;
}

button:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 2px solid var(--theme-primary);
  outline-offset: 2px;
}

@media (min-width: 1280px) {
  .dog-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 639px) {
  .pet-page {
    gap: 0.5rem;
  }

  .dog-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.375rem;
  }

  .dog-card {
    min-height: 0;
    padding: 0.5rem;
  }

  .dog-card > :first-child {
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    text-align: center;
  }

  .dog-card > :first-child > :first-child {
    width: 2.75rem;
    height: 2.75rem;
  }

  .dog-card > :first-child > :first-child img {
    width: 2.5rem;
    height: 2.5rem;
  }

  .dog-card > :first-child > :last-child {
    width: 100%;
    padding-top: 0;
  }

  .dog-card > :first-child > :last-child > div {
    display: block;
  }

  .dog-card > :first-child > :last-child > div > span {
    display: none;
  }

  .dog-card .dog-description {
    display: none;
  }

  .dog-card > button {
    height: 1.75rem;
    margin-top: 0.375rem;
  }

  .food-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
  }

  .food-card > :first-child {
    gap: 0.375rem;
  }

  .food-card > :first-child > :first-child {
    width: 2.25rem;
    height: 2.25rem;
  }

  .food-card > :first-child > :first-child img {
    width: 2rem;
    height: 2rem;
  }

  .food-card > :last-child {
    width: 8.75rem;
    margin-top: 0;
    gap: 0.375rem;
  }

  .food-card > :last-child > :first-child {
    height: 1.75rem;
  }

  .food-card .food-duration {
    display: none;
  }

  .food-card > :first-child > :last-child > div {
    display: block;
  }

  .food-card > :first-child > :last-child > div > span {
    display: block;
    margin-top: 0.125rem;
    font-size: 0.625rem;
  }

  .food-card h3 {
    font-size: 0.75rem;
  }

  .guardian-strip {
    min-height: 0;
    align-items: center;
    padding: 0.625rem 0.75rem;
  }

  .guardian-strip > :first-child {
    width: 3rem;
    height: 3rem;
  }

  .guardian-strip > :first-child img {
    width: 2.75rem;
    height: 2.75rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before {
    transition: none !important;
    animation: none !important;
  }
}
</style>
