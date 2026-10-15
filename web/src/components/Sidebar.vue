<script setup lang="ts">
import SidebarUserCard from './SidebarUserCard.vue'
import { useDateFormat, useIntervalFn, useNow } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api'

import { menuRoutes } from '@/router/menu'
import { useAccountStore } from '@/stores/account'
import { useAppStore } from '@/stores/app'
import { useShopStore } from '@/stores/shop'
import { useStatusStore } from '@/stores/status'
import { useUserStore } from '@/stores/user'

const accountStore = useAccountStore()
const statusStore = useStatusStore()
const appStore = useAppStore()
const userStore = useUserStore()
const shopStore = useShopStore()
const route = useRoute()
const router = useRouter()
const { currentAccount, currentAccountId } = storeToRefs(accountStore)
const { status, realtimeConnected } = storeToRefs(statusStore)
const { mysteryOffer, mysteryOfferAccountId } = storeToRefs(shopStore)
const { loginPageConfig, sidebarOpen } = storeToRefs(appStore)

const wsErrorNotifiedAt = ref<Record<string, number>>({})

const systemConnected = ref(true)
const serverUptimeBase = ref(0)
const lastPingTime = ref(Date.now())
const now = useNow()
const formattedTime = useDateFormat(now, 'YYYY-MM-DD HH:mm:ss')

async function checkConnection() {
  try {
    const res = await api.get('/api/ping')
    systemConnected.value = true
    if (res.data.ok && res.data.data) {
      if (res.data.data.uptime) {
        serverUptimeBase.value = res.data.data.uptime
        lastPingTime.value = Date.now()
      }
    }
    const accountRef = currentAccount.value?.id || currentAccount.value?.uin
    if (accountRef) {
      statusStore.connectRealtime(String(accountRef))
    }
  }
  catch {
    systemConnected.value = false
  }
}

async function refreshStatusFallback() {
  if (realtimeConnected.value)
    return

  const accountRef = currentAccount.value?.id || currentAccount.value?.uin
  if (accountRef) {
    await statusStore.fetchStatus(String(accountRef))
  }
}

onMounted(() => {
  appStore.fetchLoginPageConfig()
  accountStore.fetchAccounts()
  checkConnection()
  userStore.fetchUserInfo()
})

onBeforeUnmount(() => {
  statusStore.disconnectRealtime()
})

useIntervalFn(checkConnection, 30000)
useIntervalFn(() => {
  refreshStatusFallback()
  accountStore.fetchAccounts()
}, 10000)

watch(() => currentAccount.value?.id || currentAccount.value?.uin || '', () => {
  const accountRef = currentAccount.value?.id || currentAccount.value?.uin
  statusStore.connectRealtime(String(accountRef || ''))
  refreshStatusFallback()
}, { immediate: true })

watch(() => status.value?.wsError, (wsError: any) => {
  if (!wsError || Number(wsError.code) !== 400 || !currentAccount.value)
    return

  const errAt = Number(wsError.at) || 0
  const accId = String(currentAccount.value.id || currentAccount.value.uin || '')
  const lastNotified = wsErrorNotifiedAt.value[accId] || 0
  if (errAt <= lastNotified)
    return

  wsErrorNotifiedAt.value[accId] = errAt
  router.push('/settings')
}, { deep: true })

const uptime = computed(() => {
  const diff = Math.floor(serverUptimeBase.value + (now.value.getTime() - lastPingTime.value) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  return `${h}h ${m}m ${s}s`
})

const connectionStatus = computed(() => {
  if (!systemConnected.value) {
    return {
      text: '系统离线',
      color: 'bg-red-500',
      pulse: false,
    }
  }

  if (!currentAccount.value?.id) {
    return {
      text: '请添加账号',
      color: 'bg-gray-400',
      pulse: false,
    }
  }

  const isConnected = status.value?.connection?.connected
  if (isConnected) {
    return {
      text: '运行中',
      color: 'bg-green-500',
      pulse: true,
    }
  }

  return {
    text: '未连接',
    color: 'bg-gray-400',
    pulse: false,
  }
})

// 根据用户角色过滤导航菜单
const navItems = computed(() => {
  const isAdmin = userStore.isAdmin
  return menuRoutes
    .filter(item => item.showInNav !== false && (!item.adminOnly || isAdmin))
    .map(item => ({
      path: item.path ? `/${item.path}` : '/',
      label: item.label,
      icon: item.icon,
    }))
})

const hasActiveMysteryOffer = computed(() => {
  const offer = mysteryOffer.value
  if (!currentAccountId.value || mysteryOfferAccountId.value !== String(currentAccountId.value))
    return false
  if (!offer?.active || offer.purchased)
    return false
  const endTime = Number(offer.endTime || 0)
  const endMs = endTime > 10_000_000_000 ? endTime : endTime * 1000
  return !endMs || endMs > Date.now()
})

// const version = __APP_VERSION__

watch(
  () => route.path,
  () => {
    if (window.innerWidth < 1024)
      appStore.closeSidebar()
  },
)

// const showThemeDropdown = ref(false)
</script>

<template>
  <aside
    class="sidebar-glass fixed inset-y-0 left-0 z-50 h-full w-72 flex flex-col p-3 transition-transform duration-300 lg:static lg:translate-x-0"
    :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
  >
    <!-- Brand & Logo -->
    <div class="relative h-24 flex flex-none items-center justify-center px-2 pt-2 pb-2">
      <div class="w-full flex items-center justify-center relative">
        <img
          src="/qq-farm-logo.webp"
          :alt="`${loginPageConfig.title || 'QQ经典农场'}`"
          class="h-16 w-auto max-w-[225px] object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.18)] transition-transform duration-300 hover:scale-105"
        >
        
        <!-- Mobile Close Button -->
        <button
          class="liquid-close-btn absolute right-0 top-1/2 -translate-y-1/2 h-8 w-8 flex flex-none items-center justify-center rounded-xl text-gray-500 transition lg:hidden hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          @click="appStore.closeSidebar"
        >
          <div class="i-carbon-close text-xl" />
        </button>
      </div>
    </div>

    <!-- 柔光液态分隔线 -->
    <div class="mx-2 mb-3 h-px flex-none" style="background: linear-gradient(90deg, rgba(255, 255, 255, 0.8), color-mix(in srgb, var(--theme-primary) 40%, transparent), transparent);" />

    <!-- Navigation -->
    <nav class="custom-scrollbar flex-1 overflow-y-auto px-1 py-1 space-y-1.5">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        :active-class="item.path === '/' ? '' : 'router-link-active'"
        :exact-active-class="item.path === '/' ? 'router-link-active' : 'router-link-exact-active'"
        class="liquid-nav-btn group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-all duration-200"
        @click="appStore.closeSidebar"
      >
        <span class="nav-icon-box h-9 w-9 flex flex-none items-center justify-center rounded-xl text-[20px] transition-all duration-200">
          <span
            v-if="item.icon && item.icon.endsWith('.svg')"
            class="h-5 w-5 bg-current inline-block"
            :style="{
              mask: `url(${item.icon}) no-repeat center / contain`,
              WebkitMask: `url(${item.icon}) no-repeat center / contain`
            }"
          />
          <div v-else :class="[item.icon]" />
        </span>
        <span class="min-w-0 flex-1 truncate text-sm font-semibold tracking-wide">{{ item.label }}</span>
        <span
          v-if="item.path === '/shop' && hasActiveMysteryOffer"
          class="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)] animate-pulse"
          title="神秘商人已出现"
        />
      </router-link>
    </nav>

    <SidebarUserCard />

    <!-- Footer Status -->
    <div class="liquid-footer-panel relative mt-3 flex-none rounded-2xl p-3">
      <div class="flex items-center justify-between text-xs">
        <div class="flex items-center gap-1.5 font-semibold" style="color: var(--theme-text);">
          <span class="h-2.5 w-2.5 rounded-full" :class="[connectionStatus.color, { 'animate-pulse': connectionStatus.pulse }]" />
          <span>{{ connectionStatus.text }}</span>
        </div>
        <span class="font-mono font-medium opacity-75" style="color: var(--theme-text);">{{ uptime }}</span>
      </div>

      <div class="mt-2.5 flex items-center justify-between border-t border-white/30 pt-2 text-xs opacity-85 dark:border-white/10" style="color: var(--theme-text);">
        <span class="font-mono text-[11px]">{{ formattedTime }}</span>
      </div>

      </div>
  </aside>
</template>

<style scoped>
.sidebar-glass {
  background: var(--liquid-glass-bg);
  backdrop-filter: var(--liquid-glass-blur);
  -webkit-backdrop-filter: var(--liquid-glass-blur);
  border-right: 1px solid var(--liquid-glass-border);
  box-shadow: 4px 0 24px rgba(15, 23, 42, 0.05);
}

.liquid-close-btn {
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.6);
}

/* ===== 液态玻璃导航按钮 ===== */
.liquid-nav-btn {
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.4), 0 2px 8px rgba(15, 23, 42, 0.02);
  color: var(--theme-text);
  opacity: 0.88;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.dark .liquid-nav-btn {
  background: rgba(15, 23, 42, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.08);
}

.liquid-nav-btn:hover {
  background: rgba(255, 255, 255, 0.7);
  border-color: rgba(255, 255, 255, 0.9);
  box-shadow:
    inset 0 1px 1.5px rgba(255, 255, 255, 0.95),
    0 6px 16px rgba(15, 23, 42, 0.06);
  opacity: 1;
  transform: translateX(2px);
}

.dark .liquid-nav-btn:hover {
  background: rgba(51, 65, 85, 0.6);
  border-color: rgba(255, 255, 255, 0.2);
}

/* 图标容器小水滴 */
.nav-icon-box {
  background: rgba(255, 255, 255, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.6);
  color: color-mix(in srgb, var(--theme-text) 75%, transparent);
}

.dark .nav-icon-box {
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #94a3b8;
}

.liquid-nav-btn:hover .nav-icon-box {
  background: #ffffff;
  color: var(--theme-primary);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--theme-primary) 25%, transparent);
}

.dark .liquid-nav-btn:hover .nav-icon-box {
  background: #1e293b;
  color: #60a5fa;
}

/* 激活态：果冻水晶胶囊 */
.router-link-active.liquid-nav-btn,
.router-link-exact-active.liquid-nav-btn {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.85) 0%, rgba(240, 246, 255, 0.75) 100%) !important;
  border: 1.5px solid color-mix(in srgb, var(--theme-primary) 65%, #ffffff) !important;
  color: var(--theme-primary) !important;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.95),
    0 8px 22px color-mix(in srgb, var(--theme-primary) 22%, transparent) !important;
  opacity: 1 !important;
}

.dark .router-link-active.liquid-nav-btn,
.dark .router-link-exact-active.liquid-nav-btn {
  background: linear-gradient(135deg, rgba(30, 58, 138, 0.45) 0%, rgba(15, 23, 42, 0.65) 100%) !important;
  border: 1.5px solid color-mix(in srgb, var(--theme-primary) 50%, transparent) !important;
  box-shadow:
    inset 0 1px 1.5px rgba(255, 255, 255, 0.2),
    0 8px 24px rgba(0, 0, 0, 0.3) !important;
}

.router-link-active .nav-icon-box,
.router-link-exact-active .nav-icon-box {
  /* 告别厚重调色盘色块：改用高清水晶通透微光水滴底，图标本身呈主题色高清亮起 */
  background: rgba(255, 255, 255, 0.9) !important;
  border: 1.5px solid rgba(255, 255, 255, 1) !important;
  color: var(--theme-primary) !important;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 1),
    0 4px 12px rgba(15, 23, 42, 0.08) !important;
}

.dark .router-link-active .nav-icon-box,
.dark .router-link-exact-active .nav-icon-box {
  background: rgba(30, 41, 59, 0.85) !important;
  border: 1.5px solid rgba(255, 255, 255, 0.2) !important;
  color: #60a5fa !important;
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.1),
    0 4px 12px rgba(0, 0, 0, 0.25) !important;
}

.router-link-active::before,
.router-link-exact-active::before {
  content: '';
  position: absolute;
  top: 50%;
  left: -2px;
  width: 4px;
  height: 55%;
  transform: translateY(-50%);
  border-radius: 4px;
  background: var(--theme-primary);
  box-shadow: 0 0 8px color-mix(in srgb, var(--theme-primary) 60%, transparent);
}

/* 底部状态栏 */
.liquid-footer-panel {
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.65);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.8), 0 4px 16px rgba(15, 23, 42, 0.04);
}

.dark .liquid-footer-panel {
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.12);
}

.palette-btn {
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.8);
}

.dark .palette-btn {
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.palette-btn:hover {
  transform: scale(1.08);
  background: #ffffff;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.3);
  border-radius: 4px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
}
</style>
