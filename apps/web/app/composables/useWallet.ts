import type { DepositDto, LedgerEntryDto, ScamAccountDto, WithdrawalDto } from '@fx42/contracts'

export type LedgerItem = LedgerEntryDto

export function useWallet() {
  const { api } = useApi()
  const { mode } = useAccountMode()
  const { wallet } = useAccountSnapshot()
  const deposits = ref<DepositDto[]>([])
  const withdrawals = ref<WithdrawalDto[]>([])
  const ledger = ref<LedgerItem[]>([])
  const credential = ref<{ hint: string; scamUsername: string | null; status: string } | null>(null)
  const scamAccounts = ref<ScamAccountDto[]>([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    try {
      const [dep, wit, led] = await Promise.all([
        api<{ items: DepositDto[] }>(`/api/deposits?mode=${mode.value}`),
        api<{ items: WithdrawalDto[] }>(`/api/withdrawals?mode=${mode.value}`),
        api<{ items: LedgerItem[] }>(`/api/wallet/ledger?mode=${mode.value}`),
      ])
      deposits.value = dep.items
      withdrawals.value = wit.items
      ledger.value = led.items
      if (mode.value === 'real') await loadScam()
      else {
        credential.value = null
        scamAccounts.value = []
      }
    } finally {
      loading.value = false
    }
  }

  async function loadScam() {
    const data = await api<{
      credential: { hint: string; scamUsername: string | null; status: string } | null
      accounts: ScamAccountDto[]
    }>('/api/wallet/scam-accounts')
    credential.value = data.credential
    scamAccounts.value = data.accounts
  }

  async function bindToken(token: string) {
    const data = await api<{
      credential: { hint: string; scamUsername: string | null; status: string }
      accounts: ScamAccountDto[]
    }>('/api/wallet/scam-token', { method: 'POST', body: { token } })
    credential.value = data.credential
    scamAccounts.value = data.accounts
    return data
  }

  async function unbind() {
    await api('/api/wallet/scam-token', { method: 'DELETE' })
    credential.value = null
    scamAccounts.value = []
  }

  async function setPrimary(accountId: string) {
    await api('/api/wallet/scam-accounts/primary', { method: 'POST', body: { accountId } })
    await loadScam()
  }

  async function createAutoDeposit(accountId: string, amount: string) {
    const data = await api<{ deposit: DepositDto }>('/api/deposits/auto', {
      method: 'POST',
      body: { accountId, amount, requestId: `web-${crypto.randomUUID()}` },
    })
    await load()
    return data.deposit
  }

  async function createVirtualDeposit(amount: string) {
    const data = await api<{ deposit: DepositDto }>('/api/deposits/virtual', {
      method: 'POST',
      body: { amount, requestId: `web-${crypto.randomUUID()}` },
    })
    await load()
    return data.deposit
  }

  async function createWithdrawal(input: { amount: string; destinationAccountId?: string }) {
    const body =
      mode.value === 'real'
        ? {
            mode: 'real',
            amount: input.amount,
            destinationAccountId: input.destinationAccountId,
            requestId: `web-${crypto.randomUUID()}`,
          }
        : {
            mode: 'virtual',
            amount: input.amount,
            requestId: `web-${crypto.randomUUID()}`,
          }
    const data = await api<{ withdrawal: WithdrawalDto }>('/api/withdrawals', {
      method: 'POST',
      body,
    })
    await load()
    return data.withdrawal
  }

  async function cancelWithdrawal(id: string) {
    await api(`/api/withdrawals/${id}/cancel`, { method: 'POST', body: {} })
    await load()
  }

  return {
    wallet,
    deposits,
    withdrawals,
    ledger,
    credential,
    scamAccounts,
    loading,
    load,
    loadScam,
    bindToken,
    unbind,
    setPrimary,
    createAutoDeposit,
    createVirtualDeposit,
    createWithdrawal,
    cancelWithdrawal,
  }
}
