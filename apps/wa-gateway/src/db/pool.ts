import pg from 'pg'
import { loadConfig } from '../config.js'

const config = loadConfig()

/** Shared connection pool to the gateway's local Postgres. */
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})
