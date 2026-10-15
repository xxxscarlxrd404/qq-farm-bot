<script setup lang="ts">
import { marked } from 'marked'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useAppStore } from '@/stores/app'

defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const updateReadme = '暂无更新日志。'

const appStore = useAppStore()

const renderedContent = computed(() => marked.parse(updateReadme, {
  gfm: true,
  breaks: false,
}) as string)

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape')
    emit('close')
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="update-log-modal">
      <div
        v-if="show"
        class="update-log-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-log-title"
        @click.self="emit('close')"
      >
        <section class="update-log-panel">
          <header class="update-log-header">
            <div>
              <h2 id="update-log-title">
                更新日志
              </h2>
              <p>{{ appStore.loginPageConfig.title || 'QQ农场智能助手' }}版本记录</p>
            </div>
            <button
              type="button"
              class="update-log-close"
              aria-label="关闭更新日志"
              title="关闭"
              @click="emit('close')"
            >
              <span class="i-carbon-close" />
            </button>
          </header>

          <div class="update-log-body">
            <article class="markdown-content" v-html="renderedContent" />
          </div>

          <footer class="update-log-footer">
            <button type="button" @click="emit('close')">
              关闭
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.update-log-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.38);
  backdrop-filter: blur(5px);
}

.update-log-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(720px, 100%);
  max-height: min(82vh, 760px);
  overflow: hidden;
  background: #fff;
  border: 1px solid #dbe4dc;
  border-radius: 8px;
  box-shadow: 0 24px 72px rgba(15, 23, 42, 0.22);
}

.update-log-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid #e5e7eb;
}

.update-log-header h2 {
  margin: 0;
  color: #1f2937;
  font-size: 1.2rem;
  line-height: 1.4;
}

.update-log-header p {
  margin: 3px 0 0;
  color: #6b7280;
  font-size: 0.8rem;
}

.update-log-close {
  display: inline-flex;
  flex: 0 0 36px;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  color: #64748b;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  transition: 0.2s ease;
}

.update-log-close:hover {
  color: #1f2937;
  background: #f3f4f6;
  border-color: #e5e7eb;
}

.update-log-body {
  min-height: 0;
  padding: 4px 22px 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.markdown-content {
  color: #374151;
  font-size: 0.9rem;
  line-height: 1.72;
}

.markdown-content :deep(h1) {
  margin: 18px 0 8px;
  color: #166534;
  font-size: 1.35rem;
}

.markdown-content :deep(h2) {
  margin: 24px 0 10px;
  padding-bottom: 7px;
  color: #1f2937;
  font-size: 1.05rem;
  border-bottom: 1px solid #e5e7eb;
}

.markdown-content :deep(p) {
  margin: 8px 0;
}

.markdown-content :deep(ul) {
  display: grid;
  gap: 7px;
  margin: 8px 0;
  padding-left: 20px;
}

.markdown-content :deep(li::marker) {
  color: #16a34a;
}

.markdown-content :deep(code) {
  padding: 2px 5px;
  color: #9f1239;
  background: #fff1f2;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.84em;
}

.update-log-footer {
  display: flex;
  justify-content: flex-end;
  padding: 14px 22px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
}

.update-log-footer button {
  min-width: 84px;
  padding: 9px 16px;
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  cursor: pointer;
  background: #15803d;
  border: 0;
  border-radius: 6px;
}

.update-log-footer button:hover {
  background: #166534;
}

.update-log-modal-enter-active,
.update-log-modal-leave-active {
  transition: opacity 0.2s ease;
}

.update-log-modal-enter-active .update-log-panel,
.update-log-modal-leave-active .update-log-panel {
  transition: transform 0.2s ease;
}

.update-log-modal-enter-from,
.update-log-modal-leave-to {
  opacity: 0;
}

.update-log-modal-enter-from .update-log-panel,
.update-log-modal-leave-to .update-log-panel {
  transform: translateY(10px);
}

@media (max-width: 640px) {
  .update-log-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .update-log-panel {
    width: 100%;
    max-height: 90vh;
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: 8px 8px 0 0;
  }

  .update-log-header,
  .update-log-footer {
    padding-right: 18px;
    padding-left: 18px;
  }

  .update-log-body {
    padding-right: 18px;
    padding-left: 18px;
  }
}
</style>
