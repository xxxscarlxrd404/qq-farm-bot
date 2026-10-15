<script setup lang="ts">
import { computed } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'

type ModalType = 'primary' | 'danger' | 'success' | 'secondary'

const props = withDefaults(defineProps<{
  show: boolean
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  loading?: boolean
  isAlert?: boolean
  type?: ModalType
  confirmationCode?: string
}>(), {
  title: '\u786E\u8BA4\u64CD\u4F5C',
  message: '\u786E\u5B9A\u8981\u6267\u884C\u6B64\u64CD\u4F5C\u5417\uFF1F',
  confirmText: '\u786E\u5B9A',
  cancelText: '\u53D6\u6D88',
  loading: false,
  isAlert: false,
  type: 'primary',
  confirmationCode: '',
})

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
  (e: 'close'): void
}>()

const confirmDisabled = computed(() => {
  if (props.loading)
    return true
  return false
})
const confirmVariant = computed<ModalType>(() => props.type || 'primary')
const modalTone = computed(() => props.type || 'primary')
const iconClass = computed(() => {
  if (props.isAlert)
    return props.type === 'danger' ? 'i-carbon-warning' : 'i-carbon-information'
  if (props.type === 'danger')
    return 'i-carbon-warning-alt'
  if (props.type === 'success')
    return 'i-carbon-checkmark'
  return 'i-carbon-help'
})

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
  emit('confirm')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-modal">
      <div
        v-if="show"
        class="confirm-modal-overlay"
        @click="closeModal"
      >
      <div
        class="confirm-modal"
        :data-tone="modalTone"
        @click.stop
      >
        <div class="confirm-modal-icon">
          <div :class="iconClass" />
        </div>

        <div class="confirm-modal-content">
          <h3 class="confirm-modal-title">
            {{ title }}
          </h3>
          <p class="confirm-modal-message">
            {{ message }}
          </p>
        </div>

        <div class="confirm-modal-actions" :class="{ 'is-alert': isAlert }">
          <BaseButton
            v-if="!isAlert"
            class="confirm-modal-button"
            variant="secondary"
            :disabled="loading"
            @click="cancel"
          >
            {{ cancelText }}
          </BaseButton>
          <BaseButton
            class="confirm-modal-button"
            :variant="confirmVariant"
            :loading="loading"
            :disabled="confirmDisabled"
            @click="confirm"
          >
            {{ confirmText }}
          </BaseButton>
        </div>
      </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 200000 !important;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.34);
  backdrop-filter: blur(4px);
}

.confirm-modal {
  width: min(100%, 430px);
  border: 1px solid rgba(102, 187, 106, 0.22);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow:
    0 18px 56px rgba(46, 125, 50, 0.14),
    0 8px 28px rgba(15, 23, 42, 0.14);
  padding: 28px;
  text-align: center;
}

.confirm-modal-icon {
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

.confirm-modal[data-tone='danger'] {
  border-color: rgba(239, 68, 68, 0.24);
}

.confirm-modal[data-tone='danger'] .confirm-modal-icon {
  border-color: #ef9a9a;
  background: #ffebee;
  color: #d32f2f;
  box-shadow: 0 6px 18px rgba(239, 68, 68, 0.12);
}

.confirm-modal[data-tone='success'] .confirm-modal-icon {
  border-color: #66bb6a;
  background: #e8f5e9;
  color: #2e7d32;
}

.confirm-modal-content {
  margin-top: 16px;
}

.confirm-modal-title {
  margin: 0;
  color: #2e7d32;
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.25;
}

.confirm-modal[data-tone='danger'] .confirm-modal-title {
  color: #c62828;
}

.confirm-modal-message {
  margin: 12px 0 0;
  white-space: pre-line;
  color: #546e5a;
  font-size: 0.92rem;
  line-height: 1.65;
}

.confirm-modal-actions {
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr 1fr;
  margin-top: 24px;
}

.confirm-modal-actions.is-alert {
  grid-template-columns: 1fr;
}

.confirm-modal-button {
  min-height: 44px;
  border-radius: 10px;
  font-weight: 700;
}

.confirm-modal-enter-active,
.confirm-modal-leave-active {
  transition: opacity 0.2s ease;
}

.confirm-modal-enter-from,
.confirm-modal-leave-to {
  opacity: 0;
}

.confirm-modal-enter-active .confirm-modal,
.confirm-modal-leave-active .confirm-modal {
  transition: transform 0.2s ease;
}

.confirm-modal-enter-from .confirm-modal,
.confirm-modal-leave-to .confirm-modal {
  transform: translateY(8px) scale(0.97);
}

@media (max-width: 480px) {
  .confirm-modal-overlay {
    align-items: flex-end;
  }

  .confirm-modal {
    padding: 24px 22px 22px;
  }
}
</style>
