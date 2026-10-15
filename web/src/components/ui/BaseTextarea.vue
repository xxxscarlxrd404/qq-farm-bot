<script setup lang="ts">
defineProps<{
  placeholder?: string
  label?: string
  disabled?: boolean
  rows?: number
}>()
const model = defineModel<string>()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" class="text-sm text-gray-700 font-medium dark:text-gray-300">
      {{ label }}
    </label>
    <textarea
      v-model="model"
      :rows="rows || 3"
      :placeholder="placeholder"
      :disabled="disabled"
      class="base-textarea w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none transition-all duration-200 dark:border-gray-700 disabled:bg-gray-50 dark:text-white disabled:text-gray-400 dark:disabled:bg-gray-800/50"
    />
  </div>
</template>

<style scoped>
.base-textarea {
  background: var(--input-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.base-textarea:focus {
  border-color: var(--theme-primary);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--theme-primary) 18%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.32);
}
</style>
