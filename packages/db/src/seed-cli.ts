import { loadEnv } from '@fx42/config'
import { migrate, openDatabase } from './database'
import { seedDemoUsers } from './seed'

const env = loadEnv(process.env)
const db = openDatabase(env.DATABASE_PATH)
migrate(db)
seedDemoUsers(db, Date.now())
console.log(`seeded ${db.path}`)
db.close()
