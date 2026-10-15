<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { DEVICE_PROTOCOL_PRESETS, generateRandomDeviceId, generateRandomImei, generateRandomMac } from '@/composables/settings/useUserSettings'
import { useToastStore } from '@/stores/toast'

const props = defineProps<{
  currentAccountId: string | number | null | undefined
  currentAccountName?: string | null
}>()

const toastStore = useToastStore()

const loading = ref(false)
const saving = ref(false)
const showModal = ref(false)
const selectedPreset = ref<string | number>('iphone_17')

const form = ref({
  enabled: false,
  userAgent: '',
  deviceModel: 'iPhone 17',
  deviceBrand: 'Apple',
  deviceMac: '',
  deviceId: '',
  imei: '',
})

const presetOptions = DEVICE_PROTOCOL_PRESETS.map(p => ({ label: p.label, value: p.value }))

// 读取当前账号的设备协议
async function fetchDeviceProtocol() {
  if (!props.currentAccountId) return
  loading.value = true
  try {
    const res = await api.get(`/api/accounts/${props.currentAccountId}/device-protocol`)
    if (res.data?.ok && res.data.config) {
      const c = res.data.config
      form.value = {
        enabled: c.enabled === true,
        userAgent: c.userAgent || '',
        deviceModel: c.deviceModel || 'iPhone 17',
        deviceBrand: c.deviceBrand || 'Apple',
        deviceMac: c.deviceMac || '',
        deviceId: c.deviceId || '',
        imei: c.imei || '',
      }
    }
  } catch (err: any) {
    console.error('获取设备协议失败:', err)
  } finally {
    loading.value = false
  }
}

// 保存当前账号的设备协议
async function saveDeviceProtocol(quiet = false) {
  if (!props.currentAccountId) return
  saving.value = true
  try {
    const res = await api.post(`/api/accounts/${props.currentAccountId}/device-protocol`, form.value)
    if (res.data?.ok) {
      if (!quiet) toastStore.success('自定义设备登录配置已保存并生效！')
      showModal.value = false
    } else {
      if (!quiet) toastStore.error(res.data?.error || '保存失败')
    }
  } catch (err: any) {
    if (!quiet) toastStore.error(err.response?.data?.error || err.message || '保存失败')
  } finally {
    saving.value = false
  }
}

// 快速切换胶囊开关（外侧唯一总开关，真跑通）
async function onToggle(enabled: boolean) {
  form.value.enabled = enabled
  await saveDeviceProtocol(true)
  toastStore.success(enabled ? '已开启自定义设备登录' : '已关闭自定义设备登录')
}

function applyPreset(val: string | number | undefined) {
  if (val === undefined) return
  const preset = DEVICE_PROTOCOL_PRESETS.find(item => item.value === val)
  if (!preset) return
  form.value.userAgent = preset.config.userAgent || ''
  form.value.deviceBrand = preset.config.deviceBrand || ''
  form.value.deviceModel = preset.config.deviceModel || ''
}

function fillRandomMac() { form.value.deviceMac = generateRandomMac() }
function fillRandomDeviceId() { form.value.deviceId = generateRandomDeviceId() }
function fillRandomImei() { form.value.imei = generateRandomImei() }

// 摘要标签
const summaryTags = computed(() => {
  if (!form.value.enabled) return ['使用默认官方指纹', '未开启模拟']
  return [
    form.value.deviceModel || '自定义机型',
    form.value.deviceBrand || '自定义品牌',
    form.value.deviceMac ? `MAC: ${form.value.deviceMac.slice(-8)}` : '默认MAC',
    form.value.deviceId ? '自定义ID' : '',
  ].filter(Boolean)
})

watch(() => props.currentAccountId, () => {
  fetchDeviceProtocol()
})

onMounted(() => {
  fetchDeviceProtocol()
})
</script>

<template>
  <article class="group min-h-[184px] flex flex-col border border-gray-200 rounded-lg bg-white p-4 transition dark:border-gray-700 hover:border-[var(--theme-primary)] dark:bg-gray-800 hover:shadow-sm">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex items-center gap-3">
        <!-- 专属手机图标 -->
        <img
          src="/shouji.svg"
          alt="设备"
          class="h-10 w-10 shrink-0 rounded-lg bg-gray-50 object-contain p-1.5 dark:bg-gray-700/60 shadow-sm"
        />
        <div>
          <h4 class="text-gray-900 font-semibold dark:text-gray-100 flex items-center gap-1.5">
            <span>自定义设备登录</span>
          </h4>
          <p class="mt-0.5 text-xs text-gray-500">
            防风控模拟机型与硬件指纹
          </p>
        </div>
      </div>
      <!-- 外层唯一胶囊总开关 -->
      <BaseSwitch
        :model-value="form.enabled"
        :disabled="loading || saving"
        @update:model-value="onToggle(!!$event)"
      />
    </div>

    <!-- 状态微胶囊标签 -->
    <div class="mt-4 min-h-[56px] flex flex-wrap content-start gap-2">
      <span
        v-for="tag in summaryTags"
        :key="tag"
        class="max-w-full truncate rounded-md bg-gray-50 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300 font-mono"
      >
        {{ tag }}
      </span>
    </div>

    <!-- 底部状态指示与配置按钮 -->
    <div class="mt-auto flex items-center justify-between pt-4 border-t border-gray-100/70 dark:border-gray-700/60">
      <span class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <span class="h-2 w-2 rounded-full" :class="form.enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'" />
        {{ form.enabled ? '已开启' : '未开启' }}
      </span>
      <BaseButton variant="secondary" size="sm" @click="showModal = true">
        配置
      </BaseButton>
    </div>
  </article>

  <!-- 点击配置弹出的专属设置浮层 (已删除内页重复开关，仅保留参数设置) -->
  <Teleport to="body">
    <div v-if="showModal" class="fixed inset-0 z-[100050] grid place-items-center overflow-y-auto bg-gray-950/60 p-3 backdrop-blur-[2px] sm:p-6" @click.self="showModal = false">
      <section class="max-h-[94vh] max-w-2xl w-full flex flex-col overflow-hidden border border-gray-200 rounded-2xl bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800 animate-scale-in">
        <header class="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700 sm:px-6">
          <div class="flex items-center gap-3">
            <img src="/shouji.svg" alt="" class="h-9 w-9 shrink-0 rounded-xl bg-gray-100 object-contain p-1 dark:bg-gray-700">
            <div>
              <h3 class="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100">
                自定义设备登录设置
                <span v-if="currentAccountName" class="text-xs text-gray-400 font-normal ml-2">
                  ({{ currentAccountName }})
                </span>
              </h3>
              <p class="text-xs text-gray-500">模拟指定手机机型与硬件指纹，降低风控概率。</p>
            </div>
          </div>
          <button class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" @click="showModal = false">
            <span class="i-carbon-close text-xl" />
          </button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          <BaseSelect
            v-model="selectedPreset"
            label="快速选择热门机型预设"
            :options="presetOptions"
            @update:model-value="applyPreset($event)"
          />

          <BaseInput
            v-model="form.userAgent"
            label="协议头 (User-Agent，可留空)"
            type="text"
            placeholder="留空则使用默认客户端头"
          />

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BaseInput v-model="form.deviceBrand" label="设备品牌" type="text" placeholder="如 Apple / Xiaomi" />
            <BaseInput v-model="form.deviceModel" label="设备型号" type="text" placeholder="如 iPhone 17" />
          </div>

          <div class="space-y-3">
            <div class="flex items-end gap-2">
              <BaseInput v-model="form.deviceMac" label="网卡 MAC 地址" type="text" class="flex-1 font-mono" placeholder="XX:XX:XX:XX:XX:XX" />
              <BaseButton variant="secondary" size="sm" class="h-9 shrink-0 whitespace-nowrap" @click="fillRandomMac">
                随机
              </BaseButton>
            </div>

            <div class="flex items-end gap-2">
              <BaseInput v-model="form.deviceId" label="16位 设备 ID" type="text" class="flex-1 font-mono" placeholder="16位十六进制 ID" />
              <BaseButton variant="secondary" size="sm" class="h-9 shrink-0 whitespace-nowrap" @click="fillRandomDeviceId">
                随机
              </BaseButton>
            </div>

            <div class="flex items-end gap-2">
              <BaseInput v-model="form.imei" label="15位 IMEI 串号" type="text" class="flex-1 font-mono" placeholder="15位纯数字 IMEI" />
              <BaseButton variant="secondary" size="sm" class="h-9 shrink-0 whitespace-nowrap" @click="fillRandomImei">
                随机
              </BaseButton>
            </div>
          </div>
        </div>

        <footer class="flex items-center justify-end gap-2.5 border-t border-gray-100 px-5 py-3.5 dark:border-gray-700 sm:px-6">
          <BaseButton variant="secondary" size="sm" @click="showModal = false">
            取消
          </BaseButton>
          <BaseButton variant="primary" size="sm" :loading="saving" @click="saveDeviceProtocol(false)">
            <span class="i-carbon-checkmark mr-1" />
            保存配置
          </BaseButton>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
