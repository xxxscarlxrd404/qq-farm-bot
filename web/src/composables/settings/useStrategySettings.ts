import type { Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { ref, watchEffect } from 'vue'
import api from '@/api'
import { useFarmStore } from '@/stores/farm'
import { useSettingStore } from '@/stores/setting'

interface AutomationSettingsSnapshot {
  automation: Record<string, unknown>
}

type AlertType = 'primary' | 'danger'

const analyticsSortByMap: Record<string, string> = {
  max_exp: 'exp',
  max_fert_exp: 'fert',
  max_profit: 'profit',
  max_fert_profit: 'fert_profit',
}

export function useStrategySettings({
  currentAccountId,
  getAutomationSettings,
  showAlert,
}: {
  currentAccountId: Ref<string | number | null | undefined>
  getAutomationSettings: () => AutomationSettingsSnapshot
  showAlert: (message: string, type?: AlertType) => void
}) {
  const settingStore = useSettingStore()
  const farmStore = useFarmStore()
  const { settings, loading: settingsLoading } = storeToRefs(settingStore)
  const { seeds } = storeToRefs(farmStore)

  const strategySaving = ref(false)

  const localStrategySettings = ref({
    plantingStrategy: 'max_exp',
    prioritize2x2Crops: false,
    prioritizeGrowthTasks: false,
    bagSeedPriority: [] as number[],
    bagSeedKnownIds: [] as number[],
    bagSeedFallbackStrategy: 'level',
    intervals: { farmMin: 2, farmMax: 5, helpMin: 10, helpMax: 15 },
    friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
  })

  const plantingStrategyOptions = [
    { label: '背包种子优先', value: 'bag_priority' },
    { label: '任务作物优先', value: 'task_priority' },
    { label: '最高等级作物', value: 'level' },
    { label: '最大经验/时', value: 'max_exp' },
    { label: '最大普通肥经验/时', value: 'max_fert_exp' },
    { label: '最大净利润/时', value: 'max_profit' },
    { label: '最大普通肥净利润/时', value: 'max_fert_profit' },
  ]

  const bagFallbackStrategyOptions = [
    { label: '最高等级作物', value: 'level' },
    { label: '最大经验/时', value: 'max_exp' },
    { label: '最大普通肥经验/时', value: 'max_fert_exp' },
    { label: '最大净利润/时', value: 'max_profit' },
    { label: '最大普通肥净利润/时', value: 'max_fert_profit' },
  ]

  let strategyPreviewRequestId = 0

  const strategyPreviewLabel = ref<string | null>(null)

  watchEffect(async () => {
    const requestId = ++strategyPreviewRequestId
    let strategy = localStrategySettings.value.plantingStrategy
    if (strategy === 'bag_priority' || strategy === 'task_priority') {
      strategy = localStrategySettings.value.bagSeedFallbackStrategy || 'level'
    }
    const aid = String(currentAccountId.value || '')
    if (!aid) {
      strategyPreviewLabel.value = null
      return
    }
    const accountSeeds = (farmStore.seedsByAccount && farmStore.seedsByAccount[aid]) || seeds.value || []
    if (accountSeeds.length === 0) {
      strategyPreviewLabel.value = null
      return
    }
    const available = accountSeeds.filter((s: any) => !s.locked && !s.soldOut)
    if (available.length === 0) {
      strategyPreviewLabel.value = '暂无可用种子'
      return
    }
    if (strategy === 'level') {
      const best = [...available].sort((a, b) => b.requiredLevel - a.requiredLevel)[0]
      strategyPreviewLabel.value = best ? `${best.requiredLevel}级 ${best.name}` : null
      return
    }
    const sortBy = analyticsSortByMap[strategy]
    if (sortBy) {
      try {
        const accountId = currentAccountId.value
        if (!accountId) {
          strategyPreviewLabel.value = null
          return
        }
        const requestedId = String(accountId)
        const res = await api.get(`/api/analytics?sort=${sortBy}`, {
          headers: { 'x-account-id': accountId },
        })
        if (requestId !== strategyPreviewRequestId || String(currentAccountId.value || '') !== requestedId)
          return
        const rankings: any[] = res.data.ok ? (res.data.data || []) : []
        const availableIds = new Set(available.map(s => s.seedId))
        const match = rankings.find(r => availableIds.has(Number(r.seedId)))
        if (match) {
          const seed = available.find(s => s.seedId === Number(match.seedId))
          strategyPreviewLabel.value = seed ? `${seed.requiredLevel}级 ${seed.name}` : null
        }
        else {
          strategyPreviewLabel.value = '暂无匹配种子'
        }
      }
      catch {
        if (requestId === strategyPreviewRequestId)
          strategyPreviewLabel.value = null
      }
    }
  })

  function syncLocalStrategySettings() {
    if (settings.value) {
      localStrategySettings.value = JSON.parse(JSON.stringify({
        plantingStrategy: settings.value.prioritizeGrowthTasks === true
          ? 'task_priority'
          : settings.value.plantingStrategy,
        prioritize2x2Crops: settings.value.prioritize2x2Crops === true,
        prioritizeGrowthTasks: settings.value.prioritizeGrowthTasks === true,
        bagSeedPriority: settings.value.bagSeedPriority ?? [],
        bagSeedKnownIds: settings.value.bagSeedKnownIds ?? [],
        bagSeedFallbackStrategy: settings.value.bagSeedFallbackStrategy ?? 'level',
        intervals: settings.value.intervals,
        friendQuietHours: settings.value.friendQuietHours,
      }))
    }
  }

  async function loadStrategyData() {
    if (currentAccountId.value) {
      const accountId = String(currentAccountId.value)
      await settingStore.fetchSettings(accountId)
      syncLocalStrategySettings()
      await farmStore.fetchSeeds(accountId)
    }
  }

  async function saveStrategySettings() {
    if (!currentAccountId.value)
      return
    strategySaving.value = true
    try {
      const fullSettings = {
        ...settings.value,
        ...localStrategySettings.value,
        prioritizeGrowthTasks: localStrategySettings.value.plantingStrategy === 'task_priority',
        automation: getAutomationSettings().automation,
      }
      const res = await settingStore.saveSettings(String(currentAccountId.value), fullSettings)
      if (res.ok) {
        showAlert('策略设置已保存', 'primary')
      }
      else {
        showAlert(`保存失败: ${res.error}`, 'danger')
      }
    }
    finally {
      strategySaving.value = false
    }
  }

  function resetStrategyState() {
    strategyPreviewLabel.value = null
  }

  return {
    settings,
    settingsLoading,
    strategySaving,
    localStrategySettings,
    plantingStrategyOptions,
    bagFallbackStrategyOptions,
    strategyPreviewLabel,
    syncLocalStrategySettings,
    loadStrategyData,
    saveStrategySettings,
    resetStrategyState,
  }
}
