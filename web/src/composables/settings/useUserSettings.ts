import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'
import { useSettingStore } from '@/stores/setting'

interface DeviceProtocolConfig {
  enabled: boolean
  userAgent: string
  deviceModel: string
  deviceBrand: string
  deviceMac: string
  deviceId: string
  imei: string
}

type AlertType = 'primary' | 'danger'

const DEFAULT_DEVICE_PROTOCOL: DeviceProtocolConfig = {
  enabled: false,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)',
  deviceModel: 'iPhone 15 Pro Max',
  deviceBrand: 'Apple',
  deviceMac: '',
  deviceId: '',
  imei: '',
}

const DEVICE_PROTOCOL_PRESETS = [
  {
    label: 'iPhone 17',
    value: 'iphone_17',
    config: {
      userAgent: '',
      deviceBrand: 'Apple',
      deviceModel: 'iPhone 17',
    },
  },
  {
    label: 'iPhone 17 Pro',
    value: 'iphone_17_pro',
    config: {
      userAgent: '',
      deviceBrand: 'Apple',
      deviceModel: 'iPhone 17 Pro',
    },
  },
  {
    label: 'iPhone 15 Pro Max',
    value: 'iphone_15_pm',
    config: {
      userAgent: DEFAULT_DEVICE_PROTOCOL.userAgent,
      deviceBrand: 'Apple',
      deviceModel: 'iPhone 15 Pro Max',
    },
  },
  {
    label: 'Huawei Mate 60 Pro',
    value: 'mate_60_pro',
    config: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; HUAWEI Mate 60 Pro Build/HUAWEIMate60Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.47.2560(0x28002F39) NetType/WIFI Language/zh_CN',
      deviceBrand: 'Huawei',
      deviceModel: 'Mate 60 Pro',
    },
  },
  {
    label: 'Xiaomi 14 Ultra',
    value: 'xiaomi_14_ultra',
    config: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; 24031PN0DC Build/UKQ1.231003.002) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.47.2560(0x28002F39) NetType/WIFI Language/zh_CN',
      deviceBrand: 'Xiaomi',
      deviceModel: 'Xiaomi 14 Ultra',
    },
  },
] as const

const CHANNEL_DOCS: Record<string, string> = {
  qmsg: 'https://qmsg.zendee.cn/',
  wxpusher: 'https://wxpusher.zjiecode.com/docs/#/',
  wxpusher_wechat: 'https://wxpusher.zjiecode.com/docs/api-reference.html',
  bark: 'https://github.com/Finb/Bark',
}

export function useUserSettings(showAlert: (message: string, type?: AlertType) => void) {
  const settingStore = useSettingStore()
  const accountStore = useAccountStore()
  const { settings } = storeToRefs(settingStore)
  const { currentAccountId } = storeToRefs(accountStore)

  const offlineSaving = ref(false)
  const offlineTesting = ref(false)
  const deviceProtocolLoading = ref(false)
  const deviceProtocolSaving = ref(false)

  const deviceProtocolPresetOptions = computed(() =>
    DEVICE_PROTOCOL_PRESETS.map(item => ({ label: item.label, value: item.value })),
  )

  const selectedDevicePreset = ref('')
  const deviceProtocolForm = ref<DeviceProtocolConfig>({ ...DEFAULT_DEVICE_PROTOCOL })

  const localOffline = ref({
    channel: 'qmsg',
    reloginUrlMode: 'none',
    token: '',
    wxPusherUid: '',
    channelCredentials: {
      qmsg: { token: '', wxPusherUid: '' },
      wxpusher: { token: '', wxPusherUid: '' },
      wxpusher_wechat: { token: '', wxPusherUid: '' },
      bark: { token: '', wxPusherUid: '' },
    },
    title: '',
    msg: '',
    offlineDeleteSec: 0,
  })

  const channelOptions = [
    { label: 'Qmsg 酱', value: 'qmsg' },
    { label: 'WxPusher(SPT)', value: 'wxpusher' },
    { label: 'WxPusher(标准)', value: 'wxpusher_wechat' },
    { label: 'Bark（iPhone 推送）', value: 'bark' },
  ]

  const reloginUrlModeOptions = [
    { label: '不附带', value: 'none' },
    { label: 'QQ 直链', value: 'qq_link' },
    { label: '二维码链接', value: 'qr_link' },
  ]

  const currentChannelDocUrl = computed(() => {
    const key = String(localOffline.value.channel || '').trim().toLowerCase()
    return CHANNEL_DOCS[key] || ''
  })

  function openChannelDocs() {
    const url = currentChannelDocUrl.value
    if (!url)
      return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function applyDeviceProtocolConfig(config?: Partial<DeviceProtocolConfig>) {
    deviceProtocolForm.value = {
      ...DEFAULT_DEVICE_PROTOCOL,
      ...config,
      enabled: config?.enabled === true,
    }
  }

  function randomDigits(length: number) {
    let result = ''
    while (result.length < length) {
      const bytes = crypto.getRandomValues(new Uint8Array(length - result.length))
      for (const byte of bytes) {
        // Discard the upper six values so modulo 10 remains unbiased.
        if (byte < 250)
          result += String(byte % 10)
      }
    }
    return result
  }

  function formatHexByte(value: number) {
    return value.toString(16).padStart(2, '0').toUpperCase()
  }

  function generateRandomMac() {
    const bytes = crypto.getRandomValues(new Uint8Array(6))
    // Locally administered (bit 1), unicast (bit 0 cleared): no real vendor OUI.
    bytes[0] = ((bytes[0] ?? 0) & 0xFC) | 0x02
    return Array.from(bytes, formatHexByte).join(':')
  }

  function generateRandomDeviceId() {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    return Array.from(bytes, formatHexByte).join('')
  }

  function generateRandomImei() {
    const digits = randomDigits(14).split('').map(Number)
    let sum = 0
    digits.forEach((digit, index) => {
      const value = index % 2 === 1 ? digit * 2 : digit
      sum += value > 9 ? value - 9 : value
    })
    const checkDigit = (10 - (sum % 10)) % 10
    return `${digits.join('')}${checkDigit}`
  }

  function fillRandomDeviceMac() {
    deviceProtocolForm.value.deviceMac = generateRandomMac()
  }

  function fillRandomDeviceId() {
    deviceProtocolForm.value.deviceId = generateRandomDeviceId()
  }

  function fillRandomImei() {
    deviceProtocolForm.value.imei = generateRandomImei()
  }

  function applyDevicePreset(value: string | number | undefined) {
    if (value === undefined)
      return
    const preset = DEVICE_PROTOCOL_PRESETS.find(item => item.value === value)
    if (!preset)
      return
    deviceProtocolForm.value.userAgent = preset.config.userAgent
    deviceProtocolForm.value.deviceBrand = preset.config.deviceBrand
    deviceProtocolForm.value.deviceModel = preset.config.deviceModel
  }

  async function fetchDeviceProtocol() {
    deviceProtocolLoading.value = true
    try {
      const { data } = await api.get('/api/user/device-protocol')
      if (data?.ok)
        applyDeviceProtocolConfig(data.config)
    }
    catch (e) {
      console.error('加载设备协议配置失败', e)
    }
    finally {
      deviceProtocolLoading.value = false
    }
  }

  async function handleSaveDeviceProtocol() {
    deviceProtocolSaving.value = true
    try {
      const payload = {
        enabled: !!deviceProtocolForm.value.enabled,
        userAgent: String(deviceProtocolForm.value.userAgent || '').trim(),
        deviceBrand: String(deviceProtocolForm.value.deviceBrand || '').trim(),
        deviceModel: String(deviceProtocolForm.value.deviceModel || '').trim(),
        deviceMac: String(deviceProtocolForm.value.deviceMac || '').trim(),
        deviceId: String(deviceProtocolForm.value.deviceId || '').trim(),
        imei: String(deviceProtocolForm.value.imei || '').trim(),
      }
      const { data } = await api.post('/api/user/device-protocol', payload)
      if (data?.ok) {
        applyDeviceProtocolConfig(data.config)
        showAlert('设备协议配置已保存', 'primary')
      }
      else {
        showAlert(`保存失败: ${data?.error || '未知错误'}`, 'danger')
      }
    }
    catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '请求失败'
      showAlert(`保存失败: ${msg}`, 'danger')
    }
    finally {
      deviceProtocolSaving.value = false
    }
  }

  function syncLocalOfflineSettings() {
    if (settings.value?.offlineReminder) {
      localOffline.value = JSON.parse(JSON.stringify(settings.value.offlineReminder))
    }
  }

  watch(settings, () => {
    syncLocalOfflineSettings()
  }, { deep: true })

  async function handleSaveOffline() {
    if (!currentAccountId.value) {
      showAlert('请先选择账号', 'danger')
      return
    }
    offlineSaving.value = true
    try {
      const res = await settingStore.saveOfflineConfig(localOffline.value, String(currentAccountId.value))

      if (res.ok) {
        showAlert('下线提醒设置已保存', 'primary')
      }
      else {
        showAlert(`保存失败: ${res.error || '未知错误'}`, 'danger')
      }
    }
    finally {
      offlineSaving.value = false
    }
  }

  async function handleTestOffline() {
    if (!currentAccountId.value) {
      showAlert('请先选择账号', 'danger')
      return
    }
    offlineTesting.value = true
    try {
      const { data } = await api.post('/api/settings/offline-reminder/test', localOffline.value, {
        headers: { 'x-account-id': String(currentAccountId.value) },
      })
      if (data?.ok) {
        showAlert('测试消息发送成功', 'primary')
      }
      else {
        showAlert(`测试失败: ${data?.error || '未知错误'}`, 'danger')
      }
    }
    catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '请求失败'
      showAlert(`测试失败: ${msg}`, 'danger')
    }
    finally {
      offlineTesting.value = false
    }
  }

  return {
    offlineSaving,
    offlineTesting,
    deviceProtocolLoading,
    deviceProtocolSaving,
    deviceProtocolPresetOptions,
    selectedDevicePreset,
    deviceProtocolForm,
    localOffline,
    channelOptions,
    reloginUrlModeOptions,
    currentChannelDocUrl,
    openChannelDocs,
    fillRandomDeviceMac,
    fillRandomDeviceId,
    fillRandomImei,
    applyDevicePreset,
    fetchDeviceProtocol,
    syncLocalOfflineSettings,
    handleSaveDeviceProtocol,
    handleSaveOffline,
    handleTestOffline,
  }
}
