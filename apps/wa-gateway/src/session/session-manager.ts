import type { Pool } from 'pg'
import { ManagedSession } from './managed-session.js'
import type { SettingsStore } from '../settings.js'
import type { WebhookClient } from '../webhook/webhook-client.js'
import { sha256Hex, randomToken } from '../util/crypto.js'
import type { AppConfig } from '../config.js'
import type { Logger } from '../logger.js'

/**
 * In-memory registry of all live sessions, plus the lifecycle operations the routes call. On boot it
 * rehydrates every non-logged-out session from Postgres and reconnects (staggered). A periodic
 * watchdog forces reconnects on stale/half-open sockets.
 */
export class SessionManager {
  private readonly byId = new Map<string, ManagedSession>()
  private readonly byTokenHash = new Map<string, ManagedSession>()
  private watchdog: NodeJS.Timeout | null = null

  constructor(
    private readonly pool: Pool,
    private readonly config: AppConfig,
    private readonly settings: SettingsStore,
    private readonly webhook: WebhookClient,
    private readonly logger: Logger,
  ) {}

  /** Rehydrate non-logged-out sessions and reconnect each (staggered so N sockets don't dial at once). */
  async bootstrap(): Promise<void> {
    const res = await this.pool.query(
      `select session_id, academy_id, token_hash, extract(epoch from created_at) * 1000 as created_ms
         from wa_sessions where state <> 'logged_out'`,
    )
    this.logger.info({ count: res.rows.length }, 'rehydrating sessions')
    let i = 0
    for (const row of res.rows) {
      const session = this.instantiate(row.session_id, row.academy_id, row.token_hash, Number(row.created_ms))
      const delay = 200 + i * 400 + Math.random() * 200
      setTimeout(() => void session.start(), delay)
      i += 1
    }
    this.startWatchdog()
  }

  /** Create a brand-new session for an academy; returns the one-time plaintext token. */
  async create(academyId: string): Promise<{ sessionId: string; token: string }> {
    // Enforce a single active session per academy — drop any prior one first.
    for (const s of this.all()) {
      if (s.academyId === academyId) {
        await this.remove(s.sessionId).catch((e: unknown) =>
          this.logger.warn({ sessionId: s.sessionId, err: String(e) }, 'failed to drop prior session'),
        )
      }
    }

    const token = randomToken(32)
    const tokenHash = sha256Hex(token)
    const res = await this.pool.query(
      `insert into wa_sessions (academy_id, token_hash, state) values ($1, $2, 'qr')
       returning session_id, extract(epoch from created_at) * 1000 as created_ms`,
      [academyId, tokenHash],
    )
    const sessionId = res.rows[0].session_id as string
    const createdMs = Number(res.rows[0].created_ms)
    const session = this.instantiate(sessionId, academyId, tokenHash, createdMs)
    await session.start()
    return { sessionId, token }
  }

  getById(id: string): ManagedSession | undefined {
    return this.byId.get(id)
  }

  getByToken(token: string): ManagedSession | undefined {
    return this.byTokenHash.get(sha256Hex(token))
  }

  all(): ManagedSession[] {
    return [...this.byId.values()]
  }

  /** Logout + delete a session entirely (DELETE /sessions/:id). */
  async remove(id: string): Promise<void> {
    const s = this.byId.get(id)
    if (!s) return
    await s.logout()
    this.byId.delete(id)
    this.byTokenHash.delete(s.tokenHash)
    await this.pool.query('delete from wa_sessions where session_id = $1', [id])
  }

  stats(): Record<string, number> {
    const all = this.all()
    const by = (st: string): number => all.filter((s) => s.state === st).length
    return {
      total: all.length,
      connected: by('connected'),
      connecting: by('connecting'),
      qr: by('qr'),
      disconnected: by('disconnected'),
      logged_out: by('logged_out'),
    }
  }

  /** Graceful shutdown: stop all sockets WITHOUT logging out (creds survive for next boot). */
  shutdown(): void {
    if (this.watchdog) {
      clearInterval(this.watchdog)
      this.watchdog = null
    }
    for (const s of this.byId.values()) s.stop()
  }

  private instantiate(sessionId: string, academyId: string, tokenHash: string, createdAt: number): ManagedSession {
    const session = new ManagedSession(
      { sessionId, academyId, tokenHash, createdAt },
      this.pool,
      this.config,
      this.settings,
      this.webhook,
      this.logger.child({ sessionId, academyId }),
    )
    this.byId.set(sessionId, session)
    this.byTokenHash.set(tokenHash, session)
    return session
  }

  private startWatchdog(): void {
    if (this.watchdog) return
    this.watchdog = setInterval(() => {
      for (const s of this.byId.values()) s.checkHealth(this.config.WATCHDOG_STALE_MS)
    }, this.config.WATCHDOG_INTERVAL_MS)
    this.watchdog.unref?.()
  }
}
