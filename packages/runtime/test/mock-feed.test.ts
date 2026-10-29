import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '@fx42/config'
import { DbRepos, migrate, openDatabase, type Fx42Db } from '@fx42/db'
import { systemClock } from '@fx42/shared'
import { MockFeed } from '../src/mock-feed'
import { PriceStore } from '../src/price-store'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('mock candle feed', () => {
  it('seeds every supported interval and anchors the newest close to the live price', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fx42-feed-'))
    dirs.push(dir)
    const db: Fx42Db = openDatabase(join(dir, 'test.db'))
    migrate(db)
    const repos = new DbRepos(db, systemClock)
    const loaded = loadConfig({
      filePath: 'config/fx42.mock.yaml',
      env: { NODE_ENV: 'test' },
      checkSecrets: false,
    })
    const store = new PriceStore()
    const feed = new MockFeed(loaded.config, store, repos)
    feed.start()
    feed.stop()
    const price = store.get('EURUSD')
    expect(price).not.toBeNull()
    for (const interval of ['1m', '5m', '15m', '30m', '1h', '4h', '1d']) {
      const bars = repos.market.listCandles('EURUSD', interval, 300)
      expect(bars.length, interval).toBe(300)
      expect(bars[bars.length - 1]!.close, interval).toBe(price!.mid)
      expect(bars[bars.length - 1]!.isOpen, interval).toBe(true)
    }
    db.close()
  })
})
