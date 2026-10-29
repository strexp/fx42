import { createHash } from 'node:crypto'
import { toMicros } from '@fx42/shared'
import type { Fx42Db } from './database'
import { SqliteUnitOfWork } from './unit-of-work'

/**
 * Seed two demo accounts for mock mode:
 *  - Alice (dn42, active_mnt = ALICE-MNT)
 *  - Bob (generic OIDC, no mnt)
 * Both receive real + virtual accounts and a small virtual balance.
 */
export function seedDemoUsers(db: Fx42Db, now: number): void {
  const uow = new SqliteUnitOfWork(db, { now: () => now })
  uow.run((repos) => {
    const aliceMnt = 'ALICE-MNT'
    let alice = repos.users.findUserByMnt(aliceMnt)
    if (!alice) {
      alice = repos.users.createUser({
        activeMnt: aliceMnt,
        displayName: 'Alice',
        email: 'alice@example.dn42',
        locale: 'en',
        now,
      })
      repos.users.createIdentity({
        userId: alice.id,
        providerId: 'mock-dn42',
        providerKind: 'dn42',
        subject: createHash('sha256').update(`mock-dn42/${aliceMnt}`).digest('hex'),
        activeMnt: aliceMnt,
        email: 'alice@example.dn42',
        now,
      })
    }

    const bobIdentity = repos.users.findIdentity('mock-generic', 'mock-subject-bob')
    let bob = bobIdentity ? repos.users.findUserById(bobIdentity.userId) : null
    if (!bob) {
      bob = repos.users.createUser({
        activeMnt: null,
        displayName: 'Bob',
        email: 'bob@example.net',
        locale: 'en',
        now,
      })
      repos.users.createIdentity({
        userId: bob.id,
        providerId: 'mock-generic',
        providerKind: 'generic',
        subject: 'mock-subject-bob',
        activeMnt: null,
        email: 'bob@example.net',
        now,
      })
    }

    for (const user of [alice!, bob!]) {
      repos.users.createTerms(user.id, 'virtual', '127.0.0.1', 'seed', now)
      for (const mode of ['real', 'virtual'] as const) {
        let account = repos.users.findAccountByUserMode(user.id, mode)
        if (!account) account = repos.users.createAccount(user.id, mode, now)
        if (mode === 'virtual') {
          const wallet = repos.wallets.findUserWallet(account.id)
          if (wallet && wallet.balanceMicros === 0n) {
            const amount = toMicros('1000000')
            repos.wallets.postLedger({
              mode: 'virtual',
              type: 'adjustment',
              refType: 'seed',
              refId: user.id,
              memo: 'demo virtual balance',
              entries: [
                { walletId: wallet.id, amountMicros: amount },
                { walletId: `sys:virtual:external_reserve`, amountMicros: -amount },
              ],
              now,
            })
          }
        }
      }
      repos.users.completeOnboarding(user.id, 'virtual', now)
    }
  })
}
