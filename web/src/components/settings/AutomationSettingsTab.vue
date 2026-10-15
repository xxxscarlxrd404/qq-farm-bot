<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import api from '@/api'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { CHARITY_FLOWER_ACTIVITY_WINDOW, isWithinActivityWindowMs, RAIN_POEM_ACTIVITY_WINDOW } from '@/constants/activity-windows'

interface AutomationSettings {
  automation: {
    farm: boolean
    task: boolean
    sell: boolean
    friend: boolean
    friend_auto_accept: boolean
    farm_push: boolean
    land_upgrade: boolean
    friend_steal: boolean
    friend_help: boolean
    friend_bad: boolean
    friend_golden_bug: boolean
    friend_help_exp_limit: boolean
    star_passport_claim: boolean
    star_solar_claim: boolean
    star_record_claim: boolean
    qingmei_seed_claim: boolean
    qingmei_wine_brew: boolean
    qixi_dew_use: boolean
    qixi_bridge_build: boolean
    qixi_sachet_gift: boolean
    qixi_friend_priority: number[]
    rain_poem_bottle_buy: boolean
    rain_poem_weather_collect: boolean
    rain_poem_summon_use: boolean
    rain_poem_prank_use: boolean
    rain_poem_research_unlock: boolean
    charity_flower_share_claim: boolean
    charity_flower_donate: boolean
    charity_flower_reward_claim: boolean
    charity_flower_public_fund_claim: boolean
    pet_diary_adopt: boolean
    pet_diary_feed: boolean
    pet_diary_draw: boolean
    pet_diary_story_claim: boolean
    pet_diary_seed_claim: boolean
    pet_diary_solar_claim: boolean
    pet_diary_treasure_open: boolean
    pet_diary_compensation_claim: boolean
    pet_diary_charm_equip: boolean
    pet_diary_battle: boolean
    golden_bug_clear: boolean
    fertilizer_gift: boolean
    fertilizer_buy_organic: boolean
    fertilizer_buy_normal: boolean
    mystery_shop_auto_buy: boolean
    mystery_shop_allow_gold: boolean
    mystery_shop_allow_coupon: boolean
    mystery_shop_allow_gold_bean: boolean
    fertilizer: string
    skip_own_weed_bug: boolean
    fertilizer_multi_season: boolean
    fertilizer_land_types: string[]
    fertilizer_smart_seconds: number
  }
  autoAcceptFriendMinLevel: number
  fertilizerBuyOrganicCount: number
  fertilizerBuyOrganicThresholdHours: number
  fertilizerBuyNormalCount: number
  fertilizerBuyNormalThresholdHours: number
  fertilizerBuyCheckIntervalMinutes: number
  goldenBugKeepCount: number
  goldenBugRoundLimit: number
}

const props = withDefaults(defineProps<{
  currentAccountName: string | null
  currentAccountId: string | number | null | undefined
  loading: boolean
  saving: boolean
  fertilizerLandTypeOptions: { label: string, value: string }[]
  fertilizerOptions: { label: string, value: string | number }[]
  title?: string
  saveLabel?: string
  showActions?: boolean
}>(), {
  title: '自动控制',
  saveLabel: '保存自动控制',
  showActions: true,
})

const emit = defineEmits<{
  save: []
}>()

const settings = defineModel<AutomationSettings>('settings', { required: true })

function isFastMatureFertilizerMode(mode: string) {
  return mode === 'smart' || mode === 'smart_only' || mode === 'smart_normal'
}

const mysteryShopSettingsVisible = ref(false)
const SHOW_STAR_ACTIVITY = false
const SHOW_QIXI_ACTIVITY = false
const nowMs = ref(Date.now())
let nowTimer: ReturnType<typeof window.setInterval> | null = null
const showRainPoemActivity = computed(() => isWithinActivityWindowMs(RAIN_POEM_ACTIVITY_WINDOW, nowMs.value))
const showCharityFlowerActivity = computed(() => isWithinActivityWindowMs(CHARITY_FLOWER_ACTIVITY_WINDOW, nowMs.value))
const qixiFriends = ref<Array<{ gid: number, name: string, level?: number }>>([])
function qixiPriority() {
  return Array.isArray(settings.value.automation.qixi_friend_priority)
    ? settings.value.automation.qixi_friend_priority
    : []
}
async function loadQixiFriends() {
  if (!props.currentAccountId)
    return
  try {
    const { data } = await api.get('/api/activity/qixi', { headers: { 'x-account-id': props.currentAccountId } })
    qixiFriends.value = data?.friends || []
  }
  catch { qixiFriends.value = [] }
}
function toggleQixiFriend(gid: number) {
  const list = qixiPriority()
  settings.value.automation.qixi_friend_priority = list.includes(gid) ? list.filter(id => id !== gid) : [...list, gid]
}
function moveQixiFriend(index: number, direction: number) {
  const list = [...qixiPriority()]
  const target = index + direction
  if (target < 0 || target >= list.length)
    return
  const currentValue = list[index]
  const targetValue = list[target]
  if (currentValue === undefined || targetValue === undefined)
    return
  list[index] = targetValue
  list[target] = currentValue
  settings.value.automation.qixi_friend_priority = list
}
function qixiFriendName(gid: number) {
  return qixiFriends.value.find(friend => friend.gid === gid)?.name || `好友 ${gid}`
}
onMounted(() => {
  loadQixiFriends()
  nowTimer = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 60000)
})
onUnmounted(() => {
  if (nowTimer)
    window.clearInterval(nowTimer)
})
watch(() => props.currentAccountId, loadQixiFriends)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
        {{ title }}
        <span v-if="currentAccountName" class="ml-2 text-sm text-gray-500 font-normal dark:text-gray-400">
          ({{ currentAccountName }})
        </span>
      </h3>
    </div>

    <div v-if="loading" class="py-4 text-center text-gray-500">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else-if="!currentAccountId" class="py-8 text-center text-gray-500">
      <div class="i-carbon-settings-adjust mx-auto mb-2 text-3xl text-gray-400" />
      <p>请先选择账号</p>
    </div>

    <div v-else class="space-y-4">
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
        <BaseSwitch v-model="settings.automation.farm" label="自动种植收获" />
        <BaseSwitch v-model="settings.automation.task" label="自动做任务" />
        <BaseSwitch v-model="settings.automation.sell" label="自动卖果实" />
        <BaseSwitch v-model="settings.automation.friend" label="自动好友互动" />
        <BaseSwitch v-model="settings.automation.farm_push" label="推送触发巡田" />
        <BaseSwitch v-model="settings.automation.land_upgrade" label="自动升级土地" />
        <BaseSwitch v-model="settings.automation.fertilizer_gift" label="自动填充化肥" />
        <BaseSwitch v-model="settings.automation.fertilizer_buy_organic" label="自动购买有机化肥" />
        <BaseSwitch v-model="settings.automation.fertilizer_buy_normal" label="自动购买无机化肥" />
        <div class="max-w-full w-fit inline-flex items-center gap-1.5">
          <BaseSwitch v-model="settings.automation.mystery_shop_auto_buy" label="自动购买神秘商人商品" />
          <button
            class="inline-grid h-7 w-7 shrink-0 place-items-center rounded-md text-gray-400 transition hover:bg-gray-100 dark:text-gray-500 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            type="button"
            title="设置允许使用的货币"
            aria-label="设置神秘商人自动购买"
            @click="mysteryShopSettingsVisible = true"
          >
            <span class="i-carbon-settings text-base" />
          </button>
        </div>
        <BaseSwitch v-model="settings.automation.skip_own_weed_bug" label="不除自己草虫" />
        <BaseSwitch v-model="settings.automation.golden_bug_clear" label="自动清除黄金虫" />
      </div>

      <Transition name="fade">
        <div v-if="mysteryShopSettingsVisible" class="fixed inset-0 z-50 grid place-items-center bg-gray-950/45 p-4 backdrop-blur-[2px]" @click.self="mysteryShopSettingsVisible = false">
          <div class="max-w-lg w-full overflow-hidden border border-gray-200 rounded-2xl bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
            <div class="flex items-start justify-between border-b border-gray-100 px-6 py-5 dark:border-gray-700">
              <div>
                <div class="flex items-center gap-2">
                  <span class="inline-grid h-8 w-8 place-items-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
                    <span class="i-carbon-store text-lg" />
                  </span>
                  <h3 class="text-lg text-gray-900 font-semibold dark:text-gray-100">
                    神秘商人自动购买
                  </h3>
                </div>
                <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  选择自动购买时可以使用的货币。
                </p>
              </div>
              <button class="inline-grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200" type="button" aria-label="关闭" @click="mysteryShopSettingsVisible = false">
                <span class="i-carbon-close text-xl" />
              </button>
            </div>
            <div class="px-6 py-5 space-y-2">
              <div class="flex items-center justify-between gap-4 border border-gray-200 rounded-xl px-4 py-3 dark:border-gray-700">
                <div class="min-w-0 flex items-center gap-3">
                  <span class="inline-grid h-9 w-9 shrink-0 place-items-center rounded-full bg-yellow-50 text-yellow-600 dark:bg-yellow-900/25 dark:text-yellow-300"><span class="i-carbon-currency-dollar text-lg" /></span>
                  <div>
                    <div class="text-sm text-gray-800 font-medium dark:text-gray-100">
                      金币
                    </div><div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      允许使用金币自动购买
                    </div>
                  </div>
                </div>
                <BaseSwitch v-model="settings.automation.mystery_shop_allow_gold" />
              </div>
              <div class="flex items-center justify-between gap-4 border border-gray-200 rounded-xl px-4 py-3 dark:border-gray-700">
                <div class="min-w-0 flex items-center gap-3">
                  <span class="inline-grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/25 dark:text-blue-300"><span class="i-carbon-ticket text-lg" /></span>
                  <div>
                    <div class="text-sm text-gray-800 font-medium dark:text-gray-100">
                      点券
                    </div><div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      允许使用点券自动购买
                    </div>
                  </div>
                </div>
                <BaseSwitch v-model="settings.automation.mystery_shop_allow_coupon" />
              </div>
              <div class="flex items-center justify-between gap-4 border border-gray-200 rounded-xl px-4 py-3 dark:border-gray-700">
                <div class="min-w-0 flex items-center gap-3">
                  <span class="inline-grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-900/25 dark:text-emerald-300"><span class="i-carbon-crop-health text-lg" /></span>
                  <div>
                    <div class="text-sm text-gray-800 font-medium dark:text-gray-100">
                      金豆豆
                    </div><div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      允许使用金豆豆自动购买
                    </div>
                  </div>
                </div>
                <BaseSwitch v-model="settings.automation.mystery_shop_allow_gold_bean" />
              </div>
            </div>
            <div class="flex justify-end border-t border-gray-100 bg-gray-50/70 px-6 py-4 dark:border-gray-700 dark:bg-gray-900/20">
              <BaseButton class="min-w-24" size="sm" @click="mysteryShopSettingsVisible = false">
                完成
              </BaseButton>
            </div>
          </div>
        </div>
      </Transition>

      <div class="border border-gray-200 rounded-lg bg-gray-50/70 p-4 dark:border-gray-700 dark:bg-gray-900/20">
        <div class="mb-3 flex items-center gap-2">
          <span class="inline-grid h-8 w-8 place-items-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">
            <span class="i-carbon-events text-lg" />
          </span>
          <div>
            <h4 class="text-sm text-gray-900 font-semibold dark:text-gray-100">
              活动控制
            </h4>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              自动检查并领取活动中可领取的奖励。
            </p>
          </div>
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div v-if="SHOW_STAR_ACTIVITY" class="border border-gray-200 rounded-lg bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
            <BaseSwitch v-model="settings.automation.star_passport_claim" label="自动领取千星游记" />
          </div>
          <div v-if="SHOW_STAR_ACTIVITY" class="border border-gray-200 rounded-lg bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
            <BaseSwitch v-model="settings.automation.star_solar_claim" label="自动领取节令小札" />
          </div>
          <div v-if="SHOW_STAR_ACTIVITY" class="border border-gray-200 rounded-lg bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
            <BaseSwitch v-model="settings.automation.star_record_claim" label="自动领取观星礼录" />
          </div>
          <div v-if="SHOW_QIXI_ACTIVITY" class="border border-gray-200 rounded-lg bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
            <BaseSwitch v-model="settings.automation.qixi_dew_use" label="自动使用鹊羽灵露" />
          </div>
          <div v-if="SHOW_QIXI_ACTIVITY" class="border border-gray-200 rounded-lg bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
            <BaseSwitch v-model="settings.automation.qixi_bridge_build" label="自动驻建鹊桥" />
          </div>
          <div v-if="SHOW_QIXI_ACTIVITY" class="border border-gray-200 rounded-lg bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
            <BaseSwitch v-model="settings.automation.qixi_sachet_gift" label="自动赠送鹊羽香囊" />
          </div>
          <div v-if="showRainPoemActivity" class="border border-gray-200 rounded-lg bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
            <BaseSwitch v-model="settings.automation.rain_poem_bottle_buy" label="自动购买天气采集瓶" />
          </div>
          <div v-if="showRainPoemActivity" class="border border-gray-200 rounded-lg bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
            <BaseSwitch v-model="settings.automation.rain_poem_weather_collect" label="自动采集好友雷雨" />
          </div>
          <div v-if="showRainPoemActivity" class="border border-gray-200 rounded-lg bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
            <BaseSwitch v-model="settings.automation.rain_poem_summon_use" label="自动使用雷雨召唤瓶" />
          </div>
          <div v-if="showRainPoemActivity" class="border border-gray-200 rounded-lg bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
            <BaseSwitch v-model="settings.automation.rain_poem_prank_use" label="自动使用青蛙与乌云使坏瓶" />
          </div>
          <div v-if="showRainPoemActivity" class="border border-gray-200 rounded-lg bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
            <BaseSwitch v-model="settings.automation.rain_poem_research_unlock" label="自动解锁气象研究" />
          </div>
          <div v-if="showCharityFlowerActivity" class="border border-rose-200 rounded-lg bg-white px-4 py-3 dark:border-rose-900/50 dark:bg-gray-800">
            <BaseSwitch v-model="settings.automation.charity_flower_share_claim" label="自动领取小红花分享奖励" />
          </div>
          <div v-if="showCharityFlowerActivity" class="border border-rose-200 rounded-lg bg-white px-4 py-3 dark:border-rose-900/50 dark:bg-gray-800">
            <BaseSwitch v-model="settings.automation.charity_flower_donate" label="自动送出全部爱心" />
          </div>
          <div v-if="showCharityFlowerActivity" class="border border-rose-200 rounded-lg bg-white px-4 py-3 dark:border-rose-900/50 dark:bg-gray-800">
            <BaseSwitch v-model="settings.automation.charity_flower_reward_claim" label="自动领取爱心档位奖励" />
          </div>
          <div v-if="showCharityFlowerActivity" class="border border-rose-200 rounded-lg bg-white px-4 py-3 dark:border-rose-900/50 dark:bg-gray-800">
            <BaseSwitch v-model="settings.automation.charity_flower_public_fund_claim" label="自动领取并送出 1 元公益金（活动期仅一次）" />
          </div>
        </div>
        <div v-if="SHOW_QIXI_ACTIVITY && settings.automation.qixi_sachet_gift" class="mt-3 border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div class="mb-3">
            <div class="text-sm text-gray-900 font-medium dark:text-white">
              香囊好友优先级
            </div><div class="mt-1 text-xs text-gray-500">
              只向所选好友赠送；序号越小优先级越高，名单外好友不会自动获赠。
            </div>
          </div>
          <div v-if="qixiPriority().length" class="mb-3 space-y-2">
            <div v-for="(gid, index) in qixiPriority()" :key="gid" class="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900/40">
              <span class="w-6 text-gray-400">{{ index + 1 }}</span><span class="min-w-0 flex-1 truncate">{{ qixiFriendName(gid) }}</span>
              <button type="button" class="text-gray-500 disabled:opacity-30" :disabled="index === 0" @click="moveQixiFriend(index, -1)">
                <span class="i-carbon-arrow-up" />
              </button>
              <button type="button" class="text-gray-500 disabled:opacity-30" :disabled="index === qixiPriority().length - 1" @click="moveQixiFriend(index, 1)">
                <span class="i-carbon-arrow-down" />
              </button>
              <button type="button" class="text-red-500" @click="toggleQixiFriend(gid)">
                <span class="i-carbon-close" />
              </button>
            </div>
          </div>
          <div class="max-h-44 flex flex-wrap gap-2 overflow-y-auto">
            <button v-for="friend in qixiFriends.filter(item => !qixiPriority().includes(item.gid))" :key="friend.gid" type="button" class="border border-gray-200 rounded-full px-3 py-1.5 text-xs text-gray-700 dark:border-gray-700 hover:border-violet-400 dark:text-gray-200" @click="toggleQixiFriend(friend.gid)">
              + {{ friend.name }}
            </button>
            <span v-if="!qixiFriends.length" class="text-xs text-gray-500">账号运行后可加载好友列表。</span>
          </div>
        </div>
      </div>

      <div v-if="settings.automation.fertilizer_buy_organic || settings.automation.fertilizer_buy_normal" class="rounded bg-green-50 p-3 text-sm space-y-3 dark:bg-green-900/20">
        <div v-if="settings.automation.fertilizer_buy_organic" class="space-y-2">
          <div class="text-green-700 font-medium dark:text-green-400">
            有机化肥设置
          </div>
          <div class="flex flex-wrap gap-4">
            <BaseInput
              v-model.number="settings.fertilizerBuyOrganicCount"
              label="购买数量"
              type="number"
              min="1"
              max="10000"
            />
            <BaseInput
              v-model.number="settings.fertilizerBuyOrganicThresholdHours"
              label="触发阈值 (小时)"
              type="number"
              min="1"
              max="990"
            />
          </div>
        </div>
        <div v-if="settings.automation.fertilizer_buy_normal" class="space-y-2">
          <div class="text-green-700 font-medium dark:text-green-400">
            无机化肥设置
          </div>
          <div class="flex flex-wrap gap-4">
            <BaseInput
              v-model.number="settings.fertilizerBuyNormalCount"
              label="购买数量"
              type="number"
              min="1"
              max="10000"
            />
            <BaseInput
              v-model.number="settings.fertilizerBuyNormalThresholdHours"
              label="触发阈值 (小时)"
              type="number"
              min="1"
              max="990"
            />
          </div>
        </div>
        <div class="flex flex-wrap gap-4">
          <BaseInput
            v-model.number="settings.fertilizerBuyCheckIntervalMinutes"
            label="检测间隔 (分钟)"
            type="number"
            min="1"
            max="1440"
          />
        </div>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          系统会按照设定的检测间隔定时检测化肥容器剩余量，当低于触发阈值时自动购买。保存设置后会立即检测一次。同时开启两种化肥购买时，优先购买有机化肥。
        </p>
      </div>

      <div v-if="settings.automation.friend" class="flex flex-wrap gap-4 rounded bg-blue-50 p-3 text-sm dark:bg-blue-900/20">
        <BaseSwitch v-model="settings.automation.friend_steal" label="自动偷菜" />
        <BaseSwitch v-model="settings.automation.friend_help" label="自动帮忙" />
        <BaseSwitch v-model="settings.automation.friend_bad" label="自动捣乱" />
        <BaseSwitch v-model="settings.automation.friend_auto_accept" label="自动通过好友申请" />
        <BaseSwitch v-model="settings.automation.friend_golden_bug" label="自动放黄金虫" />
        <BaseSwitch v-model="settings.automation.friend_help_exp_limit" label="经验满只帮护主犬" />
      </div>

      <div v-if="settings.automation.friend && settings.automation.friend_golden_bug" class="grid grid-cols-1 gap-3 rounded bg-amber-50 p-3 text-sm md:grid-cols-2 dark:bg-amber-900/20">
        <BaseInput
          v-model.number="settings.goldenBugKeepCount"
          label="黄金虫保留数量"
          type="number"
          min="0"
          max="9999"
        />
        <BaseInput
          v-model.number="settings.goldenBugRoundLimit"
          label="黄金虫单轮上限"
          type="number"
          min="1"
          max="100"
        />
      </div>

      <div v-if="settings.automation.friend && settings.automation.friend_auto_accept" class="rounded bg-sky-50 p-3 text-sm dark:bg-sky-900/20">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <BaseInput
            v-model.number="settings.autoAcceptFriendMinLevel"
            label="自动通过好友最低等级"
            type="number"
            min="0"
            max="200"
          />
        </div>
        <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
          设为 `0` 表示不限制等级；开启自动通过好友申请后，系统会按这里的最低等级处理申请。
        </p>
      </div>

      <div class="space-y-3">
        <div class="border border-amber-200 rounded bg-amber-50/60 p-3 dark:border-amber-800/60 dark:bg-amber-900/10">
          <div class="mb-2 text-sm text-amber-800 font-medium dark:text-amber-300">
            施肥范围
          </div>
          <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
            <label
              v-for="option in fertilizerLandTypeOptions"
              :key="option.value"
              class="flex cursor-pointer items-center gap-1.5 rounded bg-white px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
            >
              <input
                v-model="settings.automation.fertilizer_land_types"
                :value="option.value"
                type="checkbox"
                class="h-3.5 w-3.5"
              >
              <span>{{ option.label }}</span>
            </label>
          </div>
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
            施肥前会优先按土地类型过滤，仅对命中范围的地块执行施肥策略。
          </p>
        </div>

        <div class="flex items-center gap-4">
          <BaseSelect
            v-model="settings.automation.fertilizer"
            label="施肥策略"
            :options="fertilizerOptions"
            class="flex-1"
          />
        </div>

        <div class="flex items-center gap-4">
          <BaseSwitch
            v-model="settings.automation.fertilizer_multi_season"
            label="多季补肥"
          />
        </div>

        <div v-if="isFastMatureFertilizerMode(settings.automation.fertilizer)" class="rounded bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
          <div class="mb-2 text-sm text-gray-900 font-medium dark:text-gray-100">
            快成熟判定秒数
          </div>
          <div class="flex flex-wrap items-end gap-4">
            <BaseInput
              v-model.number="settings.automation.fertilizer_smart_seconds"
              label="秒数"
              type="number"
              min="30"
              max="3600"
              class="w-40"
            />
            <span class="pb-2 text-xs text-gray-500 dark:text-gray-400">
              距离成熟时间 ≤ 此秒数时施肥（默认300秒=5分钟）
            </span>
          </div>
        </div>
      </div>

      <div v-if="showActions" class="flex justify-end gap-2 border-t pt-3 dark:border-gray-700">
        <BaseButton
          variant="primary"
          size="sm"
          :loading="saving"
          @click="emit('save')"
        >
          {{ saveLabel }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>
