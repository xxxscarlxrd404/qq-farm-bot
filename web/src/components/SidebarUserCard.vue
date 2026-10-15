<script setup lang="ts">
import { ref } from 'vue'
import { useSidebarUser } from './useSidebarUser'
import ChangePasswordModal from './ChangePasswordModal.vue'

const { userStore, handleLogout } = useSidebarUser()
const showPasswordModal = ref(false)
</script>

<template>
  <div
    v-if="userStore.token"
    class="liquid-user-card relative mt-2.5 flex-none rounded-2xl p-2.5 transition-all"
  >
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2.5 min-w-0">
        <!-- 机器人矢量图标 -->
        <div class="relative h-9 w-9 flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-blue-500/15 to-indigo-500/20 text-blue-600 dark:text-blue-400 ring-1 ring-white/80 shadow-sm">
          <div class="i-carbon-bot text-xl" />
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span class="truncate text-xs font-bold" style="color: var(--theme-text);">
              {{ userStore.username }}
            </span>
            <span
              class="text-[10px] px-1.5 py-0.2 rounded-md font-semibold"
              :class="userStore.isAdmin ? 'bg-purple-100/80 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300' : 'bg-blue-100/80 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'"
            >
              {{ userStore.isAdmin ? '管理员' : '普通' }}
            </span>
          </div>
          <div class="text-[11px] truncate opacity-65" style="color: var(--theme-text);">
            <span v-if="userStore.userCard">{{ userStore.expireTimeText }} · {{ userStore.isAdmin ? '♾️' : `${userStore.accountLimit}额度` }}</span>
            <span v-else>无卡密限制</span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-1">
        <!-- 修改密码按钮 -->
        <button
          class="h-7 w-7 flex shrink-0 items-center justify-center rounded-xl hover:bg-blue-500/20 hover:text-blue-500 transition-all opacity-70 hover:opacity-100"
          title="修改登录密码"
          @click="showPasswordModal = true"
        >
          <div class="i-carbon-password text-sm" />
        </button>

        <!-- 退出登录按钮 -->
        <button
          class="h-7 w-7 flex shrink-0 items-center justify-center rounded-xl hover:bg-red-500/20 hover:text-red-500 transition-all opacity-70 hover:opacity-100"
          title="退出登录"
          @click="handleLogout"
        >
          <div class="i-carbon-logout text-sm" />
        </button>
      </div>
    </div>

    <!-- 修改密码弹窗 -->
    <Teleport to="body">
      <ChangePasswordModal
        v-if="showPasswordModal"
        @close="showPasswordModal = false"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.liquid-user-card {
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.65);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.8), 0 4px 16px rgba(15, 23, 42, 0.04);
}

.dark .liquid-user-card {
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.12);
}
</style>
