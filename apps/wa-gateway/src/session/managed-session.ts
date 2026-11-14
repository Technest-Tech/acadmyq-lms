import type { Pool } from 'pg'
import {
  areJidsSameUser,
  DisconnectReason,
  isJidGroup,
  proto,
  type BaileysEventMap,
  type GroupMetadata,
  type WASocket,
} from 'baileys'
import { usePostgresAuthState, clearAuthState } from '../auth-store/postgres-auth-state.js'
import { createSocket } from './socket-factory.js'
import { decideReconnect, backoffDelay } from './reconnect.js'
import { SendQueue, type MessageState, type RecipientLookup, type SendPayload } from '../queue/send-queue.js'
import { TtlCache } from '../util/ttl-cache.js'
import type { SettingsStore } from '../settings.js'
import type { ProxyPool } from '../proxy/proxy-pool.js'
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

/** A WhatsApp group the linked number belongs to, as the panel needs it to pick a destination. */
export interface GroupView {
  id: string
  subject: string
  size: number
  /** Only admins may post (WhatsApp's "announcement" setting). */
  announce: boolean
  isAdmin: boolean
  /** False when an announcement group would silently reject our messages. */
  canSend: boolean
}

/** How many message ids we remember having reported a group receipt for (one webhook each). */
const RECEIPTS_REMEMBERED = 2_000

/** Sent messages kept so WhatsApp can be given one again when a recipient's phone asks for a resend. */
const SENT_KEPT = 1_000
const SENT_KEPT_MS = 24 * 3_600_000
/** How long a group's member list is trusted before WhatsApp is asked again. */
const GROUP_META_MS = 30 * 60_000
/** A number WhatsApp confirmed is remembered for a week; a "no such number" only for a few hours. */
const RECIPIENT_OK_MS = 7 * 86_400_000
const RECIPIENT_MISSING_MS = 6 * 3_600_000

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
  // When this NUMBER first connected through the gateway; until the first open, the session's own age.
  private numberSince: number

  state: SessionState = 'disconnected'
  phoneJid: string | null = null
  qrDataUrl: string | null = null
  lastConnectedAt: number | null = null
  lastSeenAt: number | null = null

  readonly queue: SendQueue

  private sock: WASocket | null = null
  private saveCreds: (() => Promise<void>) | null = null
  private reconnectAttempts = 0
  // 500s since the last successful open; only a streak of them wipes the creds (see reconnect.ts).
  private badSessionStreak = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private starting = false
  private stopped = false
  // Bumped whenever the current socket is replaced or dropped. Every handler carries the generation
  // of the socket it was bound to and ignores events from an older one — a late `close` from a
  // socket we already replaced used to null out the NEW socket and dial a third, leaving two live
  // sockets on one login (WhatsApp answers that with 440 "replaced", over and over).
  private generation = 0
  // creds.update fires in bursts; each save writes the whole snapshot, so they must land in order.
  private credsChain: Promise<void> = Promise.resolve()
  // Whether this session holds a login (a scanned QR). Only a paired session can be "down".
  private paired = false
  // Since when a paired session has been off, and whether the app has been told about this outage.
  private downSince: number | null = null
  private downReported = false
  // When an unpaired session first showed a QR. Not reset by QR refreshes or re-dials.
  private qrSince: number | null = null
  private readonly sentMessages = new TtlCache<proto.IMessage>(SENT_KEPT_MS, SENT_KEPT)
  private readonly retryCounters = new TtlCache<number>(3_600_000, 5_000)
  private readonly groupMeta = new TtlCache<GroupMetadata>(GROUP_META_MS, 500)
  private readonly recipients = new TtlCache<RecipientLookup>(RECIPIENT_OK_MS, 20_000)
  // Group receipts arrive once PER MEMBER; the app only needs the first of each kind per message.
  private readonly receiptsReported = new Map<string, 'delivered' | 'read'>()

  constructor(
    init: ManagedSessionInit,
    private readonly pool: Pool,
    private readonly config: AppConfig,
    private readonly settings: SettingsStore,
    private readonly webhook: WebhookClient,
    private readonly logger: Logger,
    private readonly proxies: ProxyPool,
  ) {
    this.sessionId = init.sessionId
    this.academyId = init.academyId
    this.tokenHash = init.tokenHash
    this.createdAt = init.createdAt
    this.numberSince = init.createdAt
    this.queue = new SendQueue({
      sessionId: this.sessionId,
      getSock: () => this.sock,
      isConnected: () => this.state === 'connected' && !!this.sock,
      getNumberSince: () => this.numberSince,
      // Read live pacing each send so admin rate-limit changes apply immediately.
      getPacing: () => this.settings.get(),
      tuning: {
        rampDays: this.config.RAMP_DAYS,
        burstMin: this.config.BURST_MIN,
        burstMax: this.config.BURST_MAX,
        restMinMs: this.config.REST_MIN_MS,
        restMaxMs: this.config.REST_MAX_MS,
        maxAgeMs: this.config.QUEUE_MAX_AGE_MS,
        sendTimeoutMs: this.config.SEND_TIMEOUT_MS,
        brakeErrorStreak: this.config.BRAKE_ERROR_STREAK,
        brakePauseMs: this.config.BRAKE_PAUSE_MS,
        brakeRestrictedPauseMs: this.config.BRAKE_RESTRICTED_PAUSE_MS,
      },
      logger: this.logger,
      ...(this.config.CHECK_RECIPIENTS ? { lookupRecipient: (jid: string) => this.lookupRecipient(jid) } : {}),
      beforeSend: (jid) => this.primeGroup(jid),
      // The send route answers on ENQUEUE, so without this the app could never tell a message that
      // actually left from one still waiting (or lost to a restart).
      onSent: (messageId, jid, message) => {
        if (message) this.sentMessages.set(messageId, message)
        void this.webhook.send({
          event: 'message.status',
          sessionId: this.sessionId,
          academyId: this.academyId,
          data: { msgId: messageId, status: 'sent', to: jidDigits(jid) },
        })
      },
      onFailure: (messageId, jid, error) => {
        void this.webhook.send({
          event: 'message.status',
          sessionId: this.sessionId,
          academyId: this.academyId,
          data: { msgId: messageId, status: 'failed', to: jidDigits(jid), error },
        })
      },
      onCount: (dayKey, count) => {
        const phone = this.phoneJid ? jidDigits(this.phoneJid) : ''
        if (!phone) return
        void this.pool
          .query('update wa_numbers set sent_day = $2, sent_count = $3, updated_at = now() where phone = $1', [
            phone,
            dayKey,
            count,
          ])
          .catch((e: unknown) => this.logger.warn({ sessionId: this.sessionId, err: String(e) }, 'send count not saved'))
      },
      onLeft: (messageId) => {
        void this.pool
          .query('delete from wa_send_queue where message_id = $1', [messageId])
          .catch((e: unknown) => this.logger.warn({ sessionId: this.sessionId, err: String(e) }, 'queue journal not cleared'))
      },
      onPaused: (reason, untilMs) => {
        void this.webhook.send({
          event: 'send.paused',
          sessionId: this.sessionId,
          academyId: this.academyId,
          data: { reason, until: new Date(untilMs).toISOString(), phone: this.phoneJid ? jidDigits(this.phoneJid) : null },
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
    // From here on, anything the previous socket still has to say is ignored.
    const generation = ++this.generation
    try {
      this.dropSocket('replaced by a new socket')
      // The creds this socket will log in with must be the ones the last socket left: right after a
      // QR scan WhatsApp closes the socket (515) while the pairing result is still being written, and
      // a dial that read the row a moment too early came up unpaired and showed a second QR.
      await this.credsChain
      const { state, saveCreds } = await usePostgresAuthState(this.pool, this.sessionId)
      // The academy's own proxy when a pool is configured (the same one every dial), else direct.
      const agent = await this.proxies.agentFor(this.academyId)
      const sock = await createSocket(
        state,
        this.logger,
        this.config.KEEPALIVE_MS,
        this.config.BAILEYS_LOG_LEVEL,
        {
          getMessage: async (key) => (key.id ? this.sentMessages.get<proto.IMessage>(key.id) : undefined),
          cachedGroupMetadata: async (jid) => this.groupMeta.get<GroupMetadata>(jid),
          msgRetryCounterCache: this.retryCounters,
        },
        agent,
      )
      // stop()/logout() ran while we were dialling: this socket must not outlive them.
      if (this.stopped || generation !== this.generation) {
        try {
          sock.end(undefined)
        } catch {
          /* ignore */
        }
        return
      }
      this.saveCreds = saveCreds
      this.paired = Boolean(state.creds.me)
      // The pairing clock starts with the first dial, not the first QR: an unpaired session that
      // cannot even reach WhatsApp (its proxy is down) must give up too, not redial for ever.
      if (!this.paired) this.qrSince ??= Date.now()
      if (this.paired && this.state !== 'connected') this.downSince ??= Date.now()
      this.sock = sock
      // The watchdog measures silence from here, so a dial that never produces a frame is caught too.
      this.lastSeenAt = Date.now()
      this.bindEvents(sock, generation)
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
    this.generation += 1
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.queue.dispose()
    this.dropSocket('gateway stopping')
  }

  /** Whatever creds.update writes are still on their way to Postgres (awaited before the pool closes). */
  async flush(): Promise<void> {
    await this.credsChain
  }

  /** Manual logout — the ONLY place sock.logout() is called. Unlinks the device + wipes auth-state. */
  async logout(): Promise<void> {
    this.stopped = true
    // Our own logout closes the socket with a 401; that close is ours, not news to report.
    this.generation += 1
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.failQueued()
    try {
      await this.sock?.logout()
    } catch (e) {
      this.logger.warn(
        { sessionId: this.sessionId, err: e instanceof Error ? e.message : String(e) },
        'logout error (continuing)',
      )
    }
    this.dropSocket('logged out')
    this.qrDataUrl = null
    this.setState('logged_out')
    await this.credsChain
    await clearAuthState(this.pool, this.sessionId)
    await this.persist({ state: 'logged_out', phone_jid: null })
  }

  // ── send surface ─────────────────────────────────────────────────────────

  /**
   * Accept a message for sending. It is written to the journal first, so "accepted" means it
   * survives a gateway restart; a journal that cannot be written does not stop the send.
   */
  async enqueueSend(jid: string, messageId: string, payload: SendPayload): Promise<void> {
    try {
      await this.pool.query(
        'insert into wa_send_queue (message_id, session_id, jid, payload) values ($1, $2, $3, $4) on conflict do nothing',
        [messageId, this.sessionId, jid, JSON.stringify(payload)],
      )
    } catch (e) {
      this.logger.warn({ sessionId: this.sessionId, messageId, err: String(e) }, 'message not journalled; a restart would lose it')
    }
    this.queue.enqueue(jid, messageId, payload)
  }

  /**
   * Empty the queue and tell the app each message is not going out. Without the word, the app keeps
   * its optimistic "sent" for a message that never left and so never tries it again. One at a time:
   * a long queue must not land on the app as hundreds of webhooks at once.
   */
  private failQueued(): void {
    const dropped = this.queue.clear()
    if (!dropped.length) return
    void (async () => {
      for (const d of dropped) {
        try {
          await this.webhook.send({
            event: 'message.status',
            sessionId: this.sessionId,
            academyId: this.academyId,
            data: { msgId: d.messageId, status: 'failed', to: jidDigits(d.jid), error: 'queue_cleared' },
          })
        } catch {
          // the outbox already took what could not be delivered
        }
      }
    })()
  }

  /** Rebuild the queue from the journal after a restart. */
  restoreQueue(items: Array<{ jid: string; messageId: string; payload: SendPayload; enqueuedAt: number }>): void {
    this.queue.restore(items)
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

  /** How busy the send queue is: the app holds back time-critical messages rather than bury them. */
  sendLoad(): { queueDepth: number; sentToday: number; dailyCap: number; pausedUntil: string | null; pausedReason: string | null } {
    const pausedUntil = this.queue.pausedUntil
    return {
      queueDepth: this.queue.depth,
      sentToday: this.queue.sentTodayCount,
      dailyCap: this.queue.dailyCap,
      pausedUntil: pausedUntil ? new Date(pausedUntil).toISOString() : null,
      pausedReason: this.queue.pausedReason,
    }
  }

  messageState(messageId: string): { state: MessageState; error?: string } {
    return this.queue.stateOf(messageId)
  }

  /**
   * Every group the linked number is a member of. Community parents are left out — they cannot hold
   * messages — and announcement groups report whether we are an admin, because WhatsApp drops a
   * non-admin's post there without an error anyone would see.
   */
  async listGroups(): Promise<GroupView[]> {
    const sock = this.sock
    if (!sock || this.state !== 'connected') return []
    const all = await sock.groupFetchAllParticipating()
    for (const g of Object.values(all)) this.groupMeta.set(g.id, g)
    const me = [sock.user?.id, sock.user?.lid].filter((j): j is string => Boolean(j))
    const isMe = (jid: string | undefined): boolean => Boolean(jid) && me.some((m) => areJidsSameUser(m, jid))

    return Object.values(all)
      .filter((g) => !g.isCommunity)
      .map((g) => {
        const self = g.participants.find((p) => isMe(p.id) || isMe(p.jid) || isMe(p.lid))
        const isAdmin = Boolean(self?.admin)
        const announce = Boolean(g.announce)
        return {
          id: g.id,
          subject: g.subject ?? '',
          size: g.size ?? g.participants.length,
          announce,
          isAdmin,
          canSend: !announce || isAdmin,
        }
      })
      .sort((a, b) => a.subject.localeCompare(b.subject))
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
      pausedUntil: this.queue.pausedUntil ? new Date(this.queue.pausedUntil).toISOString() : null,
      pausedReason: this.queue.pausedReason,
      proxy: this.proxies.labelFor(this.academyId),
    }
  }

  /**
   * Watchdog probe: a socket with no frames for too long is dead → force reconnect. A "connected" one
   * is half-open; a "connecting" one never finished dialling — on 2026-10-16 a session froze there for
   * hours (no QR, no close) while the panel kept serving its last, expired QR.
   */
  checkHealth(staleMs: number): void {
    this.reportIfDown()
    if (this.starting) return
    if (!this.paired && !this.stopped && this.qrSince && Date.now() - this.qrSince > this.config.QR_MAX_WAIT_MS) {
      void this.abandonPairing().catch((e: unknown) =>
        this.logger.warn({ sessionId: this.sessionId, err: String(e) }, 'abandoning the pairing failed'),
      )
      return
    }
    if (!this.sock) {
      // Nothing dialling and nothing scheduled, yet the session is meant to be up: whatever path led
      // here, do not sit in it until someone notices.
      if (!this.stopped && !this.reconnectTimer && this.state !== 'logged_out') {
        this.logger.warn({ sessionId: this.sessionId, state: this.state }, 'session has no socket and no reconnect pending; dialling')
        this.setState('disconnected')
        this.scheduleReconnect()
      }
      return
    }
    if (this.state !== 'connected' && this.state !== 'connecting') return
    if (this.lastSeenAt && Date.now() - this.lastSeenAt > staleMs) {
      this.logger.warn({ sessionId: this.sessionId, state: this.state }, 'session appears stale; forcing reconnect')
      this.generation += 1
      if (this.paired) this.downSince ??= Date.now()
      this.dropSocket('watchdog: stale connection')
      this.qrDataUrl = null
      this.setState('disconnected')
      this.scheduleReconnect()
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * Tell the app once per outage that a paired number has been off for a while. A logout is reported
   * the moment it happens; this is for the quiet kind — a session that keeps failing to reconnect
   * while every screen still says "connected".
   */
  private reportIfDown(): void {
    if (this.stopped || !this.paired || this.downReported || this.downSince === null) return
    if (this.state === 'connected' || this.state === 'logged_out') return
    const downMs = Date.now() - this.downSince
    if (downMs < this.config.DOWN_ALERT_MS) return
    this.downReported = true
    this.logger.error({ sessionId: this.sessionId, downMinutes: Math.round(downMs / 60_000) }, 'paired session is still down')
    void this.webhook.send({
      event: 'connection.update',
      sessionId: this.sessionId,
      academyId: this.academyId,
      data: { state: 'disconnected', downMinutes: Math.round(downMs / 60_000), queued: this.queue.depth },
    })
  }

  /** End the current socket, if any. Callers bump `generation` first when its close must be ignored. */
  private dropSocket(reason: string): void {
    const sock = this.sock
    this.sock = null
    if (!sock) return
    try {
      sock.end(new Error(reason))
    } catch {
      /* ignore */
    }
  }

  private bindEvents(sock: WASocket, generation: number): void {
    const current = (): boolean => generation === this.generation
    // Liveness is ANY frame from WhatsApp — Baileys' own keep-alive pongs included. The watchdog used
    // to count only app-level events, which an idle session (markOnlineOnConnect:false) never emits,
    // so every quiet socket looked dead after WATCHDOG_STALE_MS and was torn down on a loop.
    sock.ws.on('frame', () => {
      if (current()) this.lastSeenAt = Date.now()
    })
    sock.ev.on('creds.update', () => {
      // Saved even for a socket that is on its way out — they are the same creds object, and a key
      // rotation that never reaches Postgres is a broken login after the next restart.
      this.credsChain = this.credsChain
        .then(() => this.saveCreds?.())
        .catch((e: unknown) => this.logger.error({ sessionId: this.sessionId, err: String(e) }, 'saveCreds failed'))
    })
    sock.ev.on('connection.update', (update) => {
      if (!current()) return
      void this.onConnectionUpdate(update, generation).catch((e: unknown) =>
        this.logger.error({ sessionId: this.sessionId, err: String(e) }, 'connection.update handler threw'),
      )
    })
    sock.ev.on('messages.update', (updates) => {
      if (!current()) return
      try {
        this.onMessagesUpdate(updates)
      } catch (e) {
        this.logger.error({ sessionId: this.sessionId, err: String(e) }, 'messages.update handler threw')
      }
    })
    sock.ev.on('message-receipt.update', (receipts) => {
      if (!current()) return
      try {
        this.onGroupReceipts(receipts)
      } catch (e) {
        this.logger.error({ sessionId: this.sessionId, err: String(e) }, 'message-receipt.update handler threw')
      }
    })
    // A group whose members or settings changed must be read again before the next send to it: a
    // member missing from the list we encrypt for simply never gets the message.
    sock.ev.on('groups.update', (groups) => {
      for (const g of groups) if (g.id) this.groupMeta.del(g.id)
    })
    sock.ev.on('group-participants.update', (change) => {
      this.groupMeta.del(change.id)
    })
  }

  private async onConnectionUpdate(update: BaileysEventMap['connection.update'], generation: number): Promise<void> {
    const { connection, lastDisconnect, qr } = update
    this.lastSeenAt = Date.now()

    if (qr) {
      this.qrSince ??= Date.now()
      if (Date.now() - this.qrSince > this.config.QR_MAX_WAIT_MS) {
        await this.abandonPairing()
        return
      }
      try {
        const dataUrl = await qrToDataUrl(qr)
        if (generation !== this.generation) return
        this.qrDataUrl = dataUrl
        this.setState('qr')
      } catch (e) {
        this.logger.error({ sessionId: this.sessionId, err: String(e) }, 'qr render failed')
      }
    }

    if (connection === 'open') {
      this.reconnectAttempts = 0
      this.badSessionStreak = 0
      this.qrDataUrl = null
      this.qrSince = null
      this.paired = true
      this.downSince = null
      this.downReported = false
      this.lastConnectedAt = Date.now()
      this.phoneJid = this.sock?.user?.id ?? this.phoneJid
      // Group changes that happened while we were offline were never announced to us.
      this.groupMeta.flushAll()
      this.setState('connected')
      await this.persist({ phone_jid: this.phoneJid, last_connected_at: new Date(), state: 'connected' })
      await this.loadNumber()
      if (generation !== this.generation) return
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
      const decision = decideReconnect(statusCode, this.badSessionStreak)
      if (statusCode === DisconnectReason.badSession) this.badSessionStreak += 1
      this.logger.warn(
        { sessionId: this.sessionId, statusCode, action: decision.action, reason: decision.reason },
        'connection closed',
      )
      this.sock = null
      if (this.paired) this.downSince ??= Date.now()
      // A QR dies with its socket; serving it afterwards only gets "can't link device" on the phone.
      this.qrDataUrl = null

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
          this.badSessionStreak = 0
          this.paired = false
          this.downSince = null
          await clearAuthState(this.pool, this.sessionId)
          this.phoneJid = null
          await this.persist({ phone_jid: null })
          // The login is gone and only a re-scan brings it back. Without this the app kept showing
          // CONNECTED for days and no operator alert fired.
          void this.webhook.send({
            event: 'connection.update',
            sessionId: this.sessionId,
            academyId: this.academyId,
            data: { state: 'logged_out', reasonCode: statusCode, probableBan: false },
          })
          this.setState('connecting')
          void this.start()
          break
        case 'stop':
          this.stopped = true
          // Nothing can be sent from a number that is no longer linked; say so now rather than let
          // each message sit until it expires.
          this.failQueued()
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

  private onMessagesUpdate(updates: BaileysEventMap['messages.update']): void {
    for (const u of updates) {
      const status = u.update?.status
      if (status == null) continue
      if (!u.key.fromMe) continue
      this.lastSeenAt = Date.now()
      // Feed the brake: an `ack` with an error is WhatsApp refusing the message, and Baileys puts
      // the code it gave in messageStubParameters.
      const errorCode = status === proto.WebMessageInfo.Status.ERROR ? u.update.messageStubParameters?.[0] : undefined
      if (status === proto.WebMessageInfo.Status.ERROR) this.queue.reportAckError(errorCode ?? undefined)
      else if (status >= proto.WebMessageInfo.Status.SERVER_ACK) this.queue.reportAckOk()
      void this.webhook.send({
        event: 'message.status',
        sessionId: this.sessionId,
        academyId: this.academyId,
        data: {
          msgId: u.key.id,
          status: mapMessageStatus(status),
          to: jidDigits(u.key.remoteJid ?? ''),
          ...(errorCode ? { error: `ack_error_${errorCode}` } : {}),
        },
      })
    }
  }

  /**
   * Group messages never get a `messages.update` delivery status — WhatsApp reports them member by
   * member through `message-receipt.update`. The first member's phone receiving it is the proof that
   * the message reached the group, so that (and the first read) is forwarded once per message.
   */
  private onGroupReceipts(receipts: BaileysEventMap['message-receipt.update']): void {
    for (const { key, receipt } of receipts) {
      if (!key.fromMe || !key.id || !isJidGroup(key.remoteJid ?? undefined)) continue
      const status: 'delivered' | 'read' | null = receipt.readTimestamp
        ? 'read'
        : receipt.receiptTimestamp
          ? 'delivered'
          : null
      if (!status) continue
      const already = this.receiptsReported.get(key.id)
      if (already === 'read' || already === status) continue

      this.receiptsReported.set(key.id, status)
      while (this.receiptsReported.size > RECEIPTS_REMEMBERED) {
        const oldest = this.receiptsReported.keys().next().value
        if (oldest === undefined) break
        this.receiptsReported.delete(oldest)
      }

      this.lastSeenAt = Date.now()
      void this.webhook.send({
        event: 'message.status',
        sessionId: this.sessionId,
        academyId: this.academyId,
        data: { msgId: key.id, status, to: jidDigits(key.remoteJid ?? '') },
      })
    }
  }

  private setState(s: SessionState): void {
    if (this.state !== s) {
      this.logger.info({ sessionId: this.sessionId, from: this.state, to: s }, 'state change')
      this.state = s
    }
  }

  /**
   * Nobody scanned. Stop dialling and showing QR codes — an unpaired session used to loop
   * qr → timeout → reconnect → qr for days, hundreds of dials a day from one address. The next
   * Connect press finds `logged_out` and starts a clean session.
   */
  private async abandonPairing(): Promise<void> {
    this.logger.info({ sessionId: this.sessionId }, 'no QR scan in time; pairing abandoned until the next connect')
    this.stopped = true
    this.generation += 1
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.dropSocket('pairing abandoned')
    this.qrDataUrl = null
    this.qrSince = null
    this.setState('logged_out')
    await this.persist({ state: 'logged_out' })
    void this.webhook.send({
      event: 'connection.update',
      sessionId: this.sessionId,
      academyId: this.academyId,
      data: { state: 'logged_out', reason: 'qr_timeout', probableBan: false },
    })
  }

  /**
   * The number's own record: when it first connected here (the warm-up counts from that, so a re-scan
   * is not a new number) and how many messages it has sent today (so a restart is not a new day).
   */
  private async loadNumber(): Promise<void> {
    const phone = this.phoneJid ? jidDigits(this.phoneJid) : ''
    if (!phone) return
    try {
      // A number seen for the first time takes this session's age: sessions paired before this
      // table existed keep the history they have instead of all starting a warm-up on deploy.
      const res = await this.pool.query(
        `insert into wa_numbers (phone, first_connected_at) values ($1, to_timestamp($2::double precision / 1000))
         on conflict (phone) do update set updated_at = now()
         returning extract(epoch from first_connected_at) * 1000 as since_ms, sent_day, sent_count`,
        [phone, this.createdAt],
      )
      const row = res.rows[0]
      if (!row) return
      this.numberSince = Number(row.since_ms)
      this.queue.restoreCounter(row.sent_day ?? null, Number(row.sent_count ?? 0))
    } catch (e) {
      this.logger.warn({ sessionId: this.sessionId, err: String(e) }, 'number record not loaded')
    }
  }

  /** Is this private recipient on WhatsApp? Cached; `undefined` when WhatsApp could not be asked. */
  private async lookupRecipient(jid: string): Promise<RecipientLookup | undefined> {
    const known = this.recipients.get<RecipientLookup>(jid)
    if (known) return known
    const sock = this.sock
    if (!sock) return undefined
    try {
      const res = await sock.onWhatsApp(jid)
      if (!res) return undefined
      const hit = res.find((r) => r.exists)
      if (hit) {
        const found: RecipientLookup = { exists: true, jid: hit.jid.endsWith('@s.whatsapp.net') ? hit.jid : jid }
        this.recipients.set(jid, found)
        return found
      }
      const missing: RecipientLookup = { exists: false }
      this.recipients.set(jid, missing, RECIPIENT_MISSING_MS)
      return missing
    } catch {
      return undefined
    }
  }

  /** Make sure a group's member list is on hand, so the send itself does not have to ask WhatsApp. */
  private async primeGroup(jid: string): Promise<void> {
    if (!isJidGroup(jid) || this.groupMeta.get(jid)) return
    const sock = this.sock
    if (!sock) return
    try {
      this.groupMeta.set(jid, await sock.groupMetadata(jid))
    } catch (e) {
      // Baileys asks again by itself during the send; a real failure surfaces there.
      this.logger.warn({ sessionId: this.sessionId, jid, err: String(e) }, 'group metadata not primed')
    }
  }

  private scheduleReconnect(fixedDelayMs?: number): void {
    if (this.stopped) return
    if (this.reconnectTimer) return
    const cap =
      this.reconnectAttempts >= this.config.RECONNECT_SLOW_AFTER
        ? Math.max(this.config.RECONNECT_SLOW_CAP_MS, this.config.RECONNECT_CAP_MS)
        : this.config.RECONNECT_CAP_MS
    const delay = fixedDelayMs ?? backoffDelay(this.reconnectAttempts, this.config.RECONNECT_BASE_MS, cap)
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
