<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useToastStore } from '@/stores/toast'

interface SmtpConfig {
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  senderName: string
}

const toastStore = useToastStore()

const props = defineProps<{
  saving?: boolean
  testing?: boolean
}>()

const emit = defineEmits<{
  save: []
  test: []
}>()

const config = defineModel<SmtpConfig>('config', { required: true })

const loading = ref(false)
const localSaving = ref(false)
const localTesting = ref(false)
const testEmail = ref('')

async function fetchGlobalSmtp() {
  loading.value = true
  try {
    const res = await api.get('/api/admin/global-smtp')
    if (res.data?.ok && res.data.data) {
      const d = res.data.data
      config.value.smtpHost = d.smtpHost || ''
      config.value.smtpPort = Number(d.smtpPort) || 465
      config.value.smtpUser = d.smtpUser || ''
      config.value.smtpPass = d.smtpPass || ''
      config.value.senderName = d.senderName || ''
    }
  } catch (err: any) {
    console.error('获取全局SMTP配置失败:', err)
  } finally {
    loading.value = false
  }
}

async function saveSmtpDirectly() {
  if (!config.value.smtpHost || !config.value.smtpUser || !config.value.smtpPass) {
    toastStore.warning('请填写完整的SMTP服务器地址、发信邮箱和授权码！')
    return
  }
  localSaving.value = true
  try {
    const res = await api.post('/api/admin/global-smtp', config.value)
    if (res.data?.ok) {
      toastStore.success('系统全局发信邮箱已保存并生效！')
      emit('save')
    } else {
      toastStore.error(res.data?.error || '保存失败')
    }
  } catch (err: any) {
    toastStore.error(err.response?.data?.error || err.message || '保存失败')
  } finally {
    localSaving.value = false
  }
}

async function testSmtpDirectly() {
  if (!config.value.smtpHost || !config.value.smtpUser || !config.value.smtpPass) {
    toastStore.warning('请先填写发信邮箱和授权码！')
    return
  }
  let to = testEmail.value.trim() || config.value.smtpUser
  if (to && !to.includes('@')) {
    to = `${to}@qq.com`
  }
  localTesting.value = true
  try {
    const res = await api.post('/api/settings/offline-reminder/test', {
      channel: 'smtp',
      ...config.value,
      recipientEmail: to,
    })
    if (res.data?.ok) {
      toastStore.success(`测试邮件发送成功！已发送至: ${to}`)
      emit('test')
    } else {
      toastStore.error(res.data?.error || '测试发送失败')
    }
  } catch (err: any) {
    toastStore.error(err.response?.data?.error || err.message || '测试发送失败')
  } finally {
    localTesting.value = false
  }
}

onMounted(() => {
  fetchGlobalSmtp()
})
</script>

<template>
  <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800 space-y-4 shadow-sm">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-gray-100 dark:border-gray-700/80 pb-3">
      <div>
        <h4 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
          <div class="i-carbon-email text-blue-500" />
          系统发信邮箱设置 (全局 SMTP)
        </h4>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          在此配置全站公共发信账号。配置并保存后，所有用户账号发生掉线时，将自动由此邮箱统一代发通知。
        </p>
      </div>

      <!-- 专属快捷保存按钮 -->
      <BaseButton
        variant="primary"
        size="sm"
        :loading="localSaving || saving"
        :disabled="localTesting || testing"
        class="shrink-0 self-start sm:self-auto"
        @click="saveSmtpDirectly"
      >
        <span class="i-carbon-checkmark mr-1" />
        保存发件邮箱
      </BaseButton>
    </div>

    <div v-if="loading" class="py-6 text-center text-gray-400 text-xs">
      正在读取当前配置...
    </div>

    <div v-else class="space-y-3">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <BaseInput
          v-model="config.smtpHost"
          label="SMTP 服务器地址"
          type="text"
          placeholder="如 smtp.qq.com"
        />
        <BaseInput
          v-model.number="config.smtpPort"
          label="SMTP 端口 (SSL)"
          type="number"
          min="1"
          max="65535"
          placeholder="465"
        />
      </div>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <BaseInput
          v-model="config.smtpUser"
          label="发信邮箱账号"
          type="text"
          placeholder="如 123456@qq.com"
        />
        <BaseInput
          v-model="config.smtpPass"
          label="发信授权码 / 密码"
          type="password"
          placeholder="QQ邮箱在设置中生成的16位授权码"
        />
      </div>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <BaseInput
          v-model="config.senderName"
          label="发信人显示名称"
          type="text"
          placeholder="如 QQ农场助手监控中心"
        />

        <!-- 管理员测试发信框 -->
        <div class="flex items-end gap-2">
          <BaseInput
            v-model="testEmail"
            class="flex-1"
            label="测试接收邮箱 (留空发自己)"
            type="text"
            placeholder="接收测试邮件的邮箱"
          />
          <BaseButton
            variant="secondary"
            size="sm"
            class="h-9 whitespace-nowrap"
            :loading="localTesting || testing"
            :disabled="localSaving || saving"
            @click="testSmtpDirectly"
          >
            <span class="i-carbon-send mr-1" />
            测试发信
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
