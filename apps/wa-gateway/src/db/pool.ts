import pg from 'pg'
import { loadConfig } from '../config.js'

const config = loadConfig()

/** Shared connection pool to the gateway's local Postgres. */
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

// An idle client that dies (Postgres restart, network blip) emits 'error' on the pool; with no
// listener Node treats it as an uncaught exception and the whole gateway — every academy's socket —
// goes down with it. The pool replaces the client by itself; this only needs to be heard.
pool.on('error', (e) => {
  // eslint-disable-next-line no-console
  console.error('[wa-gateway] idle postgres client error:', e.message)
})
