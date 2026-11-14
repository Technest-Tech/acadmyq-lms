import type { proto, WASocket } from 'baileys'
import type { Logger } from '../logger.js'

export interface SendPacingConfig {
  minIntervalMs: number
  maxIntervalMs: number
  dailyCap: number
  warmupDays: number
  warmupDailyCap: number
  warmupMinIntervalMs: number
  warmupMaxIntervalMs: number
}

/** The pacing knobs that come from the environment rather than the admin's live settings. */
export interface QueueTuning {
  /** Days, after the warm-up, over which the cap and the gaps climb to the full profile. */
  rampDays: number
  burstMin: number
  burstMax: number
  restMinMs: number
  restMaxMs: number
  maxAgeMs: number
  sendTimeoutMs: number
  brakeErrorStreak: number
  brakePauseMs: number
  brakeRestrictedPauseMs: number
}

/** What WhatsApp said about a recipient: it exists (maybe under a corrected jid), or it does not. */
export type RecipientLookup = { exists: true; jid: string } | { exists: false }

export interface SendQueueDeps {
  sessionId: string
  getSock: () => WASocket | null
  isConnected: () => boolean
  /**
   * When this NUMBER first connected through the gateway (ms). The warm-up counts from here, not
   * from the session row: a re-scan makes a new session but the number is no newer for it.
   */
  getNumberSince: () => number
  /** Read the CURRENT pacing each time — lets admin rate-limit changes apply live. */
  getPacing: () => SendPacingConfig
  tuning: QueueTuning
  logger: Logger
  /**
   * Ask WhatsApp whether a private recipient exists. `undefined` = could not tell (send anyway).
   * Absent = never ask.
   */
  lookupRecipient?: (jid: string) => Promise<RecipientLookup | undefined>
  /** Called before a send to a jid — the session primes what the send needs (group membership). */
  beforeSend?: (jid: string) => Promise<void>
  /** Called once an item has been handed to WhatsApp (sock.sendMessage resolved). */
  onSent: (messageId: string, jid: string, message: proto.IMessage | undefined) => void
  /** Called when an item permanently fails to send (after it left the queue). */
  onFailure: (messageId: string, jid: string, error: string) => void
  /** Called after each send with the day's running count, so it can be kept across restarts. */
  onCount: (dayKey: string, count: number) => void
  /** Called when an item has left the queue for good — sent, failed, expired or cleared. */
  onLeft: (messageId: string) => void
  /** Called when the brake pauses the queue. */
  onPaused: (reason: string, untilMs: number) => void
  /** Mark the session as alive (resets the stale-connection watchdog). */
  touch: () => void
}

/** What the queue knows about a message it accepted. `unknown` = never seen, or long forgotten. */
export type MessageState = 'queued' | 'sent' | 'failed' | 'unknown'

interface TrackedMessage {
  state: Exclude<MessageState, 'unknown'>
  at: number
  error?: string
}

/** How long, and how many, accepted message ids are remembered for the state lookup. */
const TRACK_TTL_MS = 24 * 3_600_000
const TRACK_MAX = 5_000

/** How often a queue that cannot send right now (offline, capped, paused) looks again. */
const WAKE_MS = 60_000
/** An image is downloaded and uploaded before it is sent; give it this many times the text timeout. */
const MEDIA_TIMEOUT_FACTOR = 3
/** The lowest hourly allowance, so a small daily cap does not starve a normal hour. */
const HOURLY_FLOOR = 20
const HOUR_MS = 3_600_000
/** WhatsApp's answer when the account is not allowed to start new chats for now. */
const RESTRICTED_ACK_CODES = new Set(['463'])
/** Pause when WhatsApp says we are asking too fast. */
const RATE_LIMIT_PAUSE_MS = 10 * 60_000

export interface SendPayload {
  text?: string
  imageUrl?: string
  caption?: string
}

interface QueueItem {
  jid: string
  messageId: string
  payload: SendPayload
  enqueuedAt: number
  attempts: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const between = (min: number, max: number): number => Math.floor(min + Math.random() * Math.max(0, max - min))
const lerp = (from: number, to: number, t: number): number => from + (to - from) * t

class SendTimeout extends Error {}

/**
 * Per-session, serial outbound queue. This is the anti-ban layer: randomized human-like gaps between
 * sends, a daily and an hourly cap, a slower "warm-up" profile for a number that is new to the
 * gateway (easing into the full profile rather than jumping), rests between bursts, typing-presence
 * simulation, a check that a number is on WhatsApp before the first message to it, and a brake that
 * pauses the whole queue when WhatsApp starts refusing messages. Bans are the dominant real-world
 * cause of "disconnects", so this matters as much as the reconnection logic. Idempotency is handled
 * Laravel-side (dedupe_key), so enqueue is fire-and-forget; the route returns the pre-generated
 * messageId immediately.
 */
export class SendQueue {
  private items: QueueItem[] = []
  private running = false
  private sentToday = 0
  private dayKey = ''
  private lastSentAt = 0
  /** Send times within the last hour, oldest first. */
  private recent: number[] = []
  private burstLeft: number
  private restUntil = 0
  private pausedUntilMs = 0
  private pauseReason: string | null = null
  private ackErrorStreak = 0
  private wakeTimer: NodeJS.Timeout | null = null
  // Insertion-ordered, so the oldest entry is always first when pruning.
  private readonly tracked = new Map<string, TrackedMessage>()

  constructor(private readonly deps: SendQueueDeps) {
    this.burstLeft = this.nextBurst()
  }

  get depth(): number {
    return this.items.length
  }

  get sentTodayCount(): number {
    this.rollDay()
    return this.sentToday
  }

  /** The number's send cap for the day: the slower warm-up cap while it is newly paired. */
  get dailyCap(): number {
    return this.pacing().cap
  }

  /** When the brake lets the queue go again (ms), or null when it is not paused. */
  get pausedUntil(): number | null {
    return this.pausedUntilMs > Date.now() ? this.pausedUntilMs : null
  }

  get pausedReason(): string | null {
    return this.pausedUntil ? this.pauseReason : null
  }

  enqueue(jid: string, messageId: string, payload: SendPayload): void {
    this.items.push({ jid, messageId, payload, enqueuedAt: Date.now(), attempts: 0 })
    this.track(messageId, 'queued')
    void this.drain()
  }

  /**
   * The state of a message this queue accepted. The send route answers 200 the moment a message is
   * queued, so this is how the app tells "still waiting its turn" from "lost" — the queue is in
   * memory, and a restart forgets everything that had not gone out yet, which reads as `unknown`.
   */
  stateOf(messageId: string): { state: MessageState; error?: string } {
    const entry = this.tracked.get(messageId)
    if (!entry || Date.now() - entry.at > TRACK_TTL_MS) return { state: 'unknown' }
    return entry.error ? { state: entry.state, error: entry.error } : { state: entry.state }
  }

  private track(messageId: string, state: TrackedMessage['state'], error?: string): void {
    this.tracked.delete(messageId)
    this.tracked.set(messageId, error ? { state, at: Date.now(), error } : { state, at: Date.now() })
    while (this.tracked.size > TRACK_MAX) {
      const oldest = this.tracked.keys().next().value
      if (oldest === undefined) break
      this.tracked.delete(oldest)
    }
  }

  /**
   * Put back what was waiting when the last process stopped (read from the journal), oldest first.
   * Nothing is sent from here: the queue starts when the socket opens.
   */
  restore(items: Array<{ jid: string; messageId: string; payload: SendPayload; enqueuedAt: number }>): void {
    for (const item of items) {
      this.items.push({ ...item, attempts: 0 })
      this.track(item.messageId, 'queued')
    }
  }

  /** Resume draining (e.g. after a reconnect re-establishes the socket). */
  resume(): void {
    void this.drain()
  }

  /** Drop all queued items (e.g. on logout); returns what was discarded, so the caller can say so. */
  clear(): Array<{ messageId: string; jid: string }> {
    const dropped = this.items.map((item) => ({ messageId: item.messageId, jid: item.jid }))
    for (const item of this.items) {
      this.track(item.messageId, 'failed', 'queue_cleared')
      this.deps.onLeft(item.messageId)
    }
    this.items = []
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer)
      this.wakeTimer = null
    }
    return dropped
  }

  /** Stop the queue's own timer (process shutdown). Queued items stay where they are. */
  dispose(): void {
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer)
      this.wakeTimer = null
    }
  }

  /**
   * Take up the day's count the number had already reached before this process (or this session)
   * existed, so a restart or a re-scan does not hand it a fresh daily allowance.
   */
  restoreCounter(dayKey: string | null, count: number): void {
    this.rollDay()
    if (dayKey === this.dayKey && count > this.sentToday) this.sentToday = count
  }

  /** WhatsApp accepted a message of ours — whatever was going wrong has stopped. */
  reportAckOk(): void {
    this.ackErrorStreak = 0
  }

  /**
   * WhatsApp refused a message of ours (an `ack` carrying an error). One refusal is a recipient's
   * problem; a run of them, or a restriction code, is WhatsApp telling this number to stop — and a
   * number that keeps sending through that is the one that gets banned.
   */
  reportAckError(code: string | undefined): void {
    this.ackErrorStreak += 1
    const { brakeErrorStreak, brakePauseMs, brakeRestrictedPauseMs } = this.deps.tuning
    if (code && RESTRICTED_ACK_CODES.has(code)) {
      this.pause(brakeRestrictedPauseMs, `restricted(${code})`)
    } else if (this.ackErrorStreak >= brakeErrorStreak) {
      this.pause(brakePauseMs, `refused x${this.ackErrorStreak}${code ? ` (${code})` : ''}`)
    }
  }

  /** Hold every send until `ms` from now. A longer pause already running is kept. */
  pause(ms: number, reason: string): void {
    const until = Date.now() + ms
    if (until <= this.pausedUntilMs) return
    this.pausedUntilMs = until
    this.pauseReason = reason
    this.ackErrorStreak = 0
    this.deps.logger.error(
      { sessionId: this.deps.sessionId, reason, until: new Date(until).toISOString(), queued: this.items.length },
      'send queue paused (anti-ban brake)',
    )
    this.deps.onPaused(reason, until)
  }

  private nextBurst(): number {
    const { burstMin, burstMax } = this.deps.tuning
    return between(Math.min(burstMin, burstMax), Math.max(burstMin, burstMax) + 1)
  }

  private pacing(): { min: number; max: number; cap: number } {
    const cfg = this.deps.getPacing()
    const full = { min: cfg.minIntervalMs, max: cfg.maxIntervalMs, cap: cfg.dailyCap }
    // Warm-up switched off by the admin → no ramp either.
    if (cfg.warmupDays <= 0) return full

    const warm = { min: cfg.warmupMinIntervalMs, max: cfg.warmupMaxIntervalMs, cap: cfg.warmupDailyCap }
    const ageDays = (Date.now() - this.deps.getNumberSince()) / 86_400_000
    if (ageDays < cfg.warmupDays) return warm

    const rampDays = this.deps.tuning.rampDays
    const t = rampDays > 0 ? (ageDays - cfg.warmupDays) / rampDays : 1
    if (t >= 1) return full
    return {
      min: Math.round(lerp(warm.min, full.min, t)),
      max: Math.round(lerp(warm.max, full.max, t)),
      cap: Math.max(1, Math.round(lerp(warm.cap, full.cap, t))),
    }
  }

  private rollDay(): void {
    const today = new Date().toISOString().slice(0, 10)
    if (today !== this.dayKey) {
      this.dayKey = today
      this.sentToday = 0
    }
  }

  /** Look again later: nothing else wakes a queue that stopped for the cap, a pause or an outage. */
  private wakeIn(ms: number): void {
    if (this.wakeTimer) return
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null
      void this.drain()
    }, ms)
    this.wakeTimer.unref?.()
  }

  private fail(item: QueueItem, error: string): void {
    this.track(item.messageId, 'failed', error)
    this.deps.onLeft(item.messageId)
    this.deps.logger.error(
      { sessionId: this.deps.sessionId, messageId: item.messageId, err: error },
      'message send failed',
    )
    this.deps.onFailure(item.messageId, item.jid, error)
  }

  /** Fail what has waited too long: a reminder for a lesson that is over must not go out. */
  private expireOld(): void {
    const limit = Date.now() - this.deps.tuning.maxAgeMs
    if (!this.items.some((i) => i.enqueuedAt < limit)) return
    const keep: QueueItem[] = []
    for (const item of this.items) {
      if (item.enqueuedAt < limit) this.fail(item, 'expired')
      else keep.push(item)
    }
    this.items = keep
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.items.length) {
        this.expireOld()
        if (!this.items.length) break

        // Socket not ready → leave items queued; drain resumes on enqueue(), resume() or the timer.
        if (!this.deps.isConnected()) break

        if (Date.now() < this.pausedUntilMs) break

        this.rollDay()
        const { min, max, cap } = this.pacing()
        if (this.sentToday >= cap) {
          this.deps.logger.warn({ sessionId: this.deps.sessionId, cap }, 'daily send cap reached; deferring')
          break
        }

        // No more than a share of the day's allowance in any one hour.
        const hourAgo = Date.now() - HOUR_MS
        while (this.recent.length && (this.recent[0] ?? 0) <= hourAgo) this.recent.shift()
        const hourlyCap = Math.max(HOURLY_FLOOR, Math.ceil(cap / 3))
        if (this.recent.length >= hourlyCap) {
          await sleep(Math.min(WAKE_MS, (this.recent[0] ?? Date.now()) + HOUR_MS - Date.now() + 250))
          continue
        }

        // A rest between bursts. A queue that has been quiet for a while has had its rest already.
        if (this.lastSentAt && Date.now() - this.lastSentAt > this.deps.tuning.restMaxMs) {
          this.burstLeft = this.nextBurst()
          this.restUntil = 0
        }
        if (Date.now() < this.restUntil) {
          await sleep(Math.min(WAKE_MS, this.restUntil - Date.now()))
          continue
        }

        // Enforce the randomized minimum gap between consecutive sends.
        const targetGap = between(min, max)
        const sinceLast = Date.now() - this.lastSentAt
        if (this.lastSentAt && sinceLast < targetGap) {
          await sleep(targetGap - sinceLast)
          continue // re-check connection + cap after waiting
        }

        const item = this.items[0]
        if (!item) break
        const sock = this.deps.getSock()
        if (!sock) break

        // Never message a number WhatsApp says does not exist.
        let jid = item.jid
        if (this.deps.lookupRecipient && jid.endsWith('@s.whatsapp.net')) {
          const found = await this.deps.lookupRecipient(jid)
          if (found && !found.exists) {
            this.items.shift()
            this.fail(item, 'not_on_whatsapp')
            // A list of dead numbers must not turn into a burst of lookups.
            await sleep(between(1_500, 3_000))
            continue
          }
          if (found?.exists) jid = found.jid
        }

        item.attempts += 1
        try {
          await this.deps.beforeSend?.(jid)

          // Typing presence makes automated sends look less robotic. Length drives the delay; for
          // image sends the caption (or a small default) stands in for the text length.
          const typingLen = (item.payload.text ?? item.payload.caption ?? '').length || 8
          try {
            await sock.sendPresenceUpdate('composing', jid)
            await sleep(Math.round(Math.min(4_000, 500 + typingLen * 25) * (0.7 + Math.random() * 0.6)))
            await sock.sendPresenceUpdate('paused', jid)
          } catch {
            /* presence is best-effort */
          }
          const content = item.payload.imageUrl
            ? { image: { url: item.payload.imageUrl }, caption: item.payload.caption }
            : { text: item.payload.text ?? '' }
          const timeoutMs = this.deps.tuning.sendTimeoutMs * (item.payload.imageUrl ? MEDIA_TIMEOUT_FACTOR : 1)
          const sent = await this.withTimeout(sock.sendMessage(jid, content, { messageId: item.messageId }), timeoutMs)

          this.items.shift()
          this.sentToday += 1
          this.lastSentAt = Date.now()
          this.recent.push(this.lastSentAt)
          this.burstLeft -= 1
          if (this.burstLeft <= 0) {
            this.burstLeft = this.nextBurst()
            this.restUntil = Date.now() + between(this.deps.tuning.restMinMs, this.deps.tuning.restMaxMs)
          }
          this.track(item.messageId, 'sent')
          this.deps.onLeft(item.messageId)
          this.deps.touch()
          this.deps.logger.info({ sessionId: this.deps.sessionId, messageId: item.messageId }, 'message sent')
          this.deps.onCount(this.dayKey, this.sentToday)
          this.deps.onSent(item.messageId, jid, sent?.message ?? undefined)
        } catch (e) {
          const msg = e instanceof SendTimeout ? 'send_timeout' : e instanceof Error ? e.message : 'send_failed'

          // The socket went down under the send: the message most likely never left. Keep it at the
          // head (same id, so WhatsApp would drop a double) and let it go once after the reconnect.
          if (!(e instanceof SendTimeout) && !this.deps.isConnected() && item.attempts < 2) {
            this.deps.logger.warn(
              { sessionId: this.deps.sessionId, messageId: item.messageId, err: msg },
              'send interrupted by a disconnect; will retry once',
            )
            break
          }

          this.items.shift()
          // Still counts towards the gap: a failure must not be followed by an instant next try.
          this.lastSentAt = Date.now()
          this.fail(item, msg)
          if (/rate-overlimit|429/.test(msg)) this.pause(RATE_LIMIT_PAUSE_MS, 'rate-overlimit')
        }
      }
    } finally {
      this.running = false
      if (this.items.length) this.wakeIn(WAKE_MS)
    }
  }

  private withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SendTimeout('send_timeout')), ms)
    })
    // The loser of the race must not surface later as an unhandled rejection.
    work.catch(() => undefined)
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
  }
}
