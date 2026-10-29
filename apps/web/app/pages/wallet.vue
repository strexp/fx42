<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'

const { t } = useI18n()
const { mode } = useAccountMode()
const toast = useToast()
const {
  wallet,
  deposits,
  withdrawals,
  ledger,
  credential,
  scamAccounts,
  loading,
  load,
  bindToken,
  unbind,
  setPrimary,
  createAutoDeposit,
  createVirtualDeposit,
  createWithdrawal,
  cancelWithdrawal,
} = useWallet()

const token = ref('')
const bindLoading = ref(false)
const amount = ref('100')
const busy = ref(false)
const destination = ref('')
const sourceAccountId = ref('')
const sourceAccounts = computed(() => scamAccounts.value)

type ConfirmAction = 'deposit' | 'withdraw' | 'cancelWithdrawal' | 'unbind' | 'setPrimary'
const confirmAction = ref<ConfirmAction | null>(null)
const cancelTarget = ref<string | null>(null)
const primaryTarget = ref<string | null>(null)
const confirmBusy = ref(false)
const currency = computed(() => wallet.value?.currency ?? (mode.value === 'real' ? 'FTK' : 'VFTK'))
const confirmOpen = computed({
  get: () => confirmAction.value !== null,
  set: (open) => {
    if (!open) {
      confirmAction.value = null
      cancelTarget.value = null
      primaryTarget.value = null
    }
  },
})
const confirmTitle = computed(() => {
  if (confirmAction.value === 'deposit') return t('wallet.confirmDepositTitle')
  if (confirmAction.value === 'withdraw') return t('wallet.confirmWithdrawTitle')
  if (confirmAction.value === 'cancelWithdrawal') return t('wallet.confirmCancelWithdrawalTitle')
  if (confirmAction.value === 'unbind') return t('wallet.confirmUnbindTitle')
  if (confirmAction.value === 'setPrimary') return t('wallet.confirmSetPrimaryTitle')
  return ''
})
const confirmDescription = computed(() => {
  if (confirmAction.value === 'deposit') {
    return t('wallet.confirmDeposit', {
      mode: t(`common.${mode.value}`),
      amount: amount.value,
      currency: currency.value,
    })
  }
  if (confirmAction.value === 'withdraw') {
    return t('wallet.confirmWithdraw', {
      mode: t(`common.${mode.value}`),
      amount: amount.value,
      currency: currency.value,
    })
  }
  if (confirmAction.value === 'cancelWithdrawal') return t('wallet.confirmCancelWithdrawal')
  if (confirmAction.value === 'unbind') return t('wallet.confirmUnbind')
  if (confirmAction.value === 'setPrimary') return t('wallet.confirmSetPrimary')
  return ''
})

function requestAction(action: ConfirmAction) {
  confirmAction.value = action
}

function requestCancelWithdrawal(id: string) {
  cancelTarget.value = id
  confirmAction.value = 'cancelWithdrawal'
}

function requestSetPrimary(id: string) {
  primaryTarget.value = id
  confirmAction.value = 'setPrimary'
}

async function runConfirmedAction() {
  const action = confirmAction.value
  if (!action) return
  confirmBusy.value = true
  try {
    if (action === 'deposit') await deposit()
    else if (action === 'withdraw') await withdraw()
    else if (action === 'cancelWithdrawal' && cancelTarget.value) {
      await cancelWithdrawal(cancelTarget.value)
    } else if (action === 'unbind') {
      await unbind()
      toast.add({ title: t('wallet.unbound'), color: 'success' })
    } else if (action === 'setPrimary' && primaryTarget.value) {
      await setPrimary(primaryTarget.value)
    }
    confirmAction.value = null
    cancelTarget.value = null
    primaryTarget.value = null
  } catch {
    // useApi already shows the error toast; keep the dialog open for retry.
  } finally {
    confirmBusy.value = false
  }
}

function selectDefaults() {
  destination.value =
    scamAccounts.value.find((a) => a.isPrimary)?.id ?? scamAccounts.value[0]?.id ?? ''
  sourceAccountId.value = sourceAccounts.value[0]?.id ?? ''
}

onMounted(async () => {
  await load()
  selectDefaults()
})

watch(mode, async () => {
  await load()
  selectDefaults()
})

useIntervalFn(() => {
  if (
    deposits.value.some((d) => d.status === 'pending') ||
    withdrawals.value.some((w) => ['requested', 'sending'].includes(w.status))
  ) {
    void load()
  }
}, 5000)

async function doBind() {
  bindLoading.value = true
  try {
    await bindToken(token.value)
    token.value = ''
    toast.add({ title: t('wallet.bound'), color: 'success' })
    selectDefaults()
  } finally {
    bindLoading.value = false
  }
}

async function deposit() {
  busy.value = true
  try {
    if (mode.value === 'virtual') {
      const d = await createVirtualDeposit(amount.value)
      toast.add({ title: t('wallet.credited'), description: `${d.amount} VFTK`, color: 'success' })
    } else {
      if (!sourceAccountId.value) throw new Error('no source account')
      const d = await createAutoDeposit(sourceAccountId.value, amount.value)
      if (d.status === 'credited') {
        toast.add({
          title: t('wallet.credited'),
          description: `${d.creditedAmount ?? d.amount} FTK`,
          color: 'success',
        })
      } else {
        toast.add({ title: t('wallet.autoPending'), color: 'warning' })
      }
    }
  } finally {
    busy.value = false
  }
}

async function withdraw() {
  busy.value = true
  try {
    const w = await createWithdrawal({
      amount: amount.value,
      destinationAccountId: mode.value === 'real' ? destination.value : undefined,
    })
    toast.add({
      title: t('wallet.withdraw'),
      description: `${w.netAmount} ${wallet.value?.currency}`,
      color: 'success',
    })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold">
        {{ t('wallet.title') }} · {{ mode === 'real' ? 'FTK' : 'VFTK' }}
      </h1>
      <UButton
        variant="ghost"
        size="sm"
        :loading="loading"
        icon="i-lucide-refresh-cw"
        @click="load"
        >{{ t('common.refresh') }}</UButton
      >
    </div>

    <WalletSummaryCards :wallet="wallet" />

    <UAlert
      v-if="mode === 'virtual'"
      color="warning"
      variant="subtle"
      :title="t('wallet.virtualNotice')"
    />

    <WalletExternalAccountCard
      v-if="mode === 'real'"
      v-model:token="token"
      :credential="credential"
      :scam-accounts="scamAccounts"
      :bind-loading="bindLoading"
      @bind="doBind"
      @unbind="requestAction('unbind')"
      @set-primary="requestSetPrimary"
    />

    <div class="grid gap-4 xl:grid-cols-2">
      <WalletDepositCard
        v-model:amount="amount"
        v-model:source-account-id="sourceAccountId"
        :mode="mode"
        :source-accounts="sourceAccounts"
        :has-credential="!!credential"
        :busy="busy"
        @deposit="requestAction('deposit')"
      />
      <WalletWithdrawCard
        v-model:amount="amount"
        v-model:destination="destination"
        :mode="mode"
        :scam-accounts="scamAccounts"
        :has-credential="!!credential"
        :busy="busy"
        @withdraw="requestAction('withdraw')"
      />
    </div>

    <WalletHistoryCard
      :wallet="wallet"
      :deposits="deposits"
      :withdrawals="withdrawals"
      :ledger="ledger"
      @cancel-withdrawal="requestCancelWithdrawal"
    />

    <ConfirmDialog
      v-model:open="confirmOpen"
      :title="confirmTitle"
      :description="confirmDescription"
      :loading="confirmBusy || busy"
      @confirm="runConfirmedAction"
    />
  </div>
</template>
