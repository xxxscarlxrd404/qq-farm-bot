<script setup lang="ts">
import AccountModal from '@/components/AccountModal.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import DailyOverview from '@/components/DailyOverview.vue'
import BagPanel from '@/components/BagPanel.vue'
import { useBagStore } from '@/stores/bag'
import { useStatusStore } from '@/stores/status'
import { useUserStore } from '@/stores/user'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useToastStore } from '@/stores/toast'
import { getPlatformClass, getPlatformLabel } from '@/stores/account'



import { onMounted } from 'vue'

const statusStore = useStatusStore()
const userStore = useUserStore()
const bagStore = useBagStore()
const { status, dailyGifts, statusAccountId } = storeToRefs(statusStore)
const toast = useToastStore()

// 账号自续费弹窗状态
const showRenewModal = ref(false)
const renewCardCode = ref('')
const renewLoading = ref(false)

async function handleRenewCard() {
  const code = renewCardCode.value.trim()
  if (!code) {
    toast.warning('请输入卡密')
    return
  }
  renewLoading.value = true
  try {
    const res = await userStore.renew(code)
    if (res.ok) {
      const cardType = res.data?.cardType || 'time'
      if (cardType === 'quota') {
        toast.success(`充值成功！账号额度增加至 ${res.data?.accountLimit} 个`)
      } else {
        toast.success('续费成功！有效时长已成功顺延')
      }
      showRenewModal.value = false
      renewCardCode.value = ''
      await userStore.fetchUserInfo()
    } else {
      toast.error(res.error || '续费失败，请检查卡密有效性')
    }
  } catch (err: any) {
    toast.error(err.response?.data?.error || err.message || '续费请求失败')
  } finally {
    renewLoading.value = false
  }
}

const showBagModal = ref(false)
const selectedBagAccount = ref<any>(null)

function openBagModalForAccount(acc: any) {
  emit('select', acc)
  selectedBagAccount.value = acc
  bagStore.fetchBag(String(acc.id))
  showBagModal.value = true
}

function closeBagModal() {
  showBagModal.value = false
  selectedBagAccount.value = null
}

const showTaskModal = ref(false)
const selectedTaskAccount = ref<any>(null)
const taskModalLoading = ref(false)
const activeDropdownAccountId = ref<string | null>(null)

function toggleDropdown(accId: string | number) {
  const id = String(accId)
  if (activeDropdownAccountId.value === id) {
    activeDropdownAccountId.value = null
  } else {
    activeDropdownAccountId.value = id
  }
}

function closeDropdown() {
  activeDropdownAccountId.value = null
}

function getAccountLevel(acc: any) {
  const aid = String(acc.id)
  const live = statusStore.statusByAccount && statusStore.statusByAccount[aid]?.status?.level
  return Number(live ?? acc.level ?? acc.status?.level ?? 1)
}

function getAccountTaskSummary(acc: any) {
  const aid = String(acc.id)
  const liveGifts = statusStore.dailyGiftsByAccount && statusStore.dailyGiftsByAccount[aid]?.gifts
  if (liveGifts && Array.isArray(liveGifts) && liveGifts.length > 0) {
    const done = liveGifts.filter((g: any) => g.doneToday).length
    return { done, total: liveGifts.length }
  }
  if (acc.tasks && Array.isArray(acc.tasks) && acc.tasks.length > 0) {
    const done = acc.tasks.filter((g: any) => g.doneToday).length
    return { done, total: acc.tasks.length }
  }
  return { done: 0, total: 6 }
}

onMounted(() => {
  if (props.currentAccountId) {
    statusStore.fetchStatus(String(props.currentAccountId))
    statusStore.fetchDailyGifts(String(props.currentAccountId))
  }
})

const modalDailyGifts = ref<any>(null)

async function openTaskModalForAccount(acc: any) {
  emit('select', acc)
  selectedTaskAccount.value = acc
  modalDailyGifts.value = null
  showTaskModal.value = true
  taskModalLoading.value = true
  try {
    const res = await statusStore.fetchDailyGifts(String(acc.id))
    if (res) {
      modalDailyGifts.value = res
    }
  } catch {
    // 忽略异常，降级显示已有数据
  } finally {
    taskModalLoading.value = false
  }
}


const props = defineProps<{
  accounts: any[]
  accountsLoading: boolean
  currentAccountId: string | number | null | undefined
  userIsAdmin: boolean
  stoppedAccountsCount: number
  isAddAccountDisabled: boolean
  addAccountDisabledReason: string
  isAccountOpsDisabled: boolean
  showModal: boolean
  editingAccount: any
  showDeleteConfirm: boolean
  deleteLoading: boolean
  accountToDelete: any
  showClearStoppedConfirm: boolean
  clearStoppedLoading: boolean
  refreshWxCodesLoading: boolean
  defaultPlanSettingId: string
  defaultPlanApplyingId: string
}>()

const emit = defineEmits<{
  add: []
  clearStopped: []
  refreshWxCodes: []
  select: [account: any]
  toggle: [account: any]
  settings: [account: any]
  notification: [account: any]
  setDefaultPlan: [account: any]
  applyDefaultPlan: [account: any]
  edit: [account: any]
  delete: [account: any]
  saved: [targetId?: string]
  closeModal: []
  closeDeleteConfirm: []
  confirmDelete: []
  closeClearStoppedConfirm: []
  confirmClearStopped: []
}>()

function accountAvatar(acc: any) {
  const direct = String(acc?.avatar || acc?.avatarUrl || acc?.avatar_url || '').trim()
  if (direct)
    return direct
  const qq = String(acc?.uin || acc?.qq || '').trim()
  if (/^\d+$/.test(qq))
    return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`
  return ''
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <!-- 左侧用户信息栏：用户名 + 到期时间 + 额度 -->
        <div class="flex items-center gap-2 flex-wrap min-w-0">
          <!-- 用户名 -->
          <div class="flex items-center gap-1.5 font-bold text-gray-800 dark:text-gray-100 text-base sm:text-lg">
            <div class="i-carbon-user text-primary text-base" />
            <span class="truncate max-w-[140px] sm:max-w-[200px]">{{ userStore.username || '我的账号' }}</span>
          </div>

          <!-- 到期时间 (纯净小灰字) -->
          <span class="text-xs text-gray-400 dark:text-gray-500 font-mono">
            {{ userStore.expireTimeText }}
          </span>

          <span class="h-1 w-1 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0" />

          <!-- 额度 (纯净小灰字：管理员显示无限 ♾️，普通用户显示上限额度) -->
          <span class="text-xs text-gray-400 dark:text-gray-500 font-mono">
            <span v-if="userStore.isAdmin">额度: {{ accounts.length }}/<span class="font-bold">♾️</span></span>
            <span v-else>额度: {{ accounts.length }}/{{ userStore.accountLimit }}</span>
          </span>


        </div>
        <!-- 账号续费专属按钮（右上角常驻） -->
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 shadow-md shadow-orange-500/25 hover:shadow-lg hover:scale-[1.02] active:scale-95 transition-all duration-200 cursor-pointer"
          @click="showRenewModal = true"
        >
          <div class="i-carbon-ticket text-sm" />
          <span>账号续费</span>
        </button>
      </div>
      <div class="flex flex-wrap gap-2">
        <BaseButton
          variant="outline"
          size="sm"
          :loading="refreshWxCodesLoading"
          :disabled="accountsLoading || accounts.length === 0"
          @click="emit('refreshWxCodes')"
        >
          <div class="i-carbon-renew mr-2" />
          <span class="hidden sm:inline">{{ userIsAdmin ? '刷新全部微信Code' : '刷新我的微信Code' }}</span>
          <span class="sm:hidden">刷新Code</span>
        </BaseButton>
        <BaseButton
          v-if="userIsAdmin"
          variant="secondary"
          size="sm"
          :disabled="stoppedAccountsCount === 0"
          @click="emit('clearStopped')"
        >
          <div class="i-carbon-trash-can mr-2" />
          <span class="hidden sm:inline">一键清理</span>
          <span class="sm:hidden">清理</span>
          ({{ stoppedAccountsCount }})
        </BaseButton>
        <BaseButton
          variant="primary"
          size="sm"
          :disabled="isAddAccountDisabled"
          :title="addAccountDisabledReason"
          @click="emit('add')"
        >
          <div class="i-carbon-add mr-2" />
          添加账号
        </BaseButton>
      </div>
    </div>

    <div v-if="accountsLoading && accounts.length === 0" class="py-8 text-center text-gray-500">
      <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
      <div>加载中...</div>
    </div>

    <div v-else-if="accounts.length === 0" class="rounded-lg bg-white py-12 text-center shadow dark:bg-gray-800">
      <div i-carbon-user-avatar class="mb-4 inline-block text-4xl text-gray-400" />
      <p class="mb-4 text-gray-500">
        暂无账号
      </p>
      <BaseButton
        variant="text"
        size="sm"
        :disabled="isAddAccountDisabled"
        :title="addAccountDisabledReason"
        @click="emit('add')"
      >
        立即添加
      </BaseButton>
    </div>

    <div v-else class="grid grid-cols-1 gap-3.5 lg:grid-cols-3 sm:grid-cols-2 xl:grid-cols-4" @click="closeDropdown">
      <div
        v-for="acc in accounts"
        :key="acc.id"
        class="relative cursor-pointer border rounded-2xl bg-white/95 p-3.5 shadow-sm hover:shadow-md transition-all duration-200 dark:bg-gray-800/95 backdrop-blur-sm sm:p-4"
        :class="String(currentAccountId) === String(acc.id)
          ? 'ring-2'
          : 'border-transparent'"
        :style="String(currentAccountId) === String(acc.id)
          ? { borderColor: 'var(--theme-primary)', backgroundColor: 'rgba(var(--theme-primary-rgb, 59, 130, 246), 0.1)' }
          : {}"
        @click="emit('select', acc)"
      >
        <!-- ① 第一层：身份与启停控制（头像 + 角标 + 完整昵称 + 等级 + 状态与停止 + 更多） -->
        <div class="flex items-center justify-between gap-2.5">
          <!-- 左侧：头像 + 平台小角标 + 昵称/等级 -->
          <div class="min-w-0 flex items-center gap-2.5 flex-1">
            <!-- 头像容器 + 平台悬浮角标 -->
            <div class="relative h-11 w-11 flex shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 shadow-xs ring-2 ring-white/90 dark:ring-gray-700">
              <img v-if="accountAvatar(acc)" :src="accountAvatar(acc)" class="h-full w-full object-cover rounded-full">
              <div v-else class="i-carbon-user text-xl text-gray-400" />

              <!-- 头像右下角平台微角标 (复刻后台挂机列表的精致图标) -->
              <div
                v-if="acc.platform"
                class="absolute -bottom-0.5 -right-0.5 h-4.5 w-4.5 flex items-center justify-center rounded-full ring-2 ring-white dark:ring-gray-800 shadow-xs"
                :class="(acc.platform || '').toLowerCase() === 'qq' ? 'bg-blue-50 dark:bg-blue-950/80 p-0.5' : 'bg-emerald-500 text-white'"
                :title="getPlatformLabel(acc.platform)"
              >
                <!-- QQ 专属高清矢量图标 -->
                <img
                  v-if="(acc.platform || '').toLowerCase() === 'qq'"
                  src="/qq-icon.svg"
                  class="h-full w-full object-contain"
                  alt="QQ"
                />
                <!-- 微信专属 Carbon 矢量图标 -->
                <span
                  v-else
                  class="i-carbon-logo-wechat text-[11px] leading-none"
                />
              </div>
            </div>

            <!-- 昵称 + 等级胶囊 (自适应流式排版，小屏优雅适配) -->
            <div class="min-w-0 flex-1 flex items-center gap-1.5 overflow-hidden">
              <h4 class="truncate text-[15px] sm:text-base font-bold text-gray-800 dark:text-gray-100 leading-none">
                {{ acc.nick || acc.name || acc.id }}
              </h4>
              <span class="shrink-0 rounded-md bg-blue-100/90 px-1.5 py-0.5 text-[11px] font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 leading-none">
                Lv.{{ getAccountLevel(acc) }}
              </span>
            </div>
          </div>

          <!-- 右侧：运行状态指示 + 启动/停止胶囊 + ··· 更多菜单 -->
          <div class="flex items-center gap-1.5 shrink-0" @click.stop>
            <!-- 运行状态小文字 -->
            <span class="hidden xs:flex items-center gap-1 text-xs text-gray-500 font-medium mr-0.5">
              <span class="h-2 w-2 rounded-full shrink-0" :class="acc.running ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300 dark:bg-gray-600'" />
              <span>{{ acc.running ? '运行中' : '已停止' }}</span>
            </span>

            <!-- 启停轻量胶囊按钮 -->
            <BaseButton
              variant="secondary"
              size="sm"
              class="border rounded-full shadow-2xs transition-all duration-200 px-2.5 py-1 text-xs active:scale-95 inline-flex items-center gap-1"
              :class="acc.running
                ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
                : 'border-green-200 bg-green-50 text-green-600 hover:bg-green-100 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400'"
              :disabled="!acc.running && isAccountOpsDisabled"
              :title="!acc.running && isAccountOpsDisabled ? '账号已到期，无法启动账号' : ''"
              @click="emit('toggle', acc)"
            >
              <div :class="acc.running ? 'i-carbon-stop-filled' : 'i-carbon-play-filled'" class="text-xs" />
              <span>{{ acc.running ? '停止' : '启动' }}</span>
            </BaseButton>

            <!-- ··· 更多操作按钮与气泡菜单 -->
            <div class="relative">
              <button
                type="button"
                class="h-7 w-7 flex items-center justify-center rounded-full bg-gray-100/80 text-gray-600 hover:bg-gray-200 dark:bg-gray-700/60 dark:text-gray-300 transition-all active:scale-95 shadow-2xs"
                title="更多操作"
                @click.stop="toggleDropdown(acc.id)"
              >
                <div class="i-carbon-overflow-menu-horizontal text-base" />
              </button>

              <!-- 气泡下拉菜单 (带箭头与高浮层防护) -->
              <div
                v-if="String(activeDropdownAccountId) === String(acc.id)"
                class="absolute right-0 top-[calc(100%+6px)] z-[100] w-36 overflow-hidden rounded-xl bg-white/98 py-1 shadow-[0_10px_30px_rgba(0,0,0,0.18)] border border-gray-100 dark:border-gray-700 dark:bg-gray-800/98 backdrop-blur-xl animate-scale-in"
                @click.stop
              >
                <!-- 编辑账号 -->
                <button
                  type="button"
                  class="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700/60 transition-colors"
                  @click="closeDropdown(); emit('edit', acc)"
                >
                  <div class="i-carbon-edit text-sm text-gray-500 dark:text-gray-400" />
                  <span class="font-medium">更新账号</span>
                </button>

                <!-- 删除账号 (红色危险标) -->
                <button
                  type="button"
                  class="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 transition-colors border-t border-gray-100/80 dark:border-gray-700/60"
                  @click="closeDropdown(); emit('delete', acc)"
                >
                  <div class="i-carbon-trash-can text-sm text-rose-500" />
                  <span class="font-medium">删除账号</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- ② 功能矩阵四宫格：统一大小、高度、内边距与视觉规范 -->
        <div class="mt-3 grid grid-cols-2 gap-2" @click.stop>
          <!-- 1. 每日礼包卡片 -->
          <button
            type="button"
            class="h-9 flex items-center justify-between rounded-xl px-3 transition-all duration-200 active:scale-95 border"
            :class="getAccountTaskSummary(acc).done >= getAccountTaskSummary(acc).total && getAccountTaskSummary(acc).total > 0
              ? 'border-emerald-200/90 bg-emerald-50/80 text-emerald-800 hover:bg-emerald-100/80 dark:border-emerald-500/25 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'border-amber-200/80 bg-amber-50/70 text-amber-800 hover:bg-amber-100/70 dark:border-amber-500/25 dark:bg-amber-950/30 dark:text-amber-300'"
            title="查看每日礼包与任务进度"
            @click="openTaskModalForAccount(acc)"
          >
            <div class="flex items-center gap-2 min-w-0">
              <div
                class="i-carbon-gift text-sm shrink-0"
                :class="getAccountTaskSummary(acc).done >= getAccountTaskSummary(acc).total && getAccountTaskSummary(acc).total > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'"
              />
              <span class="text-xs font-bold truncate">每日礼包 {{ getAccountTaskSummary(acc).done }}/{{ getAccountTaskSummary(acc).total }}</span>
            </div>
            <div class="i-carbon-chevron-right text-xs opacity-40 shrink-0" />
          </button>

          <!-- 2. 我的背包卡片 -->
          <button
            type="button"
            class="h-9 flex items-center justify-between rounded-xl px-3 transition-all duration-200 active:scale-95 border border-blue-200/80 bg-blue-50/70 text-blue-800 hover:bg-blue-100/70 dark:border-blue-500/25 dark:bg-blue-950/30 dark:text-blue-300"
            title="打开背包仓库"
            @click="openBagModalForAccount(acc)"
          >
            <div class="flex items-center gap-2 min-w-0">
              <svg viewBox="0 0 750 802" class="h-3.5 w-3.5 fill-current text-blue-600 dark:text-blue-400 shrink-0">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M748.9 615.5 L735.9 485.0 C733.4 458.0 710.4 437.4 683.4 437.4 L659.3 437.4 L643.3 220.9 C642.9 213.7 641.9 206.5 640.4 199.4 L640.4 198.9 C624.8 130.4 563.3 79.4 490.8 79.4 L464.8 79.4 C459.3 34.4 421.3 -0.6 374.8 -0.6 C328.3 -0.6 289.8 34.4 284.8 79.4 L258.8 79.4 C186.8 79.4 124.8 130.4 109.3 198.9 L109.3 199.4 C107.8 206.4 106.8 213.9 105.8 221.4 L89.8 438.0 L65.8 438.0 C38.6 437.7 15.8 458.4 13.3 485.5 L0.3 616.0 C-1.2 631.0 3.8 645.5 13.8 657.0 C23.6 668.2 37.8 674.6 52.8 674.5 L72.3 674.5 L70.2 699.0 C68.2 725.0 77.2 751.5 95.3 770.5 C113.2 789.9 138.4 800.9 164.8 801.0 L583.8 801.0 C610.2 801.0 635.5 790.0 653.3 770.5 C671.2 751.2 680.3 725.3 678.3 699.0 L676.3 674.5 L695.8 674.5 C710.8 674.5 724.8 668.0 734.8 657.0 C744.8 646.0 750.3 630.0 748.8 615.5 Z M374.3 48.4 C393.3 48.4 408.8 61.4 413.8 78.4 L335.3 78.4 C340.0 60.7 356.0 48.4 374.3 48.4 Z M249.6 124.6 L498.6 124.6 C549.9 124.6 588.5 158.9 599.7 205.6 C600.8 230.7 604.6 255.8 599.7 280.4 L576.7 396.3 C572.4 417.8 552.6 433.7 529.6 433.7 L511.4 433.7 L511.4 418.9 C511.4 404.5 499.6 393.2 484.6 393.2 C469.6 393.2 457.9 404.5 457.9 418.9 L457.9 433.7 L290.3 433.7 L290.3 418.9 C290.3 404.5 278.5 393.2 263.5 393.2 C248.5 393.2 236.7 404.5 236.7 418.9 L236.7 433.7 L218.5 433.7 C195.5 433.7 175.7 417.8 171.4 396.3 L148.4 280.4 C143.5 255.8 147.3 230.7 148.4 205.6 C160.1 159.5 198.2 124.6 249.6 124.6 Z M52.2 623.5 C51.3 623.5 50.7 623.0 50.2 622.5 C49.8 622.0 49.2 621.0 49.8 620.0 L62.7 489.5 C62.7 488.0 64.3 487.0 65.8 487.0 L86.2 487.0 L76.2 623.5 Z M618.0 745.0 C609.7 754.6 597.6 760.1 584.9 760.0 L164.9 760.0 C152.4 760.0 140.3 754.8 131.8 745.0 C123.3 735.3 118.8 722.9 119.8 710.0 L140.3 419.9 C154.3 457.0 189.4 482.3 229.0 482.3 L246.1 482.3 L246.1 519.4 C246.1 533.8 257.1 545.1 271.1 545.1 C285.2 545.1 296.2 533.8 296.2 519.4 L296.2 482.3 L453.1 482.3 L453.1 519.4 C453.1 533.8 464.1 545.1 478.2 545.1 C492.2 545.1 503.2 533.8 503.2 519.4 L503.2 482.3 L520.3 482.3 C559.9 482.3 595.0 457.0 609.0 419.9 L629.5 710.0 C630.6 722.8 626.5 735.4 618.0 745.0 Z M698.3 622.5 C697.8 623.0 697.1 623.4 696.3 623.5 L672.8 623.5 L662.8 487.0 L683.3 487.0 C684.8 487.0 686.3 488.0 686.3 489.5 L699.3 620.0 C699.3 621.0 699.3 622.0 698.3 622.5 Z M698.3 622.5" />
              </svg>
              <span class="text-xs font-bold truncate">我的背包</span>
            </div>
            <div class="i-carbon-chevron-right text-xs opacity-40 shrink-0" />
          </button>

          <!-- 3. 功能配置卡片 -->
          <button
            type="button"
            class="h-9 flex items-center justify-between rounded-xl px-3 transition-all duration-200 active:scale-95 border border-emerald-200/90 bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100/80 dark:border-emerald-600/30 dark:bg-emerald-950/30 dark:text-emerald-200"
            title="功能配置"
            @click="emit('settings', acc)"
          >
            <div class="flex items-center gap-2 min-w-0">
              <div class="i-carbon-settings text-base text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span class="text-xs font-bold truncate">功能配置</span>
            </div>
            <div class="i-carbon-chevron-right text-xs opacity-40 shrink-0" />
          </button>

          <!-- 4. 掉线通知卡片 -->
          <button
            type="button"
            class="h-9 flex items-center justify-between rounded-xl px-3 transition-all duration-200 active:scale-95 border border-blue-200/90 bg-blue-50/70 text-blue-800 hover:bg-blue-100/80 dark:border-blue-600/30 dark:bg-blue-950/30 dark:text-blue-200"
            title="掉线通知"
            @click="emit('notification', acc)"
          >
            <div class="flex items-center gap-2 min-w-0">
              <div class="i-carbon-notification text-base text-blue-600 dark:text-blue-400 shrink-0" />
              <span class="text-xs font-bold truncate">掉线通知</span>
            </div>
            <div class="i-carbon-chevron-right text-xs opacity-40 shrink-0" />
          </button>
        </div>
      </div>
    </div>

    <AccountModal
      :show="showModal"
      :edit-data="editingAccount"
      @close="emit('closeModal')"
      @saved="(id) => emit('saved', id)"
    />

    <ConfirmModal
      :show="showDeleteConfirm"
      :loading="deleteLoading"
      title="删除账号"
      :message="accountToDelete ? `确定要删除账号 ${accountToDelete.name || accountToDelete.id} 吗?` : ''"
      confirm-text="删除"
      type="danger"
      @close="!deleteLoading && emit('closeDeleteConfirm')"
      @cancel="!deleteLoading && emit('closeDeleteConfirm')"
      @confirm="emit('confirmDelete')"
    />

    <ConfirmModal
      :show="showClearStoppedConfirm"
      :loading="clearStoppedLoading"
      title="一键清理已停止账号"
      :message="`确定要清理 ${stoppedAccountsCount} 个已停止的账号吗？此操作不可恢复！`"
      confirm-text="确认清理"
      type="danger"
      @close="!clearStoppedLoading && emit('closeClearStoppedConfirm')"
      @cancel="!clearStoppedLoading && emit('closeClearStoppedConfirm')"
      @confirm="emit('confirmClearStopped')"
    />
  </div>

    <!-- 每日礼包与任务浮层 -->
    <Teleport to="body">
      <div v-if="showTaskModal" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-3 sm:p-5 backdrop-blur-sm" @click.self="showTaskModal = false">
        <div class="max-h-[85vh] max-w-lg w-full flex flex-col overflow-hidden rounded-2xl shadow-2xl border border-white/70 dark:border-white/10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl animate-scale-in">
          <div class="flex items-center justify-between border-b border-gray-100/80 px-4 py-3 dark:border-gray-800">
            <div class="flex items-center gap-2">
              <div class="h-7 w-7 flex items-center justify-center rounded-lg bg-pink-50 text-pink-500 dark:bg-pink-950/40">
                <div class="i-carbon-gift text-base" />
              </div>
              <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100">
                每日礼包 & 任务
              </h3>
            </div>
            <button
              class="h-7 w-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors"
              title="关闭"
              @click="showTaskModal = false"
            >
              <div class="i-carbon-close text-lg" />
            </button>
          </div>
          <div class="flex-1 overflow-y-auto p-3.5 sm:p-4">
            <DailyOverview
              :daily-gifts="String(selectedTaskAccount?.id) === String(statusAccountId) ? dailyGifts : null"
              :fallback-tasks="selectedTaskAccount?.tasks"
              :loading="taskModalLoading"
              :hide-card="true"
              :show-growth="true"
            />
          </div>
        </div>
      </div>
    </Teleport>


    <!-- 我的背包浮层 (移植完整背包页面组件，带分类、批量出售、使用道具全套功能) -->
    <Teleport to="body">
      <div v-if="showBagModal" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-3 sm:p-5 backdrop-blur-sm" @click.self="closeBagModal">
        <div class="max-h-[90vh] max-w-4xl w-full flex flex-col overflow-hidden rounded-2xl shadow-2xl border border-white/70 dark:border-white/10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl animate-scale-in">
          <!-- 头部 (带账号昵称与小号关闭按钮) -->
          <div class="flex items-center justify-between border-b border-gray-100/80 px-4 py-3 dark:border-gray-800">
            <div class="flex items-center gap-2">
              <div class="h-8 w-8 flex items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                <svg viewBox="0 0 750 802" class="h-4.5 w-4.5 fill-current text-blue-600 hover:text-blue-700 dark:text-blue-400">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M748.9 615.5 L735.9 485.0 C733.4 458.0 710.4 437.4 683.4 437.4 L659.3 437.4 L643.3 220.9 C642.9 213.7 641.9 206.5 640.4 199.4 L640.4 198.9 C624.8 130.4 563.3 79.4 490.8 79.4 L464.8 79.4 C459.3 34.4 421.3 -0.6 374.8 -0.6 C328.3 -0.6 289.8 34.4 284.8 79.4 L258.8 79.4 C186.8 79.4 124.8 130.4 109.3 198.9 L109.3 199.4 C107.8 206.4 106.8 213.9 105.8 221.4 L89.8 438.0 L65.8 438.0 C38.6 437.7 15.8 458.4 13.3 485.5 L0.3 616.0 C-1.2 631.0 3.8 645.5 13.8 657.0 C23.6 668.2 37.8 674.6 52.8 674.5 L72.3 674.5 L70.2 699.0 C68.2 725.0 77.2 751.5 95.3 770.5 C113.2 789.9 138.4 800.9 164.8 801.0 L583.8 801.0 C610.2 801.0 635.5 790.0 653.3 770.5 C671.2 751.2 680.3 725.3 678.3 699.0 L676.3 674.5 L695.8 674.5 C710.8 674.5 724.8 668.0 734.8 657.0 C744.8 646.0 750.3 630.0 748.8 615.5 Z M374.3 48.4 C393.3 48.4 408.8 61.4 413.8 78.4 L335.3 78.4 C340.0 60.7 356.0 48.4 374.3 48.4 Z M249.6 124.6 L498.6 124.6 C549.9 124.6 588.5 158.9 599.7 205.6 C600.8 230.7 604.6 255.8 599.7 280.4 L576.7 396.3 C572.4 417.8 552.6 433.7 529.6 433.7 L511.4 433.7 L511.4 418.9 C511.4 404.5 499.6 393.2 484.6 393.2 C469.6 393.2 457.9 404.5 457.9 418.9 L457.9 433.7 L290.3 433.7 L290.3 418.9 C290.3 404.5 278.5 393.2 263.5 393.2 C248.5 393.2 236.7 404.5 236.7 418.9 L236.7 433.7 L218.5 433.7 C195.5 433.7 175.7 417.8 171.4 396.3 L148.4 280.4 C143.5 255.8 147.3 230.7 148.4 205.6 C160.1 159.5 198.2 124.6 249.6 124.6 Z M52.2 623.5 C51.3 623.5 50.7 623.0 50.2 622.5 C49.8 622.0 49.2 621.0 49.8 620.0 L62.7 489.5 C62.7 488.0 64.3 487.0 65.8 487.0 L86.2 487.0 L76.2 623.5 Z M618.0 745.0 C609.7 754.6 597.6 760.1 584.9 760.0 L164.9 760.0 C152.4 760.0 140.3 754.8 131.8 745.0 C123.3 735.3 118.8 722.9 119.8 710.0 L140.3 419.9 C154.3 457.0 189.4 482.3 229.0 482.3 L246.1 482.3 L246.1 519.4 C246.1 533.8 257.1 545.1 271.1 545.1 C285.2 545.1 296.2 533.8 296.2 519.4 L296.2 482.3 L453.1 482.3 L453.1 519.4 C453.1 533.8 464.1 545.1 478.2 545.1 C492.2 545.1 503.2 533.8 503.2 519.4 L503.2 482.3 L520.3 482.3 C559.9 482.3 595.0 457.0 609.0 419.9 L629.5 710.0 C630.6 722.8 626.5 735.4 618.0 745.0 Z M698.3 622.5 C697.8 623.0 697.1 623.4 696.3 623.5 L672.8 623.5 L662.8 487.0 L683.3 487.0 C684.8 487.0 686.3 488.0 686.3 489.5 L699.3 620.0 C699.3 621.0 699.3 622.0 698.3 622.5 Z M698.3 622.5" />
              </svg>
              </div>
              <div>
                <h3 class="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100">
                  我的背包
                </h3>
                <p v-if="selectedBagAccount" class="text-[11px] text-gray-400">
                  正在查看：{{ selectedBagAccount.nick || selectedBagAccount.name || selectedBagAccount.id }}
                </p>
              </div>
            </div>
            <!-- 右上角小尺寸关闭按钮 -->
            <button
              class="h-7 w-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors"
              title="关闭"
              @click="closeBagModal"
            >
              <div class="i-carbon-close text-lg" />
            </button>
          </div>

          <!-- 内容区域：原生 BagPanel 完整功能无缝嵌入 -->
          <div class="flex-1 overflow-y-auto p-3 sm:p-5">
            <BagPanel :account-id="selectedBagAccount?.id" />
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 账号续费专属液态毛玻璃浮层弹窗 -->
    <Teleport to="body">
      <div
        v-if="showRenewModal"
        class="fixed inset-0 z-[10060] flex items-center justify-center p-3 sm:p-4 bg-black/55 backdrop-blur-md"
        @click.self="showRenewModal = false"
      >
        <div class="max-w-md w-full rounded-2xl bg-white shadow-2xl dark:bg-gray-800 border border-gray-100 dark:border-gray-700 overflow-hidden" @click.stop>
          <!-- 头部标题 + 关闭按钮 -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <div class="flex items-center gap-2">
              <div class="h-8 w-8 flex items-center justify-center rounded-xl bg-orange-500/15 text-orange-500 font-bold">
                <div class="i-carbon-ticket text-lg" />
              </div>
              <h3 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white">
                账号充值续费
              </h3>
            </div>
            <button
              class="h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 transition"
              @click="showRenewModal = false"
            >
              <div class="i-carbon-close text-xl" />
            </button>
          </div>

          <!-- 内容表单区 -->
          <div class="p-5 space-y-4">
            <!-- 当前状态展示卡 -->
            <div class="flex items-center justify-between p-3 rounded-xl bg-gray-50/80 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700/60 text-xs">
              <span class="text-gray-500 dark:text-gray-400">当前账号到期状态</span>
              <span class="font-bold text-orange-600 dark:text-orange-400 font-mono">
                {{ userStore.expireTimeText }}
              </span>
            </div>

            <div>
              <label class="mb-1.5 block text-xs font-semibold text-gray-700 dark:text-gray-300">
                卡密兑换码
              </label>
              <BaseInput
                v-model="renewCardCode"
                placeholder="请输入购买获取的卡密兑换码"
                @keyup.enter="handleRenewCard"
              />
              <p class="mt-1.5 text-[11px] text-gray-400 leading-relaxed">
                支持使用【时长卡密】顺延账号有效期，或使用【额度卡密】增加可托管的农场账号上限。
              </p>
            </div>
          </div>

          <!-- 底部操作栏 -->
          <div class="px-5 py-3.5 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-2.5 bg-gray-50/50 dark:bg-gray-800/50">
            <BaseButton variant="secondary" size="sm" @click="showRenewModal = false">
              取消
            </BaseButton>
            <BaseButton
              variant="primary"
              size="sm"
              :loading="renewLoading"
              @click="handleRenewCard"
            >
              确认充值使用
            </BaseButton>
          </div>
        </div>
      </div>
    </Teleport>
</template>

<style scoped>
/* 拟物态微立体胶囊按钮 */
.neu-capsule-btn {
  border: 1.5px solid transparent;
  box-shadow: 
    inset 0 1px 1px rgba(255, 255, 255, 0.9),
    0 2px 5px rgba(0, 0, 0, 0.06);
}

.neu-green {
  background: linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%);
  border-color: #86efac;
  color: #15803d;
}
.neu-green:hover {
  background: linear-gradient(180deg, #dcfce7 0%, #bbf7d0 100%);
  border-color: #4ade80;
  box-shadow: 
    inset 0 1px 1px rgba(255, 255, 255, 1),
    0 3px 8px rgba(34, 197, 94, 0.2);
}

.neu-red {
  background: linear-gradient(180deg, #fef2f2 0%, #fee2e2 100%);
  border-color: #fca5a5;
  color: #b91c1c;
}
.neu-red:hover {
  background: linear-gradient(180deg, #fee2e2 0%, #fecaca 100%);
  border-color: #f87171;
  box-shadow: 
    inset 0 1px 1px rgba(255, 255, 255, 1),
    0 3px 8px rgba(239, 68, 68, 0.2);
}

.dark .neu-green {
  background: linear-gradient(180deg, rgba(20, 83, 45, 0.35) 0%, rgba(20, 83, 45, 0.6) 100%);
  border-color: rgba(74, 222, 128, 0.4);
  color: #86efac;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.15), 0 2px 5px rgba(0, 0, 0, 0.3);
}

.dark .neu-red {
  background: linear-gradient(180deg, rgba(127, 29, 29, 0.35) 0%, rgba(127, 29, 29, 0.6) 100%);
  border-color: rgba(248, 113, 113, 0.4);
  color: #fca5a5;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.15), 0 2px 5px rgba(0, 0, 0, 0.3);
}
</style>
