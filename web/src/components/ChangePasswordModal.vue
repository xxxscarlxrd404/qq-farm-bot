<script setup lang="ts">
import { ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useToastStore } from '@/stores/toast'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'success'): void
}>()

const toast = useToastStore()
const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const loading = ref(false)

async function handleSubmit() {
  if (!oldPassword.value) {
    toast.warning('请输入当前旧密码')
    return
  }
  if (!newPassword.value) {
    toast.warning('请输入新密码')
    return
  }
  if (newPassword.value.length < 5) {
    toast.warning('新密码长度不能少于5位')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    toast.warning('两次输入的新密码不一致')
    return
  }

  loading.value = true
  try {
    const res = await api.post('/api/user/change-password', {
      oldPassword: oldPassword.value,
      newPassword: newPassword.value,
    })
    if (res.data && res.data.ok) {
      toast.success('密码修改成功，请牢记新密码！')
      emit('success')
      emit('close')
    } else {
      toast.error(res.data?.error || '密码修改失败')
    }
  } catch (err: any) {
    toast.error(err.response?.data?.error || err.message || '网络错误，修改密码失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
    @click.self="emit('close')"
  >
    <div
      class="max-w-sm w-full rounded-2xl border border-white/60 bg-white p-5 shadow-2xl backdrop-blur-md dark:border-gray-700/60 dark:bg-gray-800"
      @click.stop
    >
      <div class="mb-4 flex items-center justify-between border-b border-gray-100 pb-2.5 dark:border-gray-700">
        <h3 class="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <span class="i-carbon-password text-blue-500" />
          修改登录密码
        </h3>
        <button
          class="h-7 w-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
          @click="emit('close')"
        >
          <div class="i-carbon-close text-lg" />
        </button>
      </div>

      <div class="space-y-3.5">
        <div>
          <label class="mb-1 block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
            当前原密码
          </label>
          <BaseInput
            v-model="oldPassword"
            type="password"
            placeholder="请输入当前旧密码"
          />
        </div>

        <div>
          <label class="mb-1 block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
            新密码
          </label>
          <BaseInput
            v-model="newPassword"
            type="password"
            placeholder="请输入新密码（至少5位）"
          />
        </div>

        <div>
          <label class="mb-1 block text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
            确认新密码
          </label>
          <BaseInput
            v-model="confirmPassword"
            type="password"
            placeholder="请再次输入新密码"
          />
        </div>
      </div>

      <div class="mt-5 flex justify-end gap-2.5">
        <BaseButton variant="secondary" size="sm" @click="emit('close')">
          取消
        </BaseButton>
        <BaseButton
          variant="primary"
          size="sm"
          :disabled="loading"
          @click="handleSubmit"
        >
          <span v-if="loading" class="i-svg-spinners-90-ring-with-bg mr-1" />
          确认修改
        </BaseButton>
      </div>
    </div>
  </div>
</template>
