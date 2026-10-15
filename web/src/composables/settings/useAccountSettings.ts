import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAccountStore } from '@/stores/account'
import { useUserStore } from '@/stores/user'

type AlertType = 'primary' | 'danger'

export function useAccountSettings(showAlert: (message: string, type?: AlertType) => void) {
  const router = useRouter()
  const accountStore = useAccountStore()
  const userStore = useUserStore()
  const { accounts, loading: accountsLoading, currentAccountId } = storeToRefs(accountStore)

  const showModal = ref(false)
  const showDeleteConfirm = ref(false)
  const deleteLoading = ref(false)
  const editingAccount = ref<any>(null)
  const accountToDelete = ref<any>(null)
  const showClearStoppedConfirm = ref(false)
  const clearStoppedLoading = ref(false)
  const refreshWxCodesLoading = ref(false)

  const userIsAdmin = computed(() => userStore.isAdmin)
  const isAccountOpsDisabled = computed(() => !userStore.isAdmin && userStore.isExpired)
  const quotaLimit = computed(() => {
    const limit = userStore.accountLimit
    if (limit === undefined || limit === null)
      return 3
    return limit
  })
  const isOverQuota = computed(() => {
    if (userStore.isAdmin)
      return false
    const limit = quotaLimit.value
    if (limit === -1)
      return false
    return accounts.value.length >= limit
  })
  const isAddAccountDisabled = computed(() => isAccountOpsDisabled.value || isOverQuota.value)
  const addAccountDisabledReason = computed(() => {
    if (isAccountOpsDisabled.value)
      return '账号已到期，无法添加账号'
    if (isOverQuota.value)
      return '已超过配额，无法添加账号'
    return ''
  })

  const stoppedAccounts = computed(() => accounts.value.filter((acc: any) => !acc.running))
  const stoppedAccountsCount = computed(() => stoppedAccounts.value.length)
  const currentAccountName = computed(() => {
    const acc = accounts.value.find((item: any) => item.id === currentAccountId.value)
    return acc ? (acc.nick || acc.name || acc.id) : null
  })

  useIntervalFn(() => {
    accountStore.fetchAccounts()
  }, 3000)

  async function fetchAccounts() {
    await accountStore.fetchAccounts()
  }

  function selectFirstAccountIfNeeded() {
    if (!currentAccountId.value && accounts.value.length > 0 && accounts.value[0]) {
      accountStore.selectAccount(String(accounts.value[0].id))
    }
  }

  function openSettings(account: any) {
    accountStore.selectAccount(account.id)
    router.push('/settings')
  }

  function openAddModal() {
    editingAccount.value = null
    showModal.value = true
  }

  function openEditModal(account: any) {
    editingAccount.value = { ...account }
    showModal.value = true
  }

  function handleDelete(account: any) {
    accountToDelete.value = account
    showDeleteConfirm.value = true
  }

  async function confirmDelete() {
    if (accountToDelete.value) {
      try {
        deleteLoading.value = true
        await accountStore.deleteAccount(accountToDelete.value.id)
        accountToDelete.value = null
        showDeleteConfirm.value = false
      }
      finally {
        deleteLoading.value = false
      }
    }
  }

  async function toggleAccount(account: any) {
    if (account.running) {
      await accountStore.stopAccount(account.id)
    }
    else {
      await accountStore.startAccount(account.id)
    }
  }

  async function refreshWxCodesNow() {
    if (refreshWxCodesLoading.value)
      return

    refreshWxCodesLoading.value = true
    try {
      const result = await accountStore.refreshWxCodes()
      const data = result.data
      if (!result.ok) {
        if (data && data.total > 0) {
          showAlert(`微信 Code 刷新完成：成功 ${data.success} 个，失败 ${data.failed} 个`, 'danger')
        }
        else {
          showAlert(result.error || '没有可刷新的微信账号', 'danger')
        }
        return
      }

      const skippedText = data && data.skipped > 0 ? `，跳过 ${data.skipped} 个非微信账号` : ''
      showAlert(`微信 Code 刷新完成：成功 ${data?.success || 0} 个${skippedText}`, 'primary')
    }
    catch (error: any) {
      showAlert(error.response?.data?.error || error.message || '刷新微信 Code 失败', 'danger')
    }
    finally {
      refreshWxCodesLoading.value = false
    }
  }

  async function handleSaved(targetId?: string) {
    await accountStore.fetchAccounts()
    if (targetId && accountStore.accounts.length > 0) {
      const target = accountStore.accounts.find(a => String(a.id) === String(targetId))
      if (target) {
        accountStore.setCurrentAccount(target)
        return
      }
    }
    // 如果没有传入明确的 targetId（例如编辑已有账号未指定新ID），优先保持当前已选中的账号不变！
    if (currentAccountId.value && accountStore.accounts.length > 0) {
      const curr = accountStore.accounts.find(a => String(a.id) === String(currentAccountId.value))
      if (curr) {
        accountStore.setCurrentAccount(curr)
        return
      }
    }
    // 只有全都没匹配到时（例如刚添加了第一个全新账号），才选最后一个
    if (accountStore.accounts.length > 0) {
      accountStore.setCurrentAccount(accountStore.accounts[accountStore.accounts.length - 1])
    }
  }

  function selectAccount(account: any) {
    if (!account || !account.id)
      return
    accountStore.selectAccount(String(account.id))
  }

  function openClearStoppedConfirm() {
    if (stoppedAccountsCount.value === 0) {
      showAlert('没有已停止的账号需要清理', 'primary')
      return
    }
    showClearStoppedConfirm.value = true
  }

  async function confirmClearStopped() {
    clearStoppedLoading.value = true
    try {
      const stoppedIds = stoppedAccounts.value.map((acc: any) => acc.id)
      let deletedCount = 0
      for (const id of stoppedIds) {
        try {
          await accountStore.deleteAccount(id)
          deletedCount++
        }
        catch (e) {
          console.error(`删除账号 ${id} 失败:`, e)
        }
      }
      showClearStoppedConfirm.value = false
      showAlert(`成功清理 ${deletedCount} 个已停止的账号`, 'primary')
      await accountStore.fetchAccounts()
    }
    finally {
      clearStoppedLoading.value = false
    }
  }

  return {
    accounts,
    accountsLoading,
    currentAccountId,
    currentAccountName,
    userIsAdmin,
    showModal,
    showDeleteConfirm,
    deleteLoading,
    editingAccount,
    accountToDelete,
    showClearStoppedConfirm,
    clearStoppedLoading,
    refreshWxCodesLoading,
    stoppedAccountsCount,
    isAddAccountDisabled,
    addAccountDisabledReason,
    isAccountOpsDisabled,
    fetchAccounts,
    selectFirstAccountIfNeeded,
    openSettings,
    openAddModal,
    openEditModal,
    handleDelete,
    confirmDelete,
    toggleAccount,
    refreshWxCodesNow,
    handleSaved,
    selectAccount,
    openClearStoppedConfirm,
    confirmClearStopped,
  }
}
