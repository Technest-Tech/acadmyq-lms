import { DisconnectReason } from 'baileys'

export type ReconnectAction =
  | 'reconnect-now' // immediate, no backoff (515 restartRequired, fires right after first pairing)
  | 'reconnect-backoff' // exponential backoff + full jitter (all transient failures)
  | 'reconnect-delayed' // single attempt after a long fixed delay (440 connectionReplaced)
  | 'fresh-qr' // wipe auth-state and require a new QR (500 badSession)
  | 'stop' // do not reconnect; needs manual re-auth (401 loggedOut / 403 forbidden)

export interface ReconnectDecision {
  action: ReconnectAction
  requiresReauth: boolean
  probableBan: boolean
  reason: string
}

/**
 * Map a Baileys disconnect status code to an action. Defaulting to `reconnect-backoff` is deliberate:
 * the uptime mandate means an unknown/transient close should self-heal, never give up. Only an
 * explicit logout/ban (401/403) stops retries; only a corrupt session (500) forces a re-scan.
 */
export function decideReconnect(statusCode: number | undefined): ReconnectDecision {
  switch (statusCode) {
    case DisconnectReason.loggedOut: // 401 — device unlinked, or the ~14-day phone-offline logout
      return { action: 'stop', requiresReauth: true, probableBan: false, reason: 'loggedOut(401)' }
    case DisconnectReason.forbidden: // 403 — almost always a ban
      return { action: 'stop', requiresReauth: true, probableBan: true, reason: 'forbidden(403)' }
    case DisconnectReason.badSession: // 500 — credentials corrupted
      return { action: 'fresh-qr', requiresReauth: true, probableBan: false, reason: 'badSession(500)' }
    case DisconnectReason.connectionReplaced: // 440 — another process took the session
      return { action: 'reconnect-delayed', requiresReauth: false, probableBan: false, reason: 'connectionReplaced(440)' }
    case DisconnectReason.restartRequired: // 515 — normal post-pairing handshake
      return { action: 'reconnect-now', requiresReauth: false, probableBan: false, reason: 'restartRequired(515)' }
    default: // 408 connectionLost/timedOut, 428 connectionClosed, 503, 411, unknown…
      return { action: 'reconnect-backoff', requiresReauth: false, probableBan: false, reason: `transient(${statusCode ?? 'none'})` }
  }
}

/** Exponential backoff with full jitter, capped. */
export function backoffDelay(attempt: number, baseMs: number, capMs: number): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt)
  return Math.random() * exp
}
