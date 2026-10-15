import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export const useBagStore = defineStore('bag', () => {
  const allItems = ref<any[]>([])
  const originalItems = ref<any[]>([])
  // 按账号 ID 隔离的独立背包字典，彻底解决背包数据跨账号串台
  const bagsByAccount = ref<Record<string, { items: any[], originalItems: any[] }>>({})
  const loading = ref(false)
  const pendingFetches = new Map<string, Promise<void>>()

  function clearBag() {
    allItems.value = []
    originalItems.value = []
  }

  const items = computed(() => {
    const hiddenIds = new Set([1, 1001, 1002, 1101, 1011, 1012, 3001, 3002])
    return allItems.value.filter((it: any) => !hiddenIds.has(Number(it.id || 0)))
  })

  const dashboardItems = computed(() => {
    const targetIds = new Set([1011, 1012, 3001, 3002])
    return allItems.value.filter((it: any) => targetIds.has(Number(it.id || 0)))
  })

  async function fetchBag(accountId: string) {
    if (!accountId)
      return

    const pending = pendingFetches.get(accountId)
    if (pending)
      return pending

    const request = fetchBagOnce(accountId).finally(() => {
      if (pendingFetches.get(accountId) === request)
        pendingFetches.delete(accountId)
      loading.value = pendingFetches.size > 0
    })
    pendingFetches.set(accountId, request)
    loading.value = true
    return request
  }

  async function fetchBagOnce(accountId: string) {
    const requestedId = String(accountId)
    try {
      const res = await api.get('/api/bag', {
        headers: { 'x-account-id': requestedId },
      })
      if (res.data && res.data.ok && res.data.data) {
        const bagData = {
          items: Array.isArray(res.data.data.items) ? res.data.data.items : [],
          originalItems: Array.isArray(res.data.data.originalItems) ? res.data.data.originalItems : [],
        }
        bagsByAccount.value[requestedId] = bagData
        allItems.value = bagData.items
        originalItems.value = bagData.originalItems
      }
      else if (res.data && res.data.ok === false) {
        bagsByAccount.value[requestedId] = { items: [], originalItems: [] }
        allItems.value = []
        originalItems.value = []
      }
    }
    catch (e) {
      console.error('获取背包失败:', e)
    }
  }

  async function useItem(accountId: string, itemId: number, count = 1, uid = 0) {
    const res = await api.post('/api/bag/use', { itemId, count, uid }, {
      headers: { 'x-account-id': accountId },
    })
    return res.data
  }

  async function sellItems(accountId: string, items: Array<{ id: number, count: number, uid?: number }>) {
    const res = await api.post('/api/bag/sell', { items }, {
      headers: { 'x-account-id': accountId },
    })
    return res.data
  }

  return { items, allItems, originalItems, bagsByAccount, dashboardItems, loading, fetchBag, clearBag, useItem, sellItems }
})
