import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/** High-entropy, URL-safe token used as a per-session bearer secret. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** Constant-time string comparison (avoids timing oracles on secret checks). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
