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
import UserEmailNotificationCard from '@/components/settings/UserEmailNotificationCard.vue'
import AdminSmtpConfigCard from '@/components/admin/AdminSmtpConfigCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountSettings } from '@/composables/settings/useAccountSettings'
import { useAutomationSettings } from '@/composables/settings/useAutomationSettings'
import { useStrategySettings } from '@/composables/settings/useStrategySettings'
import { useUserSettings } from '@/composables/settings/useUserSettings'
import { useAdminSystemConfig } from '@/composables/useAdminSystemConfig'
import { useSettingStore } from '@/stores/setting'
import { useStatusStore } from '@/stores/status'
import { useUserStore } from '@/stores/user'

const settingStore = useSettingStore()
const statusStore = useStatusStore()
const userStore = useUserStore()
const route = useRoute()

type SettingsTabKey = 'account' | 'account-config' | 'notification' | 'system'

const SETTINGS_TAB_KEYS: SettingsTabKey[] = ['account', 'account-config', 'notification', 'system']
const LEGACY_SETTINGS_TABS: Record<string, SettingsTabKey> = {
  'strategy': 'account-config',
  'automation': 'account-config',
  'default-plan': 'account-config',
  'user': 'notification',
  'capture': 'system',
}

function getInitialSettingsTab(): SettingsTabKey {
  const requested = String(route.query.tab || '')
  let target: SettingsTabKey = 'account'
  if (LEGACY_SETTINGS_TABS[requested])
    target = LEGACY_SETTINGS_TABS[requested]
  else if (SETTINGS_TAB_KEYS.includes(requested as SettingsTabKey))
    target = requested as SettingsTabKey
  else {
    const saved = localStorage.getItem('settings-active-tab')
    if (saved && LEGACY_SETTINGS_TABS[saved])
      target = LEGACY_SETTINGS_TABS[saved]
    else if (SETTINGS_TAB_KEYS.includes(saved as SettingsTabKey))
      target = saved as SettingsTabKey
  }
  if (target === 'system')
    return 'account'
  return target
}

const activeTab = ref<SettingsTabKey>(getInitialSettingsTab())
const settingsTabsNav = ref<HTMLElement | null>(null)

async function scrollActiveTabIntoView() {
  await nextTick()
  const button = settingsTabsNav.value?.querySelector<HTMLElement>(`[data-settings-tab="${activeTab.value}"]`)
  button?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
}

watch(activeTab, (newTab) => {
  if (newTab === 'system') {
    activeTab.value = 'account'
    return
  }
  localStorage.setItem('settings-active-tab', newTab)
  void scrollActiveTabIntoView()
})

/* const tabs = computed(() => [
  { key: 'account' as SettingsTabKey, label: '账号管理', icon: 'i-carbon-user-settings' },
  { key: 'account-config' as SettingsTabKey, label: '账号设置', icon: 'i-carbon-settings-adjust' },
  { key: 'notification' as SettingsTabKey, label: '通知设置', icon: 'i-carbon-notification' },
]) */

const showDrawerModal = ref(false)
const drawerActiveTab = ref<'account-config' | 'notification'>('account-config')

function openDrawer(tab: 'account-config' | 'notification', account?: any) {
  if (account) selectAccount(account)
  drawerActiveTab.value = tab
  showDrawerModal.value = true
}

function closeDrawer() {
  showDrawerModal.value = false
}

const modalVisible = ref(false)
const defaultPlanSettingId = ref('')
const defaultPlanApplyingId = ref('')
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
  showClearStoppedConfirm,
  clearStoppedLoading,
  refreshWxCodesLoading,
  stoppedAccountsCount,
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
  openClearStoppedConfirm,
  confirmClearStopped,
} = useAccountSettings(showAlert)

const {
  localAutomationSettings,
  localAutoCodeRefresh,
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

const isCurrentAccountWx = computed(() => {
  const acc = (accounts.value || []).find((a: any) => String(a.id) === String(currentAccountId.value || ''))
  return (acc?.platform || '').toLowerCase() === 'wx'
})

async function onAutoCodeRefreshToggle(val: boolean) {
  localAutoCodeRefresh.value.enabled = val
  await saveAutoCodeRefreshSettings()
}

const accountSettingsSaving = ref(false)
const autoCodeRefreshSaving = ref(false)
const systemSettingsSaving = ref(false)
const anySystemSaving = computed(() => systemSettingsSaving.value || systemConfigSaving.value || captureConfigSaving.value || deviceProtocolSaving.value)

function buildCurrentAccountConfig() {
  return {
    ...settingStore.settings,
    ...localStrategySettings.value,
    ...localAutomationSettings.value,
    autoCodeRefresh: localAutoCodeRefresh.value,
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
  if (!currentAccountId.value || autoCodeRefreshSaving.value)
    return
  autoCodeRefreshSaving.value = true
  try {
    const result = await settingStore.saveAutoCodeRefresh(String(currentAccountId.value), localAutoCodeRefresh.value)
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

function openAccountSettings(account: any) {
  if (account) {
    selectAccount(account)
    resetStrategyState()
  }
  openDrawer('account-config', account)
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
  statusStore.clearAccountScopedData()
  const farmStore = (await import('@/stores/farm')).useFarmStore()
  farmStore.clearFarmData()
  if (currentAccountId.value) {
    statusStore.fetchStatus(String(currentAccountId.value))
    statusStore.fetchDailyGifts(String(currentAccountId.value))
    await loadStrategyData()
    syncLocalAutomationSettings()
    syncLocalOfflineSettings()
  }
})

onMounted(async () => {
  if (userStore.isAdmin) {
    await Promise.all([loadSystemConfig(), loadCaptureConfig()])
  }
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


    <div class="liquid-card relative overflow-hidden rounded-2xl p-4 sm:p-5 shadow-sm">
      <div>
        <!-- 账号管理 -->
        <AccountSettingsTab
          v-if="activeTab === 'account'"
          :accounts="accounts"
          :accounts-loading="accountsLoading"
          :current-account-id="currentAccountId"
          :user-is-admin="userIsAdmin"
          :stopped-accounts-count="stoppedAccountsCount"
          :is-add-account-disabled="isAddAccountDisabled"
          :add-account-disabled-reason="addAccountDisabledReason"
          :is-account-ops-disabled="isAccountOpsDisabled"
          :show-modal="showModal"
          :editing-account="editingAccount"
          :show-delete-confirm="showDeleteConfirm"
          :delete-loading="deleteLoading"
          :account-to-delete="accountToDelete"
          :show-clear-stopped-confirm="showClearStoppedConfirm"
          :clear-stopped-loading="clearStoppedLoading"
          :refresh-wx-codes-loading="refreshWxCodesLoading"
          :default-plan-setting-id="defaultPlanSettingId"
          :default-plan-applying-id="defaultPlanApplyingId"
          @add="openAddModal"
          @clear-stopped="openClearStoppedConfirm"
          @refresh-wx-codes="refreshWxCodesNow"
          @select="selectAccount"
          @toggle="toggleAccount"
          @settings="openAccountSettings"
          @notification="openDrawer('notification', $event)"
          @set-default-plan="requestDefaultPlanConfirmation('set', $event)"
          @apply-default-plan="requestDefaultPlanConfirmation('apply', $event)"
          @edit="openEditModal"
          @delete="handleDelete"
          @saved="(id) => handleSaved(id)"
          @close-modal="showModal = false"
          @close-delete-confirm="showDeleteConfirm = false"
          @confirm-delete="confirmDelete"
          @close-clear-stopped-confirm="showClearStoppedConfirm = false"
          @confirm-clear-stopped="confirmClearStopped"
        />

        <AccountFeatureSettings
          v-else-if="activeTab === 'account-config'"
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

        <div v-else-if="activeTab === 'notification'" class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
                通知设置
              </h3>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                配置账号离线后的通知渠道和消息内容。
              </p>
            </div>
            <BaseButton size="sm" :loading="offlineSaving" :disabled="offlineTesting" @click="handleSaveOffline">
              保存通知设置
            </BaseButton>
          </div>
          <OfflineReminderCard
            v-model:config="localOffline"
            :channel-options="channelOptions"
            :current-channel-doc-url="currentChannelDocUrl"
            :saving="offlineSaving"
            :testing="offlineTesting"
            :show-save="false"
            @open-docs="openChannelDocs"
            @test="handleTestOffline"
          />
        </div>

        <div v-else-if="activeTab === 'system'" class="space-y-5">
          <div class="sticky top-0 z-10 flex items-center justify-between border border-gray-200 rounded-xl bg-white/95 p-4 shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-800/95">
            <div>
              <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
                系统配置
              </h3>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                统一管理连接参数、设备协议和抓包服务。
              </p>
            </div>
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
            :current-account-name="currentAccountName"
            :current-account-id="currentAccountId"
            :loading="settingsLoading"
            :saving="autoCodeRefreshSaving"
            :refreshing="autoCodeRefreshing"
            @save="saveAutoCodeRefreshSettings"
            @refresh="runAutoCodeRefreshNow"
          />

          <!-- 管理员全局发信邮箱 (SMTP) 配置卡片 -->
          <AdminSmtpConfigCard
            v-model:config="localOffline"
            :saving="offlineSaving"
            :testing="offlineTesting"
            @save="handleSaveOffline"
            @test="handleTestOffline"
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

  </div>

    <!-- 液态玻璃配置浮层 (含账号设置与通知设置，右上角有关闭按钮) -->
    <Teleport to="body">
      <!-- 保证 ConfirmModal 在同一个 Teleport 并且在最高层级渲染 -->
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
      <div v-if="showDrawerModal" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-3 sm:p-5 backdrop-blur-sm" @click.self="closeDrawer">
        <div class="max-h-[88vh] max-w-2xl w-full flex flex-col overflow-hidden rounded-2xl shadow-2xl border border-white/70 dark:border-white/10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl animate-scale-in">
          <!-- 浮层头部 (单一标题 + 右上角关闭按钮) -->
          <div class="flex items-center justify-between border-b border-gray-100/80 px-4 py-3 sm:px-5 dark:border-gray-800">
            <div class="flex items-center gap-2.5">
              <div
                class="h-8 w-8 flex items-center justify-center rounded-xl text-base shadow-sm"
                :class="drawerActiveTab === 'account-config' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400'"
              >
                <div :class="drawerActiveTab === 'account-config' ? 'i-carbon-settings' : 'i-carbon-notification'" />
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h3 class="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100">
                    {{ drawerActiveTab === 'account-config' ? '账号功能配置' : '掉线通知配置' }}
                  </h3>
                  <!-- 微信账号专属：自动刷新code 灰色小字 + 胶囊开关 -->
                  <div
                    v-if="drawerActiveTab === 'account-config' && isCurrentAccountWx"
                    class="inline-flex items-center gap-1.5 ml-1 sm:ml-2 px-2 py-0.5 rounded-full bg-gray-100/80 dark:bg-gray-800/80 border border-gray-200/50 dark:border-gray-700/50 shadow-inner"
                    title="开启后按设定间隔自动获取新 Code 并重启账号，保障长期运行不掉线"
                  >
                    <span class="text-[11px] text-gray-400 font-medium select-none">自动刷新code</span>
                    <input
                      type="checkbox"
                      :checked="localAutoCodeRefresh.enabled"
                      :disabled="autoCodeRefreshSaving"
                      class="relative h-4 w-7 rounded-full bg-gray-300 dark:bg-gray-600 appearance-none cursor-pointer transition-colors duration-200 ease-in-out focus:outline-none checked:bg-emerald-500 checked:hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:h-3 after:w-3 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 checked:after:translate-x-3"
                      @change="onAutoCodeRefreshToggle(($event.target as HTMLInputElement).checked)"
                    />
                  </div>
                </div>
                <p v-if="currentAccountName" class="text-[11px] text-gray-400">
                  正在配置：{{ currentAccountName }}
                </p>
              </div>
            </div>
            <!-- 右上角关闭按钮 -->
            <button
              class="h-8 w-8 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="关闭"
              @click="closeDrawer"
            >
              <div class="i-carbon-close text-xl" />
            </button>
          </div>

          <!-- 浮层内容滚动区 -->
          <div class="flex-1 overflow-y-auto p-4 sm:p-5">
            <AccountFeatureSettings
              v-if="drawerActiveTab === 'account-config'"
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

            <div v-else-if="drawerActiveTab === 'notification'" class="space-y-4">
              <UserEmailNotificationCard
                v-model:config="localOffline"
                :current-account-name="currentAccountName"
                :saving="offlineSaving"
                :testing="offlineTesting"
                @save="handleSaveOffline"
                @test="handleTestOffline"
              />
            </div>
          </div>
        </div>
      </div>
    </Teleport>

</template>


<style scoped>
.liquid-card {
  background: var(--liquid-glass-bg);
  backdrop-filter: var(--liquid-glass-blur);
  -webkit-backdrop-filter: var(--liquid-glass-blur);
  border: 1px solid var(--liquid-glass-border);
  box-shadow: var(--liquid-glass-shadow);
}
</style>
