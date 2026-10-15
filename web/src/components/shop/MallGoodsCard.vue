<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import { formatCouponAmount } from '@/utils/number-format'

defineProps<{
  item: any
  canAfford: boolean
  statusLabel: string
  hint: string
}>()

const emit = defineEmits<{
  (e: 'buy', item: any): void
}>()

const L = {
  free: '\u514D\u8D39',
  coupon: '\u70B9\u5238',
  buy: '\u7ACB\u5373\u8D2D\u4E70',
  claim: '\u7ACB\u5373\u9886\u53D6',
  canBuy: '\u53EF\u8D2D\u4E70',
  canClaimFree: '\u53EF\u514D\u8D39\u9886',
}

function itemImage(item: any) {
  return Array.isArray(item.images) ? item.images[0] : ''
}

function currencyIcon(item: any) {
  const icons: Record<number, string> = { 1001: 'gold', 1002: 'coupon', 1004: 'diamond', 1005: 'gold-bean' }
  const icon = icons[Number(item.currencyId || 1002)]
  return icon ? `/game-config/resource-icons/${icon}.png` : ''
}
</script>

<template>
  <article class="min-h-[216px] min-w-0 flex flex-col overflow-hidden border border-gray-200 rounded-lg bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
    <div class="relative grid h-24 place-items-center bg-gray-50 dark:bg-gray-900/40">
      <span class="absolute left-0 top-0 rounded-br-lg bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600 font-semibold dark:bg-gray-700 dark:text-gray-300">
        #{{ item.goodsId }}
      </span>
      <span class="absolute right-0 top-0 rounded-bl-lg bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700 font-semibold dark:bg-blue-900/20 dark:text-blue-300">
        <span v-if="item.isFree">{{ L.free }}</span>
        <img v-else-if="currencyIcon(item)" :src="currencyIcon(item)" :alt="item.currencyName || L.coupon" :title="item.currencyName || L.coupon" class="h-5 w-5 object-contain">
        <span v-else>{{ item.currencyName || L.coupon }}</span>
      </span>
      <img v-if="itemImage(item)" :src="itemImage(item)" :alt="item.name" class="max-h-14 max-w-14 object-contain">
      <div v-else class="grid h-14 w-14 place-items-center rounded-lg bg-white text-sm text-gray-500 font-semibold dark:bg-gray-800">
        {{ String(item.name || '?').slice(0, 1) }}
      </div>
    </div>

    <div class="min-h-[120px] flex flex-1 flex-col p-3">
      <div class="line-clamp-2 text-center text-sm text-gray-900 font-semibold dark:text-gray-100">
        {{ item.name }}
      </div>
      <div class="mt-1 text-center text-xs text-amber-600 font-semibold dark:text-amber-400">
        {{ item.isFree ? L.free : `${formatCouponAmount(item.price)} ${item.currencyName || L.coupon}` }}
      </div>
      <p v-if="item.discount" class="line-clamp-2 mt-2 text-[11px] text-blue-500 leading-5 dark:text-blue-400">
        {{ item.discount }}
      </p>
      <p class="line-clamp-2 mt-2 text-[11px] text-gray-500 leading-5 dark:text-gray-400">
        {{ hint }}
      </p>
      <BaseButton
        class="mt-auto w-full"
        variant="primary"
        :disabled="!item.canBuy || item.isSoldOut || !canAfford"
        @click="emit('buy', item)"
      >
        {{ statusLabel === L.canBuy || statusLabel === L.canClaimFree ? (item.isFree ? L.claim : L.buy) : statusLabel }}
      </BaseButton>
    </div>
  </article>
</template>
