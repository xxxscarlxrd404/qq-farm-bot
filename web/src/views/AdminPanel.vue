<script setup lang="ts">
import type { Card, UserCard } from '@/stores/user'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import api from '@/api'
import AdminSystemPanel from '@/components/admin/AdminSystemPanel.vue'
import AdminSmtpConfigCard from '@/components/admin/AdminSmtpConfigCard.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import DeviceProtocolCard from '@/components/settings/DeviceProtocolCard.vue'
import { useUserSettings } from '@/composables/settings/useUserSettings'
import { useAdminSystemConfig } from '@/composables/useAdminSystemConfig'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const toast = useToastStore()

const rawSavedTab = localStorage.getItem('admin-active-tab')
const activeTab = ref<'card' | 'user' | 'system'>(
  (rawSavedTab === 'user' || rawSavedTab === 'system') ? rawSavedTab : 'card',
)
const systemSubTab = ref<'gateway' | 'device' | 'smtp' | 'capture'>('gateway')
const systemSubTabs = [
  { key: 'gateway', label: '运行网关', icon: 'i-carbon-network-3' },
  { key: 'smtp', label: '发件邮箱', icon: 'i-carbon-email' },
  { key: 'capture', label: '抓包登录', icon: 'i-carbon-data-connected' },
] as const

watch(activeTab, (newTab) => {
  localStorage.setItem('admin-active-tab', newTab)
})

// ========== 挂机列表 ==========
interface BotAccountItem {
  id: string | number
  name: string
  accountName?: string
  platform: 'qq' | 'wx'
  level: number
  avatar?: string
  username: string
  running: boolean
  createdAt?: number | string | null
  uin?: string
}

const botAccounts = ref<BotAccountItem[]>([])
const botAccountsLoading = ref(false)
const botAccountSearch = ref('')
const botAccountPlatformFilter = ref<'all' | 'qq' | 'wx'>('all')
const botAccountStatusFilter = ref<'all' | 'running' | 'stopped'>('all')

async function fetchAllBotAccounts() {
  botAccountsLoading.value = true
  try {
    const res = await api.get('/api/admin/all-accounts')
    if (res.data && res.data.ok) {
      botAccounts.value = res.data.data || []
    } else {
      toast.error(res.data?.error || '获取挂机账号失败')
    }
  } catch (e: any) {
    toast.error(e.message || '获取挂机账号失败')
  } finally {
    botAccountsLoading.value = false
  }
}

const qqBotAccountsCount = computed(() => botAccounts.value.filter(a => a.platform === 'qq').length)
const wxBotAccountsCount = computed(() => botAccounts.value.filter(a => a.platform === 'wx').length)

const filteredBotAccounts = computed(() => {
  const list = Array.isArray(botAccounts.value) ? botAccounts.value : []
  return list.filter(acc => {
    if (botAccountPlatformFilter.value !== 'all' && acc.platform !== botAccountPlatformFilter.value) {
      return false
    }
    if (botAccountStatusFilter.value === 'running' && !acc.running) {
      return false
    }
    if (botAccountStatusFilter.value === 'stopped' && acc.running) {
      return false
    }
    if (botAccountSearch.value) {
      const q = botAccountSearch.value.toLowerCase()
      return (acc.name && acc.name.toLowerCase().includes(q))
        || (acc.username && acc.username.toLowerCase().includes(q))
        || (acc.accountName && acc.accountName.toLowerCase().includes(q))
        || (acc.uin && String(acc.uin).includes(q))
    }
    return true
  })
})

const tabs = computed(() => [
  { key: 'card', label: '卡密', icon: 'i-carbon-ticket' },
  { key: 'user', label: '用户', icon: 'i-carbon-user-admin' },
  { key: 'botAccounts', label: '挂机列表', icon: 'i-carbon-bot' },
  { key: 'system', label: '系统配置', icon: 'i-carbon-settings-services' },
] as const)

const modalVisible = ref(false)
const modalConfig = ref({
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  isAlert: true,
})

function showAlert(message: string, type: 'primary' | 'danger' = 'primary') {
  modalConfig.value = {
    title: type === 'danger' ? '错误' : '提示',
    message,
    type,
    isAlert: true,
  }
  modalVisible.value = true
}

// ========== 卡密管理 ==========
const cards = ref<Card[]>([])
const cardsLoading = ref(false)
const showCreateModal = ref(false)
const showExportMenu = ref(false)

const newCard = ref({
  description: '',
  days: 30,
  count: 1,
  type: 'time' as 'time' | 'quota',
  isFree: false,
})

const selectedCards = ref<Set<string>>(new Set())
const selectAll = ref(false)

const searchQuery = ref('')
const filterStatus = ref<'all' | 'free' | 'used' | 'unused' | 'enabled' | 'disabled'>('all')
const cardTypeFilter = ref<'all' | 'time' | 'quota'>('all')

// 卡密领取功能
const cardClaimEnabled = ref(false)
const cardClaimLoading = ref(false)

const unusedFreeCardsCount = computed(() => {
  return cards.value.filter(c => c.isFree === true && c.type === 'time' && !c.usedBy && c.enabled).length
})

const unusedTimeCardsCount = computed(() => {
  return cards.value.filter(c => c.type === 'time' && !c.usedBy && c.enabled).length
})

const filteredCards = computed(() => {
  let result = cards.value

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(card =>
      card.code.toLowerCase().includes(query)
      || card.description.toLowerCase().includes(query)
      || (card.usedBy && card.usedBy.toLowerCase().includes(query)),
    )
  }

  switch (filterStatus.value) {
    case 'free':
      result = result.filter(card => card.isFree === true)
      break
    case 'used':
      result = result.filter(card => card.usedBy)
      break
    case 'unused':
      result = result.filter(card => !card.usedBy)
      break
    case 'enabled':
      result = result.filter(card => card.enabled)
      break
    case 'disabled':
      result = result.filter(card => !card.enabled)
      break
  }

  if (cardTypeFilter.value !== 'all') {
    result = result.filter(card => card.type === cardTypeFilter.value)
  }

  return result
})

async function fetchCards() {
  cardsLoading.value = true
  try {
    const result = await userStore.getAllCards()
    if (result.ok) {
      cards.value = result.data
    }
    else {
      toast.error(result.error || '获取卡密列表失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取卡密列表失败')
  }
  finally {
    cardsLoading.value = false
  }
}

async function fetchCardClaimStatus() {
  cardClaimLoading.value = true
  try {
    const res = await api.get('/api/card-claim/status')
    if (res.data.ok) {
      cardClaimEnabled.value = res.data.enabled
    }
  }
  catch (e: any) {
    console.error('获取卡密领取状态失败', e)
  }
  finally {
    cardClaimLoading.value = false
  }
}

async function toggleCardClaimStatus(enabled: boolean | undefined) {
  if (enabled === undefined)
    return
  cardClaimLoading.value = true
  try {
    const res = await api.post('/api/admin/card-claim/status', { enabled })
    if (res.data.ok) {
      cardClaimEnabled.value = res.data.enabled
      toast.success(enabled ? '卡密领取功能已开启' : '卡密领取功能已关闭')
    }
  }
  catch (e: any) {
    toast.error(e.message || '操作失败')
    cardClaimEnabled.value = !enabled
  }
  finally {
    cardClaimLoading.value = false
  }
}

async function createCard() {
  if (!newCard.value.description) {
    toast.warning('请输入卡密描述')
    return
  }

  const count = Math.min(Math.max(Number.parseInt(String(newCard.value.count), 10) || 1, 1), 100)

  try {
    const result = await userStore.createCard(
      newCard.value.description,
      newCard.value.days,
      count > 1 ? count : undefined,
      newCard.value.type,
      newCard.value.isFree,
    )
    if (result && result.ok) {
      if (result.batch) {
        toast.success(`成功创建 ${result.count} 个卡密`)
        try {
          exportCardsToFile(result.data, `卡密批量导出_${newCard.value.description}_${formatDateForFile(Date.now())}.txt`)
        } catch {}
      }
      else {
        toast.success('卡密创建成功')
      }
      showCreateModal.value = false
      newCard.value = { description: '', days: 30, count: 1, type: 'time', isFree: false }
      // 延迟 300ms 刷新列表，确保后端文件写入完毕并防网络竞态
      setTimeout(() => {
        fetchCards()
      }, 300)
    }
    else {
      toast.error(result?.error || '创建卡密失败')
    }
  }
  catch (e: any) {
    // 捕获可能已成功写入但前端网络抖动的情况，自动静默刷新一次卡密列表
    setTimeout(() => { fetchCards() }, 500)
  }
}


async function handleBatchDeleteCards(targetType: 'selected' | 'used' | 'disabled' | 'free_used') {
  let codesToDelete: string[] = []
  let confirmTip = ''

  if (targetType === 'selected') {
    codesToDelete = Array.from(selectedCards.value)
    if (codesToDelete.length === 0) {
      toast.warning('请先勾选要删除的卡密')
      return
    }
    confirmTip = `确定要批量删除已选中的 ${codesToDelete.length} 个卡密吗？`
  }
  else if (targetType === 'used') {
    codesToDelete = cards.value.filter(c => !!c.usedBy).map(c => c.code)
    if (codesToDelete.length === 0) {
      toast.info('当前没有已使用的卡密')
      return
    }
    confirmTip = `确定要一键清理所有【已使用】的 ${codesToDelete.length} 个卡密吗？`
  }
  else if (targetType === 'disabled') {
    codesToDelete = cards.value.filter(c => !c.enabled).map(c => c.code)
    if (codesToDelete.length === 0) {
      toast.info('当前没有已禁用的卡密')
      return
    }
    confirmTip = `确定要一键清理所有【已禁用】的 ${codesToDelete.length} 个卡密吗？`
  }
  else if (targetType === 'free_used') {
    codesToDelete = cards.value.filter(c => c.isFree && !!c.usedBy).map(c => c.code)
    if (codesToDelete.length === 0) {
      toast.info('当前没有已使用的免费卡密')
      return
    }
    confirmTip = `确定要一键清理所有【已使用免费卡密】(${codesToDelete.length} 个) 吗？`
  }

  if (!window.confirm(confirmTip)) return

  try {
    const res = await userStore.deleteCardsBatch(codesToDelete)
    if (res && res.ok) {
      toast.success(`成功删除 ${res.deletedCount || codesToDelete.length} 个卡密`)
      selectedCards.value.clear()
      selectAll.value = false
      await fetchCards()
    }
    else {
      toast.error(res?.error || '批量删除失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '批量删除失败')
  }
}

async function toggleCardStatus(card: Card) {
  try {
    const result = await userStore.updateCard(card.code, { enabled: !card.enabled })
    if (result.ok) {
      toast.success(card.enabled ? '卡密已禁用' : '卡密已启用')
      await fetchCards()
    }
    else {
      toast.error(result.error || '操作失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function deleteCard(card: Card) {
  if (!confirm(`确定要删除卡密 ${card.code} 吗？`))
    return

  try {
    const result = await userStore.deleteCard(card.code)
    if (result.ok) {
      toast.success('卡密删除成功')
      await fetchCards()
    }
    else {
      toast.error(result.error || '删除卡密失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '删除卡密失败')
  }
}

async function deleteSelectedCards() {
  const selectedCodes = Array.from(selectedCards.value)
  if (selectedCodes.length === 0) {
    toast.warning('请先选择要删除的卡密')
    return
  }

  if (!confirm(`确定要删除选中的 ${selectedCodes.length} 个卡密吗？此操作不可恢复！`))
    return

  try {
    const result = await userStore.deleteCardsBatch(selectedCodes)
    if (result.ok) {
      toast.success(`成功删除 ${result.deletedCount} 个卡密`)
      if (result.notFoundCount > 0) {
        toast.warning(`${result.notFoundCount} 个卡密未找到`)
      }
      selectedCards.value.clear()
      selectAll.value = false
      await fetchCards()
    }
    else {
      toast.error(result.error || '批量删除卡密失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '批量删除卡密失败')
  }
}

async function copyCode(code: string) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code)
      toast.success('卡密已复制到剪贴板')
    }
    else {
      const textArea = document.createElement('textarea')
      textArea.value = code
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      toast.success('卡密已复制到剪贴板')
      document.body.removeChild(textArea)
    }
  }
  catch (e) {
    toast.error('复制失败，请手动复制')
    console.error('复制失败:', e)
  }
}

async function copySelectedCards() {
  const codes = Array.from(selectedCards.value)
  if (codes.length === 0)
    return

  try {
    const text = codes.join('\n')
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      toast.success(`已复制 ${codes.length} 个卡密到剪贴板`)
    }
    else {
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      toast.success(`已复制 ${codes.length} 个卡密到剪贴板`)
      document.body.removeChild(textArea)
    }
  }
  catch (e) {
    toast.error('复制失败，请手动复制')
    console.error('复制失败:', e)
  }
}

function formatDate(timestamp: number | null) {
  if (!timestamp)
    return '-'
  return new Date(timestamp).toLocaleString('zh-CN')
}

function formatDateForFile(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`
}

function getCardTypeLabel(card: Card) {
  if (card.type === 'quota') {
    return '额度'
  }
  return '时间'
}

function getCardValueLabel(card: Card) {
  if (card.type === 'quota') {
    return `+${card.days}额度`
  }
  if (card.days === -1)
    return '永久'
  return `${card.days}天`
}

function exportCardsToFile(cardsToExport: Card[], filename?: string) {
  if (!cardsToExport || cardsToExport.length === 0) {
    toast.warning('没有可导出的卡密')
    return
  }

  const content = cardsToExport.map(card => [
    `兑换码: ${card.code}`,
    `类型: ${getCardTypeLabel(card)}`,
    `数量: ${getCardValueLabel(card)}`,
  ].join('\n')).join('\n\n')

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || `卡密导出_${formatDateForFile(Date.now())}.txt`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  toast.success(`已导出 ${cardsToExport.length} 个卡密到文件`)
}

function exportCardsAsCsv(cardsToExport: Card[], filename?: string) {
  if (!cardsToExport || cardsToExport.length === 0) {
    toast.warning('没有可导出的卡密')
    return
  }

  // BOM for Excel UTF-8 compatibility
  const BOM = '\uFEFF'
  const header = ['兑换码', '类型', '数量']
  const rows = cardsToExport.map(card => [
    card.code,
    getCardTypeLabel(card),
    getCardValueLabel(card),
  ].map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))

  const content = BOM + [header.join(','), ...rows].join('\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || `卡密导出_${formatDateForFile(Date.now())}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  toast.success(`已导出 ${cardsToExport.length} 个卡密到 CSV 文件`)
}

function handleExportCards(scope: 'all' | 'filtered' | 'selected', format: 'txt' | 'csv') {
  showExportMenu.value = false

  let cardsToExport: Card[]
  let label: string

  switch (scope) {
    case 'selected': {
      const codes = Array.from(selectedCards.value)
      cardsToExport = cards.value.filter(c => codes.includes(c.code))
      label = '已选'
      break
    }
    case 'filtered':
      cardsToExport = filteredCards.value
      label = '筛选'
      break
    case 'all':
    default:
      cardsToExport = cards.value
      label = '全部'
      break
  }

  if (cardsToExport.length === 0) {
    toast.warning('没有可导出的卡密')
    return
  }

  const dateStr = formatDateForFile(Date.now())
  if (format === 'csv') {
    exportCardsAsCsv(cardsToExport, `卡密${label}导出_${dateStr}.csv`)
  } else {
    exportCardsToFile(cardsToExport, `卡密${label}导出_${dateStr}.txt`)
  }
}

// Close export menu when clicking outside
function closeExportMenu(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.export-dropdown')) {
    showExportMenu.value = false
  }
}

function toggleSelectAll() {
  if (selectAll.value) {
    filteredCards.value.forEach(card => selectedCards.value.add(card.code))
  }
  else {
    filteredCards.value.forEach(card => selectedCards.value.delete(card.code))
  }
}

function toggleSelectCard(code: string) {
  if (selectedCards.value.has(code)) {
    selectedCards.value.delete(code)
    selectAll.value = false
  }
  else {
    selectedCards.value.add(code)
    if (filteredCards.value.every(card => selectedCards.value.has(card.code))) {
      selectAll.value = true
    }
  }
}

// ========== 用户管理 ==========
interface UserInfo {
  username: string
  role: string
  card: UserCard | null
  accountLimit: number
}

interface EditForm {
  newUsername: string
  password: string
  accountLimit: number
  expiresAt: string
  isPermanent: boolean
}

const users = ref<UserInfo[]>([])
const usersLoading = ref(false)
const userSearchQuery = ref('')

const filteredUsers = computed(() => {
  if (!userSearchQuery.value)
    return users.value
  const query = userSearchQuery.value.toLowerCase()
  return users.value.filter(user =>
    user.username.toLowerCase().includes(query),
  )
})
const showEditModal = ref(false)
const selectedUser = ref<UserInfo | null>(null)
const editForm = ref<EditForm>({
  newUsername: '',
  password: '',
  accountLimit: 2,
  expiresAt: '',
  isPermanent: false,
})
const editLoading = ref(false)

const currentUsername = computed(() => userStore.username)

async function fetchUsers() {
  usersLoading.value = true
  try {
    const result = await userStore.getAllUsers()
    if (result.ok) {
      users.value = result.data
    }
    else {
      toast.error(result.error || '获取用户列表失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取用户列表失败')
  }
  finally {
    usersLoading.value = false
  }
}

async function toggleUserStatus(user: UserInfo) {
  try {
    const updates: Partial<UserCard> = { enabled: !user.card?.enabled }
    const result = await userStore.updateUser(user.username, updates)
    if (result.ok) {
      toast.success(user.card?.enabled ? '用户已封禁' : '用户已解封')
      await fetchUsers()
    }
    else {
      toast.error(result.error || '操作失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function deleteUser(user: UserInfo) {
  if (!confirm(`确定要删除用户 ${user.username} 吗？此操作不可恢复！`))
    return

  try {
    const result = await userStore.deleteUser(user.username)
    if (result.ok) {
      toast.success('用户删除成功')
      await fetchUsers()
    }
    else {
      toast.error(result.error || '删除用户失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '删除用户失败')
  }
}

const showClearExpiredConfirm = ref(false)
const clearExpiredLoading = ref(false)

async function clearExpiredUsers() {
  clearExpiredLoading.value = true
  try {
    const result = await userStore.clearExpiredUsers()
    if (result.ok) {
      toast.success(`成功清理 ${result.deletedCount} 个到期用户`)
      showClearExpiredConfirm.value = false
      await fetchUsers()
    }
    else {
      toast.error(result.error || '清理失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '清理失败')
  }
  finally {
    clearExpiredLoading.value = false
  }
}

function openEditModal(user: UserInfo) {
  selectedUser.value = user
  editForm.value = {
    newUsername: user.username,
    password: '',
    accountLimit: user.accountLimit || 2,
    expiresAt: user.card?.expiresAt ? formatDateTimeLocal(user.card.expiresAt) : '',
    isPermanent: user.card?.days === -1,
  }
  showEditModal.value = true
}

function formatDateTimeLocal(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

async function handleEdit() {
  if (!selectedUser.value)
    return

  editLoading.value = true
  try {
    const expiresAtValue = editForm.value.isPermanent
      ? null
      : (editForm.value.expiresAt ? new Date(editForm.value.expiresAt).getTime() : null)

    const updateData: Record<string, any> = {
      accountLimit: editForm.value.accountLimit,
      expiresAt: expiresAtValue,
      isPermanent: editForm.value.isPermanent,
    }

    if (editForm.value.newUsername && editForm.value.newUsername !== selectedUser.value.username) {
      updateData.newUsername = editForm.value.newUsername
    }

    if (editForm.value.password) {
      updateData.password = editForm.value.password
    }

    const res = await api.post(`/api/admin/users/${selectedUser.value.username}/edit`, updateData)

    if (res.data.ok) {
      toast.success('用户信息已更新')
      showEditModal.value = false
      await fetchUsers()
    }
    else {
      toast.error(res.data.error || '更新失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '更新失败')
  }
  finally {
    editLoading.value = false
  }
}

function getDaysLabel(days: number) {
  if (days === -1)
    return '永久'
  return `${days}天`
}

function isExpired(card: UserCard | null) {
  if (!card?.expiresAt)
    return false
  return Date.now() > card.expiresAt
}

// ========== 原生系统配置 ==========
const {
  systemConfigSaving,
  captureConfigSaving,
  captureConfigTesting,
  localSystemConfig,
  defaultSystemConfig,
  localCaptureConfig,
  platformOptions,
  osOptions,
  loadCaptureConfig,
  handleTestCaptureConfig,
  loadSystemConfig,
  handleResetSystemConfig,
} = useAdminSystemConfig({ showAlert })

const {
  deviceProtocolLoading,
  deviceProtocolSaving,
  deviceProtocolPresetOptions,
  selectedDevicePreset,
  deviceProtocolForm,
  fillRandomDeviceMac,
  fillRandomDeviceId,
  fillRandomImei,
  applyDevicePreset,
  fetchDeviceProtocol,
  localOffline,
  offlineSaving,
  offlineTesting,
  handleSaveOffline,
  handleTestOffline,
  syncLocalOfflineSettings,
} = useUserSettings(showAlert)

const systemSettingsSaving = ref(false)
const anySystemSaving = computed(() => systemSettingsSaving.value || systemConfigSaving.value || captureConfigSaving.value || deviceProtocolSaving.value || offlineSaving.value)

async function saveSystemSettings() {
  if (anySystemSaving.value)
    return
  systemSettingsSaving.value = true
  try {
    const devicePayload = {
      enabled: !!deviceProtocolForm.value.enabled,
      userAgent: String(deviceProtocolForm.value.userAgent || '').trim(),
      deviceBrand: String(deviceProtocolForm.value.deviceBrand || '').trim(),
      deviceModel: String(deviceProtocolForm.value.deviceModel || '').trim(),
      deviceMac: String(deviceProtocolForm.value.deviceMac || '').trim(),
      deviceId: String(deviceProtocolForm.value.deviceId || '').trim(),
      imei: String(deviceProtocolForm.value.imei || '').trim(),
    }
    const [systemResult, captureResult, deviceResult, offlineResult] = await Promise.all([
      api.post('/api/admin/system-config', { ...localSystemConfig.value, confirmed: true }),
      api.post('/api/admin/capture-config', { ...localCaptureConfig.value, confirmed: true }),
      api.post('/api/user/device-protocol', devicePayload),
      api.post('/api/settings/offline-reminder', { ...localOffline.value, isGlobalAdminSmtp: true }),
    ])
    if (!systemResult.data?.ok || !captureResult.data?.ok || !deviceResult.data?.ok || !offlineResult.data?.ok)
      throw new Error('部分系统配置保存失败')
    await Promise.all([loadSystemConfig(), loadCaptureConfig(), fetchDeviceProtocol(), syncLocalOfflineSettings()])
    showAlert('系统配置已统一保存并生效')
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '系统配置保存失败', 'danger')
  }
  finally {
    systemSettingsSaving.value = false
  }
}

watch(activeTab, (newTab) => {
  if (newTab === 'card') fetchCards()
  else if (newTab === 'user') fetchUsers()
  else if (newTab === 'botAccounts') fetchAllBotAccounts()
})

onMounted(async () => {
  syncLocalOfflineSettings()
  document.addEventListener('click', closeExportMenu)
  if (activeTab.value === 'card') await fetchCards()
  else if (activeTab.value === 'user') await fetchUsers()
  fetchCardClaimStatus()
  await Promise.all([loadSystemConfig(), loadCaptureConfig(), fetchDeviceProtocol()])
})

onUnmounted(() => {
  document.removeEventListener('click', closeExportMenu)
})
</script>

<template>
  <div class="admin-panel w-full space-y-3 sm:space-y-4">
    <!-- 标题 + Tab 液态玻璃通栏面板 -->
    <div class="ui-card-elevated relative overflow-hidden rounded-2xl p-4 sm:p-5 shadow-sm transition-all">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3 border-b border-gray-100/70 pb-3 dark:border-gray-800/70">
        <div class="flex items-center gap-2.5">
          <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-xl bg-purple-500/15 text-purple-600 dark:bg-purple-400/20 dark:text-purple-300 font-bold text-base shadow-sm ring-1 ring-white/80">
            <div class="i-carbon-security text-xl" />
          </div>
          <div>
            <h1 class="text-base font-bold text-gray-900 dark:text-gray-100 sm:text-xl">
              后台管理系统
            </h1>
            <p class="text-xs text-gray-400 mt-0.5">卡密分发、用户额度与底层网关配置</p>
          </div>
        </div>
      </div>

      <nav class="flex gap-2 p-1 rounded-xl bg-gray-100/60 dark:bg-gray-800/50 backdrop-blur-md mb-4">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs sm:text-sm font-semibold transition-all duration-200"
          :class="activeTab === tab.key
            ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-700 dark:text-blue-400'
            : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'"
          @click="activeTab = tab.key"
        >
          <div :class="tab.icon" class="text-sm sm:text-base" />
          <span>{{ tab.label }}</span>
        </button>
      </nav>

      <!-- 一体化内容区（无断开，共享顶部毛玻璃卡片） -->
      <div class="w-full border-t border-gray-100/70 pt-4 dark:border-gray-800/70">
        <!-- 卡密管理 -->
        <div v-if="activeTab === 'card'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg text-gray-800 font-semibold dark:text-gray-200">
              卡密管理
            </h3>
            <div class="flex items-center gap-2">
              <BaseButton variant="secondary" size="sm" @click="fetchCards">
                刷新
              </BaseButton>
              <!-- 导出按钮 -->
              <div class="export-dropdown relative">
                <BaseButton variant="secondary" size="sm" @click="showExportMenu = !showExportMenu">
                  <span class="flex items-center gap-1">
                    <span class="i-carbon-download text-sm" />
                    导出
                  </span>
                </BaseButton>
                <div
                  v-if="showExportMenu"
                  class="absolute right-0 z-50 mt-1 min-w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-700"
                  @click.stop
                >
                  <div class="px-3 py-1.5 text-xs text-gray-400 font-medium dark:text-gray-500">
                    导出范围
                  </div>
                  <button
                    class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-600"
                    @click="handleExportCards('all', 'txt')"
                  >
                    <span class="i-carbon-document text-sm" />
                    全部卡密 (.txt)
                  </button>
                  <button
                    class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-600"
                    @click="handleExportCards('all', 'csv')"
                  >
                    <span class="i-carbon-document text-sm" />
                    全部卡密 (.csv)
                  </button>
                  <div class="my-1 border-t border-gray-100 dark:border-gray-600" />
                  <button
                    class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-600"
                    @click="handleExportCards('filtered', 'txt')"
                  >
                    <span class="i-carbon-filter text-sm" />
                    当前筛选 (.txt)
                  </button>
                  <button
                    class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-600"
                    @click="handleExportCards('filtered', 'csv')"
                  >
                    <span class="i-carbon-filter text-sm" />
                    当前筛选 (.csv)
                  </button>
                  <template v-if="selectedCards.size > 0">
                    <div class="my-1 border-t border-gray-100 dark:border-gray-600" />
                    <button
                      class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-green-700 hover:bg-gray-100 dark:text-green-300 dark:hover:bg-gray-600"
                      @click="handleExportCards('selected', 'txt')"
                    >
                      <span class="i-carbon-checkmark-outline text-sm" />
                      已选 {{ selectedCards.size }} 个 (.txt)
                    </button>
                    <button
                      class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-green-700 hover:bg-gray-100 dark:text-green-300 dark:hover:bg-gray-600"
                      @click="handleExportCards('selected', 'csv')"
                    >
                      <span class="i-carbon-checkmark-outline text-sm" />
                      已选 {{ selectedCards.size }} 个 (.csv)
                    </button>
                  </template>
                </div>
              </div>
              <BaseButton variant="primary" size="sm" @click="showCreateModal = true">
                创建卡密
              </BaseButton>
            </div>
          </div>

          <!-- 统一合并：卡密运营与多维管控一体化卡片（层级顺序优化调整） -->
          <div class="rounded-2xl border border-white/60 bg-white/55 p-3 shadow-sm backdrop-blur-md dark:border-gray-700/60 dark:bg-gray-800/50 space-y-2.5">
            <!-- 1. 顶行：卡密领取开关与免费库存 -->
            <div class="flex items-center justify-between gap-3 pb-2 border-b border-gray-100/70 dark:border-gray-700/50">
              <div class="flex items-center gap-2 min-w-0">
                <span class="i-carbon-gift text-base text-emerald-600 dark:text-emerald-400 flex-none" />
                <h4 class="text-xs font-bold text-gray-900 dark:text-white flex-none">
                  卡密领取功能
                </h4>
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.2 text-[10px] font-semibold"
                  :class="unusedFreeCardsCount > 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'"
                >
                  免费库存: {{ unusedFreeCardsCount }} 张
                </span>
              </div>
              <div class="flex-none">
                <BaseSwitch
                  v-model="cardClaimEnabled"
                  :disabled="cardClaimLoading"
                  @update:model-value="toggleCardClaimStatus"
                />
              </div>
            </div>

            <!-- 2. 中行：分类筛选与搜索过滤输入框（移到中间） -->
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex gap-1 p-0.5 rounded-lg border border-gray-200/60 bg-white/40 dark:border-gray-700/60 dark:bg-gray-800/40">
                <button
                  class="rounded-md px-2 py-0.5 text-[11px] font-semibold transition"
                  :class="cardTypeFilter === 'all'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'"
                  @click="cardTypeFilter = 'all'"
                >
                  全部
                </button>
                <button
                  class="rounded-md px-2 py-0.5 text-[11px] font-semibold transition"
                  :class="cardTypeFilter === 'time'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'"
                  @click="cardTypeFilter = 'time'"
                >
                  时间卡
                </button>
                <button
                  class="rounded-md px-2 py-0.5 text-[11px] font-semibold transition"
                  :class="cardTypeFilter === 'quota'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'"
                  @click="cardTypeFilter = 'quota'"
                >
                  额度卡
                </button>
              </div>

              <div class="flex flex-1 sm:flex-initial items-center gap-1.5 rounded-lg border border-gray-200/60 bg-white/60 px-2 py-1 shadow-sm dark:border-gray-700 dark:bg-gray-800/50">
                <input
                  v-model="searchQuery"
                  placeholder="搜索卡密或用户..."
                  class="h-6 w-full sm:w-48 border-0 bg-transparent text-[11px] text-gray-900 outline-none placeholder-gray-400 dark:text-white"
                >
                <select
                  v-model="filterStatus"
                  class="h-6 rounded border-0 bg-transparent text-[11px] text-gray-700 outline-none font-medium dark:text-gray-200 cursor-pointer"
                >
                  <option value="all">全部状态</option>
                  <option value="free">免费卡密</option>
                  <option value="unused">未使用</option>
                  <option value="used">已使用</option>
                  <option value="enabled">已启用</option>
                  <option value="disabled">已禁用</option>
                </select>
              </div>
            </div>

            <!-- 3. 底行：批量勾选操作与一键清理分类（下移到卡片底部） -->
            <div class="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-gray-100/70 dark:border-gray-700/50 text-xs">
              <div class="flex items-center gap-1.5 flex-wrap">
                <label class="flex cursor-pointer items-center gap-1 px-1.5 py-0.5 text-[11px] font-semibold text-gray-700 select-none dark:text-gray-200">
                  <input
                    v-model="selectAll"
                    type="checkbox"
                    class="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    @change="toggleSelectAll"
                  >
                  全选本页 ({{ selectedCards.size }}/{{ filteredCards.length }})
                </label>

                <button
                  class="rounded-lg px-2 py-0.5 text-[11px] font-bold shadow-sm transition flex items-center gap-1"
                  :class="selectedCards.size > 0 ? 'bg-red-600 text-white hover:bg-red-700 active:scale-95' : 'bg-red-50 text-red-500 border border-red-200 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400 hover:bg-red-100'"
                  title="批量删除勾选的卡密"
                  @click="handleBatchDeleteCards('selected')"
                >
                  <span class="i-carbon-trash-can text-xs" />
                  删除所选{{ selectedCards.size > 0 ? ` (${selectedCards.size})` : '' }}
                </button>
              </div>

              <!-- 分类一键秒清按钮 -->
              <div class="flex items-center gap-1.5 flex-wrap">
                <button
                  class="rounded-lg border border-gray-200 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-gray-700 transition hover:bg-gray-100 hover:text-red-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300"
                  title="清理所有已被用户激活充值的历史卡密"
                  @click="handleBatchDeleteCards('used')"
                >
                  清理已使用
                </button>
                <button
                  class="rounded-lg border border-gray-200 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-gray-700 transition hover:bg-gray-100 hover:text-red-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300"
                  title="清理所有已停用禁用的废弃卡密"
                  @click="handleBatchDeleteCards('disabled')"
                >
                  清理已禁用
                </button>
              </div>
            </div>
          </div>

          <div v-if="cardsLoading" class="py-8 text-center text-gray-500">
            <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
            <div>加载中...</div>
          </div>

          <div v-else>
            <!-- 1. 桌面端：通透液态毛玻璃表格 -->
            <div class="hidden sm:block overflow-hidden rounded-2xl border border-white/60 bg-white/45 backdrop-blur-md shadow-sm dark:border-gray-800/80 dark:bg-gray-800/40">
              <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200/60 dark:divide-gray-700/60">
                  <thead class="bg-gray-50/60 dark:bg-gray-800/60">
                    <tr>
                      <th class="px-3 py-2.5 text-left w-8">
                        <input
                          v-model="selectAll"
                          type="checkbox"
                          class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          @change="toggleSelectAll"
                        >
                      </th>
                      <th class="px-3 py-2.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        卡密代码 (点击复制)
                      </th>
                      <th class="px-3 py-2.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        描述
                      </th>
                      <th class="px-3 py-2.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        类型
                      </th>
                      <th class="px-3 py-2.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        天数/数量
                      </th>
                      <th class="px-3 py-2.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        状态
                      </th>
                      <th class="px-3 py-2.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        使用者
                      </th>
                      <th class="px-3 py-2.5 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        创建时间
                      </th>
                      <th class="px-3 py-2.5 text-right text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100/70 dark:divide-gray-700/50">
                    <tr v-for="card in filteredCards" :key="card.code" class="transition hover:bg-white/50 dark:hover:bg-gray-700/30">
                      <td class="px-3 py-2.5">
                        <input
                          :checked="selectedCards.has(card.code)"
                          type="checkbox"
                          class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          @change="toggleSelectCard(card.code)"
                        >
                      </td>
                      <td class="whitespace-nowrap px-3 py-2.5">
                        <button
                          class="group inline-flex items-center gap-1.5 rounded-lg border border-gray-200/80 bg-gray-50/80 px-2 py-1 font-mono text-xs font-semibold text-gray-800 transition hover:border-blue-300 hover:bg-blue-50/60 hover:text-blue-600 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-200 dark:hover:text-blue-300"
                          title="点击快速复制卡密"
                          @click="copyCode(card.code)"
                        >
                          <span>{{ card.code }}</span>
                          <span class="i-carbon-copy text-[11px] opacity-40 group-hover:opacity-100" />
                        </button>
                      </td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                        {{ card.description }}
                      </td>
                      <td class="whitespace-nowrap px-3 py-2.5">
                        <div class="flex items-center gap-1">
                          <span
                            class="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            :class="card.type === 'quota' ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'"
                          >
                            {{ card.type === 'quota' ? '额度卡' : '时间卡' }}
                          </span>
                          <span
                            v-if="card.isFree"
                            class="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300"
                          >
                            免费
                          </span>
                        </div>
                      </td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-gray-800 dark:text-gray-200">
                        {{ getCardValueLabel(card) }}
                      </td>
                      <td class="whitespace-nowrap px-3 py-2.5">
                        <span
                          class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          :class="!card.enabled ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300' : (card.usedBy ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300')"
                        >
                          <span class="h-1.5 w-1.5 rounded-full" :class="!card.enabled ? 'bg-red-500' : (card.usedBy ? 'bg-gray-400' : 'bg-emerald-500')" />
                          {{ !card.enabled ? '已禁用' : (card.usedBy ? '已使用' : '待使用') }}
                        </span>
                      </td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-xs text-gray-700 dark:text-gray-300">
                        <template v-if="card.usedBy">
                          <span class="font-medium">{{ card.usedBy }}</span>
                          <span class="text-gray-400 text-[11px] font-mono ml-1">（{{ card.usedAt ? new Date(card.usedAt).toLocaleDateString() : '-' }}）</span>
                        </template>
                        <span v-else class="text-gray-400">-</span>
                      </td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-xs text-gray-400 font-mono">
                        {{ card.createdAt ? new Date(card.createdAt).toLocaleDateString() : '-' }}
                      </td>
                      <td class="whitespace-nowrap px-3 py-2.5 text-right text-xs font-medium">
                        <button class="mr-2 text-blue-600 hover:underline dark:text-blue-400" @click="copyCode(card.code)">
                          复制
                        </button>
                        <button
                          class="mr-2 hover:underline"
                          :class="card.enabled ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'"
                          @click="toggleCardStatus(card)"
                        >
                          {{ card.enabled ? '禁用' : '启用' }}
                        </button>
                        <button class="text-red-600 hover:underline dark:text-red-400" @click="deleteCard(card)">
                          删除
                        </button>
                      </td>
                    </tr>
                    <tr v-if="filteredCards.length === 0">
                      <td colspan="9" class="px-4 py-8 text-center text-xs text-gray-400">
                        {{ searchQuery ? '未找到匹配的卡密' : '暂无卡密数据' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- 2. 移动端：自适应独立卡密卡片流（绝不横向撑爆，单手操作极佳） -->
            <div class="sm:hidden space-y-2.5">
              <div
                v-for="card in filteredCards"
                :key="card.code"
                class="rounded-2xl border border-white/60 bg-white/55 p-3.5 shadow-sm backdrop-blur-md dark:border-gray-700/60 dark:bg-gray-800/50"
              >
                <!-- 卡片头部：多选勾选框 + 卡密代码 + 类型徽章 + 状态 -->
                <div class="flex items-center justify-between pb-2.5 border-b border-gray-100/80 dark:border-gray-700/50">
                  <div class="flex items-center gap-2 flex-wrap">
                    <input
                      :checked="selectedCards.has(card.code)"
                      type="checkbox"
                      class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      @change="toggleSelectCard(card.code)"
                    >
                    <button
                      class="inline-flex items-center gap-1 rounded-lg border border-gray-200/80 bg-gray-50/80 px-2 py-0.5 font-mono text-xs font-bold text-gray-800 active:bg-blue-100 active:text-blue-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                      title="点击快速复���卡密"
                      @click="copyCode(card.code)"
                    >
                      <span>{{ card.code }}</span>
                      <span class="i-carbon-copy text-[11px] opacity-50" />
                    </button>
                    <span
                      class="rounded-full px-2 py-0.2 text-[10px] font-semibold"
                      :class="card.type === 'quota' ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'"
                    >
                      {{ card.type === 'quota' ? '额度' : '时长' }}
                    </span>
                    <span
                      v-if="card.isFree"
                      class="rounded-full bg-emerald-100 px-1.5 py-0.2 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300"
                    >
                      免费
                    </span>
                  </div>

                  <span
                    class="rounded-full px-2 py-0.5 text-xs font-semibold"
                    :class="!card.enabled ? 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200' : (card.usedBy ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200')"
                  >
                    {{ !card.enabled ? '已禁用' : (card.usedBy ? '已使用' : '待使用') }}
                  </span>
                </div>

                <!-- 卡片中部信息网格 -->
                <div class="grid grid-cols-2 gap-2 py-2 text-xs">
                  <div class="flex flex-col">
                    <span class="text-gray-400">描述名称</span>
                    <span class="font-medium text-gray-800 dark:text-gray-200 mt-0.5 truncate">
                      {{ card.description || '未命名' }}
                    </span>
                  </div>
                  <div class="flex flex-col">
                    <span class="text-gray-400">面额天数</span>
                    <span class="font-bold text-gray-800 dark:text-gray-200 mt-0.5">
                      {{ getCardValueLabel(card) }}
                    </span>
                  </div>
                  <div class="flex flex-col">
                    <span class="text-gray-400">创建时间</span>
                    <span class="font-mono text-gray-600 dark:text-gray-400 mt-0.5 text-[11px]">
                      {{ card.createdAt ? new Date(card.createdAt).toLocaleDateString() : '-' }}
                    </span>
                  </div>
                  <div class="flex flex-col">
                    <span class="text-gray-400">使用人</span>
                    <span class="font-medium text-gray-700 dark:text-gray-300 mt-0.5 truncate" :title="card.usedBy ? `${card.usedBy}（${card.usedAt ? new Date(card.usedAt).toLocaleDateString() : '-'}）` : '暂未使用'">
                      <template v-if="card.usedBy">
                        {{ card.usedBy }}<span class="text-gray-400 text-[11px] font-mono font-normal">（{{ card.usedAt ? new Date(card.usedAt).toLocaleDateString() : '-' }}）</span>
                      </template>
                      <template v-else>
                        暂未使用
                      </template>
                    </span>
                  </div>
                </div>

                <!-- 卡片底部操作栏 -->
                <div class="flex items-center justify-end gap-2 pt-2 border-t border-gray-100/80 dark:border-gray-700/50">
                  <button
                    class="rounded-lg border border-blue-200 bg-blue-50/70 px-2.5 py-1 text-xs font-semibold text-blue-600 active:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 transition"
                    @click="copyCode(card.code)"
                  >
                    一键复制
                  </button>
                  <button
                    class="rounded-lg border px-2.5 py-1 text-xs font-semibold transition"
                    :class="card.enabled ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'"
                    @click="toggleCardStatus(card)"
                  >
                    {{ card.enabled ? '禁用' : '启用' }}
                  </button>
                  <button
                    class="rounded-lg border border-red-200 bg-red-50/70 px-2.5 py-1 text-xs font-semibold text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 transition"
                    @click="deleteCard(card)"
                  >
                    删除
                  </button>
                </div>
              </div>

              <div v-if="filteredCards.length === 0" class="py-8 text-center text-xs text-gray-400">
                {{ searchQuery ? '未找到匹配的卡密' : '暂无卡密数据' }}
              </div>
            </div>
          </div>

          <div
            v-if="showCreateModal"
            class="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 sm:p-4 backdrop-blur-sm"
            @click.self="showCreateModal = false"
          >
            <div class="max-w-md w-full max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-2xl dark:bg-gray-800 border border-gray-100 dark:border-gray-700 overflow-hidden" @click.stop>
              <!-- 固定顶部标题栏 -->
              <div class="flex-none px-5 py-3.5 flex items-center justify-between border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/80">
                <h2 class="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <span class="i-carbon-add-alt text-blue-500" />
                  创建卡密
                </h2>
                <button
                  class="h-7 w-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-200/60 dark:hover:bg-gray-700 transition"
                  @click="showCreateModal = false"
                >
                  <div class="i-carbon-close text-lg" />
                </button>
              </div>

              <!-- 中间自适应滚动表单区 -->
              <div class="flex-1 overflow-y-auto px-5 py-4 space-y-3.5 custom-scrollbar">
                <div>
                  <label class="mb-1 block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                    描述
                  </label>
                  <BaseInput
                    v-model="newCard.description"
                    placeholder="例如：月卡2024 / 体验卡"
                  />
                </div>

                <div>
                  <label class="mb-1.5 block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                    卡密类型
                  </label>
                  <div class="grid grid-cols-2 gap-2">
                    <label
                      class="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-medium transition"
                      :class="newCard.type === 'time' ? 'border-blue-500 bg-blue-50/60 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'"
                    >
                      <input v-model="newCard.type" type="radio" value="time" class="hidden">
                      <span class="i-carbon-time" />
                      时间卡 (时长)
                    </label>
                    <label
                      class="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-medium transition"
                      :class="newCard.type === 'quota' ? 'border-orange-500 bg-orange-50/60 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'"
                    >
                      <input v-model="newCard.type" type="radio" value="quota" class="hidden">
                      <span class="i-carbon-user-avatar" />
                      额度卡 (账号数)
                    </label>
                  </div>
                </div>

                <!-- 免费卡密勾选卡片 -->
                <div class="rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-2.5 dark:border-emerald-800/60 dark:bg-emerald-950/20">
                  <label class="flex cursor-pointer items-center justify-between select-none">
                    <div class="flex items-center gap-2">
                      <input
                        v-model="newCard.isFree"
                        type="checkbox"
                        class="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 dark:border-gray-600 dark:bg-gray-700"
                      >
                      <span class="text-xs font-bold text-gray-800 dark:text-gray-200">免费卡密</span>
                    </div>
                    <span class="text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold bg-emerald-100/80 dark:bg-emerald-900/60 px-2 py-0.5 rounded-full">
                      29天限领一次
                    </span>
                  </label>
                  <p class="mt-1 text-[11px] text-gray-500 pl-6 dark:text-gray-400 leading-tight">
                    勾选后带专属免费标识，供注册页领取，并受严格29天频次风控。
                  </p>
                </div>

                <div>
                  <div class="flex items-center justify-between mb-1">
                    <label class="block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                      {{ newCard.type === 'quota' ? '额度数量' : '天数' }}
                    </label>
                    <span v-if="newCard.type === 'time'" class="text-[11px] text-gray-400">输入 -1 表示永久</span>
                  </div>
                  <BaseInput
                    v-model.number="newCard.days"
                    type="number"
                    :placeholder="newCard.type === 'quota' ? '可添加的账号数量' : '天数'"
                  />
                </div>

                <div>
                  <label class="mb-1 block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                    生成数量 (1-100)
                  </label>
                  <BaseInput
                    v-model.number="newCard.count"
                    type="number"
                    min="1"
                    max="100"
                    placeholder="数量"
                  />
                </div>
              </div>

              <!-- 固定底部操作按钮栏（移动端永不截断） -->
              <div class="flex-none px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-2.5 bg-gray-50/50 dark:bg-gray-800/80">
                <BaseButton variant="secondary" size="sm" @click="showCreateModal = false">
                  取消
                </BaseButton>
                <BaseButton variant="primary" size="sm" @click="createCard">
                  确认创建
                </BaseButton>
              </div>
            </div>
          </div>
        </div>

        <!-- 挂机列表（本站所有挂机账号） -->
        <div v-else-if="activeTab === 'botAccounts'" class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <span class="i-carbon-bot text-xl text-blue-500" />
                全站挂机账号列表
              </h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                实时展示本站所有用户添加的农场挂机实例
              </p>
            </div>
            <BaseButton variant="primary" size="sm" @click="fetchAllBotAccounts">
              <span class="i-carbon-renew mr-1" />
              刷新
            </BaseButton>
          </div>

          <!-- 筛选与搜索工具栏 -->
          <div class="flex flex-wrap items-center justify-between gap-2.5">
            <div class="flex gap-1.5 p-1 rounded-xl border border-white/60 bg-white/40 backdrop-blur-md dark:border-gray-700/60 dark:bg-gray-800/40">
              <button
                class="rounded-lg px-2.5 py-1 text-xs font-semibold transition"
                :class="botAccountPlatformFilter === 'all' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'"
                @click="botAccountPlatformFilter = 'all'"
              >
                全部 ({{ botAccounts.length }})
              </button>
              <button
                class="rounded-lg px-2.5 py-1 text-xs font-semibold transition flex items-center gap-1"
                :class="botAccountPlatformFilter === 'qq' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'"
                @click="botAccountPlatformFilter = 'qq'"
              >
                <img src="/qq-icon.svg" class="h-3.5 w-3.5 object-contain" alt="QQ" />
                QQ ({{ qqBotAccountsCount }})
              </button>
              <button
                class="rounded-lg px-2.5 py-1 text-xs font-semibold transition flex items-center gap-1"
                :class="botAccountPlatformFilter === 'wx' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'"
                @click="botAccountPlatformFilter = 'wx'"
              >
                <span class="i-carbon-logo-wechat text-xs text-emerald-500" />
                微信 ({{ wxBotAccountsCount }})
              </button>
            </div>

            <div class="flex flex-1 sm:flex-initial items-center gap-2 rounded-xl border border-white/60 bg-white/45 px-2.5 py-1.5 shadow-sm backdrop-blur-md dark:border-gray-800 dark:bg-gray-800/40">
              <input
                v-model="botAccountSearch"
                placeholder="搜索账号名、归属人或QQ..."
                class="h-7 w-full sm:w-56 border-0 bg-transparent text-xs text-gray-900 outline-none placeholder-gray-400 dark:text-white"
              >
              <select
                v-model="botAccountStatusFilter"
                class="h-7 rounded-lg border border-gray-200/60 bg-white/60 px-1.5 text-xs text-gray-700 outline-none dark:border-gray-700 dark:bg-gray-700/60 dark:text-gray-200"
              >
                <option value="all">全部运行状态</option>
                <option value="running">运行中 (在线)</option>
                <option value="stopped">已停止 (离线)</option>
              </select>
            </div>
          </div>

          <div v-if="botAccountsLoading" class="py-12 text-center text-gray-500">
            <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
            <div>正在加载挂机账号...</div>
          </div>

          <div v-else>
            <!-- 1. 桌面端：通透液态毛玻璃表格 -->
            <div class="hidden sm:block overflow-hidden rounded-2xl border border-white/60 bg-white/45 backdrop-blur-md shadow-sm dark:border-gray-800/80 dark:bg-gray-800/40">
              <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200/60 dark:divide-gray-700/60">
                  <thead class="bg-gray-50/60 dark:bg-gray-800/60">
                    <tr>
                      <th class="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        头像与账号
                      </th>
                      <th class="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        等级
                      </th>
                      <th class="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        所属平台
                      </th>
                      <th class="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        归属用户
                      </th>
                      <th class="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        到期时间
                      </th>
                      <th class="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        添加时间
                      </th>
                      <th class="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        运行状态
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100/70 dark:divide-gray-700/50">
                    <tr v-for="acc in filteredBotAccounts" :key="acc.id" class="transition hover:bg-white/50 dark:hover:bg-gray-700/30">
                      <td class="whitespace-nowrap px-4 py-3 text-sm">
                        <div class="flex items-center gap-3">
                          <img
                            :src="acc.avatar || '/icon.png'"
                            class="h-9 w-9 rounded-full object-cover border border-white/80 shadow-sm bg-gray-100 dark:bg-gray-700"
                            alt="头像"
                            referrerpolicy="no-referrer"
                          >
                          <div class="flex flex-col">
                            <span class="font-bold text-gray-900 dark:text-white">{{ acc.name }}</span>
                            <span v-if="acc.accountName && acc.accountName !== acc.name" class="text-xs text-gray-400">备注: {{ acc.accountName }}</span>
                          </div>
                        </div>
                      </td>
                      <td class="whitespace-nowrap px-4 py-3 text-sm font-semibold text-amber-600 dark:text-amber-400">
                        Lv.{{ acc.level }}
                      </td>
                      <td class="whitespace-nowrap px-4 py-3 text-sm">
                        <span
                          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                          :class="acc.platform === 'qq' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'"
                        >
                          <img v-if="acc.platform === 'qq'" src="/qq-icon.svg" class="h-3.5 w-3.5 object-contain" alt="QQ" />
                          <span v-else class="i-carbon-logo-wechat text-emerald-500" />
                          {{ acc.platform === 'qq' ? 'QQ农场' : '微信农场' }}
                        </span>
                      </td>
                      <td class="whitespace-nowrap px-4 py-3 text-sm">
                        <span class="inline-flex items-center gap-1 rounded-lg bg-gray-100/80 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-gray-700/80 dark:text-gray-200">
                          <span class="i-carbon-user" />
                          {{ acc.username }}
                        </span>
                      </td>
                      <td class="whitespace-nowrap px-4 py-3 text-sm font-mono">
                        <span v-if="acc.isPermanent || !acc.expiresAt" class="inline-flex items-center gap-1 font-bold text-purple-600 dark:text-purple-400">
                          <span class="i-carbon-infinity text-sm" />
                          永久
                        </span>
                        <span v-else :class="acc.expiresAt < Date.now() ? 'text-red-500 font-bold' : 'text-gray-700 dark:text-gray-300'">
                          {{ formatDate(acc.expiresAt) }}
                        </span>
                      </td>
                      <td class="whitespace-nowrap px-4 py-3 text-xs text-gray-500 font-mono dark:text-gray-400">
                        {{ acc.createdAt ? new Date(acc.createdAt).toLocaleString() : '历史账号' }}
                      </td>
                      <td class="whitespace-nowrap px-4 py-3 text-right">
                        <span
                          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold"
                          :class="acc.running ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'"
                        >
                          <span class="h-2 w-2 rounded-full" :class="acc.running ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'" />
                          {{ acc.running ? '挂机运行中' : '已停止' }}
                        </span>
                      </td>
                    </tr>
                    <tr v-if="filteredBotAccounts.length === 0">
                      <td colspan="6" class="px-4 py-8 text-center text-xs text-gray-400">
                        {{ botAccountSearch ? '未找到匹配的挂机账号' : '暂无挂机账号' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- 2. 移动端：双列极致紧凑轻量账号卡片（一排两个，极大节省空间） -->
            <div class="sm:hidden grid grid-cols-2 gap-2.5">
              <div
                v-for="acc in filteredBotAccounts"
                :key="acc.id"
                class="flex items-center gap-2.5 rounded-2xl border border-white/60 bg-white/55 p-2.5 shadow-sm backdrop-blur-md dark:border-gray-700/60 dark:bg-gray-800/50"
              >
                <!-- 头像及右下角在线状态小圆点 -->
                <div class="relative flex-none">
                  <img
                    :src="acc.avatar || '/icon.png'"
                    class="h-10 w-10 rounded-full object-cover border border-white/90 shadow-sm bg-gray-100 dark:bg-gray-700"
                    alt="头像"
                    referrerpolicy="no-referrer"
                  >
                  <!-- 状态指示点：绿色运行在线 / 灰色已停止离线 -->
                  <span
                    class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-gray-800"
                    :class="acc.running ? 'bg-emerald-500 ring-2 ring-emerald-400/40' : 'bg-gray-400'"
                  />
                </div>

                <!-- 昵称+等级+平台图标（第一行） & 归属用户（第二行） -->
                <div class="min-w-0 flex-1 flex flex-col justify-center">
                  <!-- 第一行：昵称 + 等级 + 平台图标（单行不换行，超出截断） -->
                  <div class="flex items-center gap-1 min-w-0">
                    <span class="truncate text-xs font-bold text-gray-900 dark:text-white" :title="acc.name">
                      {{ acc.name }}
                    </span>
                    <span class="flex-none text-[10px] font-bold text-amber-600 dark:text-amber-400 font-mono">
                      Lv.{{ acc.level }}
                    </span>
                    <!-- 平台图标 -->
                    <img
                      v-if="acc.platform === 'qq'"
                      src="/qq-icon.svg"
                      class="h-3 w-3 object-contain flex-none"
                      alt="QQ"
                    >
                    <span
                      v-else
                      class="i-carbon-logo-wechat text-xs text-emerald-500 flex-none"
                    />
                  </div>

                  <!-- 第二行：用户图标 + 归属账号（如排行榜归属，直显全称不隐藏） -->
                  <div class="mt-1 flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 min-w-0">
                    <span class="i-carbon-user text-xs opacity-75 flex-none" />
                    <span class="truncate font-medium text-gray-700 dark:text-gray-300" :title="acc.username">
                      {{ acc.username }}
                    </span>
                  </div>
                </div>
              </div>

              <div v-if="filteredBotAccounts.length === 0" class="col-span-2 py-8 text-center text-xs text-gray-400">
                {{ botAccountSearch ? '未找到匹配的挂机账号' : '暂无挂机账号数据' }}
              </div>
            </div>
          </div>
        </div>

        <!-- 用户管理 -->
        <div v-else-if="activeTab === 'user'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
              用户管理
            </h3>
            <div class="flex items-center gap-2">
              <BaseButton variant="danger" size="sm" @click="showClearExpiredConfirm = true">
                清理到期用户
              </BaseButton>
              <BaseButton variant="primary" size="sm" @click="fetchUsers">
                刷新
              </BaseButton>
            </div>
          </div>

          <div class="flex items-center gap-2 rounded-xl border border-white/60 bg-white/45 px-2.5 py-1.5 shadow-sm backdrop-blur-md dark:border-gray-800 dark:bg-gray-800/40">
            <input
              v-model="userSearchQuery"
              placeholder="搜索用户..."
              class="h-8 w-64 border border-gray-300 rounded-lg bg-white px-3 text-sm text-gray-900 outline-none transition-all dark:border-gray-600 focus:border-green-500 dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-green-500/20"
            >
          </div>

          <div v-if="usersLoading" class="py-8 text-center text-gray-500">
            <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
            <div>加载中...</div>
          </div>

          <div v-else>
            <!-- 1. 桌面端：通透液态毛玻璃表格 -->
            <div class="hidden sm:block overflow-hidden rounded-2xl border border-white/60 bg-white/45 backdrop-blur-md shadow-sm dark:border-gray-800/80 dark:bg-gray-800/40">
              <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200/60 dark:divide-gray-700/60">
                  <thead class="bg-gray-50/60 dark:bg-gray-800/60">
                    <tr>
                      <th class="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        用户名
                      </th>
                      <th class="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        角色
                      </th>
                      <th class="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        在线挂机
                      </th>
                      <th class="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        额度
                      </th>
                      <th class="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        注册时间
                      </th>
                      <th class="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        到期时间
                      </th>
                      <th class="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        状态
                      </th>
                      <th class="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100/70 dark:divide-gray-700/50">
                    <tr v-for="user in filteredUsers" :key="user.username" class="transition hover:bg-white/50 dark:hover:bg-gray-700/30">
                      <td class="whitespace-nowrap px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white">
                        <div class="flex items-center gap-2">
                          <span class="h-2 w-2 rounded-full" :class="user.card?.enabled === false ? 'bg-red-400' : (isExpired(user.card) ? 'bg-amber-400' : 'bg-emerald-400')" />
                          {{ user.username }}
                        </div>
                      </td>
                      <td class="whitespace-nowrap px-4 py-3 text-sm">
                        <span
                          class="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium"
                          :class="user.role === 'admin' ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'"
                        >
                          {{ user.role === 'admin' ? '管理员' : '普通用户' }}
                        </span>
                      </td>
                      <td class="whitespace-nowrap px-4 py-3 text-sm">
                        <span
                          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold"
                          :class="(user.runningAccountsCount || 0) > 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'"
                        >
                          <span class="h-1.5 w-1.5 rounded-full" :class="(user.runningAccountsCount || 0) > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'" />
                          {{ user.runningAccountsCount || 0 }} 个在线
                        </span>
                      </td>
                      <td class="whitespace-nowrap px-4 py-3 text-sm">
                        <span
                          class="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium"
                          :class="user.role === 'admin' ? 'bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' : 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300'"
                        >
                          {{ user.role === 'admin' ? '无限制' : `${String(user.accountLimit || 2)} 个账号` }}
                        </span>
                      </td>
                      <td class="whitespace-nowrap px-4 py-3 text-xs text-gray-500 font-mono dark:text-gray-400">
                        {{ user.createdAt ? formatDate(user.createdAt) : '-' }}
                      </td>
                      <td class="whitespace-nowrap px-4 py-3 text-sm font-mono" :class="isExpired(user.card) ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-700 dark:text-gray-300'">
                        <span v-if="user.role === 'admin' || user.card?.days === -1 || (!user.card?.expiresAt && user.card)" class="inline-flex items-center gap-1 font-semibold text-purple-600 dark:text-purple-400">
                          <span class="i-carbon-infinity text-sm" />
                          永久
                        </span>
                        <span v-else>
                          {{ formatDate(user.card?.expiresAt || null) }}
                        </span>
                      </td>
                      <td class="whitespace-nowrap px-4 py-3">
                        <span
                          v-if="user.card"
                          class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                          :class="user.card.enabled === false ? 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200' : (isExpired(user.card) ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/60 dark:text-yellow-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200')"
                        >
                          <span class="h-1.5 w-1.5 rounded-full" :class="user.card.enabled === false ? 'bg-red-500' : (isExpired(user.card) ? 'bg-yellow-500' : 'bg-emerald-500')" />
                          {{ user.card.enabled === false ? '已封禁' : (isExpired(user.card) ? '已到期' : '正常') }}
                        </span>
                        <span v-else class="text-xs text-gray-400">-</span>
                      </td>
                      <td class="whitespace-nowrap px-4 py-3 text-right text-sm font-medium">
                        <button
                          class="mr-3 text-blue-600 dark:text-blue-400 hover:underline"
                          @click="openEditModal(user)"
                        >
                          编辑
                        </button>
                        <button
                          v-if="user.card"
                          class="mr-3 hover:underline"
                          :class="user.card.enabled === false ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'"
                          @click="toggleUserStatus(user)"
                        >
                          {{ user.card.enabled === false ? '解封' : '封禁' }}
                        </button>
                        <button
                          v-if="user.username !== currentUsername"
                          class="text-red-600 dark:text-red-400 hover:underline"
                          @click="deleteUser(user)"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                    <tr v-if="filteredUsers.length === 0">
                      <td colspan="7" class="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                        {{ userSearchQuery ? '未找到匹配的用户' : '暂无用户' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- 2. 移动端：超紧凑高密度现代微卡片（体积缩减 45%，信息更充实） -->
            <div class="sm:hidden space-y-2">
              <div
                v-for="user in filteredUsers"
                :key="user.username"
                class="rounded-xl border border-white/60 bg-white/55 p-2.5 shadow-sm backdrop-blur-md dark:border-gray-700/60 dark:bg-gray-800/50"
              >
                <!-- 顶行：用户信息 + 挂机状态胶囊 + 账号状态 -->
                <div class="flex items-center justify-between gap-1.5 pb-1.5 border-b border-gray-100/70 dark:border-gray-700/50">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span class="h-2 w-2 rounded-full flex-none" :class="user.card?.enabled === false ? 'bg-red-500' : (isExpired(user.card) ? 'bg-amber-500' : 'bg-emerald-500')" />
                    <span class="font-bold text-gray-900 dark:text-white text-xs truncate max-w-[110px]">{{ user.username }}</span>
                    <span
                      class="rounded px-1.5 py-0.2 text-[10px] font-semibold flex-none"
                      :class="user.role === 'admin' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/60 dark:text-purple-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'"
                    >
                      {{ user.role === 'admin' ? '管理员' : '用户' }}
                    </span>
                  </div>

                  <div class="flex items-center gap-1.5 flex-none">
                    <!-- 核心新增：挂机数量（当前在线正常运行数） -->
                    <span
                      class="inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[11px] font-bold"
                      :class="(user.runningAccountsCount || 0) > 0 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'"
                      title="当前正常在线运行的农场挂机账号"
                    >
                      <span class="h-1.5 w-1.5 rounded-full" :class="(user.runningAccountsCount || 0) > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'" />
                      在线: {{ user.runningAccountsCount || 0 }}个
                    </span>

                    <span
                      v-if="user.card"
                      class="rounded-full px-1.5 py-0.2 text-[10px] font-semibold"
                      :class="user.card.enabled === false ? 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200' : (isExpired(user.card) ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/60 dark:text-yellow-200' : 'bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-200')"
                    >
                      {{ user.card.enabled === false ? '封禁' : (isExpired(user.card) ? '到期' : '正常') }}
                    </span>
                  </div>
                </div>

                <!-- 中间紧凑数据行：额度 / 注册时间 / 到期时间 -->
                <div class="flex items-center justify-between text-[11px] py-1.5 text-gray-600 dark:text-gray-300">
                  <div class="flex items-center gap-2.5">
                    <span>配额: <b class="text-gray-800 dark:text-white font-mono">{{ user.role === 'admin' ? '无限' : `${user.accountLimit || 2}个` }}</b></span>
                    <span>注册: <b class="text-gray-800 dark:text-white font-mono">{{ user.createdAt ? formatDate(user.createdAt) : '-' }}</b></span>
                  </div>
                  <div class="flex items-center gap-1">
                    <span class="text-gray-400">到期:</span>
                    <span class="font-mono" :class="isExpired(user.card) ? 'text-red-500 font-bold' : 'text-gray-700 dark:text-gray-300'">
                      <template v-if="user.role === 'admin' || user.card?.days === -1 || (!user.card?.expiresAt && user.card)">
                        <b class="text-purple-600 dark:text-purple-400 font-bold">永久</b>
                      </template>
                      <template v-else>
                        {{ formatDate(user.card?.expiresAt || null) }}
                      </template>
                    </span>
                  </div>
                </div>

                <!-- 底部极简紧凑操作按钮 -->
                <div class="flex items-center justify-end gap-1.5 pt-1.5 border-t border-gray-100/70 dark:border-gray-700/50">
                  <button
                    class="rounded border border-blue-200 bg-blue-50/60 px-2 py-0.5 text-[11px] font-medium text-blue-600 active:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"
                    @click="openEditModal(user)"
                  >
                    编辑
                  </button>
                  <button
                    v-if="user.card"
                    class="rounded border px-2 py-0.5 text-[11px] font-medium transition"
                    :class="user.card.enabled === false ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'"
                    @click="toggleUserStatus(user)"
                  >
                    {{ user.card.enabled === false ? '解封' : '封禁' }}
                  </button>
                  <button
                    v-if="user.username !== currentUsername"
                    class="rounded border border-red-200 bg-red-50/60 px-2 py-0.5 text-[11px] font-medium text-red-600 active:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                    @click="deleteUser(user)"
                  >
                    删除
                  </button>
                </div>
              </div>

              <div v-if="filteredUsers.length === 0" class="py-8 text-center text-xs text-gray-400">
                {{ userSearchQuery ? '未找到匹配的用户' : '暂无用户' }}
              </div>
            </div>
          </div>

    <!-- 编辑用户模态弹窗：Teleport 到 body，全屏居中，固定标题与操作栏，中间滚动 -->
    <Teleport to="body">
      <div
        v-if="showEditModal"
        class="fixed inset-0 z-[10050] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-md"
        @click.self="showEditModal = false"
      >
        <div class="max-w-md w-full max-h-[82vh] flex flex-col rounded-2xl bg-white shadow-2xl dark:bg-gray-800 border border-gray-100 dark:border-gray-700 overflow-hidden" @click.stop>
          <!-- 弹窗固定顶部标题与关闭按钮 -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
            <h2 class="text-base sm:text-lg text-gray-900 font-bold dark:text-white truncate">
              编辑用户：{{ selectedUser?.username }}
            </h2>
            <button
              class="h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 transition"
              @click="showEditModal = false"
            >
              <div class="i-carbon-close text-xl" />
            </button>
          </div>

          <!-- 弹窗内部滚动表单区 -->
          <div class="flex-1 overflow-y-auto p-5 space-y-3.5 custom-scrollbar">
            <div>
              <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                用户名
              </label>
              <BaseInput
                v-model="editForm.newUsername"
                placeholder="输入新用户名（留空则不修改）"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                用户名只能包含字母、数字和下划线，长度3-32位
              </p>
            </div>
            <div>
              <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                新密码
              </label>
              <BaseInput
                v-model="editForm.password"
                type="password"
                placeholder="输入新密码（留空则不修改）"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                密码长度至少6位，需包含大写字母、小写字母、数字、特殊符号中的至少两种
              </p>
            </div>
            <div>
              <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                账号额度
              </label>
              <BaseInput
                v-model.number="editForm.accountLimit"
                type="number"
                min="1"
                placeholder="可添加的农场账号数量"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                用户最多可添加的农场账号数量
              </p>
            </div>
            <div>
              <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                过期时间
              </label>
              <div class="flex items-center gap-3">
                <input
                  v-model="editForm.isPermanent"
                  type="checkbox"
                  class="border-gray-300 rounded text-blue-600 focus:ring-blue-500"
                >
                <span class="text-sm text-gray-600 dark:text-gray-400">永久有效</span>
              </div>
              <input
                v-if="!editForm.isPermanent"
                v-model="editForm.expiresAt"
                type="datetime-local"
                class="mt-2 w-full border border-gray-200 rounded-lg bg-white px-3 py-2 text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
            </div>
          </div>

          <!-- 弹窗固定底部操作栏（取消与保存按钮永远可见，绝不被截断） -->
          <div class="px-5 py-3.5 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3 bg-gray-50/50 dark:bg-gray-800/50 shrink-0">
            <BaseButton variant="secondary" size="sm" @click="showEditModal = false">
              取消
            </BaseButton>
            <BaseButton
              variant="primary"
              size="sm"
              :disabled="editLoading"
              @click="handleEdit"
            >
              {{ editLoading ? '保存中...' : '保存修改' }}
            </BaseButton>
          </div>
        </div>
      </div>
    </Teleport>

          <!-- 清理到期用户确认弹窗 -->
          <div
            v-if="showClearExpiredConfirm"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            @click.self="showClearExpiredConfirm = false"
          >
            <div class="max-w-md w-[95vw] rounded-lg bg-white p-5 dark:bg-gray-800 sm:w-full" @click.stop>
              <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                确认清理到期用户
              </h2>
              <p class="mb-4 text-gray-600 dark:text-gray-300">
                确定要清理所有到期的用户吗？此操作将删除所有已过期的普通用户账号，且不可恢复！
              </p>
              <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
                管理员账号不会被删除
              </p>
              <div class="flex justify-end space-x-3">
                <BaseButton variant="secondary" size="sm" @click="showClearExpiredConfirm = false">
                  取消
                </BaseButton>
                <BaseButton
                  variant="danger"
                  size="sm"
                  :loading="clearExpiredLoading"
                  @click="clearExpiredUsers"
                >
                  确认清理
                </BaseButton>
              </div>
            </div>
          </div>
        </div>

        <!-- 系统配置管理模块 (优雅子Tab分流模式) -->
        <div v-else-if="activeTab === 'system'" class="space-y-4">
          <!-- 顶部吸顶条：左侧标题与微副标，右侧全局统配保存 -->
          <div class="sticky top-0 z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-gray-200/80 rounded-2xl bg-white/90 p-4 shadow-sm backdrop-blur-md dark:border-gray-700/80 dark:bg-gray-800/90">
            <div>
              <h3 class="text-lg text-gray-900 font-extrabold dark:text-gray-100 flex items-center gap-2">
                <div class="i-carbon-settings-services text-emerald-500" />
                <span>系统配置中心</span>
              </h3>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                模块化独立配置与管理网关参数、模拟机型、发件邮箱和抓包代理。
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <BaseButton size="sm" variant="primary" :loading="anySystemSaving" @click="saveSystemSettings">
                <span class="i-carbon-save mr-1" />
                保存全部系统配置
              </BaseButton>
            </div>
          </div>

          <!-- 系统配置二级胶囊导航 -->
          <nav class="flex items-center gap-1.5 p-1 rounded-xl bg-gray-100/70 dark:bg-gray-800/60 backdrop-blur-sm overflow-x-auto shadow-inner">
            <button
              v-for="sub in systemSubTabs"
              :key="sub.key"
              type="button"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer"
              :class="systemSubTab === sub.key
                ? 'bg-white dark:bg-gray-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-white/40 dark:hover:bg-gray-700/40'"
              @click="systemSubTab = sub.key"
            >
              <div :class="sub.icon" class="text-sm" />
              <span>{{ sub.label }}</span>
            </button>
          </nav>

          <!-- Tab 1: 运行网关 (WebSocket地址、版本、平台) -->
          <div v-if="systemSubTab === 'gateway'" class="space-y-4">
            <AdminSystemPanel
              v-model:local-system-config="localSystemConfig"
              v-model:local-capture-config="localCaptureConfig"
              section="system"
              :show-heading="false"
              :show-save="false"
              :default-system-config="defaultSystemConfig"
              :platform-options="platformOptions"
              :os-options="osOptions"
              :system-config-saving="systemConfigSaving"
              :capture-config-saving="captureConfigSaving"
              :capture-config-testing="captureConfigTesting"
              @reset-system="handleResetSystemConfig"
              @test-capture="handleTestCaptureConfig"
            />
          </div>



          <!-- Tab 3: 全局发信邮箱 (SMTP 邮件推送中枢) -->
          <div v-else-if="systemSubTab === 'smtp'" class="space-y-4">
            <AdminSmtpConfigCard
              v-model:config="localOffline"
              :saving="offlineSaving"
              :testing="offlineTesting"
              @save="handleSaveOffline"
              @test="handleTestOffline"
            />
          </div>

          <!-- Tab 4: 抓包服务 (18000 MITM代理服务管理) -->
          <div v-else-if="systemSubTab === 'capture'" class="space-y-4">
            <AdminSystemPanel
              v-model:local-system-config="localSystemConfig"
              v-model:local-capture-config="localCaptureConfig"
              section="capture"
              :show-heading="false"
              :show-save="false"
              :default-system-config="defaultSystemConfig"
              :platform-options="platformOptions"
              :os-options="osOptions"
              :system-config-saving="systemConfigSaving"
              :capture-config-saving="captureConfigSaving"
              :capture-config-testing="captureConfigTesting"
              @test-capture="handleTestCaptureConfig"
            />
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="modalVisible"
      :title="modalConfig.title"
      :message="modalConfig.message"
      :type="modalConfig.type"
      :is-alert="modalConfig.isAlert"
      confirm-text="知道了"
      @confirm="modalVisible = false"
      @cancel="modalVisible = false"
    />
  </div>
</template>

<style scoped lang="postcss">
</style>
