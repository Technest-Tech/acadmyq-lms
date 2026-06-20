import type { Pool } from 'pg'
import type { SendPacingConfig } from './queue/send-queue.js'
import type { Logger } from './logger.js'

/**
 * Live, admin-editable send-pacing settings (the anti-ban knobs), persisted as a singleton row in
 * wa_settings and cached in memory. The SendQueue reads `get()` on every send, so a change via the
 * admin panel takes effect immediately for all sessions — no restart, no redeploy.
 */
export class SettingsStore {
  private cache: SendPacingConfig

  constructor(
    private readonly pool: Pool,
    private readonly defaults: SendPacingConfig,
    private readonly logger: Logger,
  ) {
    this.cache = { ...defaults }
  }

  /** Seed the row from env defaults on first run, then load the persisted values into the cache. */
  async init(): Promise<void> {
    const d = this.defaults
    await this.pool.query(
      `insert into wa_settings
         (id, send_min_interval_ms, send_max_interval_ms, send_daily_cap,
          warmup_days, warmup_daily_cap, warmup_min_interval_ms, warmup_max_interval_ms)
       values (1, $1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do nothing`,
      [d.minIntervalMs, d.maxIntervalMs, d.dailyCap, d.warmupDays, d.warmupDailyCap, d.warmupMinIntervalMs, d.warmupMaxIntervalMs],
    )
    await this.reload()
  }

  get(): SendPacingConfig {
    return this.cache
  }

  async update(patch: Partial<SendPacingConfig>): Promise<SendPacingConfig> {
    const next: SendPacingConfig = { ...this.cache, ...patch }
    await this.pool.query(
      `update wa_settings set
         send_min_interval_ms = $1, send_max_interval_ms = $2, send_daily_cap = $3,
         warmup_days = $4, warmup_daily_cap = $5, warmup_min_interval_ms = $6, warmup_max_interval_ms = $7,
         updated_at = now()
       where id = 1`,
      [next.minIntervalMs, next.maxIntervalMs, next.dailyCap, next.warmupDays, next.warmupDailyCap, next.warmupMinIntervalMs, next.warmupMaxIntervalMs],
    )
    this.cache = next
    this.logger.info({ settings: next }, 'send pacing settings updated')
    return next
  }

  private async reload(): Promise<void> {
    const res = await this.pool.query('select * from wa_settings where id = 1')
    const row = res.rows[0]
    if (!row) return
    this.cache = {
      minIntervalMs: row.send_min_interval_ms,
      maxIntervalMs: row.send_max_interval_ms,
      dailyCap: row.send_daily_cap,
      warmupDays: row.warmup_days,
      warmupDailyCap: row.warmup_daily_cap,
      warmupMinIntervalMs: row.warmup_min_interval_ms,
      warmupMaxIntervalMs: row.warmup_max_interval_ms,
    }
  }
}
