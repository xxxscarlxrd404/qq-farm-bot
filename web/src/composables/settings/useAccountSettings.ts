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

  const currentAccountName = computed(() => {
    const acc = accounts.value.find((item: any) => item.id === currentAccountId.value)
    return acc ? (acc.name || acc.nick || acc.id) : null
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

  function handleSaved() {
    accountStore.fetchAccounts()
  }

  function selectAccount(account: any) {
    if (!account || !account.id)
      return
    accountStore.selectAccount(String(account.id))
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
    refreshWxCodesLoading,
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
  }
}
