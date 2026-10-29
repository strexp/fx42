import type { Clock } from '@fx42/shared'
import type { Fx42Db, SqliteDatabase } from '../database'

export class RepoBase {
  constructor(
    readonly db: Fx42Db,
    readonly clock: Clock,
  ) {}

  protected get sql(): SqliteDatabase {
    return this.db.raw
  }

  now(): number {
    return this.clock.now()
  }
}
