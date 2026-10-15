<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useUserStore } from '@/stores/user'
import BaseButton from '@/components/ui/BaseButton.vue'

interface OfflineReminderConfig {
  channel: string
  recipientEmail?: string
  token?: string
  [key: string]: any
}

defineProps<{
  saving: boolean
  testing: boolean
  currentAccountName?: string | null
}>()

const userStore = useUserStore()
const emit = defineEmits<{
  test: []
  save: []
}>()

const config = defineModel<OfflineReminderConfig>('config', { required: true })

// 当前通知渠道：email (邮箱) 或 pushplus (微信推送加)
const currentChannel = ref<'email' | 'pushplus'>(
  config.value.channel === 'pushplus' ? 'pushplus' : 'email'
)

// 热门邮箱后缀列表
const POPULAR_SUFFIXES = [
  '@qq.com',
  '@163.com',
  '@gmail.com',
  '@126.com',
  '@outlook.com',
  '@foxmail.com',
  'custom',
]

function parseEmail(fullEmail: string) {
  const str = String(fullEmail || '').trim()
  if (!str) return { prefix: '', suffix: '@qq.com', customSuffix: '', isCustom: false }
  
  const atIdx = str.lastIndexOf('@')
  if (atIdx === -1) {
    return { prefix: str, suffix: '@qq.com', customSuffix: '', isCustom: false }
  }
  
  const prefix = str.slice(0, atIdx)
  const suffix = str.slice(atIdx).toLowerCase()
  const matched = POPULAR_SUFFIXES.find(s => s === suffix)
  
  if (matched) {
    return { prefix, suffix: matched, customSuffix: '', isCustom: false }
  }
  return { prefix, suffix: 'custom', customSuffix: suffix, isCustom: true }
}

const initial = parseEmail(config.value.recipientEmail || '')
const rawPrefix = ref(initial.prefix)
const selectedSuffix = ref(initial.suffix)
const customSuffix = ref(initial.customSuffix || '')
const pushplusToken = ref(config.value.token || '')

// 智能清洗 prefix
function cleanPrefixAndSyncSuffix(val: string) {
  const trimmed = val.trim()
  const atIdx = trimmed.lastIndexOf('@')
  if (atIdx !== -1) {
    const p = trimmed.slice(0, atIdx)
    const s = trimmed.slice(atIdx).toLowerCase()
    const matched = POPULAR_SUFFIXES.find(item => item === s)
    if (matched) {
      selectedSuffix.value = matched
      rawPrefix.value = p
      return
    } else {
      selectedSuffix.value = 'custom'
      customSuffix.value = s
      rawPrefix.value = p
      return
    }
  }
}

watch(rawPrefix, (val) => {
  cleanPrefixAndSyncSuffix(val)
})

// 组合完整邮箱
const fullEmailAddress = computed(() => {
  const p = rawPrefix.value.trim()
  if (!p) return ''
  if (selectedSuffix.value === 'custom') {
    const suf = customSuffix.value.trim()
    if (!suf) return p
    return suf.startsWith('@') ? `${p}${suf}` : `${p}@${suf}`
  }
  return `${p}${selectedSuffix.value}`
})

// 同步设置到外部 config 模型
function syncConfig() {
  if (currentChannel.value === 'email') {
    config.value.channel = 'smtp'
    config.value.recipientEmail = fullEmailAddress.value
  } else {
    config.value.channel = 'pushplus'
    config.value.token = pushplusToken.value.trim()
  }
}

watch([currentChannel, fullEmailAddress, pushplusToken], () => {
  syncConfig()
}, { immediate: true })

// 外部数据变化时同步内部
watch(() => config.value, (val) => {
  if (val.channel === 'pushplus') {
    currentChannel.value = 'pushplus'
    if (val.token) pushplusToken.value = val.token
  } else {
    currentChannel.value = 'email'
    if (val.recipientEmail) {
      const parsed = parseEmail(val.recipientEmail)
      rawPrefix.value = parsed.prefix
      selectedSuffix.value = parsed.suffix
      if (parsed.customSuffix) customSuffix.value = parsed.customSuffix
    }
  }
}, { deep: true })

const canSubmit = computed(() => {
  if (currentChannel.value === 'email') return !!fullEmailAddress.value
  return !!pushplusToken.value.trim()
})
</script>

<template>
  <div class="space-y-4">
    <!-- 渠道切换导航胶囊 (邮箱 / 微信PushPlus) -->
    <div class="flex items-center gap-2 p-1 rounded-xl bg-gray-100/80 dark:bg-gray-800/80 border border-gray-200/50 dark:border-gray-700/50 shadow-inner">
      <button
        type="button"
        class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
        :class="currentChannel === 'email'
          ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
          : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'"
        @click="currentChannel = 'email'"
      >
        <div class="i-carbon-email text-sm" />
        <span>QQ 邮箱接收</span>
      </button>

      <button
        type="button"
        class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer"
        :class="currentChannel === 'pushplus'
          ? 'bg-white dark:bg-gray-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
          : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'"
        @click="currentChannel = 'pushplus'"
      >
        <div class="i-carbon-chat text-sm" />
        <span>微信服务号推送 (PushPlus)</span>
      </button>
    </div>

    <!-- 1. 邮箱模式内容 -->
    <template v-if="currentChannel === 'email'">
      <div class="rounded-xl bg-blue-50/60 dark:bg-blue-950/20 p-3 text-xs text-blue-700 dark:text-blue-300 border border-blue-100/60 dark:border-blue-900/40 flex items-start gap-2">
        <div class="i-carbon-information text-base shrink-0 mt-0.5" />
        <div class="leading-relaxed">
          由系统统一发信。您只需填写接收邮箱，账号离线时系统将第一时间向您推送邮件通知。
        </div>
      </div>

      <div class="border border-gray-200/80 rounded-xl bg-white/70 p-4 dark:border-gray-700/80 dark:bg-gray-800/60 backdrop-blur-sm space-y-3">
        <div class="flex items-center justify-between">
          <label class="text-xs font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
            <div class="i-carbon-email text-sm text-blue-500" />
            <span>接收邮箱地址</span>
          </label>
          <span v-if="fullEmailAddress" class="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
            接收: {{ fullEmailAddress }}
          </span>
        </div>

        <div class="flex items-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/60 shadow-sm overflow-hidden focus-within:border-blue-500 dark:focus-within:border-blue-500 transition-colors">
          <input
            v-model="rawPrefix"
            type="text"
            class="flex-1 min-w-0 px-3.5 py-2.5 text-sm bg-transparent border-0 outline-none text-gray-900 dark:text-gray-100 placeholder:text-gray-400 font-mono"
            placeholder="请填写QQ号或邮箱前缀"
          />
          <div class="h-5 w-[1px] bg-gray-200 dark:bg-gray-700 shrink-0" />
          <select
            v-model="selectedSuffix"
            class="shrink-0 px-3 py-2.5 text-sm bg-transparent border-0 outline-none text-gray-700 dark:text-gray-200 font-medium cursor-pointer"
          >
            <option value="@qq.com">@qq.com (默认)</option>
            <option value="@163.com">@163.com</option>
            <option value="@gmail.com">@gmail.com</option>
            <option value="@126.com">@126.com</option>
            <option value="@outlook.com">@outlook.com</option>
            <option value="@foxmail.com">@foxmail.com</option>
            <option value="custom">自定义后缀...</option>
          </select>
        </div>

        <div v-if="selectedSuffix === 'custom'" class="flex items-center gap-2 pt-1 animate-fade-in">
          <span class="text-xs text-gray-500 shrink-0">自定义后缀:</span>
          <input
            v-model="customSuffix"
            type="text"
            placeholder="@example.com"
            class="flex-1 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/60 outline-none focus:border-blue-500 text-gray-900 dark:text-gray-100 font-mono"
          />
        </div>
      </div>
    </template>

    <!-- 2. 微信推送加 (PushPlus) 模式内容 -->
    <template v-else>
      <div class="rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 p-3 text-xs text-emerald-800 dark:text-emerald-300 border border-emerald-100/60 dark:border-emerald-900/40 flex items-start gap-2">
        <div class="i-carbon-chat text-base shrink-0 mt-0.5 text-emerald-600" />
        <div class="leading-relaxed">
          直接推送到您的个人微信！微信关注「pushplus推送加」公众号获取一对一 Token，掉线时微信服务号将即时震动弹窗通知。
        </div>
      </div>

      <div class="border border-gray-200/80 rounded-xl bg-white/70 p-4 dark:border-gray-700/80 dark:bg-gray-800/60 backdrop-blur-sm space-y-3">
        <div class="flex items-center justify-between">
          <label class="text-xs font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
            <div class="i-carbon-key text-sm text-emerald-500" />
            <span>PushPlus Token</span>
          </label>
          <a
            href="https://www.pushplus.plus/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-0.5"
          >
            <span>获取我的 Token</span>
            <div class="i-carbon-launch text-[10px]" />
          </a>
        </div>

        <div class="flex items-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/60 shadow-sm overflow-hidden focus-within:border-emerald-500 dark:focus-within:border-emerald-500 transition-colors">
          <input
            v-model="pushplusToken"
            type="text"
            class="flex-1 min-w-0 px-3.5 py-2.5 text-sm bg-transparent border-0 outline-none text-gray-900 dark:text-gray-100 placeholder:text-gray-400 font-mono"
            placeholder="请在此粘贴您的 PushPlus Token (一串英数代码)"
          />
        </div>
      </div>
    </template>

    <!-- 底部统一操作按钮 -->
    <div class="flex items-center justify-end gap-2.5 pt-1">
      <BaseButton
        v-if="userStore.isAdmin"
        variant="secondary"
        size="sm"
        :loading="testing"
        :disabled="saving || !canSubmit"
        title="仅管理员可测试"
        @click="emit('test')"
      >
        <span class="i-carbon-send mr-1" />
        测试发送
      </BaseButton>

      <BaseButton
        variant="primary"
        size="sm"
        :loading="saving"
        :disabled="testing"
        @click="emit('save')"
      >
        <span class="i-carbon-checkmark mr-1" />
        保存接收设置
      </BaseButton>
    </div>
  </div>
</template>
