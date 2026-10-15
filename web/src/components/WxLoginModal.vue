<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAccountStore } from '@/stores/account'
import { useWxLoginStore } from '@/stores/wx-login'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits(['close', 'saved'])

const wxLoginStore = useWxLoginStore()
const accountStore = useAccountStore()

const QR_AUTO_REFRESH_MS = 110_000

const accountName = ref('')
const checking = ref(false)

// 轮询检查登录状态
const { pause: stopCheck, resume: startCheck } = useIntervalFn(async () => {
  if (wxLoginStore.isLoading || checking.value)
    return
  if (shouldRefreshQr()) {
    await loadQRCode()
    return
  }
  if (wxLoginStore.status !== 'qr_ready' && wxLoginStore.status !== 'confirming') {
    return
  }

  checking.value = true
  try {
    const result = await wxLoginStore.checkLogin()

    if (result.success && result.wxid) {
      stopCheck()

      // 自动添加账号
      await handleAutoAddAccount(result.wxid, result.nickname, result.avatar)
    }
  }
  finally {
    checking.value = false
  }
}, 2000, { immediate: false })

function shouldRefreshQr() {
  return !!wxLoginStore.qrCreatedAt
    && (wxLoginStore.status === 'qr_ready' || wxLoginStore.status === 'confirming')
    && Date.now() - wxLoginStore.qrCreatedAt > QR_AUTO_REFRESH_MS
}

// 自动添加账号
async function handleAutoAddAccount(wxid: string, nickname?: string, avatar?: string) {
  try {
    const result = await wxLoginStore.getFarmCode(wxid)

    if (result.success && result.code) {
      const name = accountName.value.trim() || nickname || `微信账号${Date.now()}`

      await accountStore.addAccount({
        name,
        code: result.code,
        platform: 'wx',
        loginType: 'wx_qr',
        wxid,
        avatar,
        wxSessionId: wxLoginStore.uuid,
      })
      emit('saved')
      close()
    }
  }
  catch (e) {
    console.error('自动添加账号失败:', e)
  }
}

// 获取二维码
async function loadQRCode() {
  stopCheck()
  wxLoginStore.resetState()
  const success = await wxLoginStore.getQRCode()
  if (success) {
    startCheck()
  }
}

// 关闭弹窗
function close() {
  stopCheck()
  wxLoginStore.resetState()
  accountName.value = ''
  emit('close')
}

// 二维码图片地址
const qrImageSrc = computed(() => {
  if (!wxLoginStore.qrCode)
    return ''
  if (wxLoginStore.qrCode.startsWith('data:'))
    return wxLoginStore.qrCode
  if (wxLoginStore.qrCode.startsWith('http'))
    return wxLoginStore.qrCode
  return `data:image/png;base64,${wxLoginStore.qrCode}`
})

// 状态样式
const statusClass = computed(() => {
  switch (wxLoginStore.status) {
    case 'success':
      return 'text-green-600'
    case 'error':
      return 'text-red-600'
    case 'qr_loading':
    case 'scanning':
      return 'text-blue-600'
    default:
      return 'text-gray-600'
  }
})

watch(() => props.show, (newVal) => {
  if (newVal) {
    loadQRCode()
  }
  else {
    stopCheck()
  }
})
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div class="max-w-md w-full overflow-hidden rounded-lg shadow-xl" :style="{ background: 'var(--theme-bg)' }">
      <!-- Header -->
      <div class="flex items-center justify-between border-b p-4" :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 10%, transparent)' }">
        <h3 class="text-lg font-semibold" :style="{ color: 'var(--theme-text)' }">
          微信扫码登录
        </h3>
        <BaseButton variant="ghost" class="!p-1" @click="close">
          <div class="i-carbon-close text-xl" :style="{ color: 'var(--theme-text)' }" />
        </BaseButton>
      </div>

      <!-- Login Content -->
      <div class="p-4 space-y-4">
        <!-- 账号名称输入 -->
        <BaseInput
          v-model="accountName"
          label="账号备注（可选）"
          placeholder="留空使用微信昵称"
        />

        <!-- 二维码区域 -->
        <div class="flex flex-col items-center justify-center py-4 space-y-4">
          <div
            v-if="qrImageSrc"
            class="border rounded-lg p-2"
            :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 20%, transparent)', background: '#fff' }"
          >
            <img :src="qrImageSrc" class="h-48 w-48">
          </div>
          <div
            v-else
            class="h-48 w-48 flex items-center justify-center rounded-lg"
            :style="{ background: 'color-mix(in srgb, var(--theme-bg) 90%, var(--theme-text))' }"
          >
            <div v-if="wxLoginStore.isLoading" i-svg-spinners-90-ring-with-bg class="text-3xl" :style="{ color: 'var(--theme-primary)' }" />
            <span v-else class="text-sm" :style="{ color: 'var(--theme-text)' }">点击获取二维码</span>
          </div>

          <!-- 状态信息 -->
          <p class="text-center text-sm" :class="statusClass">
            {{ wxLoginStore.statusMessage }}
          </p>

          <!-- 错误信息 -->
          <p v-if="wxLoginStore.errorMessage" class="text-center text-sm text-red-600">
            {{ wxLoginStore.errorMessage }}
          </p>

          <!-- 操作按钮 -->
          <div class="flex gap-2">
            <BaseButton
              variant="secondary"
              size="sm"
              :loading="wxLoginStore.isLoading"
              @click="loadQRCode"
            >
              刷新二维码
            </BaseButton>
          </div>
        </div>

        <!-- 说明文字 -->
        <div class="text-center text-xs opacity-60" :style="{ color: 'var(--theme-text)' }">
          使用微信扫描二维码登录，登录成功后将自动添加账号
        </div>
      </div>
    </div>
  </div>
</template>
