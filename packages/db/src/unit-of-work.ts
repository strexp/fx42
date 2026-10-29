import { AppError, type Clock, systemClock } from '@fx42/shared'
import type { Fx42Db } from './database'
import { withTransaction } from './database'
import { DbRepos } from './repos'

export class SqliteUnitOfWork {
  private inTransaction = false
  readonly repos: DbRepos

  constructor(
    readonly db: Fx42Db,
    clock: Clock = systemClock,
  ) {
    this.repos = new DbRepos(db, clock)
  }

  run<T>(fn: (repos: DbRepos) => T): T {
    if (this.inTransaction) {
      throw new AppError('INTERNAL', { message: 'nested UnitOfWork transactions are not allowed' })
    }
    this.inTransaction = true
    try {
      return withTransaction(this.db, () => fn(this.repos))
    } finally {
      this.inTransaction = false
    }
  }
}

export function createRepos(db: Fx42Db, clock: Clock = systemClock): DbRepos {
  return new DbRepos(db, clock)
}
