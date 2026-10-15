<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { formatCurrencyAmountByLabel } from '@/utils/number-format'

const props = withDefaults(defineProps<{
  show: boolean
  title?: string
  itemName: string
  unitPrice: number
  currencyLabel: string
  balance: number
  loading?: boolean
  maxQuantity?: number
  isFree?: boolean
}>(), {
  title: '\u786E\u8BA4\u8D2D\u4E70',
  loading: false,
  maxQuantity: 99,
  isFree: false,
})

const emit = defineEmits<{
  (e: 'confirm', quantity: number): void
  (e: 'close'): void
  (e: 'cancel'): void
}>()

const quantity = ref(1)

const L = {
  unitPrice: '\u5355\u4EF7',
  quantity: '\u6570\u91CF',
  total: '\u5408\u8BA1',
  balance: '\u4F59\u989D',
  max: '\u6700\u5927',
  cancel: '\u53D6\u6D88',
  confirm: '\u786E\u5B9A\u8D2D\u4E70',
  free: '\u514D\u8D39',
}

const normalizedUnitPrice = computed(() => Math.max(0, Number(props.unitPrice) || 0))
const normalizedBalance = computed(() => Math.max(0, Number(props.balance) || 0))
const configuredMax = computed(() => Math.max(1, Math.min(99, Math.floor(Number(props.maxQuantity) || 99))))
const affordableMax = computed(() => {
  if (props.isFree)
    return configuredMax.value
  if (normalizedUnitPrice.value <= 0)
    return 1
  return Math.floor(normalizedBalance.value / normalizedUnitPrice.value)
})
const maxBuyCount = computed(() => Math.max(1, Math.min(99, configuredMax.value, affordableMax.value)))
const normalizedQuantity = computed(() => {
  const value = Math.floor(Number(quantity.value) || 1)
  return Math.max(1, Math.min(maxBuyCount.value, value))
})
const totalCost = computed(() => normalizedUnitPrice.value * normalizedQuantity.value)
const confirmDisabled = computed(() => props.loading || normalizedQuantity.value < 1 || normalizedQuantity.value > maxBuyCount.value)

watch(() => props.show, (show) => {
  if (show)
    quantity.value = 1
})

watch(maxBuyCount, () => {
  quantity.value = normalizedQuantity.value
})

function setQuantity(value: number) {
  quantity.value = Math.max(1, Math.min(maxBuyCount.value, Math.floor(Number(value) || 1)))
}

function closeModal() {
  if (props.loading)
    return
  emit('close')
}

function cancel() {
  if (props.loading)
    return
  emit('cancel')
}

function confirm() {
  if (confirmDisabled.value)
    return
  emit('confirm', normalizedQuantity.value)
}
</script>

<template>
  <Transition name="purchase-modal">
    <div
      v-if="show"
      class="purchase-modal-overlay"
      @click="closeModal"
    >
      <div class="purchase-modal" @click.stop>
        <div class="purchase-modal-icon">
          <div class="i-carbon-shopping-cart" />
        </div>

        <div class="mt-4">
          <h3 class="text-xl text-emerald-700 font-bold dark:text-emerald-300">
            {{ title }}
          </h3>
          <div class="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {{ itemName }}
          </div>
        </div>

        <div class="mt-5 text-left space-y-4">
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
              <div class="text-xs text-gray-500 dark:text-gray-400">
                {{ L.unitPrice }}
              </div>
              <div class="mt-1 font-semibold">
                {{ isFree ? L.free : `${formatCurrencyAmountByLabel(unitPrice, currencyLabel)} ${currencyLabel}` }}
              </div>
            </div>
            <div class="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
              <div class="text-xs text-gray-500 dark:text-gray-400">
                {{ L.balance }}
              </div>
              <div class="mt-1 font-semibold">
                {{ formatCurrencyAmountByLabel(balance, currencyLabel) }} {{ currencyLabel }}
              </div>
            </div>
          </div>

          <div>
            <div class="mb-2 flex items-center justify-between">
              <label class="text-sm text-gray-700 font-medium dark:text-gray-300">
                {{ L.quantity }}
              </label>
              <span class="text-xs text-gray-500 dark:text-gray-400">{{ L.max }} {{ maxBuyCount }}</span>
            </div>
            <div class="qty-control-row">
              <button
                type="button"
                class="qty-icon-button"
                :disabled="loading || normalizedQuantity <= 1"
                @click="setQuantity(normalizedQuantity - 1)"
              >
                <div class="i-carbon-subtract" />
              </button>
              <input
                :value="normalizedQuantity"
                type="number"
                min="1"
                :max="maxBuyCount"
                class="qty-input"
                :disabled="loading"
                @input="setQuantity(Number(($event.target as HTMLInputElement).value))"
              >
              <button
                type="button"
                class="qty-icon-button"
                :disabled="loading || normalizedQuantity >= maxBuyCount"
                @click="setQuantity(normalizedQuantity + 1)"
              >
                <div class="i-carbon-add" />
              </button>
              <button
                type="button"
                class="qty-max-button"
                :disabled="loading"
                @click="setQuantity(maxBuyCount)"
              >
                {{ L.max }}
              </button>
            </div>
          </div>

          <div class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
            {{ L.total }} {{ isFree ? L.free : `${formatCurrencyAmountByLabel(totalCost, currencyLabel)} ${currencyLabel}` }}
          </div>
        </div>

        <div class="grid grid-cols-2 mt-6 gap-3">
          <BaseButton variant="secondary" :disabled="loading" @click="cancel">
            {{ L.cancel }}
          </BaseButton>
          <BaseButton variant="primary" :loading="loading" :disabled="confirmDisabled" @click="confirm">
            {{ L.confirm }}
          </BaseButton>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.purchase-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.34);
  backdrop-filter: blur(4px);
}

.purchase-modal {
  width: min(100%, 460px);
  border: 1px solid rgba(102, 187, 106, 0.22);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow:
    0 18px 56px rgba(46, 125, 50, 0.14),
    0 8px 28px rgba(15, 23, 42, 0.14);
  padding: 28px;
  text-align: center;
}

.purchase-modal-icon {
  display: inline-flex;
  width: 56px;
  height: 56px;
  align-items: center;
  justify-content: center;
  border: 2px solid #66bb6a;
  border-radius: 50%;
  background: #e8f5e9;
  color: #43a047;
  font-size: 1.6rem;
  box-shadow: 0 6px 18px rgba(102, 187, 106, 0.16);
}

.qty-control-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 40px 72px;
  gap: 8px;
}

.qty-icon-button,
.qty-max-button,
.qty-input {
  min-height: 40px;
  border: 1px solid rgba(148, 163, 184, 0.42);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.92);
  color: #334155;
  font-size: 0.92rem;
  font-weight: 700;
  outline: none;
  transition: all 0.18s ease;
}

.qty-icon-button,
.qty-max-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.qty-input {
  width: 100%;
  padding: 0 12px;
  text-align: center;
}

.qty-icon-button:hover:not(:disabled),
.qty-max-button:hover:not(:disabled),
.qty-input:focus {
  border-color: var(--theme-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--theme-primary) 14%, transparent);
}

.qty-icon-button:disabled,
.qty-max-button:disabled,
.qty-input:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.purchase-modal-enter-active,
.purchase-modal-leave-active {
  transition: opacity 0.2s ease;
}

.purchase-modal-enter-from,
.purchase-modal-leave-to {
  opacity: 0;
}

.purchase-modal-enter-active .purchase-modal,
.purchase-modal-leave-active .purchase-modal {
  transition: transform 0.2s ease;
}

.purchase-modal-enter-from .purchase-modal,
.purchase-modal-leave-to .purchase-modal {
  transform: translateY(8px) scale(0.97);
}

@media (max-width: 480px) {
  .purchase-modal-overlay {
    align-items: flex-end;
  }

  .purchase-modal {
    padding: 24px 22px 22px;
  }

  .qty-control-row {
    grid-template-columns: 38px minmax(0, 1fr) 38px 64px;
    gap: 6px;
  }
}
</style>
