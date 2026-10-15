<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/api'
import AdminSystemPanel from '@/components/admin/AdminSystemPanel.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import AccountFeatureSettings from '@/components/settings/AccountFeatureSettings.vue'
import AccountSettingsTab from '@/components/settings/AccountSettingsTab.vue'
import AutoCodeRefreshCard from '@/components/settings/AutoCodeRefreshCard.vue'
import DeviceProtocolCard from '@/components/settings/DeviceProtocolCard.vue'
import OfflineReminderCard from '@/components/settings/OfflineReminderCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountSettings } from '@/composables/settings/useAccountSettings'
import { useAutomationSettings } from '@/composables/settings/useAutomationSettings'
import { useStrategySettings } from '@/composables/settings/useStrategySettings'
import { useUserSettings } from '@/composables/settings/useUserSettings'
import { useAdminSystemConfig } from '@/composables/useAdminSystemConfig'
import { useSettingStore } from '@/stores/setting'

const settingStore = useSettingStore()
const route = useRoute()

type SettingsTabKey = 'account' | 'account-config' | 'notification'

const SETTINGS_TAB_KEYS: SettingsTabKey[] = ['account', 'account-config', 'notification']
const LEGACY_SETTINGS_TABS: Record<string, SettingsTabKey> = {
  'strategy': 'account-config',
  'automation': 'account-config',
  'default-plan': 'account-config',
  'daily': 'account-config',
  'daily-activity': 'account-config',
  'user': 'notification',
}

const tabs = [
  { key: 'account', label: '账号管理', icon: 'i-carbon-user-settings' },
  { key: 'account-config', label: '常规设置', icon: 'i-carbon-settings-adjust' },
  { key: 'notification', label: '通知设置', icon: 'i-carbon-notification' },
] as const

function getInitialSettingsTab(): SettingsTabKey {
  const requested = String(route.query.tab || '')
  if (LEGACY_SETTINGS_TABS[requested])
    return LEGACY_SETTINGS_TABS[requested]
  if (SETTINGS_TAB_KEYS.includes(requested as SettingsTabKey))
    return requested as SettingsTabKey
  const saved = localStorage.getItem('settings-active-tab')
  if (saved && LEGACY_SETTINGS_TABS[saved])
    return LEGACY_SETTINGS_TABS[saved]
  return SETTINGS_TAB_KEYS.includes(saved as SettingsTabKey)
    ? saved as SettingsTabKey
    : 'account'
}

const activeTab = ref<SettingsTabKey>(getInitialSettingsTab())
const settingsTabsNav = ref<HTMLElement | null>(null)
const isSystemSettingsPage = computed(() => route.name === 'SystemSettings')
const pageTitle = computed(() => isSystemSettingsPage.value ? '系统设置' : '账号设置')
const localAutoCodeRefresh = ref({ enabled: true, intervalMinutes: 2, maxRetries: 8 })
watch(() => route.name, () => {
  activeTab.value = getInitialSettingsTab()
})

async function scrollActiveTabIntoView() {
  await nextTick()
  const button = settingsTabsNav.value?.querySelector<HTMLElement>(`[data-settings-tab="${activeTab.value}"]`)
  button?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
}

watch(activeTab, (newTab) => {
  localStorage.setItem('settings-active-tab', newTab)
  void scrollActiveTabIntoView()
})

const modalVisible = ref(false)
const defaultPlanSettingId = ref('')
const defaultPlanApplyingId = ref('')
const applyingNotificationSettings = ref(false)
const notificationApplyConfirmationVisible = ref(false)
const defaultPlanConfirmation = ref<{
  action: 'set' | 'apply'
  account: any
} | null>(null)
const defaultPlanConfirmationVisible = computed(() => !!defaultPlanConfirmation.value)
const defaultPlanConfirmationTitle = computed(() =>
  defaultPlanConfirmation.value?.action === 'set' ? '设置默认方案' : '应用默认方案',
)
const defaultPlanConfirmationMessage = computed(() => {
  const pending = defaultPlanConfirmation.value
  if (!pending)
    return ''
  const accountName = pending.account?.name || pending.account?.id
  return pending.action === 'set'
    ? `确定将 ${accountName} 的当前配置设置为默认方案吗？这会覆盖此前保存的默认方案。`
    : `确定将默认方案应用到 ${accountName} 吗？这会覆盖该账号当前的相关配置。`
})
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
  offlineSaving,
  offlineTesting,
  deviceProtocolLoading,
  deviceProtocolSaving,
  deviceProtocolPresetOptions,
  selectedDevicePreset,
  deviceProtocolForm,
  localOffline,
  channelOptions,
  currentChannelDocUrl,
  openChannelDocs,
  fillRandomDeviceMac,
  fillRandomDeviceId,
  fillRandomImei,
  applyDevicePreset,
  fetchDeviceProtocol,
  syncLocalOfflineSettings,
  handleSaveOffline,
  handleTestOffline,
} = useUserSettings(showAlert)

const {
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
  openAddModal,
  openEditModal,
  handleDelete,
  confirmDelete,
  toggleAccount,
  refreshWxCodesNow,
  handleSaved,
  selectAccount,
} = useAccountSettings(showAlert)

const notificationApplyTargets = computed(() =>
  accounts.value.filter(account => String(account.id) !== String(currentAccountId.value)),
)
const notificationApplyConfirmationMessage = computed(() => {
  const count = notificationApplyTargets.value.length
  const deleteSeconds = Number(localOffline.value.offlineDeleteSec) || 0
  const deleteWarning = deleteSeconds > 0
    ? ` 当前配置还会在账号离线 ${deleteSeconds} 秒后删除账号。`
    : ''
  return `确定将当前账号的下线提醒设置复制到全部 ${count} 个其他账号吗？这会覆盖它们已有的通知渠道、各渠道凭据和消息内容。${deleteWarning}`
})

const {
  localAutomationSettings,
  autoCodeRefreshing,
  fertilizerLandTypeOptions,
  fertilizerOptions,
  syncLocalAutomationSettings,
  runAutoCodeRefreshNow,
} = useAutomationSettings({
  currentAccountId,
  showAlert,
})

const {
  settingsLoading,
  localStrategySettings,
  plantingStrategyOptions,
  bagFallbackStrategyOptions,
  strategyPreviewLabel,
  loadStrategyData,
  resetStrategyState,
} = useStrategySettings({
  currentAccountId,
  getAutomationSettings: () => localAutomationSettings.value,
  showAlert,
})

const accountSettingsSaving = ref(false)
const autoCodeRefreshSaving = ref(false)
const systemSettingsSaving = ref(false)
const anySystemSaving = computed(() => systemSettingsSaving.value || systemConfigSaving.value || captureConfigSaving.value || deviceProtocolSaving.value || autoCodeRefreshSaving.value)

function buildCurrentAccountConfig() {
  return {
    ...settingStore.settings,
    ...localStrategySettings.value,
    ...localAutomationSettings.value,
  }
}

async function saveCurrentAccountSettings(_module?: string, quiet = false) {
  if (!currentAccountId.value || accountSettingsSaving.value)
    return
  accountSettingsSaving.value = true
  try {
    const result = await settingStore.saveSettings(String(currentAccountId.value), buildCurrentAccountConfig())
    if (!result.ok)
      throw new Error(result.error || '保存失败')
    if (!quiet)
      showAlert('账号设置已保存')
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '账号设置保存失败', 'danger')
  }
  finally {
    accountSettingsSaving.value = false
  }
}

async function saveAutoCodeRefreshSettings() {
  if (autoCodeRefreshSaving.value)
    return
  autoCodeRefreshSaving.value = true
  try {
    localAutoCodeRefresh.value.intervalMinutes = Math.max(1, Math.min(1440, Math.round(Number(localAutoCodeRefresh.value.intervalMinutes) || 2)))
    localAutoCodeRefresh.value.maxRetries = Math.max(1, Math.min(100, Math.round(Number(localAutoCodeRefresh.value.maxRetries) || 8)))
    const result = await settingStore.saveAutoCodeRefresh(localAutoCodeRefresh.value)
    if (!result.ok)
      throw new Error(result.error || '保存失败')
    showAlert('微信定时刷新重登设置已保存')
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '刷新设置保存失败', 'danger')
  }
  finally {
    autoCodeRefreshSaving.value = false
  }
}

async function applyNotificationSettingsToOtherAccounts() {
  if (applyingNotificationSettings.value || !currentAccountId.value || notificationApplyTargets.value.length === 0)
    return

  const targets = [...notificationApplyTargets.value]
  applyingNotificationSettings.value = true
  const config = {
    ...JSON.parse(JSON.stringify(localOffline.value)),
    confirmed: true,
  }
  const failures: string[] = []
  try {
    for (const account of targets) {
      try {
        const { data } = await api.post('/api/settings/offline-reminder', config, {
          headers: { 'x-account-id': String(account.id) },
        })
        if (!data?.ok)
          failures.push(`${account.name || account.id}: ${data?.error || '保存失败'}`)
      }
      catch (error: any) {
        failures.push(`${account.name || account.id}: ${error.response?.data?.error || error.message || '保存失败'}`)
      }
    }

    if (failures.length > 0) {
      const appliedCount = targets.length - failures.length
      showAlert(
        `通知设置已应用到 ${appliedCount} 个账号，${failures.length} 个账号失败：${failures.join('；')}`,
        'danger',
      )
      return
    }
    showAlert(`已将当前账号的通知设置应用到 ${targets.length} 个其他账号`)
  }
  finally {
    applyingNotificationSettings.value = false
  }
}

async function loadAutoCodeRefreshSettings() {
  const result = await settingStore.fetchAutoCodeRefresh()
  if (!result.ok) {
    showAlert(`读取刷新设置失败: ${result.error || '未知错误'}`, 'danger')
    return
  }
  localAutoCodeRefresh.value = { ...settingStore.autoCodeRefresh }
}

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
    const [systemResult, captureResult, deviceResult] = await Promise.all([
      api.post('/api/admin/system-config', { ...localSystemConfig.value, confirmed: true }),
      api.post('/api/admin/capture-config', { ...localCaptureConfig.value, confirmed: true }),
      api.post('/api/user/device-protocol', devicePayload),
    ])
    if (!systemResult.data?.ok || !captureResult.data?.ok || !deviceResult.data?.ok)
      throw new Error('部分系统配置保存失败')
    await Promise.all([loadSystemConfig(), loadCaptureConfig(), fetchDeviceProtocol()])
    showAlert('系统配置已统一保存并生效')
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '系统配置保存失败', 'danger')
  }
  finally {
    systemSettingsSaving.value = false
  }
}

async function applyDefaultPlan(account: any) {
  if (!account?.id || defaultPlanSettingId.value || defaultPlanApplyingId.value)
    return
  const accountId = String(account.id)
  defaultPlanApplyingId.value = accountId
  try {
    const { data } = await api.post('/api/settings/default-plan/apply', {}, {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(data?.error || '应用失败')
    if (String(currentAccountId.value || '') === accountId) {
      settingStore.clearSettingsState()
      resetStrategyState()
      await loadStrategyData()
      syncLocalAutomationSettings()
    }
    showAlert(`已将默认方案应用到 ${account.name || account.id}`)
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '应用默认方案失败', 'danger')
  }
  finally {
    defaultPlanApplyingId.value = ''
  }
}

async function setDefaultPlan(account: any) {
  if (!account?.id || defaultPlanSettingId.value || defaultPlanApplyingId.value)
    return
  const accountId = String(account.id)
  defaultPlanSettingId.value = accountId
  try {
    const { data } = await api.post('/api/settings/default-plan/import', {}, {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(data?.error || '设置失败')
    showAlert(`已将 ${account.name || account.id} 的配置设置为默认方案`)
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '设置默认方案失败', 'danger')
  }
  finally {
    defaultPlanSettingId.value = ''
  }
}

function requestDefaultPlanConfirmation(action: 'set' | 'apply', account: any) {
  if (!account?.id || defaultPlanSettingId.value || defaultPlanApplyingId.value)
    return
  defaultPlanConfirmation.value = { action, account }
}

function requestCurrentAccountDefaultPlanConfirmation(action: 'set' | 'apply') {
  const account = accounts.value.find(item => String(item.id) === String(currentAccountId.value))
  if (!account) {
    showAlert('请先选择账号', 'danger')
    return
  }
  requestDefaultPlanConfirmation(action, account)
}

function closeDefaultPlanConfirmation() {
  defaultPlanConfirmation.value = null
}

function confirmDefaultPlanOperation() {
  const pending = defaultPlanConfirmation.value
  if (!pending)
    return
  closeDefaultPlanConfirmation()
  if (pending.action === 'set')
    void setDefaultPlan(pending.account)
  else
    void applyDefaultPlan(pending.account)
}

watch(currentAccountId, async () => {
  settingStore.clearSettingsState()
  resetStrategyState()
  if (currentAccountId.value) {
    await loadStrategyData()
    syncLocalAutomationSettings()
    syncLocalOfflineSettings()
  }
})

onMounted(async () => {
  await Promise.all([loadSystemConfig(), loadCaptureConfig(), loadAutoCodeRefreshSettings()])
  await fetchAccounts()
  await fetchDeviceProtocol()
  selectFirstAccountIfNeeded()
  if (currentAccountId.value) {
    await loadStrategyData()
    syncLocalAutomationSettings()
    syncLocalOfflineSettings()
  }
  await scrollActiveTabIntoView()
})
</script>

<template>
  <div class="settings-page">
    <div class="mb-4">
      <h1 class="text-2xl text-gray-900 font-bold dark:text-gray-100">
        {{ pageTitle }}
      </h1>
    </div>

    <div class="border border-gray-200 rounded-lg bg-white shadow dark:border-gray-700 dark:bg-gray-800">
      <div v-if="!isSystemSettingsPage" class="border-b border-gray-200 dark:border-gray-700">
        <nav ref="settingsTabsNav" class="flex gap-1 overflow-x-auto p-2">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :data-settings-tab="tab.key"
            class="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all"
            :class="activeTab === tab.key
              ? 'text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'"
            :style="activeTab === tab.key ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="activeTab = tab.key"
          >
            <div :class="tab.icon" />
            {{ tab.label }}
          </button>
        </nav>
      </div>

      <div class="p-4">
        <!-- 账号管理 -->
        <AccountSettingsTab
          v-if="!isSystemSettingsPage && activeTab === 'account'"
          :accounts="accounts"
          :accounts-loading="accountsLoading"
          :current-account-id="currentAccountId"
          :user-is-admin="userIsAdmin"
          :is-add-account-disabled="isAddAccountDisabled"
          :add-account-disabled-reason="addAccountDisabledReason"
          :is-account-ops-disabled="isAccountOpsDisabled"
          :show-modal="showModal"
          :editing-account="editingAccount"
          :show-delete-confirm="showDeleteConfirm"
          :delete-loading="deleteLoading"
          :account-to-delete="accountToDelete"
          :refresh-wx-codes-loading="refreshWxCodesLoading"
          @add="openAddModal"
          @refresh-wx-codes="refreshWxCodesNow"
          @select="selectAccount"
          @toggle="toggleAccount"
          @edit="openEditModal"
          @delete="handleDelete"
          @saved="handleSaved"
          @close-modal="showModal = false"
          @close-delete-confirm="showDeleteConfirm = false"
          @confirm-delete="confirmDelete"
        />

        <div v-else-if="!isSystemSettingsPage && activeTab === 'account-config'" class="space-y-4">
          <div class="flex flex-wrap justify-end gap-2">
            <BaseButton
              variant="secondary"
              size="sm"
              :loading="defaultPlanSettingId === String(currentAccountId)"
              :disabled="!currentAccountId || !!defaultPlanSettingId || !!defaultPlanApplyingId"
              @click="requestCurrentAccountDefaultPlanConfirmation('set')"
            >
              设置默认方案
            </BaseButton>
            <BaseButton
              variant="secondary"
              size="sm"
              :loading="defaultPlanApplyingId === String(currentAccountId)"
              :disabled="!currentAccountId || !!defaultPlanSettingId || !!defaultPlanApplyingId"
              @click="requestCurrentAccountDefaultPlanConfirmation('apply')"
            >
              应用默认方案
            </BaseButton>
          </div>
          <AccountFeatureSettings
            v-model:strategy="localStrategySettings"
            v-model:automation="localAutomationSettings"
            :current-account-name="currentAccountName"
            :current-account-id="currentAccountId"
            :loading="settingsLoading"
            :saving="accountSettingsSaving"
            :planting-strategy-options="plantingStrategyOptions"
            :bag-fallback-strategy-options="bagFallbackStrategyOptions"
            :strategy-preview-label="strategyPreviewLabel"
            :fertilizer-land-type-options="fertilizerLandTypeOptions"
            :fertilizer-options="fertilizerOptions"
            @save="saveCurrentAccountSettings"
          />
        </div>

        <div v-else-if="!isSystemSettingsPage && activeTab === 'notification'" class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap gap-2">
              <BaseButton
                size="sm"
                variant="secondary"
                :loading="applyingNotificationSettings"
                :disabled="offlineSaving || offlineTesting || !currentAccountId || notificationApplyTargets.length === 0"
                @click="notificationApplyConfirmationVisible = true"
              >
                一键应用当前账号设置
              </BaseButton>
              <BaseButton size="sm" :loading="offlineSaving" :disabled="offlineTesting || applyingNotificationSettings || !currentAccountId" @click="handleSaveOffline">
                保存通知设置
              </BaseButton>
            </div>
          </div>
          <OfflineReminderCard
            v-model:config="localOffline"
            :channel-options="channelOptions"
            :current-channel-doc-url="currentChannelDocUrl"
            :saving="offlineSaving"
            :testing="offlineTesting"
            :disabled="!currentAccountId"
            :show-save="false"
            @open-docs="openChannelDocs"
            @test="handleTestOffline"
          />
        </div>

        <div v-else-if="isSystemSettingsPage" class="space-y-5">
          <div class="sticky top-0 z-10 flex items-center justify-between border border-gray-200 rounded-xl bg-white/95 p-4 shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-800/95">
            <BaseButton size="sm" :loading="anySystemSaving" @click="saveSystemSettings">
              保存系统配置
            </BaseButton>
          </div>

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

          <DeviceProtocolCard
            v-model:form="deviceProtocolForm"
            v-model:selected-preset="selectedDevicePreset"
            :loading="deviceProtocolLoading"
            :saving="deviceProtocolSaving"
            :preset-options="deviceProtocolPresetOptions"
            :show-save="false"
            @apply-preset="applyDevicePreset"
            @random-mac="fillRandomDeviceMac"
            @random-device-id="fillRandomDeviceId"
            @random-imei="fillRandomImei"
          />

          <AutoCodeRefreshCard
            v-model:config="localAutoCodeRefresh"
            :current-account-id="currentAccountId"
            :loading="settingStore.autoCodeRefreshLoading"
            :saving="autoCodeRefreshSaving"
            :refreshing="autoCodeRefreshing"
            @save="saveAutoCodeRefreshSettings"
            @refresh="runAutoCodeRefreshNow"
          />

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

    <ConfirmModal
      :show="defaultPlanConfirmationVisible"
      :title="defaultPlanConfirmationTitle"
      :message="defaultPlanConfirmationMessage"
      type="danger"
      confirm-text="确认执行"
      @confirm="confirmDefaultPlanOperation"
      @close="closeDefaultPlanConfirmation"
      @cancel="closeDefaultPlanConfirmation"
    />

    <ConfirmModal
      :show="notificationApplyConfirmationVisible"
      title="应用通知设置到其他账号"
      :message="notificationApplyConfirmationMessage"
      type="danger"
      confirm-text="确认应用"
      @confirm="notificationApplyConfirmationVisible = false; void applyNotificationSettingsToOtherAccounts()"
      @close="notificationApplyConfirmationVisible = false"
      @cancel="notificationApplyConfirmationVisible = false"
    />

    <ConfirmModal
      :show="modalVisible"
      :title="modalConfig.title"
      :message="modalConfig.message"
      :type="modalConfig.type"
      :is-alert="modalConfig.isAlert"
      confirm-text="知道了"
      @confirm="modalVisible = false"
      @close="modalVisible = false"
      @cancel="modalVisible = false"
    />
  </div>
</template>
