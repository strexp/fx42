import { readFileSync, writeFileSync } from 'node:fs'

const sql = readFileSync(new URL('../packages/db/src/schema.sql', import.meta.url), 'utf8')
const escaped = sql.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
const output = `// Generated from schema.sql. Run \`pnpm db:schema\` after editing the SQL file.\nexport const SCHEMA_SQL = String.raw\`${escaped}\`\n`
writeFileSync(new URL('../packages/db/src/schema.generated.ts', import.meta.url), output)
console.log(`generated schema.generated.ts (${sql.length} bytes)`)
