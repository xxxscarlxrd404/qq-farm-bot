import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export interface AutomationConfig {
  farm?: boolean
  farm_push?: boolean
  land_upgrade?: boolean
  friend?: boolean
  friend_auto_accept?: boolean
  task?: boolean
  star_passport_claim?: boolean
  star_solar_claim?: boolean
  star_record_claim?: boolean
  qingmei_seed_claim?: boolean
  qingmei_wine_brew?: boolean
  qixi_dew_use?: boolean
  qixi_bridge_build?: boolean
  qixi_sachet_gift?: boolean
  qixi_friend_priority?: number[]
  rain_poem_bottle_buy?: boolean
  rain_poem_weather_collect?: boolean
  rain_poem_summon_use?: boolean
  rain_poem_prank_use?: boolean
  rain_poem_research_unlock?: boolean
  charity_flower_share_claim?: boolean
  charity_flower_donate?: boolean
  charity_flower_reward_claim?: boolean
  charity_flower_public_fund_claim?: boolean
  wish_sign_draw?: boolean
  wish_sign_choice?: number
  wish_sign_claim?: boolean
  share_reward_share?: boolean
  share_reward_daily?: boolean
  share_reward_milestones?: boolean
  pet_diary_adopt?: boolean
  milk_tea_share_daily?: boolean
  milk_tea_share_rewards?: boolean
  milk_tea_fund_rewards?: boolean
  milk_tea_cashier?: boolean
  milk_tea_wages?: boolean
  milk_tea_upgrade?: boolean
  milk_tea_craft?: boolean
  milk_tea_boost?: boolean
  milk_tea_hire?: boolean
  milk_tea_hire_duration?: number
  milk_tea_hire_talent?: number
  milk_tea_seed_buy?: boolean
  pet_diary_feed?: boolean
  pet_diary_draw?: boolean
  pet_diary_story_claim?: boolean
  pet_diary_seed_claim?: boolean
  pet_diary_solar_claim?: boolean
  pet_diary_treasure_open?: boolean
  pet_diary_compensation_claim?: boolean
  pet_diary_charm_equip?: boolean
  pet_diary_battle?: boolean
  sell?: boolean
  fertilizer_gift?: boolean
  fertilizer_buy_organic?: boolean
  fertilizer_buy_normal?: boolean
  mall_coupon_gift_buy?: boolean
  mystery_shop_auto_buy?: boolean
  mystery_shop_allow_gold?: boolean
  mystery_shop_allow_coupon?: boolean
  mystery_shop_allow_gold_bean?: boolean
  fertilizer?: string
  fertilizer_multi_season?: boolean
  fertilizer_land_types?: string[]
  fertilizer_smart_seconds?: number
  friend_steal?: boolean
  friend_help?: boolean
  friend_bad?: boolean
  friend_golden_bug?: boolean
  friend_help_exp_limit?: boolean
  golden_bug_clear?: boolean
  skip_own_weed_bug?: boolean
}

export interface IntervalsConfig {
  farm?: number
  friend?: number
  farmMin?: number
  farmMax?: number
  friendMin?: number
  friendMax?: number
  helpMin?: number
  helpMax?: number
}

export interface FriendQuietHoursConfig {
  enabled?: boolean
  start?: string
  end?: string
}

export interface OfflineConfig {
  channel: string
  reloginUrlMode: string
  token: string
  wxPusherUid: string
  channelCredentials: Record<string, { token: string, wxPusherUid: string }>
  title: string
  msg: string
  offlineDeleteSec: number
}

export interface OfflineConfigSavePayload extends OfflineConfig {
  confirmed?: boolean
  confirmText?: string
}

export interface UIConfig {
  theme?: string
}

export interface AutoCodeRefreshConfig {
  enabled: boolean
  intervalMinutes: number
  maxRetries: number
}

export interface SettingsState {
  plantingStrategy: string
  prioritize2x2Crops: boolean
  prioritizeGrowthTasks: boolean
  bagSeedPriority: number[]
  bagSeedKnownIds: number[]
  bagSeedFallbackStrategy: string
  autoAcceptFriendMinLevel: number
  intervals: IntervalsConfig
  friendQuietHours: FriendQuietHoursConfig
  automation: AutomationConfig
  ui: UIConfig
  offlineReminder: OfflineConfig
  fertilizerBuyOrganicCount: number
  fertilizerBuyOrganicThresholdHours: number
  fertilizerBuyNormalCount: number
  fertilizerBuyNormalThresholdHours: number
  fertilizerBuyCheckIntervalMinutes: number
  goldenBugKeepCount: number
  goldenBugRoundLimit: number
}

function createDefaultOfflineReminder(): OfflineConfig {
  const channelCredentials = Object.fromEntries(
    ['qmsg', 'wxpusher', 'wxpusher_wechat', 'bark'].map(channel => [
      channel,
      { token: '', wxPusherUid: '' },
    ]),
  )
  return {
    channel: 'qmsg',
    reloginUrlMode: 'none',
    token: '',
    wxPusherUid: '',
    channelCredentials,
    title: '账号下线提醒',
    msg: '账号下线',
    offlineDeleteSec: 0,
  }
}

function createDefaultAutoCodeRefresh(): AutoCodeRefreshConfig {
  return {
    enabled: true,
    intervalMinutes: 2,
    maxRetries: 8,
  }
}

function normalizeOfflineReminder(input: Partial<OfflineConfig> | null | undefined): OfflineConfig {
  const defaults = createDefaultOfflineReminder()
  const channel = input?.channel || defaults.channel
  const channelCredentials = { ...defaults.channelCredentials }
  for (const [key, credentials] of Object.entries(input?.channelCredentials || {})) {
    channelCredentials[key] = {
      token: String(credentials?.token || ''),
      wxPusherUid: String(credentials?.wxPusherUid || ''),
    }
  }
  if (!Object.prototype.hasOwnProperty.call(input?.channelCredentials || {}, channel)) {
    channelCredentials[channel] = {
      token: String(input?.token || ''),
      wxPusherUid: String(input?.wxPusherUid || ''),
    }
  }
  return {
    ...defaults,
    ...(input || {}),
    channelCredentials,
    token: channelCredentials[channel]?.token || '',
    wxPusherUid: channelCredentials[channel]?.wxPusherUid || '',
  }
}

export const useSettingStore = defineStore('setting', () => {
  const settings = ref<SettingsState>({
    plantingStrategy: 'max_exp',
    prioritize2x2Crops: false,
    prioritizeGrowthTasks: false,
    bagSeedPriority: [],
    bagSeedKnownIds: [],
    bagSeedFallbackStrategy: 'level',
    autoAcceptFriendMinLevel: 0,
    intervals: {},
    friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
    automation: {},
    ui: {},
    offlineReminder: createDefaultOfflineReminder(),
    fertilizerBuyOrganicCount: 10,
    fertilizerBuyOrganicThresholdHours: 10,
    fertilizerBuyNormalCount: 10,
    fertilizerBuyNormalThresholdHours: 10,
    fertilizerBuyCheckIntervalMinutes: 30,
    goldenBugKeepCount: 0,
    goldenBugRoundLimit: 24,
  })
  const autoCodeRefresh = ref<AutoCodeRefreshConfig>(createDefaultAutoCodeRefresh())
  const loading = ref(false)
  const autoCodeRefreshLoading = ref(false)
  let fetchRequestId = 0

  function isCurrentAccount(accountId: string) {
    const accountStore = useAccountStore()
    const currentId = String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
    return currentId === String(accountId)
  }

  function clearSettingsState() {
    settings.value = {
      plantingStrategy: 'max_exp',
      prioritize2x2Crops: false,
      prioritizeGrowthTasks: false,
      bagSeedPriority: [],
      bagSeedKnownIds: [],
      bagSeedFallbackStrategy: 'level',
      autoAcceptFriendMinLevel: 0,
      intervals: {},
      friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
      automation: {},
      ui: {},
      offlineReminder: createDefaultOfflineReminder(),
      fertilizerBuyOrganicCount: 10,
      fertilizerBuyOrganicThresholdHours: 10,
      fertilizerBuyNormalCount: 10,
      fertilizerBuyNormalThresholdHours: 10,
      fertilizerBuyCheckIntervalMinutes: 30,
      goldenBugKeepCount: 0,
      goldenBugRoundLimit: 24,
    }
    loading.value = false
  }

  async function fetchSettings(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    const requestId = ++fetchRequestId
    loading.value = true
    try {
      const { data } = await api.get('/api/settings', {
        headers: { 'x-account-id': accountId },
      })
      if (requestId !== fetchRequestId || !isCurrentAccount(requestedId))
        return
      if (data && data.ok && data.data) {
        const d = data.data
        settings.value.plantingStrategy = d.plantingStrategy || d.strategy || 'max_exp'
        settings.value.prioritize2x2Crops = d.prioritize2x2Crops === true
        settings.value.prioritizeGrowthTasks = d.prioritizeGrowthTasks === true
        settings.value.intervals = d.intervals || {}
        settings.value.friendQuietHours = d.friendQuietHours || { enabled: false, start: '23:00', end: '07:00' }
        settings.value.automation = d.automation || {}
        settings.value.ui = d.ui || {}
        settings.value.autoAcceptFriendMinLevel = d.autoAcceptFriendMinLevel ?? 0
        settings.value.offlineReminder = normalizeOfflineReminder(d.offlineReminder)
        settings.value.fertilizerBuyOrganicCount = d.fertilizerBuyOrganicCount ?? 10
        settings.value.fertilizerBuyOrganicThresholdHours = d.fertilizerBuyOrganicThresholdHours ?? 10
        settings.value.fertilizerBuyNormalCount = d.fertilizerBuyNormalCount ?? 10
        settings.value.fertilizerBuyNormalThresholdHours = d.fertilizerBuyNormalThresholdHours ?? 10
        settings.value.fertilizerBuyCheckIntervalMinutes = d.fertilizerBuyCheckIntervalMinutes ?? 30
        settings.value.goldenBugKeepCount = d.goldenBugKeepCount ?? 0
        settings.value.goldenBugRoundLimit = d.goldenBugRoundLimit ?? 24
        settings.value.bagSeedPriority = d.bagSeedPriority ?? []
        settings.value.bagSeedKnownIds = d.bagSeedKnownIds ?? []
        settings.value.bagSeedFallbackStrategy = d.bagSeedFallbackStrategy ?? 'level'
      }
    }
    finally {
      if (requestId === fetchRequestId)
        loading.value = false
    }
  }

  async function saveSettings(accountId: string, newSettings: any) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    loading.value = true
    try {
      const settingsPayload = {
        plantingStrategy: newSettings.plantingStrategy,
        prioritize2x2Crops: newSettings.prioritize2x2Crops === true,
        prioritizeGrowthTasks: newSettings.prioritizeGrowthTasks === true,
        bagSeedPriority: newSettings.bagSeedPriority ?? [],
        bagSeedKnownIds: newSettings.bagSeedKnownIds ?? [],
        bagSeedFallbackStrategy: newSettings.bagSeedFallbackStrategy ?? 'level',
        autoAcceptFriendMinLevel: newSettings.autoAcceptFriendMinLevel ?? 0,
        intervals: newSettings.intervals,
        friendQuietHours: newSettings.friendQuietHours,
        fertilizerBuyOrganicCount: newSettings.fertilizerBuyOrganicCount ?? 10,
        fertilizerBuyOrganicThresholdHours: newSettings.fertilizerBuyOrganicThresholdHours ?? 10,
        fertilizerBuyNormalCount: newSettings.fertilizerBuyNormalCount ?? 10,
        fertilizerBuyNormalThresholdHours: newSettings.fertilizerBuyNormalThresholdHours ?? 10,
        fertilizerBuyCheckIntervalMinutes: newSettings.fertilizerBuyCheckIntervalMinutes ?? 30,
        goldenBugKeepCount: newSettings.goldenBugKeepCount ?? 0,
        goldenBugRoundLimit: newSettings.goldenBugRoundLimit ?? 24,
      }

      await api.post('/api/settings/save', settingsPayload, {
        headers: { 'x-account-id': accountId },
      })

      if (newSettings.automation) {
        await api.post('/api/automation', newSettings.automation, {
          headers: { 'x-account-id': accountId },
        })
      }

      await fetchSettings(accountId)
      return { ok: true }
    }
    finally {
      loading.value = false
    }
  }

  async function saveOfflineConfig(config: OfflineConfigSavePayload, accountId: string) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    loading.value = true
    try {
      const { data } = await api.post('/api/settings/offline-reminder', config, {
        headers: { 'x-account-id': accountId },
      })
      if (data && data.ok) {
        settings.value.offlineReminder = normalizeOfflineReminder(data.data || config)
        return { ok: true }
      }
      return { ok: false, error: '保存失败' }
    }
    finally {
      loading.value = false
    }
  }

  async function fetchAutoCodeRefresh() {
    autoCodeRefreshLoading.value = true
    try {
      const { data } = await api.get('/api/settings/auto-code-refresh')
      if (!data?.ok)
        return { ok: false, error: data?.error || '读取失败' }
      autoCodeRefresh.value = {
        ...createDefaultAutoCodeRefresh(),
        ...(data.data || {}),
      }
      return { ok: true }
    }
    catch (e: any) {
      return { ok: false, error: e.response?.data?.error || e.message }
    }
    finally {
      autoCodeRefreshLoading.value = false
    }
  }

  async function saveAutoCodeRefresh(config: AutoCodeRefreshConfig) {
    autoCodeRefreshLoading.value = true
    try {
      const { data } = await api.post('/api/settings/auto-code-refresh', config)
      if (data && data.ok) {
        autoCodeRefresh.value = {
          ...createDefaultAutoCodeRefresh(),
          ...(data.data || config),
        }
        return { ok: true }
      }
      return { ok: false, error: data?.error || '保存失败' }
    }
    catch (e: any) {
      return { ok: false, error: e.response?.data?.error || e.message }
    }
    finally {
      autoCodeRefreshLoading.value = false
    }
  }

  async function runAutoCodeRefresh(accountId: string) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    try {
      const { data } = await api.post('/api/settings/auto-code-refresh/run', {}, {
        headers: { 'x-account-id': accountId },
      })
      if (data && data.ok)
        return { ok: true }
      return { ok: false, error: data?.error || '刷新失败' }
    }
    catch (e: any) {
      return { ok: false, error: e.response?.data?.error || e.message }
    }
  }

  return {
    settings,
    loading,
    autoCodeRefresh,
    autoCodeRefreshLoading,
    clearSettingsState,
    fetchSettings,
    fetchAutoCodeRefresh,
    saveSettings,
    saveOfflineConfig,
    saveAutoCodeRefresh,
    runAutoCodeRefresh,
  }
})
