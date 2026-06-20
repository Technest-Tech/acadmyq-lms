import { hmacSha256Hex } from '../util/crypto.js'
import { pool } from '../db/pool.js'
import type { Logger } from '../logger.js'

export interface WebhookEvent {
  event: string
  sessionId: string
  academyId: string
  data: Record<string, unknown>
}

/**
 * Delivers signed webhooks to Laravel (gateway → app). Every payload is HMAC-signed; a delivery that
 * fails is persisted to wa_webhook_outbox and retried by `flushOutbox` on an interval, so a Laravel
 * outage never loses a `connected`/`logged_out`/`qr` transition across a gateway restart.
 */
export class WebhookClient {
  constructor(
    private readonly url: string | undefined,
    private readonly secret: string,
    private readonly logger: Logger,
  ) {}

  async send(evt: WebhookEvent): Promise<void> {
    if (!this.url) {
      this.logger.warn({ event: evt.event }, 'no LARAVEL_WEBHOOK_URL configured; webhook dropped')
      return
    }
    const ok = await this.deliver(evt)
    if (!ok) await this.persistToOutbox(evt)
  }

  private async deliver(evt: WebhookEvent): Promise<boolean> {
    if (!this.url) return false
    const payload = JSON.stringify({
      event: evt.event,
      sessionId: evt.sessionId,
      academyId: evt.academyId,
      timestamp: Math.floor(Date.now() / 1000),
      data: evt.data,
    })
    const signature = hmacSha256Hex(this.secret, payload)
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-wa-signature': `sha256=${signature}` },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        this.logger.warn({ event: evt.event, status: res.status }, 'webhook non-2xx')
        return false
      }
      return true
    } catch (e) {
      this.logger.warn(
        { event: evt.event, err: e instanceof Error ? e.message : String(e) },
        'webhook delivery error',
      )
      return false
    }
  }

  private async persistToOutbox(evt: WebhookEvent): Promise<void> {
    try {
      await pool.query(
        `insert into wa_webhook_outbox (session_id, event, payload, next_attempt_at)
         values ($1, $2, $3, now() + interval '30 seconds')`,
        [evt.sessionId, evt.event, JSON.stringify({ academyId: evt.academyId, data: evt.data })],
      )
    } catch (e) {
      this.logger.error(
        { err: e instanceof Error ? e.message : String(e) },
        'failed to persist webhook to outbox',
      )
    }
  }

  /** Retry pending outbox rows whose backoff has elapsed. Called on an interval from server.ts. */
  async flushOutbox(limit = 50): Promise<void> {
    if (!this.url) return
    let rows: Array<{ id: string; session_id: string; event: string; payload: { academyId: string; data: Record<string, unknown> }; attempts: number }>
    try {
      const res = await pool.query(
        `select id, session_id, event, payload, attempts from wa_webhook_outbox
          where delivered_at is null and next_attempt_at <= now()
          order by next_attempt_at asc limit $1`,
        [limit],
      )
      rows = res.rows
    } catch (e) {
      this.logger.error({ err: e instanceof Error ? e.message : String(e) }, 'outbox query failed')
      return
    }
    for (const row of rows) {
      const ok = await this.deliver({
        event: row.event,
        sessionId: row.session_id,
        academyId: row.payload.academyId,
        data: row.payload.data,
      })
      if (ok) {
        await pool.query('update wa_webhook_outbox set delivered_at = now() where id = $1', [row.id])
      } else {
        const attempts = row.attempts + 1
        const backoffSec = Math.min(3600, 30 * 2 ** attempts)
        await pool.query(
          `update wa_webhook_outbox
              set attempts = $2, next_attempt_at = now() + ($3 || ' seconds')::interval
            where id = $1`,
          [row.id, attempts, String(backoffSec)],
        )
      }
    }
  }
}
