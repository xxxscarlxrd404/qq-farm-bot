<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps<{
  label?: string
  options?: { label: string, value: string | number, disabled?: boolean }[]
  disabled?: boolean
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'change', value: string | number): void
}>()

const model = defineModel<string | number>()

const isOpen = ref(false)
const containerRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
const dropdownDirection = ref<'down' | 'up'>('down')
const dropdownMaxHeight = ref(240)

const selectedLabel = computed(() => {
  const selected = props.options?.find(opt => opt.value === model.value)
  return selected ? selected.label : (props.placeholder || '请选择')
})

function updateDropdownPlacement() {
  const trigger = triggerRef.value
  if (!trigger)
    return

  const triggerRect = trigger.getBoundingClientRect()
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight
  const gap = 8
  const preferredHeight = 240
  const spaceBelow = viewportHeight - triggerRect.bottom - gap
  const spaceAbove = triggerRect.top - gap
  const shouldOpenUp = spaceBelow < preferredHeight && spaceAbove > spaceBelow
  const availableHeight = shouldOpenUp ? spaceAbove : spaceBelow

  dropdownDirection.value = shouldOpenUp ? 'up' : 'down'
  dropdownMaxHeight.value = Math.max(120, Math.min(preferredHeight, Math.floor(availableHeight)))
}

async function toggleDropdown() {
  if (props.disabled)
    return
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    await nextTick()
    updateDropdownPlacement()
  }
}

function selectOption(value: string | number) {
  model.value = value
  isOpen.value = false
  emit('change', value)
}

function closeDropdown(e: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    isOpen.value = false
  }
}

function handleViewportChange() {
  if (isOpen.value)
    updateDropdownPlacement()
}

onMounted(() => {
  document.addEventListener('click', closeDropdown)
  document.addEventListener('scroll', handleViewportChange, true)
  window.addEventListener('resize', handleViewportChange)
})

onUnmounted(() => {
  document.removeEventListener('click', closeDropdown)
  document.removeEventListener('scroll', handleViewportChange, true)
  window.removeEventListener('resize', handleViewportChange)
})
</script>

<template>
  <div ref="containerRef" class="flex flex-col gap-1.5">
    <label v-if="label" class="text-sm text-gray-700 font-medium dark:text-gray-300">
      {{ label }}
    </label>
    <div class="relative">
      <!-- Trigger -->
      <div
        ref="triggerRef"
        class="base-select-trigger w-full flex cursor-pointer items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none transition-all duration-200 dark:border-gray-700 dark:text-white"
        :class="{
          'bg-gray-50 text-gray-400 cursor-not-allowed dark:bg-gray-800/50': disabled,
          'is-open': isOpen,
        }"
        @click="toggleDropdown"
      >
        <span class="truncate">{{ selectedLabel }}</span>
        <div class="i-carbon-chevron-down text-lg text-gray-400 transition-transform duration-200" :class="{ 'rotate-180': isOpen }" />
      </div>

      <!-- Dropdown Menu -->
      <Transition
        enter-active-class="transition duration-100 ease-out"
        enter-from-class="transform scale-95 opacity-0"
        enter-to-class="transform scale-100 opacity-100"
        leave-active-class="transition duration-75 ease-in"
        leave-from-class="transform scale-100 opacity-100"
        leave-to-class="transform scale-95 opacity-0"
      >
        <div
          v-if="isOpen"
          class="glass-panel absolute left-0 right-0 z-[70] overflow-auto rounded-lg py-1"
          :class="dropdownDirection === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'"
          :style="{ maxHeight: `${dropdownMaxHeight}px` }"
        >
          <template v-if="options?.length">
            <div
              v-for="opt in options"
              :key="opt.value"
              class="cursor-pointer px-3 py-2 text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-700/50"
              :class="{
                'text-primary': model === opt.value,
                'text-gray-400 cursor-not-allowed hover:bg-transparent dark:text-gray-500': opt.disabled,
                'text-gray-700 dark:text-gray-200': model !== opt.value && !opt.disabled,
              }"
              @click="!opt.disabled && selectOption(opt.value)"
            >
              <slot name="option" :option="opt" :selected="model === opt.value">
                {{ opt.label }}
              </slot>
            </div>
          </template>
          <div v-else class="px-3 py-2 text-center text-sm text-gray-400">
            暂无选项
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.base-select-trigger {
  background: var(--input-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.base-select-trigger.is-open {
  border-color: var(--theme-primary);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--theme-primary) 18%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.32);
}

.text-primary {
  background: color-mix(in srgb, var(--theme-primary) 10%, transparent);
  color: var(--theme-primary);
}
</style>
