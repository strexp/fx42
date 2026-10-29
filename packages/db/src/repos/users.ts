import { newId } from '@fx42/shared'
import { mapAccount, mapIdentity, mapUser, n } from '../database'

import type { AccountRow, IdentityRow, UserRow } from '../types'

import { RepoBase } from './base'

export interface CreateUserInput {
  activeMnt: string | null
  displayName: string | null
  email: string | null
  locale: 'zh-CN' | 'en'
  now: number
}

export interface CreateIdentityInput {
  userId: string
  providerId: string
  providerKind: 'dn42' | 'generic'
  subject: string
  activeMnt: string | null
  email: string | null
  now: number
}

export interface ScamAccountInput {
  scamAccountId: number
  iban: string
  accountName: string | null
  balanceMicros: bigint | null
}

export class UserRepos extends RepoBase {
  findUserById(id: string): UserRow | null {
    const row = this.sql.prepare('SELECT * FROM users WHERE id = ?').get(id)
    return row ? mapUser(row as Record<string, unknown>) : null
  }

  findUserByMnt(mnt: string): UserRow | null {
    const row = this.sql.prepare('SELECT * FROM users WHERE active_mnt = ?').get(mnt)
    return row ? mapUser(row as Record<string, unknown>) : null
  }

  createUser(input: CreateUserInput): UserRow {
    const id = newId()
    this.sql
      .prepare(
        `INSERT INTO users (id, active_mnt, display_name, email, locale, status,
           session_version, default_mode, onboarding_completed_at, last_login_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', 1, 'virtual', NULL, ?, ?)`,
      )
      .run(
        id,
        input.activeMnt,
        input.displayName,
        input.email,
        input.locale,
        BigInt(input.now),
        BigInt(input.now),
      )
    return this.findUserById(id)!
  }

  updateUserLogin(
    id: string,
    input: { displayName: string | null; email: string | null; now: number },
  ): void {
    this.sql
      .prepare(
        `UPDATE users SET last_login_at = ?,
           display_name = COALESCE(display_name, ?), email = COALESCE(?, email) WHERE id = ?`,
      )
      .run(BigInt(input.now), input.displayName, input.email, id)
  }

  updateUserProfile(
    id: string,
    input: { displayName?: string; locale?: 'zh-CN' | 'en'; defaultMode?: 'real' | 'virtual' },
  ): UserRow {
    const sets: string[] = []
    const params: unknown[] = []
    if (input.displayName !== undefined) {
      sets.push('display_name = ?')
      params.push(input.displayName)
    }
    if (input.locale !== undefined) {
      sets.push('locale = ?')
      params.push(input.locale)
    }
    if (input.defaultMode !== undefined) {
      sets.push('default_mode = ?')
      params.push(input.defaultMode)
    }
    if (sets.length > 0) {
      params.push(id)
      this.sql.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    }
    return this.findUserById(id)!
  }

  completeOnboarding(id: string, defaultMode: 'real' | 'virtual', now: number): void {
    this.sql
      .prepare('UPDATE users SET onboarding_completed_at = ?, default_mode = ? WHERE id = ?')
      .run(BigInt(now), defaultMode, id)
  }

  incrementSessionVersion(id: string): number {
    this.sql.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run(id)
    return this.findUserById(id)?.sessionVersion ?? 1
  }

  updateUserStatus(id: string, status: UserRow['status']): void {
    this.sql.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id)
  }

  listIdentitiesByUser(userId: string): IdentityRow[] {
    return (
      this.sql
        .prepare('SELECT * FROM user_identities WHERE user_id = ? ORDER BY created_at')
        .all(userId) as Record<string, unknown>[]
    ).map(mapIdentity)
  }

  findIdentity(providerId: string, subject: string): IdentityRow | null {
    const row = this.sql
      .prepare('SELECT * FROM user_identities WHERE provider_id = ? AND subject = ?')
      .get(providerId, subject)
    return row ? mapIdentity(row as Record<string, unknown>) : null
  }

  findIdentityById(id: string): IdentityRow | null {
    const row = this.sql.prepare('SELECT * FROM user_identities WHERE id = ?').get(id)
    return row ? mapIdentity(row as Record<string, unknown>) : null
  }

  createIdentity(input: CreateIdentityInput): IdentityRow {
    const id = newId()
    this.sql
      .prepare(
        `INSERT INTO user_identities
          (id, user_id, provider_id, provider_kind, subject, active_mnt, email, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.providerId,
        input.providerKind,
        input.subject,
        input.activeMnt,
        input.email,
        BigInt(input.now),
        BigInt(input.now),
      )
    return this.findIdentityById(id)!
  }

  touchIdentity(id: string, activeMnt: string | null, now: number): void {
    this.sql
      .prepare('UPDATE user_identities SET last_login_at = ?, active_mnt = ? WHERE id = ?')
      .run(BigInt(now), activeMnt, id)
  }

  findAccountsByUser(userId: string): AccountRow[] {
    return (
      this.sql
        .prepare('SELECT * FROM trading_accounts WHERE user_id = ? ORDER BY mode')
        .all(userId) as Record<string, unknown>[]
    ).map(mapAccount)
  }

  findAccountByUserMode(userId: string, mode: 'real' | 'virtual'): AccountRow | null {
    const row = this.sql
      .prepare('SELECT * FROM trading_accounts WHERE user_id = ? AND mode = ?')
      .get(userId, mode)
    return row ? mapAccount(row as Record<string, unknown>) : null
  }

  findAccountById(id: string): AccountRow | null {
    const row = this.sql.prepare('SELECT * FROM trading_accounts WHERE id = ?').get(id)
    return row ? mapAccount(row as Record<string, unknown>) : null
  }

  createAccount(userId: string, mode: 'real' | 'virtual', now: number): AccountRow {
    const id = newId()
    this.sql
      .prepare(
        `INSERT INTO trading_accounts (id, user_id, mode, currency, status, created_at)
         VALUES (?, ?, ?, ?, 'active', ?)`,
      )
      .run(id, userId, mode, mode === 'real' ? 'FTK' : 'VFTK', BigInt(now))
    const account = this.findAccountById(id)!
    this.sql
      .prepare(
        `INSERT INTO wallets (id, account_id, mode, kind, balance_micros, allow_negative, updated_at)
         VALUES (?, ?, ?, 'user', 0, 0, ?)`,
      )
      .run(newId(), id, mode, BigInt(now))
    return account
  }

  findTerms(userId: string): { mode: string; acceptedAt: number } | null {
    const row = this.sql
      .prepare('SELECT mode, accepted_at FROM terms_acceptances WHERE user_id = ?')
      .get(userId) as { mode: string; accepted_at: bigint } | undefined
    return row ? { mode: row.mode, acceptedAt: n(row.accepted_at) } : null
  }

  createTerms(
    userId: string,
    mode: string,
    ip: string | null,
    userAgent: string | null,
    now: number,
  ): void {
    this.sql
      .prepare(
        `INSERT OR IGNORE INTO terms_acceptances (id, user_id, mode, ip, user_agent, accepted_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(newId(), userId, mode, ip, userAgent, BigInt(now))
  }
}
