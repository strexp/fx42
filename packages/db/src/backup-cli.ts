import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadEnv } from '@fx42/config'
import { openDatabase } from './database'

const env = loadEnv(process.env)
const target =
  process.argv[2] ??
  resolve(
    process.cwd(),
    'data/backups',
    `pre-migrate-${new Date().toISOString().replace(/[:.]/g, '-')}.db`,
  )
mkdirSync(dirname(target), { recursive: true })
const db = openDatabase(env.DATABASE_PATH)
db.raw.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
console.log(`backup written to ${target}`)
db.close()
