import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * SSRF guard for client-supplied image URLs. Baileys downloads the URL server-side (on the gateway
 * droplet, which sits on the private VPC), so an unvalidated URL is a server-side request forgery
 * vector — a client could point it at gateway-local services or VPC-internal hosts. We therefore
 * require https and reject any hostname that resolves to a private / loopback / link-local / reserved
 * address (resolving ALL addresses to blunt DNS-rebinding).
 */

const MAX_URL_LENGTH = 2048

function ipv4IsPrivate(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true
  const [a, b] = parts as [number, number, number, number]
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // 10.0.0.0/8 private
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) return true // 192.0.0.0/24 + 192.0.2.0/24 reserved/TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51) return true // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0) return true // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + broadcast
  return false
}

function ipv6IsPrivate(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0] ?? '' // strip any zone id
  if (addr === '::1' || addr === '::') return true // loopback / unspecified
  // IPv4-mapped (::ffff:a.b.c.d) — check the embedded v4 address.
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped?.[1]) return ipv4IsPrivate(mapped[1])
  if (addr.startsWith('fe8') || addr.startsWith('fe9') || addr.startsWith('fea') || addr.startsWith('feb')) {
    return true // fe80::/10 link-local
  }
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true // fc00::/7 unique-local
  if (addr.startsWith('2001:db8')) return true // documentation
  if (addr.startsWith('ff')) return true // ff00::/8 multicast
  return false
}

function ipIsPrivate(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return ipv4IsPrivate(ip)
  if (family === 6) return ipv6IsPrivate(ip)
  return true // not a recognizable IP → fail closed
}

/**
 * True only when `raw` is an https URL whose host resolves exclusively to public IP addresses.
 * Fails closed on any parse/resolution error.
 */
export async function isSafePublicImageUrl(raw: string): Promise<boolean> {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH) return false

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false // no embedded credentials

  const host = url.hostname
  if (!host) return false

  // Host is an IP literal → check directly (no DNS to trust).
  if (isIP(host)) return !ipIsPrivate(host)

  // Reject obvious internal names outright before resolving.
  const lower = host.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) {
    return false
  }

  try {
    const records = await lookup(host, { all: true })
    if (records.length === 0) return false
    return records.every((r) => !ipIsPrivate(r.address))
  } catch {
    return false
  }
}
