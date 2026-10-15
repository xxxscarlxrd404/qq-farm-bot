import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export interface PetDog { id: number, name: string, image: string, desc: string, level: number, rarity: number, owned: boolean, activatable: boolean, deployed: boolean }
export interface PetFood { id: number, name: string, image: string, count: number, days: number, duration: number }
export interface CapitalMode { enabled: boolean, dogId: number, leadSeconds: number }

export const usePetStore = defineStore('pet', () => {
  const overview = ref({ dogs: [] as PetDog[], foods: [] as PetFood[], deployedId: 0, foodSeconds: 0, protectSeconds: 2592000 })
  const logs = ref<any[]>([])
  const capitalMode = ref<CapitalMode>({ enabled: false, dogId: 0, leadSeconds: 10 })
  const loading = ref(false)
  const mutating = ref(false)

  const headers = (accountId: string) => ({ 'x-account-id': accountId })
  async function fetchOverview(accountId: string) {
    if (!accountId)
      return
    loading.value = true
    try {
      const { data } = await api.get('/api/dog/info', { headers: headers(accountId), timeout: 60000 })
      if (!data?.ok)
        throw new Error(data?.error || '获取宠物信息失败')
      overview.value = {
        ...data.data,
        autoBuyFood: data.data?.autoBuyFood === true,
        autoFeedDog: data.data?.autoFeedDog === true,
      }
    }
    finally { loading.value = false }
  }
  async function fetchLogs(accountId: string) {
    const { data } = await api.get('/api/dog/protect-logs', { headers: headers(accountId), timeout: 60000 })
    logs.value = Array.isArray(data?.data?.logs) ? data.data.logs : []
  }
  async function fetchCapitalMode(accountId: string) {
    const { data } = await api.get('/api/dog/capital-mode', { headers: headers(accountId) })
    if (data?.ok)
      capitalMode.value = data.data
  }
  async function mutate(accountId: string, path: string, body = {}) {
    mutating.value = true
    try {
      const { data } = await api.post(path, body, { headers: headers(accountId), timeout: 60000 })
      if (!data?.ok)
        throw new Error(data?.error || '操作失败')
      await fetchOverview(accountId)
    }
    finally { mutating.value = false }
  }
  const activate = (accountId: string, dogId: number) => mutate(accountId, '/api/dog/activate', { dogId })
  const deploy = (accountId: string, dogId: number) => mutate(accountId, '/api/dog/deploy', { dogId })
  const withdraw = (accountId: string) => mutate(accountId, '/api/dog/withdraw')
  const feed = (accountId: string, foodId: number, count: number) => mutate(accountId, '/api/dog/feed', { foodId, count })
  async function saveCapitalMode(accountId: string, config: CapitalMode) {
    const { data } = await api.post('/api/dog/capital-mode', config, { headers: headers(accountId) })
    if (!data?.ok)
      throw new Error(data?.error || '保存失败')
    capitalMode.value = data.data.capitalMode
  }
  async function setAutoConfig(accountId: string, payload: { autoBuyFood?: boolean, autoFeedDog?: boolean }) {
    if (!accountId) return
    const { data } = await api.post('/api/dog/auto-config', payload, { headers: headers(accountId) })
    if (data?.ok) {
      const resp = data.data || data
      overview.value = {
        ...overview.value,
        ...(resp.autoBuyFood !== undefined ? { autoBuyFood: resp.autoBuyFood === true } : {}),
        ...(resp.autoFeedDog !== undefined ? { autoFeedDog: resp.autoFeedDog === true } : {}),
      }
    }
    return data
  }
  return { overview, logs, capitalMode, loading, mutating, fetchOverview, fetchLogs, fetchCapitalMode, activate, deploy, withdraw, feed, saveCapitalMode, setAutoConfig }
})
