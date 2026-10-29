import { loadEnv } from '@fx42/config'
import { openDatabase, quickCheck } from './database'
import { createRepos } from './unit-of-work'
import { reconcile } from './reconcile'

const env = loadEnv(process.env)
const db = openDatabase(env.DATABASE_PATH)
const healthy = quickCheck(db)
console.log(`quick_check: ${healthy ? 'ok' : 'FAILED'}`)
const migrated = db.raw
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ledger_entries'")
  .get()
if (!migrated) {
  console.error(`database is not migrated: ${db.path}`)
  db.close()
  process.exit(1)
}
const report = reconcile(createRepos(db))
for (const check of report.checks) {
  console.log(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}`, check.details ?? '')
}
db.close()
if (!healthy || !report.ok) process.exit(1)
