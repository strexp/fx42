<script setup lang="ts">
import type { DepositDto, WalletDto, WithdrawalDto } from '@fx42/contracts'
import type { LedgerItem } from '~/composables/useWallet'

defineProps<{
  wallet: WalletDto | null
  deposits: DepositDto[]
  withdrawals: WithdrawalDto[]
  ledger: LedgerItem[]
}>()
const emit = defineEmits<{ cancelWithdrawal: [id: string] }>()
const { t } = useI18n()
const { money, date, translateOr, statusColor } = useFormat()
const listTab = ref<'ledger' | 'deposits' | 'withdrawals'>('ledger')

const ledgerLabel = (type: string) => translateOr('wallet.ledgerTypes', type)
const methodLabel = (method: string) => translateOr('wallet.methods', method)
</script>

<template>
  <UCard class="border-default bg-elevated w-full">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-medium">{{ t('wallet.listHistory') }}</h2>
        <div class="border-default flex rounded-lg border p-0.5 text-xs">
          <button
            class="rounded-md px-3 py-1"
            :class="listTab === 'ledger' ? 'bg-accented text-highlighted' : 'text-muted'"
            @click="listTab = 'ledger'"
          >
            {{ t('wallet.ledger') }}
          </button>
          <button
            class="rounded-md px-3 py-1"
            :class="listTab === 'deposits' ? 'bg-accented text-highlighted' : 'text-muted'"
            @click="listTab = 'deposits'"
          >
            {{ t('wallet.depositHistory') }}
          </button>
          <button
            class="rounded-md px-3 py-1"
            :class="listTab === 'withdrawals' ? 'bg-accented text-highlighted' : 'text-muted'"
            @click="listTab = 'withdrawals'"
          >
            {{ t('wallet.withdrawHistory') }}
          </button>
        </div>
      </div>
    </template>

    <div v-if="listTab === 'ledger'" class="max-h-96 space-y-2 overflow-y-auto text-sm">
      <div v-if="!ledger.length" class="text-dimmed py-6 text-center text-xs">
        {{ t('common.empty') }}
      </div>
      <div
        v-for="(l, i) in ledger"
        :key="i"
        class="border-muted flex items-center justify-between border-b pb-2 last:border-0"
      >
        <div>
          <div>{{ ledgerLabel(l.type) }}</div>
          <div class="text-dimmed text-[10px]">{{ date(l.createdAt) }}</div>
        </div>
        <div class="text-right">
          <div class="tabular" :class="Number(l.amount) >= 0 ? 'fx-up' : 'fx-down'">
            {{ money(l.amount) }}
          </div>
          <div class="text-dimmed text-[10px]">{{ money(l.balanceAfter) }}</div>
        </div>
      </div>
    </div>

    <div v-else-if="listTab === 'deposits'" class="max-h-96 space-y-2 overflow-y-auto text-sm">
      <div v-if="!deposits.length" class="text-dimmed py-6 text-center text-xs">
        {{ t('common.empty') }}
      </div>
      <div
        v-for="d in deposits"
        :key="d.id"
        class="border-muted flex items-center justify-between border-b py-2 last:border-0"
      >
        <div>
          <div class="tabular">{{ money(d.amount) }} {{ wallet?.currency }}</div>
          <div class="text-dimmed text-[10px]">
            {{ date(d.createdAt) }} · {{ methodLabel(d.method) }}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <UBadge :color="statusColor(d.status)" size="sm" variant="subtle">
            {{ t(`wallet.${d.status}`) }}
          </UBadge>
        </div>
      </div>
    </div>

    <div v-else class="max-h-96 space-y-2 overflow-y-auto text-sm">
      <div v-if="!withdrawals.length" class="text-dimmed py-6 text-center text-xs">
        {{ t('common.empty') }}
      </div>
      <div
        v-for="w in withdrawals"
        :key="w.id"
        class="border-muted flex items-center justify-between border-b py-2 last:border-0"
      >
        <div>
          <div class="tabular">{{ money(w.amount) }} → {{ money(w.netAmount) }}</div>
          <div class="text-dimmed text-[10px]">
            {{ date(w.requestedAt) }} <span v-if="w.scamRef">· {{ w.scamRef }}</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <UBadge :color="statusColor(w.status)" size="sm" variant="subtle">
            {{ t(`wallet.${w.status}`) }}
          </UBadge>
          <UButton
            v-if="w.status === 'requested'"
            size="xs"
            variant="ghost"
            color="error"
            @click="emit('cancelWithdrawal', w.id)"
          >
            {{ t('common.cancel') }}
          </UButton>
        </div>
      </div>
    </div>
  </UCard>
</template>
