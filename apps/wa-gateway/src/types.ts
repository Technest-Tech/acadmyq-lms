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
}
