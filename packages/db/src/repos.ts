import { systemClock, type Clock } from '@fx42/shared'
import { withTransaction, type Fx42Db } from './database'
import { UserRepos } from './repos/users'
import { WalletRepos } from './repos/wallet'
import { CredentialRepos } from './repos/credentials'
import { FundingRepos } from './repos/funding'
import { TradingRepos } from './repos/trading'
import { JobRepos } from './repos/jobs'
import { RuntimeRepos } from './repos/runtime'
import { MarketRepos } from './repos/market'

/**
 * Repository facade composed from independent aggregates. Each aggregate only
 * exposes the methods for its own concern; application code must reach them
 * through the corresponding field instead of relying on one god interface.
 */
export class DbRepos {
  readonly users: UserRepos
  readonly wallets: WalletRepos
  readonly credentials: CredentialRepos
  readonly funding: FundingRepos
  readonly trading: TradingRepos
  readonly jobs: JobRepos
  readonly runtime: RuntimeRepos
  readonly market: MarketRepos

  constructor(
    readonly db: Fx42Db,
    readonly clock: Clock = systemClock,
  ) {
    this.users = new UserRepos(db, clock)
    this.wallets = new WalletRepos(db, clock)
    this.credentials = new CredentialRepos(db, clock)
    this.funding = new FundingRepos(db, clock)
    this.trading = new TradingRepos(db, clock)
    this.jobs = new JobRepos(db, clock)
    this.runtime = new RuntimeRepos(db, clock)
    this.market = new MarketRepos(db, clock)
  }

  transaction<T>(fn: () => T): T {
    return withTransaction(this.db, fn)
  }
}

export * from './repos/index'
