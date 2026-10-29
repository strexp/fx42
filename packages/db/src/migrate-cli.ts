import { loadEnv } from '@fx42/config'
import { migrate, openDatabase } from './database'

const env = loadEnv(process.env)
const db = openDatabase(env.DATABASE_PATH)
migrate(db)
console.log(`migrated ${db.path}`)
db.close()
