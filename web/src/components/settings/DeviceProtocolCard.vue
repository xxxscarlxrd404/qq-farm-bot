<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

interface DeviceProtocolConfig {
  enabled: boolean
  userAgent: string
  deviceModel: string
  deviceBrand: string
  deviceMac: string
  deviceId: string
  imei: string
}

defineProps<{
  loading: boolean
  saving: boolean
  presetOptions: { label: string, value: string | number }[]
  showSave?: boolean
}>()

const emit = defineEmits<{
  applyPreset: [value: string | number | undefined]
  randomMac: []
  randomDeviceId: []
  randomImei: []
  save: []
}>()

const form = defineModel<DeviceProtocolConfig>('form', { required: true })
const selectedPreset = defineModel<string | number>('selectedPreset', { required: true })
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between border-b border-gray-100/70 pb-2 dark:border-gray-800/70">
      <h4 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
        <div class="i-carbon-mobile text-blue-500" />
        设备协议配置
      </h4>
      <span class="text-xs text-gray-400">全局风控设备特征参数</span>
    </div>

    <div v-if="loading" class="py-8 text-center text-sm text-gray-500">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl text-blue-500" />
      <p>正在同步协议配置...</p>
    </div>

    <div v-else class="space-y-3.5">
      <!-- 开启开关微面板 -->
      <div class="rounded-xl bg-gray-50/70 p-3.5 dark:bg-gray-800/40 border border-gray-100/60 dark:border-gray-800/60">
        <BaseSwitch
          v-model="form.enabled"
          label="启用自定义设备协议"
        />
        <p class="mt-1.5 text-xs text-gray-400 leading-relaxed">
          启用后将模拟指定机型设备特征发起登录。修改后建议重新扫码或登录相关账号以应用新指纹。
        </p>
      </div>

      <BaseSelect
        v-model="selectedPreset"
        label="快速选择热门机型"
        :options="presetOptions"
        @update:model-value="emit('applyPreset', $event)"
      />

      <BaseInput
        v-model="form.userAgent"
        label="协议头 (User-Agent，可留空)"
        type="text"
        placeholder="手机 QQ 预设留空，不发送此请求头"
      />

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <BaseInput
          v-model="form.deviceBrand"
          label="设备品牌"
          type="text"
          placeholder="如 Apple / Huawei / Xiaomi"
        />
        <BaseInput
          v-model="form.deviceModel"
          label="设备型号"
          type="text"
          placeholder="如 iPhone 15 Pro Max"
        />
      </div>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div class="flex items-end gap-2">
          <BaseInput
            v-model="form.deviceMac"
            class="flex-1"
            label="设备 MAC 地址"
            type="text"
            placeholder="XX:XX:XX:XX:XX:XX"
          />
          <BaseButton variant="secondary" size="sm" @click="emit('randomMac')">
            随机
          </BaseButton>
        </div>
        <div class="flex items-end gap-2">
          <BaseInput
            v-model="form.deviceId"
            class="flex-1"
            label="设备 ID"
            type="text"
            placeholder="16位设备 ID"
          />
          <BaseButton variant="secondary" size="sm" @click="emit('randomDeviceId')">
            随机
          </BaseButton>
        </div>
        <div class="flex items-end gap-2">
          <BaseInput
            v-model="form.imei"
            class="flex-1"
            label="IMEI 编码"
            type="text"
            placeholder="15位 IMEI"
          />
          <BaseButton variant="secondary" size="sm" @click="emit('randomImei')">
            随机
          </BaseButton>
        </div>
      </div>

      <p class="text-xs text-gray-400 font-mono">
        ※ 此组特征全局生效，不区分单个账号。仅在遭遇风控限制或协议不兼容时启用。
      </p>

      <div v-if="showSave !== false" class="flex justify-end border-t border-gray-100/70 pt-3 dark:border-gray-800/70">
        <BaseButton
          variant="primary"
          size="sm"
          :loading="saving"
          @click="emit('save')"
        >
          保存设备协议配置
        </BaseButton>
      </div>
    </div>
  </div>
</template>
