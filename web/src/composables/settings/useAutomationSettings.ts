import type { Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useSettingStore } from '@/stores/setting'

type AlertType = 'primary' | 'danger'

const allFertilizerLandTypes = ['purple', 'gold', 'black', 'red', 'normal']

const defaultAutomation = {
  farm: false,
  task: false,
  sell: false,
  friend: false,
  friend_auto_accept: true,
  farm_push: false,
  land_upgrade: false,
  friend_steal: false,
  friend_help: false,
  friend_bad: false,
  friend_golden_bug: false,
  friend_help_exp_limit: false,
  star_passport_claim: false,
  star_solar_claim: false,
  star_record_claim: false,
  qingmei_seed_claim: false,
  qingmei_wine_brew: false,
  qixi_dew_use: false,
  qixi_bridge_build: false,
  qixi_sachet_gift: false,
  qixi_friend_priority: [] as number[],
  rain_poem_bottle_buy: false,
  rain_poem_weather_collect: false,
  rain_poem_summon_use: false,
  rain_poem_prank_use: false,
  rain_poem_research_unlock: false,
  charity_flower_share_claim: false,
  charity_flower_donate: false,
  charity_flower_reward_claim: false,
  charity_flower_public_fund_claim: false,
  wish_sign_draw: false,
  wish_sign_choice: 1,
  wish_sign_claim: false,
  share_reward_share: false,
  share_reward_daily: false,
  share_reward_milestones: false,
  pet_diary_adopt: false,
  milk_tea_share_daily: false,
  milk_tea_share_rewards: false,
  milk_tea_fund_rewards: false,
  milk_tea_cashier: false,
  milk_tea_wages: false,
  milk_tea_upgrade: false,
  milk_tea_craft: false,
  milk_tea_boost: false,
  milk_tea_hire: false,
  milk_tea_hire_duration: 1,
  milk_tea_hire_talent: 0,
  milk_tea_seed_buy: false,
  pet_diary_feed: false,
  pet_diary_draw: false,
  pet_diary_story_claim: false,
  pet_diary_seed_claim: false,
  pet_diary_solar_claim: false,
  pet_diary_treasure_open: false,
  pet_diary_compensation_claim: false,
  pet_diary_charm_equip: false,
  pet_diary_battle: false,
  golden_bug_clear: true,
  fertilizer_gift: false,
  fertilizer_buy_organic: false,
  fertilizer_buy_normal: false,
  mall_coupon_gift_buy: false,
  mystery_shop_auto_buy: false,
  mystery_shop_allow_gold: true,
  mystery_shop_allow_coupon: false,
  mystery_shop_allow_gold_bean: false,
  fertilizer: 'none',
  skip_own_weed_bug: false,
  fertilizer_multi_season: false,
  fertilizer_land_types: [...allFertilizerLandTypes],
  fertilizer_smart_seconds: 300,
}

export function useAutomationSettings({
  currentAccountId,
  showAlert,
}: {
  currentAccountId: Ref<string | number | null | undefined>
  showAlert: (message: string, type?: AlertType) => void
}) {
  const settingStore = useSettingStore()
  const { settings } = storeToRefs(settingStore)

  const localAutomationSettings = ref({
    automation: {
      ...defaultAutomation,
      fertilizer: 'normal',
    },
    autoAcceptFriendMinLevel: 0,
    fertilizerBuyOrganicCount: 10,
    fertilizerBuyOrganicThresholdHours: 10,
    fertilizerBuyNormalCount: 10,
    fertilizerBuyNormalThresholdHours: 10,
    fertilizerBuyCheckIntervalMinutes: 30,
    goldenBugKeepCount: 0,
    goldenBugRoundLimit: 24,
  })

  const automationSaving = ref(false)
  const autoCodeRefreshing = ref(false)

  const fertilizerLandTypeOptions = [
    { label: '紫土地', value: 'purple' },
    { label: '金土地', value: 'gold' },
    { label: '黑土地', value: 'black' },
    { label: '红土地', value: 'red' },
    { label: '普通土地', value: 'normal' },
  ]

  const fertilizerOptions = [
    { label: '普通 + 有机', value: 'both' },
    { label: '普通 + 快成熟有机', value: 'smart' },
    { label: '快成熟有机', value: 'smart_only' },
    { label: '快成熟普通', value: 'smart_normal' },
    { label: '最终阶段普通肥', value: 'final_normal' },
    { label: '最终阶段有机肥', value: 'final_organic' },
    { label: '仅普通化肥', value: 'normal' },
    { label: '仅有机化肥', value: 'organic' },
    { label: '不施肥', value: 'none' },
  ]

  function normalizeFertilizerLandTypes(input: unknown) {
    const source = Array.isArray(input) ? input : allFertilizerLandTypes
    const normalized: string[] = []
    for (const item of source) {
      const value = String(item || '').trim().toLowerCase()
      if (!allFertilizerLandTypes.includes(value))
        continue
      if (normalized.includes(value))
        continue
      normalized.push(value)
    }
    return normalized
  }

  function syncLocalAutomationSettings() {
    if (settings.value) {
      localAutomationSettings.value.automation = settings.value.automation
        ? {
            ...defaultAutomation,
            ...settings.value.automation,
          }
        : { ...defaultAutomation }

      localAutomationSettings.value.automation.fertilizer_land_types = normalizeFertilizerLandTypes(localAutomationSettings.value.automation.fertilizer_land_types)
      localAutomationSettings.value.automation.qixi_friend_priority = normalizeQixiFriendPriority(localAutomationSettings.value.automation.qixi_friend_priority)
      if (localAutomationSettings.value.automation.fertilizer_smart_seconds === undefined) {
        localAutomationSettings.value.automation.fertilizer_smart_seconds = 300
      }
      localAutomationSettings.value.autoAcceptFriendMinLevel = settings.value.autoAcceptFriendMinLevel ?? 0
      localAutomationSettings.value.fertilizerBuyOrganicCount = settings.value.fertilizerBuyOrganicCount ?? 10
      localAutomationSettings.value.fertilizerBuyOrganicThresholdHours = settings.value.fertilizerBuyOrganicThresholdHours ?? 10
      localAutomationSettings.value.fertilizerBuyNormalCount = settings.value.fertilizerBuyNormalCount ?? 10
      localAutomationSettings.value.fertilizerBuyNormalThresholdHours = settings.value.fertilizerBuyNormalThresholdHours ?? 10
      localAutomationSettings.value.fertilizerBuyCheckIntervalMinutes = settings.value.fertilizerBuyCheckIntervalMinutes ?? 30
      localAutomationSettings.value.goldenBugKeepCount = settings.value.goldenBugKeepCount ?? 0
      localAutomationSettings.value.goldenBugRoundLimit = settings.value.goldenBugRoundLimit ?? 24
    }
  }

  function normalizeQixiFriendPriority(value: unknown) {
    if (!Array.isArray(value))
      return []
    return [...new Set(value.map(Number).filter(gid => Number.isSafeInteger(gid) && gid > 0))]
  }

  async function saveAutomationSettings() {
    if (!currentAccountId.value)
      return
    const accountId = String(currentAccountId.value)
    automationSaving.value = true
    try {
      localAutomationSettings.value.automation.qixi_friend_priority = normalizeQixiFriendPriority(localAutomationSettings.value.automation.qixi_friend_priority)
      const fullSettings = {
        ...settings.value,
        automation: localAutomationSettings.value.automation,
        autoAcceptFriendMinLevel: localAutomationSettings.value.autoAcceptFriendMinLevel,
        fertilizerBuyOrganicCount: localAutomationSettings.value.fertilizerBuyOrganicCount,
        fertilizerBuyOrganicThresholdHours: localAutomationSettings.value.fertilizerBuyOrganicThresholdHours,
        fertilizerBuyNormalCount: localAutomationSettings.value.fertilizerBuyNormalCount,
        fertilizerBuyNormalThresholdHours: localAutomationSettings.value.fertilizerBuyNormalThresholdHours,
        fertilizerBuyCheckIntervalMinutes: localAutomationSettings.value.fertilizerBuyCheckIntervalMinutes,
        goldenBugKeepCount: localAutomationSettings.value.goldenBugKeepCount,
        goldenBugRoundLimit: localAutomationSettings.value.goldenBugRoundLimit,
      }
      const res = await settingStore.saveSettings(accountId, fullSettings)
      if (res.ok) {
        showAlert('自动控制设置已保存', 'primary')

        // 如果启用了自动购买化肥，立即检测并购买
        if (localAutomationSettings.value.automation.fertilizer_buy_organic || localAutomationSettings.value.automation.fertilizer_buy_normal) {
          try {
            const buyRes = await api.post('/api/fertilizer/check-and-buy', {
              buyOrganic: localAutomationSettings.value.automation.fertilizer_buy_organic,
              buyNormal: localAutomationSettings.value.automation.fertilizer_buy_normal,
              organicCount: localAutomationSettings.value.fertilizerBuyOrganicCount,
              organicThresholdHours: localAutomationSettings.value.fertilizerBuyOrganicThresholdHours,
              normalCount: localAutomationSettings.value.fertilizerBuyNormalCount,
              normalThresholdHours: localAutomationSettings.value.fertilizerBuyNormalThresholdHours,
            }, {
              headers: { 'x-account-id': accountId },
            })
            if (buyRes.data?.ok) {
              const totalBought = (buyRes.data.organicBought || 0) + (buyRes.data.normalBought || 0)
              if (totalBought > 0) {
                showAlert(`已自动购买 ${totalBought} 个化肥`, 'primary')
              }
            }
          }
          catch (e) {
            console.error('检测购买化肥失败', e)
          }
        }
      }
      else {
        showAlert(`保存失败: ${res.error}`, 'danger')
      }
    }
    finally {
      automationSaving.value = false
    }
  }

  async function runAutoCodeRefreshNow() {
    if (!currentAccountId.value)
      return
    const accountId = String(currentAccountId.value)
    autoCodeRefreshing.value = true
    try {
      const res = await settingStore.runAutoCodeRefresh(accountId)
      if (res.ok)
        showAlert('已触发刷新 Code，完成后会自动重启账号', 'primary')
      else
        showAlert(`刷新失败: ${res.error}`, 'danger')
    }
    finally {
      autoCodeRefreshing.value = false
    }
  }

  return {
    localAutomationSettings,
    automationSaving,
    autoCodeRefreshing,
    fertilizerLandTypeOptions,
    fertilizerOptions,
    syncLocalAutomationSettings,
    saveAutomationSettings,
    runAutoCodeRefreshNow,
  }
}
