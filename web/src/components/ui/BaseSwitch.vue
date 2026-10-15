<script setup lang="ts">
defineProps<{
  label?: string
  disabled?: boolean
}>()
const model = defineModel<boolean>()
</script>

<template>
  <label class="inline-flex items-center gap-3" :class="disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'">
    <div class="relative inline-flex items-center">
      <input v-model="model" type="checkbox" class="peer sr-only" :disabled="disabled">
      <div class="base-switch h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:border after:border-gray-300 dark:border-gray-600 after:rounded-full after:bg-white dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-2 after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
    </div>
    <span v-if="label" class="select-none text-sm text-gray-700 font-medium dark:text-gray-300">
      {{ label }}
    </span>
  </label>
</template>

<style scoped>
.peer:checked + .base-switch {
  background: var(--theme-gradient);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--theme-primary) 14%, transparent);
}
</style>
