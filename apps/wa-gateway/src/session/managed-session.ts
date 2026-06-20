import type { Pool } from 'pg'
import { proto, type BaileysEventMap, type WASocket } from 'baileys'
import { usePostgresAuthState, clearAuthState } from '../auth-store/postgres-auth-state.js'
import { createSocket } from './socket-factory.js'
import { decideReconnect, backoffDelay } from './reconnect.js'
import { SendQueue } from '../queue/send-queue.js'
import type { SettingsStore } from '../settings.js'
import type { WebhookClient } from '../webhook/webhook-client.js'
import { qrToDataUrl } from '../qr/qr.js'
import { jidDigits } from '../util/jid.js'
import type { AppConfig } from '../config.js'
import type { Logger } from '../logger.js'
import type { SessionState, SessionStatusView } from '../types.js'

export interface ManagedSessionInit {
  sessionId: string
  academyId: string
  tokenHash: string
  createdAt: number
}

/** Map Baileys' numeric message status to a stable string for the webhook. */
function mapMessageStatus(status: number | null | undefined): string {
  switch (status) {
    case proto.WebMessageInfo.Status.ERROR:
      return 'failed'
    case proto.WebMessageInfo.Status.PENDING:
      return 'pending'
    case proto.WebMessageInfo.Status.SERVER_ACK:
      return 'sent'
    case proto.WebMessageInfo.Status.DELIVERY_ACK:
      return 'delivered'
    case proto.WebMessageInfo.Status.READ:
      return 'read'
    case proto.WebMessageInfo.Status.PLAYED:
      return 'played'
    default:
      return 'unknown'
  }
}

/**
 * Owns one academy's Baileys socket across its whole lifecycle: pairing (QR), connect, the
 * reconnection decision table, the per-session send queue, credential persistence, and graceful
 * shutdown. All event handlers are wrapped so a throw in one session can never crash the process.
 */
export class ManagedSession {
  readonly sessionId: string
  readonly academyId: string
  readonly tokenHash: string
  private readonly createdAt: number

  state: SessionState = 'disconnected'
  phoneJid: string | null = null
  qrDataUrl: string | null = null
  lastConnectedAt: number | null = null
  lastSeenAt: number | null = null

  readonly queue: SendQueue

  private sock: WASocket | null = null
  private saveCreds: (() => Promise<void>) | null = null
  private reconnectAttempts = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private starting = false
  private stopped = false

  constructor(
    init: ManagedSessionInit,
    private readonly pool: Pool,
    private readonly config: AppConfig,
    private readonly settings: SettingsStore,
    private readonly webhook: WebhookClient,
    private readonly logger: Logger,
  ) {
    this.sessionId = init.sessionId
    this.academyId = init.academyId
    this.tokenHash = init.tokenHash
    this.createdAt = init.createdAt
    this.queue = new SendQueue({
      sessionId: this.sessionId,
      getSock: () => this.sock,
      isConnected: () => this.state === 'connected' && !!this.sock,
      sessionCreatedAt: this.createdAt,
      // Read live pacing each send so admin rate-limit changes apply immediately.
      getPacing: () => this.settings.get(),
      logger: this.logger,
      onFailure: (messageId, jid, error) => {
        void this.webhook.send({
          event: 'message.status',
          sessionId: this.sessionId,
          academyId: this.academyId,
          data: { msgId: messageId, status: 'failed', to: jidDigits(jid), error },
        })
      },
      touch: () => {
        this.lastSeenAt = Date.now()
      },
    })
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  /** Start (or restart) the socket. Idempotent: refuses to double-start a connected session. */
  async start(): Promise<void> {
    if (this.starting) return
    if (this.sock && this.state === 'connected') return
    this.starting = true
    this.stopped = false
    try {
      const { state, saveCreds } = await usePostgresAuthState(this.pool, this.sessionId)
      this.saveCreds = saveCreds
      const sock = await createSocket(state, this.logger, this.config.KEEPALIVE_MS)
      this.sock = sock
      this.bindEvents(sock)
      if (this.state !== 'connected') this.setState('connecting')
    } catch (e) {
      this.logger.error(
        { sessionId: this.sessionId, err: e instanceof Error ? e.message : String(e) },
        'failed to start socket',
      )
      this.setState('disconnected')
      this.scheduleReconnect()
    } finally {
      this.starting = false
    }
  }

  /** Graceful stop on shutdown — closes the socket but does NOT log out (creds survive for reconnect). */
  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    try {
      this.sock?.end(undefined)
    } catch {
      /* ignore */
    }
    this.sock = null
  }

  /** Manual logout — the ONLY place sock.logout() is called. Unlinks the device + wipes auth-state. */
  async logout(): Promise<void> {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.queue.clear()
    try {
      await this.sock?.logout()
    } catch (e) {
      this.logger.warn(
        { sessionId: this.sessionId, err: e instanceof Error ? e.message : String(e) },
        'logout error (continuing)',
      )
    }
    try {
      this.sock?.end(undefined)
    } catch {
      /* ignore */
    }
    this.sock = null
    this.setState('logged_out')
    await clearAuthState(this.pool, this.sessionId)
    await this.persist({ state: 'logged_out', phone_jid: null })
  }

  // ── send surface ─────────────────────────────────────────────────────────

  enqueueSend(jid: string, text: string, messageId: string): void {
    this.queue.enqueue(jid, text, messageId)
  }

  async onWhatsApp(jid: string): Promise<boolean> {
    if (!this.sock) return false
    try {
      const res = await this.sock.onWhatsApp(jid)
      return !!res?.[0]?.exists
    } catch {
      return false
    }
  }

  statusUpper(): string {
    return this.state.toUpperCase()
  }

  view(): SessionStatusView {
    return {
      sessionId: this.sessionId,
      academyId: this.academyId,
      state: this.state,
      phoneJid: this.phoneJid,
      lastConnectedAt: this.lastConnectedAt ? new Date(this.lastConnectedAt).toISOString() : null,
      lastSeenAt: this.lastSeenAt ? new Date(this.lastSeenAt).toISOString() : null,
      queueDepth: this.queue.depth,
      reconnectAttempts: this.reconnectAttempts,
    }
  }

  /** Watchdog probe: a "connected" session with no events for too long is half-open → force reconnect. */
  checkHealth(staleMs: number): void {
    if (this.state === 'connected' && this.lastSeenAt && Date.now() - this.lastSeenAt > staleMs) {
      this.logger.warn({ sessionId: this.sessionId }, 'session appears stale; forcing reconnect')
      try {
        this.sock?.end(new Error('watchdog: stale connection'))
      } catch {
        /* ignore */
      }
      this.sock = null
      this.setState('disconnected')
      this.scheduleReconnect()
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private bindEvents(sock: WASocket): void {
    sock.ev.on('creds.update', () => {
      void this.saveCreds?.().catch((e: unknown) =>
        this.logger.error({ sessionId: this.sessionId, err: String(e) }, 'saveCreds failed'),
      )
    })
    sock.ev.on('connection.update', (update) => {
      void this.onConnectionUpdate(update).catch((e: unknown) =>
        this.logger.error({ sessionId: this.sessionId, err: String(e) }, 'connection.update handler threw'),
      )
    })
    sock.ev.on('messages.upsert', (m) => {
      try {
        this.onMessagesUpsert(m)
      } catch (e) {
        this.logger.error({ sessionId: this.sessionId, err: String(e) }, 'messages.upsert handler threw')
      }
    })
    sock.ev.on('messages.update', (updates) => {
      try {
        this.onMessagesUpdate(updates)
      } catch (e) {
        this.logger.error({ sessionId: this.sessionId, err: String(e) }, 'messages.update handler threw')
      }
    })
  }

  private async onConnectionUpdate(update: BaileysEventMap['connection.update']): Promise<void> {
    const { connection, lastDisconnect, qr } = update
    this.lastSeenAt = Date.now()

    if (qr) {
      try {
        this.qrDataUrl = await qrToDataUrl(qr)
        this.setState('qr')
        void this.webhook.send({
          event: 'qr.generated',
          sessionId: this.sessionId,
          academyId: this.academyId,
          data: { qr: this.qrDataUrl },
        })
      } catch (e) {
        this.logger.error({ sessionId: this.sessionId, err: String(e) }, 'qr render failed')
      }
    }

    if (connection === 'open') {
      this.reconnectAttempts = 0
      this.qrDataUrl = null
      this.lastConnectedAt = Date.now()
      this.phoneJid = this.sock?.user?.id ?? this.phoneJid
      this.setState('connected')
      await this.persist({ phone_jid: this.phoneJid, last_connected_at: new Date(), state: 'connected' })
      this.queue.resume()
      void this.webhook.send({
        event: 'connection.update',
        sessionId: this.sessionId,
        academyId: this.academyId,
        data: { state: 'connected', phoneJid: this.phoneJid },
      })
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
        ?.statusCode
      const decision = decideReconnect(statusCode)
      this.logger.warn(
        { sessionId: this.sessionId, statusCode, action: decision.action, reason: decision.reason },
        'connection closed',
      )
      this.sock = null

      switch (decision.action) {
        case 'reconnect-now':
          void this.start()
          break
        case 'reconnect-backoff':
          this.setState('disconnected')
          this.scheduleReconnect()
          break
        case 'reconnect-delayed':
          this.setState('disconnected')
          this.scheduleReconnect(this.config.RECONNECT_CAP_MS)
          break
        case 'fresh-qr':
          await clearAuthState(this.pool, this.sessionId)
          this.setState('connecting')
          void this.start()
          break
        case 'stop':
          this.stopped = true
          this.setState('logged_out')
          await this.persist({ state: 'logged_out' })
          void this.webhook.send({
            event: 'connection.update',
            sessionId: this.sessionId,
            academyId: this.academyId,
            data: { state: 'logged_out', reasonCode: statusCode, probableBan: decision.probableBan },
          })
          this.logger.fatal(
            { sessionId: this.sessionId, academyId: this.academyId, statusCode, probableBan: decision.probableBan },
            'session requires manual re-auth (logged out / banned)',
          )
          break
      }
    }
  }

  private onMessagesUpsert(m: BaileysEventMap['messages.upsert']): void {
    if (m.type !== 'notify') return
    for (const msg of m.messages) {
      if (msg.key.fromMe) continue
      const from = msg.key.remoteJid ?? ''
      if (from.endsWith('@g.us') || from === 'status@broadcast') continue
      const text = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? ''
      this.lastSeenAt = Date.now()
      void this.webhook.send({
        event: 'message.inbound',
        sessionId: this.sessionId,
        academyId: this.academyId,
        data: { from: jidDigits(from), msgId: msg.key.id, text, timestamp: Number(msg.messageTimestamp ?? 0) },
      })
    }
  }

  private onMessagesUpdate(updates: BaileysEventMap['messages.update']): void {
    for (const u of updates) {
      const status = u.update?.status
      if (status == null) continue
      if (!u.key.fromMe) continue
      this.lastSeenAt = Date.now()
      void this.webhook.send({
        event: 'message.status',
        sessionId: this.sessionId,
        academyId: this.academyId,
        data: { msgId: u.key.id, status: mapMessageStatus(status), to: jidDigits(u.key.remoteJid ?? '') },
      })
    }
  }

  private setState(s: SessionState): void {
    if (this.state !== s) {
      this.logger.info({ sessionId: this.sessionId, from: this.state, to: s }, 'state change')
      this.state = s
    }
  }

  private scheduleReconnect(fixedDelayMs?: number): void {
    if (this.stopped) return
    if (this.reconnectTimer) return
    const delay =
      fixedDelayMs ?? backoffDelay(this.reconnectAttempts, this.config.RECONNECT_BASE_MS, this.config.RECONNECT_CAP_MS)
    this.reconnectAttempts += 1
    this.logger.info(
      { sessionId: this.sessionId, attempt: this.reconnectAttempts, delayMs: Math.round(delay) },
      'scheduling reconnect',
    )
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.start()
    }, delay)
  }

  private async persist(fields: {
    phone_jid?: string | null
    last_connected_at?: Date
    state?: SessionState
  }): Promise<void> {
    const sets: string[] = []
    const vals: unknown[] = [this.sessionId]
    let i = 2
    for (const [k, v] of Object.entries(fields)) {
      sets.push(`${k} = $${i++}`)
      vals.push(v)
    }
    if (!sets.length) return
    sets.push('updated_at = now()')
    try {
      await this.pool.query(`update wa_sessions set ${sets.join(', ')} where session_id = $1`, vals)
    } catch (e) {
      this.logger.error({ sessionId: this.sessionId, err: String(e) }, 'persist failed')
    }
  }
}
