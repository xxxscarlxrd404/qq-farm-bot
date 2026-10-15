<script setup lang="ts">
import { useEventListener, useIntervalFn } from '@vueuse/core'
import { computed, reactive, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import { useWxLoginStore } from '@/stores/wx-login'
import { parseManualLoginInput } from '@/utils/gateway-url'

const props = defineProps<{
  show: boolean
  editData?: any
}>()

const emit = defineEmits<{(e: 'close'): void; (e: 'saved', targetId?: string): void}>()

const CODE_QUERY_RE = /[?&]code=([^&]+)/i
const QR_AUTO_REFRESH_MS = 110_000
const QQ_QR_AUTO_REFRESH_MS = 100_000
const CAPTURE_SUCCESS_STORAGE_KEY = 'capture_login_succeeded'

const wxLoginStore = useWxLoginStore()

interface CaptureFlowState {
  id: string
  platform: 'qq' | 'wx'
  codeCaptured: boolean
  accountGid: string
  friendCount: number
  captureStatus: string
  proxy: {
    running: boolean
    status: string
    error: string
  }
  publicInfo: {
    host: string
    addresses: { address: string, kind: string }[]
    mitmPort: number
    remainingSec: number
    certificateUrl: string
  }
}

const activeTab = ref<'wx' | 'qq' | 'capture' | 'manual'>('manual')
const loading = ref(false)
const wxChecking = ref(false)
const errorMessage = ref('')
const wxAccountName = ref('')
const qqEnabled = ref(false)
const wxEnabled = ref(true)
const qqAccountName = ref('')
const qqTaskId = ref('')
const qqQrImage = ref('')
const qqStatus = ref('点击获取二维码')
const qqError = ref('')
const qqLoading = ref(false)
const qqExtracting = ref(false)
const qqQrCreatedAt = ref(0)
const captureEnabled = ref(false)
const captureLoading = ref(false)
const captureChecking = ref(false)
const captureCompleting = ref(false)
const captureError = ref('')
const captureCopiedField = ref<'host' | 'port' | ''>('')
const captureAccountName = ref('')
const capturePlatform = ref<'qq' | 'wx'>('qq')
const showCaptureHelp = ref(false)
const captureHelpMode = ref<'first' | 'daily'>('first')
const captureHelpDevice = ref<'ios' | 'android'>('ios')
const captureFlow = ref<CaptureFlowState | null>(null)

const form = reactive({
  name: '',
  code: '',
  platform: 'qq' as 'qq' | 'wx',
})

const captureHelpSteps = computed(() => captureHelpMode.value === 'first'
  ? [
      '点击开始抓取，获取本次代理地址和端口',
      '打开 CA 证书，并在手机系统中安装和信任',
      '连续添加时，先切换到目标 QQ 并彻底关闭上一个农场',
      '将手机 Wi-Fi 代理设置为页面显示的地址和端口',
      '彻底关闭后重新打开对应的 QQ 或微信农场',
      'Code 获取后账号会立即添加；QQ 好友 GID 将在后台继续同步',
      'QQ 农场保持打开，完整好友列表同步后会立即释放代理，最迟约 15 秒',
    ]
  : [
      '点击开始抓取，确认本次代理地址和端口',
      '连续添加时，先切换到目标 QQ 并彻底关闭上一个农场',
      '将手机 Wi-Fi 代理更新为本次显示的地址和端口',
      '重新打开对应农场，并保持页面打开',
      '账号添加后，QQ 农场继续保持打开，最迟约 15 秒完成后台同步',
      '后台同步结束后，将手机 Wi-Fi 代理改回关闭',
    ])

const captureDeviceSteps = computed(() => captureHelpDevice.value === 'ios'
  ? [
      '在 Safari 中点击“打开证书”并允许下载描述文件',
      '进入“设置 → 通用 → VPN 与设备管理”安装描述文件',
      '进入“设置 → 通用 → 关于本机 → 证书信任设置”启用完全信任',
    ]
  : [
      '点击“打开证书”下载 CA 文件',
      '进入系统安全设置中的“安装证书”或“凭据存储”',
      '选择 CA 证书并确认安装；不同品牌的菜单名称可能不同',
    ])

const captureCurrentStep = computed(() => {
  if (!captureFlow.value)
    return '开始新的抓取任务'
  if (!captureFlow.value.codeCaptured)
    return `设置 Wi-Fi 代理并打开${captureFlow.value.platform === 'qq' ? ' QQ' : '微信'}农场`
  return '已获取 Code，正在立即完成账号操作'
})

const captureNextStep = computed(() => {
  if (!captureFlow.value)
    return '开始后按本次显示的代理信息设置手机 Wi-Fi'
  if (!captureFlow.value.codeCaptured)
    return '重新打开小程序，并保持农场页面打开'
  if (captureFlow.value.platform === 'qq')
    return `即将自动${props.editData ? '更新' : '添加'}账号，好友 GID 将在后台同步`
  return `即将自动${props.editData ? '更新' : '添加'}账号`
})

const { pause: stopWxCheck, resume: startWxCheck } = useIntervalFn(pollWxLogin, 2000, { immediate: false })

async function pollWxLogin(refreshExpired = true) {
  if (!props.show || document.hidden || activeTab.value !== 'wx' || wxLoginStore.isLoading || wxChecking.value)
    return
  if (refreshExpired && shouldRefreshWxQr()) {
    await loadWxQRCode()
    return
  }
  if (wxLoginStore.status !== 'qr_ready' && wxLoginStore.status !== 'confirming')
    return

  wxChecking.value = true
  try {
    const result = await wxLoginStore.checkLogin()
    if (result.success && result.wxid) {
      stopWxCheck()
      const codeResult = await wxLoginStore.getFarmCode(result.wxid)
      if (codeResult.success && codeResult.code) {
        const name = wxAccountName.value.trim() || result.nickname || `微信账号${Date.now()}`
        await addAccount({
          id: props.editData?.id,
          name: props.editData ? (props.editData.name || name) : name,
          code: codeResult.code,
          platform: 'wx',
          loginType: 'wx_qr',
          wxid: result.wxid,
          avatar: result.avatar,
          wxSessionId: wxLoginStore.uuid,
        })
      }
    }
  }
  finally {
    wxChecking.value = false
  }
}

useEventListener(document, 'visibilitychange', () => {
  // 先检查原二维码，避免切回时丢弃已在微信确认的登录。
  if (!document.hidden)
    void pollWxLogin(false)
})

const { pause: stopCaptureCheck, resume: startCaptureCheck } = useIntervalFn(async () => {
  if (activeTab.value !== 'capture' || !captureFlow.value || captureCompleting.value || captureChecking.value)
    return
  captureChecking.value = true
  try {
    const { data } = await api.get(`/api/capture/sessions/${captureFlow.value.id}`, { timeout: 20000 })
    if (!data?.ok || !data.data)
      return
    captureFlow.value = data.data
    captureError.value = data.data.proxy?.error || ''
    if (data.data.codeCaptured)
      await completeCaptureAccount()
  }
  catch (e: any) {
    captureError.value = e.response?.data?.error || e.message || '查询抓取状态失败'
  }
  finally {
    captureChecking.value = false
  }
}, 1500, { immediate: false })

const { pause: stopQqCheck, resume: startQqCheck } = useIntervalFn(async () => {
  if (activeTab.value !== 'qq' || !qqTaskId.value || qqLoading.value)
    return
  if (qqQrCreatedAt.value && Date.now() - qqQrCreatedAt.value >= QQ_QR_AUTO_REFRESH_MS) {
    await startQqLogin()
    return
  }
  try {
    const { data } = await api.post(`/api/napcat-login/tasks/${qqTaskId.value}/status`, undefined, { timeout: 20000, skipErrorToast: true } as any)
    if (!data?.ok)
      throw new Error(data?.error || '查询扫码状态失败')
    qqStatus.value = data.data.status === 'scanned' ? '已扫码，请在 QQ 中确认' : '请使用 QQ 扫码登录'
    if (data.data.status === 'confirmed') {
      stopQqCheck()
      qqLoading.value = true
      qqStatus.value = '正在获取农场 Code 并清理 QQ 会话…'
      const result = await api.post(`/api/napcat-login/tasks/${qqTaskId.value}/code`, undefined, { timeout: 120000, skipErrorToast: true } as any)
      if (!result.data?.ok || !result.data.data?.code)
        throw new Error(result.data?.error || '获取农场 Code 失败')
      qqTaskId.value = ''
      await addAccount({ id: props.editData?.id, name: props.editData?.name || qqAccountName.value.trim() || result.data.data.nickname || `QQ账号${result.data.data.uin || Date.now()}`, code: result.data.data.code, platform: 'qq', loginType: 'qq_napcat', qq: result.data.data.uin || '', uin: result.data.data.uin || '', startAfterSave: true })
    }
  }
  catch (e: any) {
    stopQqCheck()
    qqError.value = e.response?.data?.error || e.message || 'QQ 扫码登录失败'
  }
  finally { qqLoading.value = false }
}, 1500, { immediate: false })

async function loadQqCapability() {
  try {
    const { data } = await api.get('/api/napcat-login/capability')
    qqEnabled.value = data?.ok && data.data?.enabled === true
  }
  catch { qqEnabled.value = false }
}

async function cancelQqTask() {
  stopQqCheck()
  const id = qqTaskId.value
  qqTaskId.value = ''
  qqQrImage.value = ''
  qqQrCreatedAt.value = 0
  if (id) {
    try {
      await api.post(`/api/napcat-login/tasks/${id}/cancel`, undefined, { timeout: 30000, skipErrorToast: true } as any)
    }
    catch {}
  }
}

async function startQqLogin(forceRefresh = Boolean(qqQrImage.value)) {
  if (qqLoading.value)
    return
  qqLoading.value = true
  qqError.value = ''
  await cancelQqTask()
  try {
    const { data } = await api.post('/api/napcat-login/tasks', { refresh: forceRefresh }, { timeout: 30000, skipErrorToast: true } as any)
    if (!data?.ok || !data.data?.taskId)
      throw new Error(data?.error || '获取 QQ 二维码失败')
    qqTaskId.value = data.data.taskId
    qqQrImage.value = data.data.qrImage
    qqQrCreatedAt.value = Date.now()
    qqStatus.value = '请使用 QQ 扫码并确认登录'
    startQqCheck()
  }
  catch (e: any) { qqError.value = e.response?.data?.error || e.message || '获取 QQ 二维码失败' }
  finally { qqLoading.value = false }
}

async function loadCaptureConfig() {
  try {
    const { data } = await api.get('/api/capture/config')
    captureEnabled.value = data?.ok && data.data?.enabled === true
    wxEnabled.value = data?.ok ? data.data?.wxQrEnabled !== false : true
    if (!captureEnabled.value && activeTab.value === 'capture')
      activeTab.value = 'manual'
    if (!wxEnabled.value && activeTab.value === 'wx')
      activeTab.value = 'manual'
  }
  catch {
    captureEnabled.value = false
    wxEnabled.value = true
    if (activeTab.value === 'capture')
      activeTab.value = 'manual'
  }
}

async function cancelCaptureSession() {
  stopCaptureCheck()
  const flowId = captureFlow.value?.id
  captureFlow.value = null
  if (flowId) {
    try {
      await api.delete(`/api/capture/sessions/${flowId}`)
    }
    catch {}
  }
}

async function startCaptureSession() {
  captureLoading.value = true
  captureError.value = ''
  await cancelCaptureSession()
  try {
    const { data } = await api.post('/api/capture/sessions', {
      platform: capturePlatform.value,
      accountId: props.editData?.id || '',
    }, { timeout: 35000 })
    if (!data?.ok || !data.data)
      throw new Error(data?.error || '启动抓取失败')
    captureFlow.value = data.data
    startCaptureCheck()
  }
  catch (e: any) {
    captureError.value = e.response?.data?.error || e.message || '启动抓取失败'
  }
  finally {
    captureLoading.value = false
  }
}

async function completeCaptureAccount() {
  if (!captureFlow.value || captureCompleting.value)
    return
  captureCompleting.value = true
  captureError.value = ''
  try {
    const { data } = await api.post(`/api/capture/sessions/${captureFlow.value.id}/complete`, {
      name: captureAccountName.value.trim(),
    }, { timeout: 35000 })
    if (!data?.ok)
      throw new Error(data?.error || (props.editData ? '更新账号失败' : '添加账号失败'))
    localStorage.setItem(CAPTURE_SUCCESS_STORAGE_KEY, '1')
    stopCaptureCheck()
    const capTargetId = String(props.editData?.id || data?.data?.accountId || data?.targetAccountId || '')
    captureFlow.value = null
    emit('saved', capTargetId)
    close()
  }
  catch (e: any) {
    if (e.response?.data?.code === 'DUPLICATE_CAPTURE_ACCOUNT') {
      stopCaptureCheck()
      captureFlow.value = null
    }
    captureError.value = e.response?.data?.error || e.message || (props.editData ? '更新账号失败' : '添加账号失败')
  }
  finally {
    captureCompleting.value = false
  }
}

function openCaptureHelp() {
  captureHelpMode.value = localStorage.getItem(CAPTURE_SUCCESS_STORAGE_KEY) === '1' ? 'daily' : 'first'
  showCaptureHelp.value = true
}

async function copyCaptureValue(field: 'host' | 'port') {
  const host = captureFlow.value?.publicInfo.host || ''
  const port = captureFlow.value?.publicInfo.mitmPort || 0
  if (!host || !port)
    return
  const value = field === 'host' ? host : String(port)
  try {
    let copied = false
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value)
        copied = true
      }
      catch {}
    }
    if (!copied) {
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      copied = document.execCommand('copy')
      textarea.remove()
    }
    if (!copied)
      throw new Error('copy failed')
    captureCopiedField.value = field
    setTimeout(() => {
      if (captureCopiedField.value === field)
        captureCopiedField.value = ''
    }, 1800)
  }
  catch {
    captureError.value = '复制失败，请手动填写代理地址和端口'
  }
}

function shouldRefreshWxQr() {
  return !!wxLoginStore.qrCreatedAt
    && (wxLoginStore.status === 'qr_ready' || wxLoginStore.status === 'confirming')
    && Date.now() - wxLoginStore.qrCreatedAt > QR_AUTO_REFRESH_MS
}

async function loadWxQRCode() {
  if (activeTab.value !== 'wx' || wxLoginStore.isLoading)
    return
  stopWxCheck()
  wxLoginStore.resetState()
  const success = await wxLoginStore.getQRCode()
  if (success)
    startWxCheck()
}

async function addAccount(data: any) {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await api.post('/api/accounts', data)
    if (res.data.ok) {
      const targetId = String(props.editData?.id || data.id || res.data.targetAccountId || (res.data.data?.accounts?.length ? res.data.data.accounts[res.data.data.accounts.length - 1].id : ''))
      emit('saved', targetId)
      close()
    }
    else {
      errorMessage.value = `保存失败: ${res.data.error}`
    }
  }
  catch (e: any) {
    errorMessage.value = `保存失败: ${e.response?.data?.error || e.message}`
  }
  finally {
    loading.value = false
  }
}

async function submitManual() {
  errorMessage.value = ''
  if (!form.code) {
    errorMessage.value = '请输入 Code'
    return
  }

  const parsedInput = parseManualLoginInput(form.code)
  let code = parsedInput.code
  if (!code) {
    errorMessage.value = '请输入有效 Code 或官方 WebSocket URL'
    return
  }
  if (!parsedInput.gatewayUrl) {
    const match = code.match(CODE_QUERY_RE)
    if (match && match[1])
      code = decodeURIComponent(match[1])
  }
  form.code = code
  if (parsedInput.platform)
    form.platform = parsedInput.platform

  let payload: any = {}
  if (props.editData) {
    const onlyNameChanged = !parsedInput.gatewayUrl
      && form.name !== props.editData.name
      && form.code === (props.editData.code || '')
      && form.platform === (props.editData.platform || 'qq')

    if (onlyNameChanged) {
      payload = { id: props.editData.id, name: form.name }
    }
    else {
      payload = {
        id: props.editData.id,
        name: form.name,
        code,
        platform: form.platform,
        loginType: 'manual',
        ...(parsedInput.gatewayUrl ? { gatewayUrl: parsedInput.gatewayUrl } : {}),
      }
    }
  }
  else {
    payload = {
      name: form.name,
      code,
      platform: form.platform,
      loginType: 'manual',
      ...(parsedInput.gatewayUrl ? { gatewayUrl: parsedInput.gatewayUrl } : {}),
    }
  }

  await addAccount(payload)
}

const wxQrImageSrc = computed(() => {
  if (!wxLoginStore.qrCode)
    return ''
  if (wxLoginStore.qrCode.startsWith('data:'))
    return wxLoginStore.qrCode
  if (wxLoginStore.qrCode.startsWith('http'))
    return wxLoginStore.qrCode
  return `data:image/png;base64,${wxLoginStore.qrCode}`
})

function close() {
  stopWxCheck()
  void cancelQqTask()
  stopCaptureCheck()
  void cancelCaptureSession()
  wxLoginStore.resetState()
  showCaptureHelp.value = false
  emit('close')
}

watch(() => props.show, (newVal) => {
  if (newVal) {
    errorMessage.value = ''
    captureError.value = ''
    captureCopiedField.value = ''
    captureAccountName.value = props.editData?.name || ''
    capturePlatform.value = props.editData?.platform === 'wx' ? 'wx' : 'qq'
    captureHelpMode.value = localStorage.getItem(CAPTURE_SUCCESS_STORAGE_KEY) === '1' ? 'daily' : 'first'
    void loadCaptureConfig()
    void loadQqCapability()
    if (props.editData) {
      activeTab.value = 'manual'
      form.name = props.editData.name || ''
      form.code = props.editData.code || ''
      form.platform = props.editData.platform || 'qq'
      wxAccountName.value = props.editData.name || ''
      qqAccountName.value = props.editData.name || ''
    }
    else {
      activeTab.value = 'manual'
      form.name = ''
      form.code = ''
      form.platform = 'qq'
      wxAccountName.value = ''
      qqAccountName.value = ''
    }
  }
  else {
    stopWxCheck()
    void cancelQqTask()
    stopCaptureCheck()
    void cancelCaptureSession()
    wxLoginStore.resetState()
  }
})

watch(activeTab, (tab) => {
  if (tab === 'capture' && !captureEnabled.value) {
    activeTab.value = 'manual'
    return
  }
  if (tab === 'wx')
    loadWxQRCode()
  if (tab === 'qq' && !qqTaskId.value)
    void startQqLogin()
  if (tab !== 'qq')
    void cancelQqTask()
  if (tab !== 'capture')
    void cancelCaptureSession()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-3 sm:p-4 backdrop-blur-sm">
      <div class="max-h-[85vh] max-w-md w-full flex flex-col overflow-hidden rounded-2xl shadow-2xl border border-white/60 dark:border-white/10" :style="{ background: 'var(--theme-bg)' }">
      <div class="flex items-center justify-between border-b p-4" :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 10%, transparent)' }">
        <h3 class="text-lg font-semibold" :style="{ color: 'var(--theme-text)' }">
          {{ editData ? '编辑账号' : '添加账号' }}
        </h3>
        <BaseButton variant="ghost" class="!p-1" @click="close">
          <div class="i-carbon-close text-xl" :style="{ color: 'var(--theme-text)' }" />
        </BaseButton>
      </div>

      <div class="max-h-[calc(90vh-80px)] overflow-y-auto p-4">
        <div v-if="errorMessage" class="mb-4 rounded p-3 text-sm" :style="{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }">
          {{ errorMessage }}
        </div>

        <div class="mb-4 flex border-b" :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 10%, transparent)' }">
          <button
            v-if="qqEnabled"
            class="flex-1 py-2 text-center text-sm font-medium transition-colors"
            :class="activeTab === 'qq' ? 'border-b-2' : 'opacity-60'"
            :style="{ color: activeTab === 'qq' ? 'var(--theme-primary)' : 'var(--theme-text)', borderColor: 'var(--theme-primary)' }"
            @click="activeTab = 'qq'"
          >
            QQ 扫码
          </button>
          <button
            class="flex-1 py-2 text-center text-sm font-medium transition-colors"
            :class="activeTab === 'manual' ? 'border-b-2' : 'opacity-60'"
            :style="{
              color: activeTab === 'manual' ? 'var(--theme-primary)' : 'var(--theme-text)',
              borderColor: 'var(--theme-primary)',
            }"
            @click="activeTab = 'manual'"
          >
            手动填码
          </button>
          <button
            v-if="wxEnabled"
            class="flex-1 py-2 text-center text-sm font-medium transition-colors"
            :class="activeTab === 'wx' ? 'border-b-2' : 'opacity-60'"
            :style="{
              color: activeTab === 'wx' ? 'var(--theme-primary)' : 'var(--theme-text)',
              borderColor: 'var(--theme-primary)',
            }"
            @click="activeTab = 'wx'"
          >
            微信扫码
          </button>
          <button
            v-if="captureEnabled"
            class="flex-1 py-2 text-center text-sm font-medium transition-colors"
            :class="activeTab === 'capture' ? 'border-b-2' : 'opacity-60'"
            :style="{
              color: activeTab === 'capture' ? 'var(--theme-primary)' : 'var(--theme-text)',
              borderColor: 'var(--theme-primary)',
            }"
            @click="activeTab = 'capture'"
          >
            抓包登录
          </button>
        </div>

        <div v-if="activeTab === 'qq'" class="space-y-4">
          <BaseInput v-model="qqAccountName" label="账号备注（可选）" placeholder="留空则使用默认账号名" />
          <div class="flex flex-col items-center justify-center py-4 space-y-4">
            <div
              v-if="qqQrImage"
              class="border rounded-lg bg-white p-2 transition-opacity"
              :class="qqLoading ? 'cursor-wait opacity-60' : 'cursor-pointer hover:opacity-80'"
              title="点击刷新二维码"
              role="button"
              tabindex="0"
              @click="!qqLoading && startQqLogin()"
              @keydown.enter.prevent="!qqLoading && startQqLogin()"
              @keydown.space.prevent="!qqLoading && startQqLogin()"
            >
              <img :src="qqQrImage" class="h-48 w-48">
            </div>
            <div v-else class="h-48 w-48 flex items-center justify-center rounded-lg" :style="{ background: 'color-mix(in srgb, var(--theme-bg) 90%, var(--theme-text))' }">
              <div v-if="qqLoading" i-svg-spinners-90-ring-with-bg class="text-3xl" :style="{ color: 'var(--theme-primary)' }" />
              <span v-else class="text-sm" :style="{ color: 'var(--theme-text)' }">正在获取二维码…</span>
            </div>
            <p class="text-center text-sm" :style="{ color: 'var(--theme-text)' }">
              {{ qqStatus }}
            </p>
            <p v-if="qqError" class="text-center text-sm text-red-600">
              {{ qqError }}
            </p>
          </div>
          <div class="text-center text-xs opacity-60" :style="{ color: 'var(--theme-text)' }">
            扫码成功后会自动获取 Code，并退出临时 NapCat QQ 会话
          </div>
        </div>

        <div v-if="activeTab === 'wx'" class="space-y-4">
          <BaseInput
            v-model="wxAccountName"
            label="账号备注（可选）"
            placeholder="留空则使用微信昵称"
          />

          <div class="flex flex-col items-center justify-center py-4 space-y-4">
            <div
              v-if="wxQrImageSrc"
              class="border rounded-lg p-2"
              :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 20%, transparent)', background: '#fff' }"
            >
              <img :src="wxQrImageSrc" class="h-48 w-48">
            </div>
            <div
              v-else
              class="h-48 w-48 flex cursor-pointer items-center justify-center rounded-lg transition-opacity hover:opacity-80"
              :style="{ background: 'color-mix(in srgb, var(--theme-bg) 90%, var(--theme-text))' }"
              role="button"
              tabindex="0"
              @click="loadWxQRCode"
              @keydown.enter.prevent="loadWxQRCode"
              @keydown.space.prevent="loadWxQRCode"
            >
              <div v-if="wxLoginStore.isLoading" i-svg-spinners-90-ring-with-bg class="text-3xl" :style="{ color: 'var(--theme-primary)' }" />
              <span v-else class="text-sm" :style="{ color: 'var(--theme-text)' }">点击获取二维码</span>
            </div>

            <p class="text-center text-sm" :style="{ color: 'var(--theme-text)' }">
              {{ wxLoginStore.statusMessage }}
            </p>

            <p v-if="wxLoginStore.errorMessage" class="text-center text-sm text-red-600">
              {{ wxLoginStore.errorMessage }}
            </p>

            <BaseButton variant="secondary" size="sm" :loading="wxLoginStore.isLoading" @click="loadWxQRCode">
              {{ wxLoginStore.qrCode ? '刷新二维码' : '获取二维码' }}
            </BaseButton>
          </div>

          <div class="text-center text-xs opacity-60" :style="{ color: 'var(--theme-text)' }">
            使用微信扫描二维码登录，成功后会自动添加账号
          </div>
        </div>

        <div v-if="activeTab === 'capture'" class="space-y-4">
          <BaseInput
            v-model="captureAccountName"
            label="账号备注（可选）"
            placeholder="留空则使用默认账号名"
            :disabled="!!captureFlow"
          />

          <div class="flex flex-col gap-1.5">
            <label class="text-sm font-medium" :style="{ color: 'var(--theme-text)' }">平台</label>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                class="h-9 rounded-lg px-3 text-sm transition-colors"
                :class="capturePlatform === 'qq' ? 'text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'"
                :style="capturePlatform === 'qq' ? { background: 'var(--theme-gradient)' } : {}"
                :disabled="!!captureFlow"
                @click="capturePlatform = 'qq'"
              >
                QQ 小程序
              </button>
              <button
                type="button"
                class="h-9 rounded-lg px-3 text-sm transition-colors"
                :class="capturePlatform === 'wx' ? 'text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'"
                :style="capturePlatform === 'wx' ? { background: 'var(--theme-gradient)' } : {}"
                :disabled="!!captureFlow"
                @click="capturePlatform = 'wx'"
              >
                微信小程序
              </button>
            </div>
          </div>

          <button
            v-if="!captureFlow"
            type="button"
            class="h-11 w-full flex items-center justify-between border border-gray-200 rounded-lg px-3 text-left text-sm dark:border-gray-700"
            :style="{ color: 'var(--theme-text)' }"
            @click="openCaptureHelp"
          >
            <span class="flex items-center gap-2">
              <span class="i-carbon-help" :style="{ color: 'var(--theme-primary)' }" />
              使用说明
            </span>
            <span class="i-carbon-chevron-right opacity-60" />
          </button>

          <div v-if="captureError" class="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">
            {{ captureError }}
          </div>

          <div v-if="!captureFlow" class="flex flex-col items-center gap-3 py-4">
            <div class="h-16 w-16 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
              <div class="i-carbon-data-connected text-3xl" :style="{ color: 'var(--theme-primary)' }" />
            </div>
            <BaseButton variant="primary" :loading="captureLoading" @click="startCaptureSession">
              开始抓取
            </BaseButton>
          </div>

          <template v-else>
            <div class="rounded-lg px-3 py-3 text-sm" style="background-color: color-mix(in srgb, var(--theme-primary) 10%, transparent); color: var(--theme-text);">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-xs opacity-60">
                    当前步骤
                  </div>
                  <div class="mt-1 break-words font-semibold">
                    {{ captureCurrentStep }}
                  </div>
                  <div class="mt-1 break-words text-xs opacity-70">
                    下一步：{{ captureNextStep }}
                  </div>
                </div>
                <button
                  type="button"
                  class="h-8 w-8 flex flex-none items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
                  title="使用说明"
                  @click="openCaptureHelp"
                >
                  <span class="i-carbon-help text-lg" />
                </button>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2 text-sm">
              <div class="min-w-0 flex items-center justify-between gap-1 border border-gray-200 rounded-lg px-3 py-3 dark:border-gray-700">
                <div class="min-w-0">
                  <div class="text-xs opacity-60" :style="{ color: 'var(--theme-text)' }">
                    代理服务器
                  </div>
                  <div class="mt-1 break-all font-semibold" :style="{ color: 'var(--theme-text)' }">
                    {{ captureFlow.publicInfo.host || '-' }}
                  </div>
                </div>
                <BaseButton
                  variant="ghost"
                  size="sm"
                  :title="captureCopiedField === 'host' ? '已复制' : '复制代理服务器'"
                  class="flex-none !px-2"
                  @click="copyCaptureValue('host')"
                >
                  <span :class="captureCopiedField === 'host' ? 'i-carbon-checkmark text-green-600' : 'i-carbon-copy'" />
                </BaseButton>
              </div>
              <div class="min-w-0 flex items-center justify-between gap-1 border border-gray-200 rounded-lg px-3 py-3 dark:border-gray-700">
                <div class="min-w-0">
                  <div class="text-xs opacity-60" :style="{ color: 'var(--theme-text)' }">
                    代理端口
                  </div>
                  <div class="mt-1 font-semibold" :style="{ color: 'var(--theme-text)' }">
                    {{ captureFlow.publicInfo.mitmPort || '-' }}
                  </div>
                </div>
                <BaseButton
                  variant="ghost"
                  size="sm"
                  :title="captureCopiedField === 'port' ? '已复制' : '复制代理端口'"
                  class="flex-none !px-2"
                  @click="copyCaptureValue('port')"
                >
                  <span :class="captureCopiedField === 'port' ? 'i-carbon-checkmark text-green-600' : 'i-carbon-copy'" />
                </BaseButton>
              </div>
            </div>

            <div v-if="captureFlow.publicInfo.addresses?.length > 1" class="border border-gray-200 rounded-lg p-3 text-sm dark:border-gray-700">
              <div class="mb-2 text-xs opacity-60" :style="{ color: 'var(--theme-text)' }">
                全部可用地址（按当前网络环境选择，代理端口相同）
              </div>
              <div class="space-y-1.5">
                <div
                  v-for="item in captureFlow.publicInfo.addresses"
                  :key="item.address"
                  class="flex items-center justify-between gap-2"
                >
                  <span class="min-w-0 break-all text-xs font-mono" :style="{ color: 'var(--theme-text)' }">
                    {{ item.address }}:{{ captureFlow.publicInfo.mitmPort }}
                  </span>
                  <span
                    class="flex-none rounded px-1.5 py-0.5 text-[10px] font-medium"
                    :style="{
                      color: item.kind === 'tailscale' ? '#0ea5e9' : item.kind === 'lan' ? '#10b981' : 'var(--theme-text)',
                      background: 'color-mix(in srgb, currentColor 10%, transparent)',
                    }"
                  >
                    {{ item.kind === 'tailscale' ? 'Tailscale' : item.kind === 'lan' ? '局域网' : '其他' }}
                  </span>
                </div>
              </div>
            </div>

            <div class="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
              <div class="flex items-center justify-between gap-3">
                <span :style="{ color: 'var(--theme-text)' }">Code</span>
                <span :class="captureFlow.codeCaptured ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'">
                  {{ captureFlow.codeCaptured ? '已获取' : '等待中' }}
                </span>
              </div>
              <div v-if="captureFlow.platform === 'qq'" class="mt-2 flex items-center justify-between gap-3">
                <span :style="{ color: 'var(--theme-text)' }">好友 GID</span>
                <span :style="{ color: 'var(--theme-primary)' }">{{ captureFlow.friendCount }} 个</span>
              </div>
              <div class="mt-2 flex items-center justify-between gap-3">
                <span :style="{ color: 'var(--theme-text)' }">剩余时间</span>
                <span :style="{ color: 'var(--theme-text)' }">{{ captureFlow.publicInfo.remainingSec }} 秒</span>
              </div>
            </div>

            <div class="sticky bottom-0 z-10 flex flex-wrap justify-end gap-2 border-t border-gray-200 px-4 py-3 -mx-4 dark:border-gray-700" :style="{ background: 'var(--theme-bg)' }">
              <BaseButton
                variant="secondary"
                size="sm"
                :href="captureFlow.publicInfo.certificateUrl"
              >
                <span class="i-carbon-certificate" />
                打开证书
              </BaseButton>
              <BaseButton variant="outline" size="sm" @click="cancelCaptureSession">
                取消抓取
              </BaseButton>
              <BaseButton
                v-if="captureFlow.codeCaptured"
                variant="primary"
                size="sm"
                :loading="captureCompleting"
                @click="completeCaptureAccount"
              >
                {{ editData ? '立即更新' : '立即添加' }}
              </BaseButton>
            </div>
          </template>
        </div>

        <div v-if="activeTab === 'manual'" class="space-y-4">
          <BaseInput
            v-model="form.name"
            label="账号备注（可选）"
            placeholder="留空则使用默认账号名"
          />

          <BaseTextarea
            v-model="form.code"
            label="Code"
            placeholder="请输入登录 Code"
            :rows="3"
          />

          <div v-if="!editData" class="flex gap-4">
            <label class="flex cursor-pointer items-center gap-2">
              <input
                v-model="form.platform"
                type="radio"
                value="qq"
                class="h-4 w-4"
                :style="{ accentColor: 'var(--theme-primary)' }"
              >
              <span class="text-sm" :style="{ color: 'var(--theme-text)' }">QQ 小程序</span>
            </label>
            <label class="flex cursor-pointer items-center gap-2">
              <input
                v-model="form.platform"
                type="radio"
                value="wx"
                class="h-4 w-4"
                :style="{ accentColor: 'var(--theme-primary)' }"
              >
              <span class="text-sm" :style="{ color: 'var(--theme-text)' }">微信小程序</span>
            </label>
          </div>

          <div class="flex justify-end gap-2 pt-4">
            <BaseButton variant="outline" @click="close">
              取消
            </BaseButton>
            <BaseButton variant="primary" :loading="loading" @click="submitManual">
              {{ editData ? '保存' : '添加' }}
            </BaseButton>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="showCaptureHelp"
      class="fixed inset-0 z-[10001] flex items-end justify-center bg-black/50 md:items-center"
      @click.self="showCaptureHelp = false"
    >
      <div class="max-h-[78vh] max-w-md w-full flex flex-col overflow-hidden rounded-t-lg shadow-2xl md:rounded-lg" :style="{ background: 'var(--theme-bg)' }">
        <div class="h-14 flex flex-none items-center justify-between border-b border-gray-200 px-4 dark:border-gray-700">
          <h4 class="text-base font-semibold" :style="{ color: 'var(--theme-text)' }">
            抓包登录使用说明
          </h4>
          <BaseButton variant="ghost" class="!h-9 !w-9 !p-0" title="关闭使用说明" @click="showCaptureHelp = false">
            <span class="i-carbon-close text-lg" />
          </BaseButton>
        </div>

        <div class="flex-1 overflow-y-auto p-4">
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="h-9 rounded-lg px-3 text-sm transition-colors"
              :class="captureHelpMode === 'first' ? 'text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'"
              :style="captureHelpMode === 'first' ? { background: 'var(--theme-gradient)' } : {}"
              @click="captureHelpMode = 'first'"
            >
              首次使用
            </button>
            <button
              type="button"
              class="h-9 rounded-lg px-3 text-sm transition-colors"
              :class="captureHelpMode === 'daily' ? 'text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'"
              :style="captureHelpMode === 'daily' ? { background: 'var(--theme-gradient)' } : {}"
              @click="captureHelpMode = 'daily'"
            >
              已装证书
            </button>
          </div>

          <div class="mt-4 divide-y divide-gray-200 dark:divide-gray-700">
            <div v-for="(step, index) in captureHelpSteps" :key="step" class="flex items-start gap-3 py-3 first:pt-0">
              <span class="h-6 w-6 flex flex-none items-center justify-center rounded-full text-xs text-white font-semibold" :style="{ background: 'var(--theme-primary)' }">
                {{ index + 1 }}
              </span>
              <span class="min-w-0 break-words text-sm leading-6" :style="{ color: 'var(--theme-text)' }">
                {{ step }}
              </span>
            </div>
          </div>

          <template v-if="captureHelpMode === 'first'">
            <div class="mt-3 border-t border-gray-200 pt-4 dark:border-gray-700">
              <div class="mb-3 text-sm font-semibold" :style="{ color: 'var(--theme-text)' }">
                证书安装帮助
              </div>
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  class="h-9 rounded-lg px-3 text-sm transition-colors"
                  :class="captureHelpDevice === 'ios' ? 'text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'"
                  :style="captureHelpDevice === 'ios' ? { background: 'var(--theme-gradient)' } : {}"
                  @click="captureHelpDevice = 'ios'"
                >
                  iPhone / iPad
                </button>
                <button
                  type="button"
                  class="h-9 rounded-lg px-3 text-sm transition-colors"
                  :class="captureHelpDevice === 'android' ? 'text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'"
                  :style="captureHelpDevice === 'android' ? { background: 'var(--theme-gradient)' } : {}"
                  @click="captureHelpDevice = 'android'"
                >
                  Android
                </button>
              </div>
              <div class="mt-3 space-y-2">
                <div v-for="(step, index) in captureDeviceSteps" :key="step" class="flex items-start gap-2 text-xs leading-5" :style="{ color: 'var(--theme-text)' }">
                  <span class="flex-none opacity-60">{{ index + 1 }}.</span>
                  <span class="break-words">{{ step }}</span>
                </div>
              </div>
            </div>
          </template>

          <div class="mt-4 rounded-lg bg-amber-50 px-3 py-3 text-xs text-amber-800 leading-5 dark:bg-amber-900/20 dark:text-amber-200">
            <div>每次任务的代理端口可能变化，请以当前页面显示为准。</div>
            <div class="mt-1">
              服务端会自动释放代理，但账号完成后仍需在手机上手动关闭 Wi-Fi 代理。
            </div>
            <div v-if="capturePlatform === 'wx'" class="mt-1">
              微信抓取成功后无法继续进入农场属于正常现象。
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
