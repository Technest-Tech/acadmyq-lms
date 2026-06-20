import { pool } from './db/pool.js'
import { SCHEMA_SQL } from './db/schema.js'

/** Apply the idempotent schema. Safe to run on every deploy. */
async function main(): Promise<void> {
  await pool.query(SCHEMA_SQL)
  // eslint-disable-next-line no-console
  console.log('[wa-gateway] migrations applied')
  await pool.end()
}

main().catch((e: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[wa-gateway] migration failed:', e)
  process.exit(1)
})
