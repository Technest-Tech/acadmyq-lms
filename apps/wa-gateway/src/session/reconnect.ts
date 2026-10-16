import { DisconnectReason } from 'baileys'

export type ReconnectAction =
  | 'reconnect-now' // immediate, no backoff (515 restartRequired, fires right after first pairing)
  | 'reconnect-backoff' // exponential backoff + full jitter (all transient failures)
  | 'reconnect-delayed' // single attempt after a long fixed delay (440 connectionReplaced)
  | 'fresh-qr' // wipe auth-state and require a new QR (500 badSession, BAD_SESSION_RETRIES in a row)
  | 'stop' // do not reconnect; needs manual re-auth (401 loggedOut / 403 forbidden)

/**
 * How many 500s in a row (no successful open in between) are retried with the creds kept before the
 * session is believed corrupt and wiped. Baileys reports 500 for ANY stream error it does not
 * recognise and for a WebSocket error without a code — on 2026-10-13 an `ack` stream error right
 * after an image send wiped a perfectly good login this way, and the number sat unpaired for days.
 */
export const BAD_SESSION_RETRIES = 3

export interface ReconnectDecision {
  action: ReconnectAction
  requiresReauth: boolean
  probableBan: boolean
  reason: string
}

/**
 * Map a Baileys disconnect status code to an action. Defaulting to `reconnect-backoff` is deliberate:
 * the uptime mandate means an unknown/transient close should self-heal, never give up. Only an
 * explicit logout/ban (401/403) stops retries; only a session that keeps failing with 500 forces a
 * re-scan. `badSessionStreak` = 500s already seen since the last successful open.
 */
export function decideReconnect(statusCode: number | undefined, badSessionStreak = 0): ReconnectDecision {
  switch (statusCode) {
    case DisconnectReason.loggedOut: // 401 — device unlinked, or the ~14-day phone-offline logout
      return { action: 'stop', requiresReauth: true, probableBan: false, reason: 'loggedOut(401)' }
    case DisconnectReason.forbidden: // 403 — almost always a ban
      return { action: 'stop', requiresReauth: true, probableBan: true, reason: 'forbidden(403)' }
    case DisconnectReason.badSession: // 500 — usually NOT corrupt creds, see BAD_SESSION_RETRIES
      if (badSessionStreak < BAD_SESSION_RETRIES) {
        return { action: 'reconnect-backoff', requiresReauth: false, probableBan: false, reason: 'badSession(500), keeping creds' }
      }
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
