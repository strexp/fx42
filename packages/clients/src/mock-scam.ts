import { randomBytes } from 'node:crypto'
import type { ScamAccountInfo, ScamPort, ScamTransactionInfo, ScamTransferResult } from '@fx42/application'
import { ScamError } from '@fx42/application'

interface MockAccount {
  id: number
  iban: string
  name: string
  balance: number
}

interface MockTx {
  id: number
  from: string
  to: string
  amount: number
  description: string
  type: string
  createdAt: number
}

export const MOCK_RESERVE_IBAN = 'DN4200420000000000000001'
export const MOCK_RESERVE_TOKEN = 'reserve-token'
export const MOCK_ALICE_IBAN = 'DN4200420000000000000002'
export const MOCK_ALICE_TOKEN = 'alice-token'

/**
 * In-memory scam.dn42 substitute for FX42_MODE=mock. It supports enough of the
 * real API for binding, deposits, transfers and reconciliation.
 */
export class MockScamClient implements ScamPort {
  private accounts = new Map<number, MockAccount>()
  private tokens = new Map<string, number[]>()
  private transactions: MockTx[] = []
  private nextAccountId = 1
  private nextTxId = 1000

  constructor() {
    this.createAccount(MOCK_RESERVE_IBAN, 'FX42 Reserve', 10_000_000, MOCK_RESERVE_TOKEN)
    // A regular demo account that can be bound by a user and used as a deposit source.
    this.createAccount(MOCK_ALICE_IBAN, 'Alice Personal', 1_000_000, MOCK_ALICE_TOKEN)
  }

  createAccount(iban: string, name: string, balance: number, token?: string): MockAccount {
    const account: MockAccount = { id: this.nextAccountId++, iban, name, balance }
    this.accounts.set(account.id, account)
    if (token) {
      const ids = this.tokens.get(token) ?? []
      if (!ids.includes(account.id)) ids.push(account.id)
      this.tokens.set(token, ids)
    }
    return account
  }

  private accountForToken(token: string): MockAccount {
    const ids = this.tokens.get(token)
    if (ids && ids.length) {
      const first = this.accounts.get(ids[0]!)
      if (first) return first
    }
    const suffix = randomBytes(8).toString('hex').slice(0, 16).padStart(16, '0')
    return this.createAccount(`DN420042${suffix}`, 'Mock User', 1_000_000, token)
  }

  private toInfo(a: MockAccount): ScamAccountInfo {
    return { scamAccountId: a.id, iban: a.iban, accountName: a.name, balance: a.balance.toFixed(4) }
  }

  private findIban(iban: string): MockAccount | undefined {
    for (const a of this.accounts.values()) if (a.iban === iban) return a
    return undefined
  }

  async listAccounts(token: string): Promise<{ accounts: ScamAccountInfo[]; username: string | null; userId: number | null }> {
    if (!token || token.length < 8) throw new ScamError('invalid token', 401, true)
    const account = this.accountForToken(token)
    const ids = this.tokens.get(token) ?? [account.id]
    const accounts = ids
      .map((id) => this.accounts.get(id))
      .filter((a): a is MockAccount => !!a)
      .map((a) => this.toInfo(a))
    return { accounts: accounts.length ? accounts : [this.toInfo(account)], username: account.name, userId: account.id }
  }

  async getAccount(token: string, accountId: number): Promise<ScamAccountInfo> {
    const ids = this.tokens.get(token)
    if (!ids) throw new ScamError('invalid token', 401, true)
    if (!ids.includes(accountId)) throw new ScamError('forbidden', 403, true)
    const account = this.accounts.get(accountId)
    if (!account) throw new ScamError('not found', 404, true)
    return this.toInfo(account)
  }

  async transfer(
    token: string,
    input: { fromAccountId: number; toIban: string; amount: string; description: string; idempotencyKey: string },
  ): Promise<ScamTransferResult> {
    const ids = this.tokens.get(token)
    if (!ids) throw new ScamError('invalid token', 401, true)
    if (!ids.includes(input.fromAccountId)) throw new ScamError('forbidden', 403, true)
    const existing = this.transactions.find((t) => t.description.endsWith(`[${input.idempotencyKey}]`))
    if (existing) return { transactionId: existing.id, raw: existing }
    const from = this.accounts.get(input.fromAccountId)
    if (!from) throw new ScamError('from account not found', 404, true)
    const to = this.findIban(input.toIban)
    if (!to) throw new ScamError('destination not found', 404, true)
    const amount = Number(input.amount)
    if (!Number.isFinite(amount) || amount < 0.01) throw new ScamError('invalid amount', 400, true)
    if (from.balance < amount) throw new ScamError('insufficient funds', 400, true)
    from.balance -= amount
    to.balance += amount
    const tx: MockTx = {
      id: this.nextTxId++,
      from: from.iban,
      to: to.iban,
      amount,
      description: `${input.description} [${input.idempotencyKey}]`,
      type: 'transfer',
      createdAt: Date.now(),
    }
    this.transactions.push(tx)
    return { transactionId: tx.id, raw: tx }
  }

  async listTransactions(
    token: string,
    input: { accountId: number; limit: number; minId?: number | null },
  ): Promise<{ transactions: ScamTransactionInfo[]; username: string | null }> {
    const ids = this.tokens.get(token)
    if (!ids) throw new ScamError('invalid token', 401, true)
    if (!ids.includes(input.accountId)) throw new ScamError('forbidden', 403, true)
    const account = this.accounts.get(input.accountId)!
    const txs = this.transactions
      .filter((t) => t.from === account.iban || t.to === account.iban)
      .filter((t) => (input.minId ? t.id > input.minId : true))
      .slice(-input.limit)
      .map((t) => ({
        id: t.id,
        fromAccount: t.from,
        toAccount: t.to,
        amount: t.amount.toFixed(4),
        description: t.description,
        type: t.type,
        createdAt: t.createdAt,
      }))
    return { transactions: txs, username: account.name }
  }

  reset(): void {
    this.accounts.clear()
    this.tokens.clear()
    this.transactions = []
    this.nextAccountId = 1
    this.nextTxId = 1000
    this.createAccount(MOCK_RESERVE_IBAN, 'FX42 Reserve', 10_000_000, MOCK_RESERVE_TOKEN)
    this.createAccount(MOCK_ALICE_IBAN, 'Alice Personal', 1_000_000, MOCK_ALICE_TOKEN)
  }
}
