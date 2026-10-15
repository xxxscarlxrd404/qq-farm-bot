<script setup lang="ts">
import type { Account } from '@/stores/account'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import api from '@/api'
import AccountCareerModal from '@/components/AccountCareerModal.vue'
import AccountModal from '@/components/AccountModal.vue'
import RemarkModal from '@/components/RemarkModal.vue'
import { getPlatformClass, getPlatformLabel, useAccountStore } from '@/stores/account'
import { useStatusStore } from '@/stores/status'

const accountStore = useAccountStore()
const statusStore = useStatusStore()
const { accounts, currentAccount } = storeToRefs(accountStore)
const { currentStatusReady, status } = storeToRefs(statusStore)

const showAccountDropdown = ref(false)
const showAccountModal = ref(false)
const showRemarkModal = ref(false)
const showCareerModal = ref(false)
const careerLoading = ref(false)
const careerError = ref('')
const careerItems = ref<any[]>([])
const careerProfile = ref<Record<string, any>>({})
const accountToEdit = ref<any>(null)
const failedAvatars = ref(new Set<string>())

const triggerRef = useTemplateRef<HTMLElement>('trigger')
const dropdownPos = ref({ top: 0, left: 0, width: 320 })

function onScroll() {
  if (showAccountDropdown.value) {
    updateDropdownPos()
  }
}

function onResize() {
  if (showAccountDropdown.value) {
    updateDropdownPos()
  }
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onResize)
})

const isOnline = computed(() => {
  return !!status.value?.connection?.connected
})

function cleanText(value: unknown) {
  return String(value || '').trim()
}

function liveAccountName() {
  if (!currentStatusReady.value)
    return ''
  const name = cleanText(status.value?.status?.name)
  return name && name !== '未登录' ? name : ''
}

function liveAccountAvatar() {
  if (!currentStatusReady.value)
    return ''
  return cleanText(
    status.value?.status?.avatar
    || status.value?.status?.avatarUrl
    || status.value?.status?.avatar_url,
  )
}

function accountDisplayName(acc?: Account | null) {
  if (!acc)
    return '选择账号'

  const liveName = currentAccount.value?.id === acc.id ? liveAccountName() : ''
  const nick = cleanText(liveName || acc.nick)
  const remark = cleanText(acc.name)
  if (nick && remark && nick !== remark)
    return `${nick} (${remark})`
  if (nick)
    return nick
  if (remark)
    return remark
  return cleanText(acc.uin || acc.qq || acc.id) || '选择账号'
}

function accountSubtitle(acc?: Account | null) {
  if (!acc)
    return ''
  return cleanText(acc.uin || acc.qq || acc.id)
}

function avatarSource(acc?: Account | null) {
  if (!acc)
    return ''
  const explicit = currentAccount.value?.id === acc.id
    ? cleanText(liveAccountAvatar() || acc.avatar)
    : cleanText(acc.avatar)
  if (explicit)
    return explicit
  const qq = cleanText(acc.uin || acc.qq)
  if (qq && /^\d+$/.test(qq))
    return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`
  return ''
}

function avatarKey(acc?: Account | null) {
  return cleanText(acc?.id || acc?.uin || acc?.qq || acc?.wxid || '')
}

function shouldShowAvatar(acc?: Account | null) {
  const key = avatarKey(acc)
  return !!avatarSource(acc) && !!key && !failedAvatars.value.has(key)
}

function markAvatarFailed(acc?: Account | null) {
  const key = avatarKey(acc)
  if (!key)
    return
  const next = new Set(failedAvatars.value)
  next.add(key)
  failedAvatars.value = next
}

function avatarInitial(acc?: Account | null) {
  return accountDisplayName(acc).replace(/[()（）\s]/g, '').slice(0, 1) || '账'
}

async function loadCareer() {
  const accountId = cleanText(currentAccount.value?.id)
  if (!accountId)
    return
  careerLoading.value = true
  careerError.value = ''
  try {
    const { data } = await api.get('/api/career', {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(data?.error || '生涯记录读取失败')
    careerProfile.value = data.data || {}
    careerItems.value = data.data?.items || []
  }
  catch (error: any) {
    careerError.value = error?.response?.data?.error || error?.message || '生涯记录读取失败'
  }
  finally {
    careerLoading.value = false
  }
}

/*
function openCareer(event: MouseEvent) {
  event.stopPropagation()
  if (!currentAccount.value)
    return
  closeDropdown()
  showCareerModal.value = true
  loadCareer()
}
*/

const displayName = computed(() => accountDisplayName(currentAccount.value))
const currentAvatarSrc = computed(() => avatarSource(currentAccount.value))

async function openDropdown() {
  updateDropdownPos()
  showAccountDropdown.value = true
  await nextTick()
  updateDropdownPos()
}

function closeDropdown() {
  showAccountDropdown.value = false
}

function toggleDropdown() {
  if (showAccountDropdown.value) {
    closeDropdown()
    return
  }
  openDropdown()
}

function updateDropdownPos() {
  const el = triggerRef.value
  if (!el)
    return

  const rect = el.getBoundingClientRect()
  const viewportGap = 12
  const width = Math.min(300, window.innerWidth - viewportGap * 2)
  // 严格右对齐：菜单的右边框与触发按钮的右边框完全重合
  const margin = 12
  const maxW = Math.min(290, window.innerWidth - margin * 2)
  let l = rect.right - maxW
  if (l < margin) {
    l = margin
  }
  if (l + maxW > window.innerWidth - margin) {
    l = window.innerWidth - maxW - margin
  }

  dropdownPos.value = {
    top: rect.bottom + 6,
    left: l,
    width: maxW,
  }
}

function selectAccount(acc: any) {
  accountStore.setCurrentAccount(acc)
  closeDropdown()
}

function openAddAccount() {
  accountToEdit.value = null
  showAccountModal.value = true
  closeDropdown()
}

function openRemarkModal(acc: any) {
  accountToEdit.value = acc
  showRemarkModal.value = true
  closeDropdown()
}

async function handleAccountSaved(targetId?: string) {
  await accountStore.fetchAccounts()
  if (targetId && accountStore.accounts.length > 0) {
    const target = accountStore.accounts.find((a: any) => String(a.id) === String(targetId))
    if (target) {
      accountStore.setCurrentAccount(target)
    } else {
      accountStore.setCurrentAccount(accountStore.accounts[accountStore.accounts.length - 1])
    }
  } else if (accountStore.accounts.length > 0 && !accountToEdit.value) {
    // 新增账号若未带 targetId，默认对焦最后一个
    accountStore.setCurrentAccount(accountStore.accounts[accountStore.accounts.length - 1])
  }
  showAccountModal.value = false
  showRemarkModal.value = false
  accountToEdit.value = null
}
</script>

<template>
  <div class="relative">
    <!-- 液态玻璃灵动按钮：平常为圆形收缩球只留展开符号，点击展开为椭圆胶囊并露出精致头像与在线指示灯 -->
    <button
      ref="trigger"
      type="button"
      class="liquid-capsule-btn"
      :class="{ 'is-expanded': showAccountDropdown }"
      :title="showAccountDropdown ? '收起账号菜单' : '展开账号列表'"
      @click="toggleDropdown"
    >
      <!-- 头像容器：使用专用 CSS 类保证平滑伸展动画 -->
      <div class="trigger-avatar-wrapper" :class="{ 'is-visible': showAccountDropdown }">
        <div class="trigger-avatar-inner">
          <img
            v-if="shouldShowAvatar(currentAccount)"
            :src="currentAvatarSrc"
            :alt="displayName"
            class="h-full w-full object-cover"
            @error="markAvatarFailed(currentAccount)"
          >
          <span v-else class="text-[11px] font-bold text-gray-700 dark:text-gray-200">
            {{ avatarInitial(currentAccount) }}
          </span>
        </div>
        <!-- 运行在线小红绿灯 -->
        <span
          v-if="currentAccount"
          class="trigger-online-dot"
          :class="isOnline ? 'is-online' : 'is-offline'"
        />
      </div>

      <!-- 展开符号小图标 -->
      <div
        class="trigger-arrow i-carbon-chevron-down"
        :class="{ 'is-rotated': showAccountDropdown }"
      />
    </button>

    <Teleport to="body">
      <div
        v-if="showAccountDropdown"
        class="fixed inset-0 z-[9998] bg-transparent"
        @click="closeDropdown"
      />

      <div
        v-if="showAccountDropdown"
        class="liquid-dropdown-menu fixed z-[9999] overflow-hidden rounded-2xl py-2 shadow-2xl bg-white/95 dark:bg-gray-800/95 border border-gray-100 dark:border-gray-700/80 backdrop-blur-xl"
        :style="{ top: `${dropdownPos.top}px`, left: `${dropdownPos.left}px`, width: `${dropdownPos.width}px` }"
      >
        <div class="custom-scrollbar max-h-72 overflow-y-auto px-1.5 divide-y divide-gray-100/90 dark:divide-gray-700/60">
          <template v-if="accounts.length > 0">
            <button
              v-for="acc in accounts"
              :key="acc.id || acc.uin"
              class="liquid-account-row w-full flex items-center gap-2.5 px-2.5 py-2.5 transition-all text-left hover:bg-gray-50/80 dark:hover:bg-gray-700/40 first:rounded-t-xl last:rounded-b-xl"
              :class="{ 'bg-blue-50/70 dark:bg-blue-950/40': currentAccount?.id === acc.id }"
              @click="selectAccount(acc)"
            >
              <div class="h-8 w-8 flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-white/60 shadow-sm bg-white/50">
                <img
                  v-if="shouldShowAvatar(acc)"
                  :src="avatarSource(acc)"
                  :alt="accountDisplayName(acc)"
                  class="h-full w-full object-cover"
                  @error="markAvatarFailed(acc)"
                >
                <span v-else class="text-xs font-bold text-gray-600 dark:text-gray-300">
                  {{ avatarInitial(acc) }}
                </span>
              </div>
              <div class="min-w-0 flex flex-1 flex-col items-start">
                <span class="w-full truncate text-left text-xs font-bold" style="color: var(--theme-text);">
                  {{ accountDisplayName(acc) }}
                </span>
                <div class="flex items-center gap-1.5 mt-0.5">
                  <span
                    v-if="getPlatformLabel(acc.platform)"
                    class="rounded px-1 py-0.2 text-[9px] font-medium leading-tight"
                    :class="getPlatformClass(acc.platform)"
                  >
                    {{ getPlatformLabel(acc.platform) }}
                  </span>
                  <span v-if="accountSubtitle(acc)" class="text-[11px] opacity-60 font-mono" style="color: var(--theme-text);">{{ accountSubtitle(acc) }}</span>
                </div>
              </div>
              <button
                class="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/60 hover:text-blue-500"
                title="修改备注"
                @click.stop="openRemarkModal(acc)"
              >
                <div class="i-carbon-edit text-xs" />
              </button>
              <div v-if="currentAccount?.id === acc.id" class="i-carbon-checkmark text-blue-500 font-bold shrink-0" />
            </button>
          </template>
          <div v-else class="px-4 py-4 text-center text-xs opacity-60">
            暂无账号
          </div>
        </div>
        <div class="mt-1 border-t border-gray-100 pt-2 px-1.5 flex gap-1.5 dark:border-gray-700/60">
          <button
            class="liquid-btn-action flex-1 flex items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-bold text-blue-600 transition-colors"
            @click="openAddAccount"
          >
            <div class="i-carbon-add text-sm" />
            <span>添加账号</span>
          </button>
          <router-link
            to="/settings"
            class="liquid-btn-action flex-1 flex items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-bold text-blue-600 transition-colors"
            @click="closeDropdown"
          >
            <div class="i-carbon-settings text-sm" />
            <span>管理账号</span>
          </router-link>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <AccountModal
        :show="showAccountModal"
        :edit-data="accountToEdit"
        @close="showAccountModal = false; accountToEdit = null"
        @saved="handleAccountSaved"
      />

      <RemarkModal
        :show="showRemarkModal"
        :account="accountToEdit"
        @close="showRemarkModal = false"
        @saved="handleAccountSaved"
      />

      <AccountCareerModal
        :show="showCareerModal"
        :account="currentAccount"
        :profile="careerProfile"
        :items="careerItems"
        :loading="careerLoading"
        :error="careerError"
        @close="showCareerModal = false"
        @refresh="loadCareer"
      />
    </Teleport>
  </div>
</template>

<style scoped>
/* 灵动液态玻璃收缩/展开按钮 */
.liquid-capsule-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 9999px;
  padding: 0;
  gap: 0;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.4);
  cursor: pointer;
  transition: width 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
              height 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
              padding 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
              gap 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.25s ease,
              background 0.2s ease;
}

.dark .liquid-capsule-btn {
  background: rgba(30, 41, 59, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.15);
}

.liquid-capsule-btn:hover {
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(255, 255, 255, 1);
}

.dark .liquid-capsule-btn:hover {
  background: rgba(51, 65, 85, 0.75);
}

/* 展开态：由正圆形流畅伸展为 82px 的精致椭圆胶囊 */
.liquid-capsule-btn.is-expanded {
  width: 76px !important;
  height: 38px !important;
  padding: 0 8px 0 6px !important;
  gap: 6px !important;
  border-radius: 9999px !important;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 1),
    0 8px 24px rgba(15, 23, 42, 0.12);
}

/* 伸展展开的头像外壳 */
.trigger-avatar-wrapper {
  position: relative;
  width: 0;
  max-width: 0;
  height: 28px;
  opacity: 0;
  transform: scale(0.3);
  flex-shrink: 0;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  transition: width 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
              max-width 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
              opacity 0.22s ease,
              transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.trigger-avatar-wrapper.is-visible {
  width: 28px !important;
  max-width: 28px !important;
  opacity: 1;
  transform: scale(1);
  overflow: visible;
  pointer-events: auto;
}

.trigger-avatar-inner {
  width: 28px;
  height: 28px;
  border-radius: 9999px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  border: 1.5px solid rgba(255, 255, 255, 0.95);
  background: rgba(255, 255, 255, 0.6);
}

.trigger-online-dot {
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  border: 1.5px solid #ffffff;
  pointer-events: none;
}
.trigger-online-dot.is-online {
  background-color: #22c55e;
  box-shadow: 0 0 6px #22c55e;
}
.trigger-online-dot.is-offline {
  background-color: #f87171;
}

/* 箭头旋转微动画 */
.trigger-arrow {
  font-size: 15px;
  color: #4b5563;
  opacity: 0.8;
  transition: transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.2s ease;
  flex-shrink: 0;
}
.dark .trigger-arrow {
  color: #d1d5db;
}
.trigger-arrow.is-rotated {
  transform: rotate(180deg);
  opacity: 1;
  color: var(--theme-primary, #10b981);
}
</style>