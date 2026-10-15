<script setup lang="ts">
import FarmScene from '@/components/FarmScene.vue'

type FriendActionType = 'steal' | 'water' | 'weed' | 'bug' | 'bad'

const props = defineProps<{
  friends: any[]
  totalFriends: number
  totalPages: number
  pageSize: number
  blacklistGidSet: Set<number>
  knownFriendGidSet: Set<number>
  expandedFriends: Set<string>
  friendLands: Record<string, any[]>
  friendLandsLoading: Record<string, boolean>
  isQqAccount: boolean
  canShowFriendAvatar: (friend: any) => boolean
  getFriendAvatar: (friend: any) => string
  getFriendLevel: (friend: any) => number
  getFriendGold: (friend: any) => number
  formatFriendGold: (value: unknown) => string
  getFriendStatusText: (friend: any) => string
  getFriendStatusHint: (friend: any) => string
}>()

const emit = defineEmits<{
  (e: 'toggleFriend', friendId: string): void
  (e: 'operate', friendId: string, type: FriendActionType, event: Event): void
  (e: 'toggleBlacklist', friend: any, event: Event): void
  (e: 'removeKnownFriendGid', friend: any, event: Event): void
  (e: 'friendAvatarError', friend: any): void
}>()

const currentPage = defineModel<number>('currentPage', { required: true })

function goToPage(page: number) {
  currentPage.value = Math.max(1, Math.min(page, props.totalPages))
}
</script>

<template>
  <div
    v-for="friend in friends"
    :key="friend.gid"
    class="overflow-hidden rounded-lg bg-white shadow dark:bg-gray-800"
  >
    <div
      class="flex flex-col cursor-pointer justify-between gap-4 p-4 transition sm:flex-row sm:items-center hover:bg-gray-50 dark:hover:bg-gray-700/50"
      :class="blacklistGidSet.has(Number(friend.gid)) ? 'opacity-50' : ''"
      @click="emit('toggleFriend', friend.gid)"
    >
      <div class="flex items-center gap-3">
        <div class="h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 ring-1 ring-gray-100 dark:bg-gray-600 dark:ring-gray-700">
          <img
            v-if="canShowFriendAvatar(friend)"
            :src="getFriendAvatar(friend)"
            class="h-full w-full object-cover"
            loading="lazy"
            @error="emit('friendAvatarError', friend)"
          >
          <div v-else class="i-carbon-user text-gray-400" />
        </div>
        <div>
          <div class="flex items-center gap-2 font-bold">
            {{ friend.name }} ({{ friend.gid }})

            <span v-if="blacklistGidSet.has(Number(friend.gid))" class="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400">已屏蔽</span>
            <span v-if="Number(friend?.dogId) === 90021" class="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-600 dark:bg-red-900/40 dark:text-red-400 shadow-sm">🐕 护主犬</span>
            <span v-else-if="Number(friend?.dogId) > 0" class="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 shadow-sm">🐶 {{ friend.dogName || '宠物犬' }}</span>
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
            <span
              v-if="getFriendLevel(friend) > 0"
              class="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500 dark:bg-gray-700 dark:text-gray-300"
            >
              Lv.{{ getFriendLevel(friend) }}
            </span>
            <span
              v-if="getFriendGold(friend) > 0"
              class="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
            >
              金币 {{ formatFriendGold(friend.gold) }}
            </span>
            <span
              v-if="friend.dogName"
              class="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500 dark:bg-gray-700 dark:text-gray-300"
            >
              {{ friend.dogName }}
            </span>
          </div>
          <div class="text-sm" :class="getFriendStatusText(friend) !== '无操作' ? 'text-green-500 font-medium' : 'text-gray-400'">
            {{ getFriendStatusText(friend) }}
          </div>
          <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {{ getFriendStatusHint(friend) }}
          </div>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          class="rounded bg-blue-100 px-3 py-2 text-sm text-blue-700 transition hover:bg-blue-200"
          @click="emit('operate', friend.gid, 'steal', $event)"
        >
          偷取
        </button>
        <button
          class="rounded bg-cyan-100 px-3 py-2 text-sm text-cyan-700 transition hover:bg-cyan-200"
          @click="emit('operate', friend.gid, 'water', $event)"
        >
          浇水
        </button>
        <button
          class="rounded bg-green-100 px-3 py-2 text-sm text-green-700 transition hover:bg-green-200"
          @click="emit('operate', friend.gid, 'weed', $event)"
        >
          除草
        </button>
        <button
          class="rounded bg-orange-100 px-3 py-2 text-sm text-orange-700 transition hover:bg-orange-200"
          @click="emit('operate', friend.gid, 'bug', $event)"
        >
          除虫
        </button>
        <button
          class="rounded bg-red-100 px-3 py-2 text-sm text-red-700 transition hover:bg-red-200"
          @click="emit('operate', friend.gid, 'bad', $event)"
        >
          捣乱
        </button>
        <button
          class="rounded px-3 py-2 text-sm transition"
          :class="blacklistGidSet.has(Number(friend.gid))
            ? 'bg-gray-200 text-gray-600 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
            : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700/50 dark:text-gray-400 dark:hover:bg-gray-700'"
          @click="emit('toggleBlacklist', friend, $event)"
        >
          {{ blacklistGidSet.has(Number(friend.gid)) ? '移出黑名单' : '加入黑名单' }}
        </button>
        <button
          v-if="isQqAccount && knownFriendGidSet.has(Number(friend.gid))"
          class="rounded bg-amber-100 px-3 py-2 text-sm text-amber-700 transition dark:bg-amber-900/30 hover:bg-amber-200 dark:text-amber-400 dark:hover:bg-amber-900/50"
          @click="emit('removeKnownFriendGid', friend, $event)"
        >
          移出同步列表
        </button>
      </div>
    </div>

    <div v-if="expandedFriends.has(friend.gid)" class="border-t bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
      <div v-if="friendLandsLoading[friend.gid]" class="flex justify-center py-4">
        <div class="i-svg-spinners-90-ring-with-bg text-2xl text-blue-500" />
      </div>
      <div v-else-if="!friendLands[friend.gid] || friendLands[friend.gid]?.length === 0" class="py-4 text-center text-gray-500">
        当前没有返回土地数据，可稍后重试或先确认该好友农场是否可访问。
      </div>
      <FarmScene v-else :lands="friendLands[friend.gid] || []" />
    </div>
  </div>

  <div v-if="totalFriends > pageSize" class="mt-4 flex flex-wrap items-center justify-center gap-2">
    <button
      class="border border-gray-200 rounded bg-white px-3 py-1.5 text-sm text-gray-600 transition dark:border-gray-600 dark:bg-gray-800 hover:bg-gray-50 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-700"
      :disabled="currentPage === 1"
      @click="goToPage(1)"
    >
      首页
    </button>
    <button
      class="border border-gray-200 rounded bg-white px-3 py-1.5 text-sm text-gray-600 transition dark:border-gray-600 dark:bg-gray-800 hover:bg-gray-50 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-700"
      :disabled="currentPage === 1"
      @click="goToPage(currentPage - 1)"
    >
      上一页
    </button>
    <div class="flex items-center gap-1">
      <template v-for="p in totalPages" :key="p">
        <button
          v-if="p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)"
          class="h-8 w-8 rounded text-sm transition"
          :class="p === currentPage
            ? 'text-white'
            : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
          :style="p === currentPage ? { backgroundColor: 'var(--theme-primary)' } : {}"
          @click="goToPage(p)"
        >
          {{ p }}
        </button>
        <span
          v-else-if="p === currentPage - 2 || p === currentPage + 2"
          class="px-1 text-gray-400"
        >...</span>
      </template>
    </div>
    <button
      class="border border-gray-200 rounded bg-white px-3 py-1.5 text-sm text-gray-600 transition dark:border-gray-600 dark:bg-gray-800 hover:bg-gray-50 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-700"
      :disabled="currentPage === totalPages"
      @click="goToPage(currentPage + 1)"
    >
      下一页
    </button>
    <button
      class="border border-gray-200 rounded bg-white px-3 py-1.5 text-sm text-gray-600 transition dark:border-gray-600 dark:bg-gray-800 hover:bg-gray-50 dark:text-gray-300 disabled:opacity-50 dark:hover:bg-gray-700"
      :disabled="currentPage === totalPages"
      @click="goToPage(totalPages)"
    >
      末页
    </button>
    <span class="text-sm text-gray-500 dark:text-gray-400">
      共 {{ totalFriends }} 位好友
    </span>
  </div>
</template>
