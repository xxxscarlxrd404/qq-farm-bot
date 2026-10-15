<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

const props = defineProps<{
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'outline' | 'text'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
  block?: boolean
  to?: string
  href?: string
  type?: 'button' | 'submit' | 'reset'
}>()

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

const componentTag = computed(() => {
  if (props.to)
    return RouterLink
  if (props.href)
    return 'a'
  return 'button'
})

const baseClasses = 'liquid-btn inline-flex items-center justify-center rounded-xl font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.97]'

const variantClasses = computed(() => {
  switch (props.variant) {
    case 'primary':
      return 'liquid-btn-primary text-white shadow-md hover:-translate-y-0.5 focus:ring-[var(--theme-primary)]'
    case 'secondary':
      return 'liquid-btn-secondary text-gray-800 hover:-translate-y-0.5 focus:ring-gray-400 dark:text-gray-100'
    case 'success':
      return 'liquid-btn-success text-white hover:-translate-y-0.5 focus:ring-green-500 shadow-md'
    case 'danger':
      return 'liquid-btn-danger text-white hover:-translate-y-0.5 focus:ring-red-500 shadow-md'
    case 'ghost':
      return 'liquid-btn-ghost text-gray-700 hover:bg-white/50 dark:text-gray-300 dark:hover:bg-gray-800/50'
    case 'outline':
      return 'liquid-btn-outline text-gray-700 hover:-translate-y-0.5 dark:text-gray-200'
    case 'text':
      return 'hover:underline p-0 bg-transparent shadow-none hover:bg-transparent'
    default:
      return 'liquid-btn-primary text-white shadow-md hover:-translate-y-0.5 focus:ring-[var(--theme-primary)]'
  }
})

const sizeClasses = computed(() => {
  if (props.variant === 'text')
    return ''

  switch (props.size) {
    case 'sm':
      return 'px-3 py-1.5 text-xs'
    case 'lg':
      return 'px-6 py-3 text-base'
    default:
      return 'px-4 py-2 text-sm'
  }
})

const widthClasses = computed(() => props.block ? 'w-full' : '')
</script>

<template>
  <component
    :is="componentTag"
    :to="to"
    :href="href"
    :type="!to && !href ? (type || 'button') : undefined"
    :disabled="disabled || loading"
    :class="[baseClasses, variantClasses, sizeClasses, widthClasses]"
    v-bind="$attrs"
    @click="!disabled && !loading && emit('click', $event)"
  >
    <div v-if="loading" class="i-svg-spinners-ring-resize mr-2 animate-spin" />
    <slot />
  </component>
</template>

<style scoped>
.liquid-btn {
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.liquid-btn-primary {
  background: var(--theme-gradient);
  border: 1px solid rgba(255, 255, 255, 0.45);
  box-shadow:
    inset 0 1px 1.5px rgba(255, 255, 255, 0.75),
    0 8px 20px color-mix(in srgb, var(--theme-primary) 30%, transparent);
}

.liquid-btn-primary:hover {
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.9),
    0 12px 28px color-mix(in srgb, var(--theme-primary) 42%, transparent);
  filter: brightness(1.05);
}

.liquid-btn-secondary {
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.75);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.9),
    0 4px 14px rgba(15, 23, 42, 0.05);
}

.dark .liquid-btn-secondary {
  background: rgba(30, 41, 59, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.15),
    0 4px 14px rgba(0, 0, 0, 0.3);
}

.liquid-btn-secondary:hover {
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(255, 255, 255, 0.95);
}

.dark .liquid-btn-secondary:hover {
  background: rgba(51, 65, 85, 0.75);
}

.liquid-btn-success {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  border: 1px solid rgba(255, 255, 255, 0.4);
  box-shadow:
    inset 0 1px 1.5px rgba(255, 255, 255, 0.7),
    0 8px 20px rgba(16, 185, 129, 0.3);
}

.liquid-btn-danger {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  border: 1px solid rgba(255, 255, 255, 0.4);
  box-shadow:
    inset 0 1px 1.5px rgba(255, 255, 255, 0.7),
    0 8px 20px rgba(239, 68, 68, 0.3);
}

.liquid-btn-outline {
  background: rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.6);
}

.dark .liquid-btn-outline {
  background: rgba(30, 41, 59, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.15);
}
</style>
