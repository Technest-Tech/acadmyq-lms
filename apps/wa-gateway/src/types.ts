export type SessionState = 'qr' | 'connecting' | 'connected' | 'disconnected' | 'logged_out'

/** Public, token-free view of a session for the admin/metrics endpoints. */
export interface SessionStatusView {
  sessionId: string
  academyId: string
  state: SessionState
  phoneJid: string | null
  lastConnectedAt: string | null
  lastSeenAt: string | null
  queueDepth: number
  reconnectAttempts: number
  /** Set while the anti-ban brake is holding this number's queue. */
  pausedUntil: string | null
  pausedReason: string | null
  /** host:port of the proxy this number dials through; null when it dials directly. */
  proxy: string | null
}
