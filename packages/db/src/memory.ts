import { systemClock, type Clock } from '@fx42/shared'
import { openDatabase, migrate, type Fx42Db } from './database'
import { DbRepos } from './repos'
import { SqliteUnitOfWork } from './unit-of-work'

export function createMemoryDb(): Fx42Db {
  const db = openDatabase(':memory:')
  migrate(db)
  return db
}

export function createMemoryRepos(clock: Clock = systemClock): {
  db: Fx42Db
  repos: DbRepos
  uow: SqliteUnitOfWork
} {
  const db = createMemoryDb()
  return {
    db,
    repos: new DbRepos(db, clock),
    uow: new SqliteUnitOfWork(db, clock),
  }
}
