<script setup lang="ts">
import { computed } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'

interface OfflineReminderConfig {
  channel: string
  reloginUrlMode: string
  token: string
  wxPusherUid: string
  channelCredentials: Record<string, { token: string, wxPusherUid: string }>
  title: string
  msg: string
  offlineDeleteSec: number
}

defineProps<{
  channelOptions: { label: string, value: string | number }[]
  currentChannelDocUrl: string
  saving: boolean
  testing: boolean
  disabled?: boolean
  showSave?: boolean
}>()

const emit = defineEmits<{
  openDocs: []
  test: []
  save: []
}>()

const config = defineModel<OfflineReminderConfig>('config', { required: true })

const activeToken = computed({
  get: () => config.value.channelCredentials[config.value.channel]?.token || '',
  set: (token: string) => {
    const current = config.value.channelCredentials[config.value.channel] || { token: '', wxPusherUid: '' }
    config.value.channelCredentials[config.value.channel] = { ...current, token }
  },
})
const activeWxPusherUid = computed({
  get: () => config.value.channelCredentials[config.value.channel]?.wxPusherUid || '',
  set: (wxPusherUid: string) => {
    const current = config.value.channelCredentials[config.value.channel] || { token: '', wxPusherUid: '' }
    config.value.channelCredentials[config.value.channel] = { ...current, wxPusherUid }
  },
})
</script>

<template>
  <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
    <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
      <div class="i-carbon-notification" />
      下线提醒
    </h4>

    <div class="space-y-3">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <span class="text-sm text-gray-700 font-medium dark:text-gray-300">推送渠道</span>
            <BaseButton
              variant="text"
              size="sm"
              :disabled="!currentChannelDocUrl"
              @click="emit('openDocs')"
            >
              官网
            </BaseButton>
          </div>
          <BaseSelect
            v-model="config.channel"
            :options="channelOptions"
          />
        </div>
        <BaseInput
          v-model.number="config.offlineDeleteSec"
          label="离线删除账号 (秒)"
          type="number"
          min="0"
          placeholder="0 表示不删除"
        />
      </div>

      <template v-if="config.channel === 'wxpusher_wechat'">
        <BaseInput
          v-model="activeToken"
          label="WxPusher AppToken"
          type="password"
          placeholder="以 AT_ 开头的应用令牌"
        />
        <BaseInput
          v-model="activeWxPusherUid"
          label="WxPusher 接收者 UID"
          type="text"
          placeholder="以 UID_ 开头的用户标识"
        />
      </template>
      <template v-else-if="config.channel === 'wxpusher'">
        <BaseInput
          v-model="activeToken"
          label="WxPusher SPT"
          type="password"
          placeholder="以 SPT_ 开头的极简推送令牌"
        />
      </template>
      <template v-else-if="config.channel === 'bark'">
        <BaseInput
          v-model="activeToken"
          label="Bark Key 或服务器 URL"
          type="password"
          placeholder="设备 Key 或 https://api.day.app/设备Key/"
        />
      </template>
      <BaseInput
        v-else
        v-model="activeToken"
        label="Qmsg 酱 Key"
        type="password"
        placeholder="在 Qmsg 酱管理台获取"
      />

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <BaseInput
          v-model="config.title"
          label="标题"
          type="text"
          placeholder="提醒标题"
        />
        <BaseInput
          v-model="config.msg"
          label="内容"
          type="text"
          placeholder="提醒内容"
        />
      </div>
    </div>

    <div class="mt-4 flex justify-end gap-2 border-t pt-3 dark:border-gray-700">
      <BaseButton
        variant="secondary"
        size="sm"
        :loading="testing"
        :disabled="saving || disabled"
        @click="emit('test')"
      >
        测试通知
      </BaseButton>
      <BaseButton
        v-if="showSave !== false"
        variant="primary"
        size="sm"
        :loading="saving"
        :disabled="testing"
        @click="emit('save')"
      >
        保存下线提醒设置
      </BaseButton>
    </div>
  </div>
</template>
