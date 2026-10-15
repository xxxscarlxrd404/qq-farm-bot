import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'

export interface Account {
  id: string
  name: string
  nick?: string
  uin?: number
  qq?: string | number
  wxid?: string
  gid?: string | number
  openId?: string
  avatar?: string
  avatarUrl?: string
  username?: string
  platform?: string
  running?: boolean
  // Add other fields as discovered
}

export interface RefreshWxCodesResult {
  total: number
  success: number
  failed: number
  skipped: number
  results: Array<{
    accountId: string
    name: string
    ok: boolean
    error?: string
  }>
}

export interface AccountLog {
  time: string
  action: string
  msg: string
  reason?: string
}

export function getPlatformLabel(p?: string) {
  if (p === 'qq')
    return 'QQ'
  if (p === 'wx')
    return '微信'
  return ''
}

export function getPlatformClass(p?: string) {
  if (p === 'qq')
    return 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
  if (p === 'wx')
    return 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
  return ''
}

export const useAccountStore = defineStore('account', () => {
  const accounts = ref<Account[]>([])
  const currentAccountId = useStorage('current_account_id', '')
  const loading = ref(false)
  const logs = ref<AccountLog[]>([])

  function applyAccounts(nextAccounts: Account[]) {
    accounts.value = nextAccounts

    if (accounts.value.length === 0) {
      currentAccountId.value = ''
      return
    }

    const found = accounts.value.find(a => String(a.id) === currentAccountId.value)
    if (!found && accounts.value[0]) {
      currentAccountId.value = String(accounts.value[0].id)
    }
  }

  const currentAccount = computed(() =>
    accounts.value.find(a => String(a.id) === currentAccountId.value),
  )

  async function fetchAccounts() {
    loading.value = true
    try {
      // api interceptor adds x-admin-token
      const res = await api.get('/api/accounts')
      if (res.data.ok && res.data.data && res.data.data.accounts) {
        applyAccounts(Array.isArray(res.data.data.accounts) ? res.data.data.accounts : [])
      }
      else {
        console.warn('[account] fetchAccounts returned unexpected payload, keeping previous account state')
      }
    }
    catch (e) {
      console.error('获取账号失败', e)
      // Keep the last usable account selection to avoid blanking the app on transient failures.
    }
    finally {
      loading.value = false
    }
  }

  function selectAccount(id: string) {
    currentAccountId.value = String(id || '')
    try {
      localStorage.setItem('current_account_id', String(id || ''))
    } catch {}
  }

  function setCurrentAccount(acc: Account) {
    selectAccount(acc.id)
  }

  async function startAccount(id: string) {
    await api.post(`/api/accounts/${id}/start`)
    await fetchAccounts()
  }

  async function stopAccount(id: string) {
    await api.post(`/api/accounts/${id}/stop`)
    await fetchAccounts()
  }

  async function refreshWxCodes() {
    const res = await api.post('/api/accounts/refresh-wx-codes', {}, { timeout: 120000 })
    await fetchAccounts()
    return res.data as { ok: boolean, error?: string, data?: RefreshWxCodesResult }
  }

  async function deleteAccount(id: string) {
    await api.delete(`/api/accounts/${id}`)
    if (currentAccountId.value === id) {
      currentAccountId.value = ''
    }
    await fetchAccounts()
  }

  async function fetchLogs() {
    try {
      const res = await api.get('/api/account-logs?limit=100')
      if (Array.isArray(res.data)) {
        logs.value = res.data
      }
    }
    catch (e) {
      console.error('获取账号日志失败', e)
    }
  }

  async function addAccount(payload: any) {
    try {
      const res = await api.post('/api/accounts', payload)
      await fetchAccounts()

      const resList = Array.isArray(res.data?.data?.accounts) ? res.data.data.accounts : []
      const newId = String(res.data?.targetAccountId || (resList.length > 0 ? resList[resList.length - 1].id : ''))
      
      if (newId) {
        currentAccountId.value = newId
        localStorage.setItem('current_account_id', newId)
        const target = accounts.value.find(a => String(a.id) === newId)
        if (target) {
          setCurrentAccount(target)
        }
      } else if (accounts.value.length > 0) {
        const last = accounts.value[accounts.value.length - 1]
        currentAccountId.value = String(last.id)
        localStorage.setItem('current_account_id', String(last.id))
        setCurrentAccount(last)
      }
    }
    catch (e) {
      console.error('添加账号失败', e)
      throw e
    }
  }

  async function updateAccount(id: string, payload: any) {
    try {
      // core uses POST /api/accounts for both add and update (if id is present)
      await api.post('/api/accounts', { ...payload, id })
      await fetchAccounts()
    }
    catch (e) {
      console.error('更新账号失败', e)
      throw e
    }
  }

  return {
    accounts,
    currentAccountId,
    currentAccount,
    loading,
    logs,
    fetchAccounts,
    selectAccount,
    startAccount,
    stopAccount,
    refreshWxCodes,
    deleteAccount,
    fetchLogs,
    addAccount,
    updateAccount,
    setCurrentAccount,
  }
})
