import type { WASocket } from 'baileys'
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

export interface SendQueueDeps {
  sessionId: string
  getSock: () => WASocket | null
  isConnected: () => boolean
  sessionCreatedAt: number
  /** Read the CURRENT pacing each time — lets admin rate-limit changes apply live. */
  getPacing: () => SendPacingConfig
  logger: Logger
  /** Called when an item permanently fails to send (after it left the queue). */
  onFailure: (messageId: string, jid: string, error: string) => void
  /** Mark the session as alive (resets the stale-connection watchdog). */
  touch: () => void
}

export interface SendPayload {
  text?: string
  imageUrl?: string
  caption?: string
}

interface QueueItem {
  jid: string
  messageId: string
  payload: SendPayload
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Per-session, serial outbound queue. This is the anti-ban layer: randomized human-like gaps between
 * sends, daily caps, a slower "warm-up" profile for newly-paired numbers, and typing-presence
 * simulation. Bans are the dominant real-world cause of "disconnects", so this matters as much as
 * the reconnection logic. Idempotency is handled Laravel-side (dedupe_key), so enqueue is
 * fire-and-forget; the route returns the pre-generated messageId immediately.
 */
export class SendQueue {
  private items: QueueItem[] = []
  private running = false
  private sentToday = 0
  private dayKey = ''
  private lastSentAt = 0

  constructor(private readonly deps: SendQueueDeps) {}

  get depth(): number {
    return this.items.length
  }

  get sentTodayCount(): number {
    return this.sentToday
  }

  enqueue(jid: string, messageId: string, payload: SendPayload): void {
    this.items.push({ jid, messageId, payload })
    void this.drain()
  }

  /** Resume draining (e.g. after a reconnect re-establishes the socket). */
  resume(): void {
    void this.drain()
  }

  /** Drop all queued items (e.g. on logout); returns how many were discarded. */
  clear(): number {
    const n = this.items.length
    this.items = []
    return n
  }

  private pacing(): { min: number; max: number; cap: number } {
    const cfg = this.deps.getPacing()
    const ageDays = (Date.now() - this.deps.sessionCreatedAt) / 86_400_000
    const warming = ageDays < cfg.warmupDays
    return warming
      ? { min: cfg.warmupMinIntervalMs, max: cfg.warmupMaxIntervalMs, cap: cfg.warmupDailyCap }
      : { min: cfg.minIntervalMs, max: cfg.maxIntervalMs, cap: cfg.dailyCap }
  }

  private rollDay(): void {
    const today = new Date().toISOString().slice(0, 10)
    if (today !== this.dayKey) {
      this.dayKey = today
      this.sentToday = 0
    }
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.items.length) {
        // Socket not ready → leave items queued; drain resumes on enqueue() or resume().
        if (!this.deps.isConnected()) break

        this.rollDay()
        const { min, max, cap } = this.pacing()
        if (this.sentToday >= cap) {
          this.deps.logger.warn({ sessionId: this.deps.sessionId, cap }, 'daily send cap reached; deferring')
          break
        }

        // Enforce the randomized minimum gap between consecutive sends.
        const targetGap = Math.floor(min + Math.random() * Math.max(0, max - min))
        const sinceLast = Date.now() - this.lastSentAt
        if (this.lastSentAt && sinceLast < targetGap) {
          await sleep(targetGap - sinceLast)
          continue // re-check connection + cap after waiting
        }

        const item = this.items[0]
        if (!item) break
        const sock = this.deps.getSock()
        if (!sock) break

        try {
          // Typing presence makes automated sends look less robotic. Length drives the delay; for
          // image sends the caption (or a small default) stands in for the text length.
          const typingLen = (item.payload.text ?? item.payload.caption ?? '').length || 8
          try {
            await sock.sendPresenceUpdate('composing', item.jid)
            await sleep(Math.min(3_000, 400 + typingLen * 30))
            await sock.sendPresenceUpdate('paused', item.jid)
          } catch {
            /* presence is best-effort */
          }
          const content = item.payload.imageUrl
            ? { image: { url: item.payload.imageUrl }, caption: item.payload.caption }
            : { text: item.payload.text ?? '' }
          await sock.sendMessage(item.jid, content, { messageId: item.messageId })
          this.items.shift()
          this.sentToday += 1
          this.lastSentAt = Date.now()
          this.deps.touch()
          this.deps.logger.info({ sessionId: this.deps.sessionId, messageId: item.messageId }, 'message sent')
        } catch (e) {
          this.items.shift()
          const msg = e instanceof Error ? e.message : 'send_failed'
          this.deps.logger.error(
            { sessionId: this.deps.sessionId, messageId: item.messageId, err: msg },
            'message send failed',
          )
          this.deps.onFailure(item.messageId, item.jid, msg)
        }
      }
    } finally {
      this.running = false
    }
  }
}
