<script setup lang="ts">
import type { WalletDto } from '@fx42/contracts'

defineProps<{ wallet: WalletDto | null }>()
const { t } = useI18n()
</script>

<template>
  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <UCard class="border-default bg-elevated">
      <div class="text-dimmed text-xs">{{ t('wallet.balance') }}</div>
      <div class="mt-1 text-2xl font-semibold">
        <AnimatedMoney :value="wallet?.balance" :digits="2" />
      </div>
    </UCard>
    <UCard class="border-default bg-elevated">
      <div class="text-dimmed text-xs">{{ t('wallet.equity') }}</div>
      <div class="mt-1 text-2xl font-semibold">
        <AnimatedMoney :value="wallet?.equity" :digits="2" />
      </div>
    </UCard>
    <UCard class="border-default bg-elevated">
      <div class="text-dimmed text-xs">{{ t('wallet.margin') }}</div>
      <div class="mt-1 text-2xl font-semibold">
        <AnimatedMoney :value="wallet?.marginUsed" :digits="2" />
      </div>
    </UCard>
    <UCard class="border-default bg-elevated">
      <div class="text-dimmed text-xs">{{ t('wallet.unrealized') }}</div>
      <div class="mt-1 text-2xl font-semibold">
        <AnimatedMoney :value="wallet?.unrealizedPnl" :digits="2" />
      </div>
    </UCard>
  </div>
</template>
