import { newId } from '@fx42/shared'
import { mapCredential, mapScamAccount } from '../database'

import type { CredentialRow, ScamAccountRow } from '../types'

import { RepoBase } from './base'
import type { ScamAccountInput } from './users'

export class CredentialRepos extends RepoBase {
  findLiveCredential(userId: string): CredentialRow | null {
    const row = this.sql
      .prepare(
        `SELECT * FROM scam_credentials WHERE user_id = ? AND status IN ('active','invalid','unverified')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(userId)
    return row ? mapCredential(row as Record<string, unknown>) : null
  }

  findCredentialById(id: string): CredentialRow | null {
    const row = this.sql.prepare('SELECT * FROM scam_credentials WHERE id = ?').get(id)
    return row ? mapCredential(row as Record<string, unknown>) : null
  }

  findActiveCredential(userId: string): CredentialRow | null {
    const row = this.sql
      .prepare(
        "SELECT * FROM scam_credentials WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
      )
      .get(userId)
    return row ? mapCredential(row as Record<string, unknown>) : null
  }

  createCredential(input: {
    userId: string
    tokenCipher: string
    tokenHint: string
    scamUserId: number | null
    scamUsername: string | null
    status: 'active' | 'unverified'
    now: number
  }): CredentialRow {
    const id = newId()
    this.sql
      .prepare(
        `INSERT INTO scam_credentials
          (id, user_id, token_cipher, key_version, token_hint, scam_user_id, scam_username, status,
           verified_at, last_used_at, revoked_at, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        id,
        input.userId,
        input.tokenCipher,
        input.tokenHint,
        input.scamUserId === null ? null : BigInt(input.scamUserId),
        input.scamUsername,
        input.status,
        input.status === 'active' ? BigInt(input.now) : null,
        BigInt(input.now),
        BigInt(input.now),
      )
    return this.findCredentialById(id)!
  }

  updateCredential(
    id: string,
    input: {
      tokenCipher: string
      tokenHint: string
      scamUserId: number | null
      scamUsername: string | null
      status: 'active' | 'unverified'
      now: number
    },
  ): void {
    this.sql
      .prepare(
        `UPDATE scam_credentials SET token_cipher = ?, token_hint = ?, scam_user_id = ?, scam_username = ?,
           status = ?, verified_at = ?, last_used_at = ?, revoked_at = NULL WHERE id = ?`,
      )
      .run(
        input.tokenCipher,
        input.tokenHint,
        input.scamUserId === null ? null : BigInt(input.scamUserId),
        input.scamUsername,
        input.status,
        input.status === 'active' ? BigInt(input.now) : null,
        BigInt(input.now),
        id,
      )
  }

  setCredentialStatus(id: string, status: CredentialRow['status'], now: number): void {
    this.sql
      .prepare(
        "UPDATE scam_credentials SET status = ?, revoked_at = CASE WHEN ? = 'revoked' THEN ? ELSE revoked_at END WHERE id = ?",
      )
      .run(status, status, BigInt(now), id)
  }

  listScamAccounts(credentialId: string): ScamAccountRow[] {
    return (
      this.sql
        .prepare(
          'SELECT * FROM scam_accounts WHERE credential_id = ? ORDER BY is_primary DESC, synced_at',
        )
        .all(credentialId) as Record<string, unknown>[]
    ).map(mapScamAccount)
  }

  findScamAccount(id: string): ScamAccountRow | null {
    const row = this.sql.prepare('SELECT * FROM scam_accounts WHERE id = ?').get(id)
    return row ? mapScamAccount(row as Record<string, unknown>) : null
  }

  findPrimaryScamAccount(credentialId: string): ScamAccountRow | null {
    const row = this.sql
      .prepare(
        'SELECT * FROM scam_accounts WHERE credential_id = ? ORDER BY is_primary DESC, synced_at LIMIT 1',
      )
      .get(credentialId)
    return row ? mapScamAccount(row as Record<string, unknown>) : null
  }

  findScamAccountByIban(iban: string): ScamAccountRow | null {
    const row = this.sql
      .prepare('SELECT * FROM scam_accounts WHERE iban = ? ORDER BY synced_at DESC LIMIT 1')
      .get(iban)
    return row ? mapScamAccount(row as Record<string, unknown>) : null
  }

  replaceScamAccounts(
    credentialId: string,
    accounts: ScamAccountInput[],
    primaryScamAccountId: number | null,
    now: number,
  ): void {
    const existing = this.listScamAccounts(credentialId)
    const keep = new Set(accounts.map((a) => a.scamAccountId))
    for (const old of existing) {
      if (!keep.has(old.scamAccountId)) {
        this.sql.prepare('DELETE FROM scam_accounts WHERE id = ?').run(old.id)
      }
    }
    const chosen = primaryScamAccountId ?? accounts[0]?.scamAccountId ?? null
    this.sql
      .prepare('UPDATE scam_accounts SET is_primary = 0 WHERE credential_id = ?')
      .run(credentialId)
    for (const account of accounts) {
      const current = existing.find((a) => a.scamAccountId === account.scamAccountId)
      if (current) {
        this.sql
          .prepare(
            `UPDATE scam_accounts SET iban = ?, account_name = ?, balance_snapshot_micros = ?,
               is_primary = ?, synced_at = ? WHERE id = ?`,
          )
          .run(
            account.iban,
            account.accountName,
            account.balanceMicros,
            account.scamAccountId === chosen ? 1 : 0,
            BigInt(now),
            current.id,
          )
      } else {
        this.sql
          .prepare(
            `INSERT INTO scam_accounts
              (id, credential_id, scam_account_id, iban, account_name, balance_snapshot_micros, is_primary, synced_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            newId(),
            credentialId,
            BigInt(account.scamAccountId),
            account.iban,
            account.accountName,
            account.balanceMicros,
            account.scamAccountId === chosen ? 1 : 0,
            BigInt(now),
          )
      }
    }
  }

  setPrimaryScamAccount(userId: string, accountId: string): boolean {
    const row = this.sql
      .prepare(
        `SELECT sa.id, sa.credential_id FROM scam_accounts sa
         JOIN scam_credentials sc ON sa.credential_id = sc.id
         WHERE sa.id = ? AND sc.user_id = ? AND sc.status = 'active'`,
      )
      .get(accountId, userId) as { id: string; credential_id: string } | undefined
    if (!row) return false
    this.sql
      .prepare('UPDATE scam_accounts SET is_primary = 0 WHERE credential_id = ?')
      .run(row.credential_id)
    this.sql.prepare('UPDATE scam_accounts SET is_primary = 1 WHERE id = ?').run(row.id)
    return true
  }
}
