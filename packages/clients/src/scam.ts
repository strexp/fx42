import { ofetch, type FetchOptions } from 'ofetch'
import { AppError } from '@fx42/shared'
import type { ScamAccountInfo, ScamPort, ScamTransactionInfo, ScamTransferResult } from '@fx42/application'
import { ScamError } from '@fx42/application'

interface RawAccount {
  id?: unknown
  account_id?: unknown
  account_number?: unknown
  iban?: unknown
  account_name?: unknown
  name?: unknown
  balance?: unknown
}

interface RawTransaction {
  id?: unknown
  from_account?: unknown
  from_account_number?: unknown
  to_account?: unknown
  to_account_number?: unknown
  amount?: unknown
  description?: unknown
  type?: unknown
  created_at?: unknown
  timestamp?: unknown
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  return null
}

function parseAccount(raw: RawAccount): ScamAccountInfo | null {
  const idRaw = raw.id ?? raw.account_id
  const id = typeof idRaw === 'number' ? idRaw : Number(idRaw)
  const iban = asString(raw.account_number ?? raw.iban)
  if (!Number.isFinite(id) || !iban) return null
  return {
    scamAccountId: id,
    iban,
    accountName: asString(raw.account_name ?? raw.name),
    balance: asString(raw.balance) ?? '0',
  }
}

function parseTransaction(raw: RawTransaction): ScamTransactionInfo | null {
  const id = typeof raw.id === 'number' ? raw.id : Number(raw.id)
  if (!Number.isFinite(id)) return null
  const created = raw.created_at ?? raw.timestamp
  let createdAt: number | null = null
  if (typeof created === 'number') createdAt = created < 1e12 ? created * 1000 : created
  else if (typeof created === 'string') {
    const parsed = Date.parse(created)
    createdAt = Number.isFinite(parsed) ? parsed : null
  }
  return {
    id,
    fromAccount: asString(raw.from_account ?? raw.from_account_number),
    toAccount: asString(raw.to_account ?? raw.to_account_number),
    amount: asString(raw.amount) ?? '0',
    description: asString(raw.description),
    type: asString(raw.type) ?? 'unknown',
    createdAt,
  }
}

function transportError(error: unknown, definitiveForWrite = false): never {
  const status = (error as { status?: number; response?: { status?: number } }).status ??
    (error as { response?: { status?: number } }).response?.status ??
    0
  const definitive = definitiveForWrite && [400, 401, 403, 404, 409].includes(status)
  const message = status ? `scam.dn42 responded ${status}` : 'scam.dn42 unavailable'
  throw new ScamError(message, status, definitive, error)
}

export interface ScamClientOptions {
  baseUrl: string
  timeoutMs?: number
}

export class ScamClient implements ScamPort {
  private readonly client: typeof ofetch
  private readonly baseUrl: string

  constructor(options: ScamClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    const opts: FetchOptions = {
      timeout: options.timeoutMs ?? 5000,
      retry: 0, // funds writes must never be retried at HTTP layer
      headers: { accept: 'application/json' },
    }
    this.client = ofetch.create(opts)
  }

  private auth(token: string) {
    return { Authorization: `Bearer ${token}` }
  }

  async listAccounts(token: string): Promise<{ accounts: ScamAccountInfo[]; username: string | null; userId: number | null }> {
    try {
      const raw = await this.client<unknown>(`${this.baseUrl}/api/accounts`, {
        headers: this.auth(token),
      })
      const list = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as { accounts?: unknown }).accounts)
          ? ((raw as { accounts: unknown[] }).accounts)
          : []
      const accounts = (list as RawAccount[]).map(parseAccount).filter((a): a is ScamAccountInfo => !!a)
      const user = (raw as { user?: { id?: unknown; username?: unknown } }).user
      return {
        accounts,
        username: asString(user?.username),
        userId: user?.id === undefined ? null : Number(user.id),
      }
    } catch (error) {
      transportError(error)
    }
  }

  async getAccount(token: string, accountId: number): Promise<ScamAccountInfo> {
    try {
      const raw = await this.client<unknown>(`${this.baseUrl}/api/accounts/${accountId}`, {
        headers: this.auth(token),
      })
      const account = parseAccount((raw as { account?: RawAccount }).account ?? (raw as RawAccount))
      if (!account) throw new AppError('SCAM_REJECTED', { message: 'invalid scam account response' })
      return account
    } catch (error) {
      if (error instanceof AppError) throw error
      transportError(error)
    }
  }

  async transfer(
    token: string,
    input: { fromAccountId: number; toIban: string; amount: string; description: string; idempotencyKey: string },
  ): Promise<ScamTransferResult> {
    try {
      const raw = await this.client<unknown>(`${this.baseUrl}/api/transfer`, {
        method: 'POST',
        headers: { ...this.auth(token), 'Idempotency-Key': input.idempotencyKey },
        body: {
          from_account_id: input.fromAccountId,
          to_account_number: input.toIban,
          amount: input.amount,
          description: input.description,
        },
      })
      const id = (raw as { transaction_id?: unknown; id?: unknown }).transaction_id ??
        (raw as { id?: unknown }).id
      return { transactionId: id === undefined || id === null ? null : Number(id), raw }
    } catch (error) {
      transportError(error, true)
    }
  }

  async listTransactions(
    token: string,
    input: { accountId: number; limit: number; minId?: number | null },
  ): Promise<{ transactions: ScamTransactionInfo[]; username: string | null }> {
    try {
      const url = new URL(`${this.baseUrl}/api/transactions`)
      url.searchParams.set('account_id', String(input.accountId))
      url.searchParams.set('limit', String(input.limit))
      if (input.minId) url.searchParams.set('min_id', String(input.minId))
      const raw = await this.client<unknown>(url.toString(), { headers: this.auth(token) })
      const list = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as { transactions?: unknown }).transactions)
          ? ((raw as { transactions: unknown[] }).transactions)
          : []
      const transactions = (list as RawTransaction[])
        .map(parseTransaction)
        .filter((t): t is ScamTransactionInfo => !!t)
        .sort((a, b) => a.id - b.id)
      return { transactions, username: null }
    } catch (error) {
      transportError(error)
    }
  }
}
