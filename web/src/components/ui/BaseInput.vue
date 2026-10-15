<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  type?: string
  placeholder?: string
  label?: string
  disabled?: boolean
  clearable?: boolean
  min?: string | number
  max?: string | number
  step?: string | number
}>()
const emit = defineEmits<{
  (e: 'clear'): void
}>()
const [model, modelModifiers] = defineModel<string | number>()
const showPassword = ref(false)
const inputType = computed(() => {
  if (props.type === 'password' && showPassword.value) {
    return 'text'
  }
  return props.type || 'text'
})

function updateModel(event: Event) {
  const value = (event.target as HTMLInputElement).value
  model.value = (props.type === 'number' || modelModifiers.number) && value !== ''
    ? Number(value)
    : value
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" class="text-sm text-gray-700 font-medium dark:text-gray-300">
      {{ label }}
    </label>
    <div class="relative">
      <input
        :value="model"
        :type="inputType"
        :placeholder="placeholder"
        :disabled="disabled"
        :min="min"
        :max="max"
        :step="step"
        class="base-input w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none transition-all duration-200 dark:border-gray-700 disabled:bg-gray-50 dark:text-white disabled:text-gray-400 focus:ring-2 dark:disabled:bg-gray-800/50"
        :class="{ 'pr-10': type === 'password' || (clearable && model) }"
        @input="updateModel"
      >
      <button
        v-if="type === 'password'"
        type="button"
        class="absolute right-3 top-1/2 text-gray-400 -translate-y-1/2 hover:text-gray-600 dark:hover:text-gray-300"
        @click="showPassword = !showPassword"
      >
        <div v-if="showPassword" class="i-carbon-view-off" />
        <div v-else class="i-carbon-view" />
      </button>

      <button
        v-else-if="clearable && model"
        type="button"
        class="absolute right-3 top-1/2 text-gray-400 -translate-y-1/2 hover:text-gray-600 dark:hover:text-gray-300"
        @click="model = ''; emit('clear')"
      >
        <div class="i-carbon-close" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.base-input::-ms-reveal,
.base-input::-ms-clear {
  display: none;
}

.base-input {
  background: var(--input-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.base-input:focus {
  border-color: var(--theme-primary);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--theme-primary) 18%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.32);
}
</style>
