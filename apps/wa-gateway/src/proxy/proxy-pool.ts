import type { Agent } from 'node:https'
import type { Pool } from 'pg'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import type { Logger } from '../logger.js'

/** One proxy from PROXY_URLS. */
export interface ProxyEntry {
  /** Stable identity (user@host:port, no password), so rotating a password keeps every assignment. */
  key: string
  /** host:port — what the status view and the log show. Never the credentials. */
  label: string
  url: string
}

const SCHEMES = new Set(['http:', 'https:', 'socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'])

/** Parse PROXY_URLS (comma or whitespace separated). Throws on anything that is not a usable proxy URL. */
export function parseProxyUrls(raw: string): ProxyEntry[] {
  const entries: ProxyEntry[] = []
  for (const part of raw.split(/[\s,]+/).filter(Boolean)) {
    let url: URL
    try {
      url = new URL(part)
    } catch {
      throw new Error('PROXY_URLS: not a URL (entry ' + (entries.length + 1) + ')')
    }
    if (!SCHEMES.has(url.protocol)) throw new Error(`PROXY_URLS: unsupported scheme ${url.protocol}`)
    if (!url.hostname || !url.port) throw new Error('PROXY_URLS: every proxy needs a host and a port')
    const label = `${url.hostname}:${url.port}`
    const key = url.username ? `${decodeURIComponent(url.username)}@${label}` : label
    if (entries.some((e) => e.key === key)) throw new Error(`PROXY_URLS: ${label} is listed twice`)
    entries.push({ key, label, url: part })
  }
  return entries
}

/**
 * Gives each academy its own way out to WhatsApp. Without it every number dials from the one
 * datacenter address of this server — dozens of unrelated accounts behind a single hosting IP is
 * the pattern WhatsApp bans in one sweep.
 *
 * The assignment is STICKY and belongs to the academy, not the session: a number that hops between
 * addresses looks worse than one that sits on a datacenter IP, so an academy keeps its proxy across
 * reconnects, restarts and re-scans. A new academy gets the least-loaded proxy. An academy whose
 * proxy was taken out of PROXY_URLS is moved to another one the next time it dials.
 *
 * There is no fallback to a direct connection: when a proxy is down its numbers stay down (and the
 * long-outage alert fires) rather than quietly reappear on the server's own address.
 *
 * With PROXY_URLS empty the pool is off and every socket dials directly, exactly as before.
 */
export class ProxyPool {
  private readonly agents = new Map<string, Agent>()
  private readonly assigned = new Map<string, string>()
  // Assignments are made one at a time, or twenty sessions booting together would all read the
  // same counts and pile onto the same proxy.
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly pool: Pool,
    private readonly entries: ProxyEntry[],
    private readonly logger: Logger,
  ) {}

  get enabled(): boolean {
    return this.entries.length > 0
  }

  /** host:port of the proxy this academy last dialled through, for the status view. */
  labelFor(academyId: string): string | null {
    const key = this.assigned.get(academyId)
    return this.entries.find((e) => e.key === key)?.label ?? null
  }

  /** The agent this academy's socket must dial through, or null when the pool is off. */
  async agentFor(academyId: string): Promise<Agent | null> {
    if (!this.enabled) return null
    const run = this.chain.then(() => this.assign(academyId))
    this.chain = run.catch(() => undefined)
    const entry = await run
    let agent = this.agents.get(entry.key)
    if (!agent) {
      agent = /^socks/.test(new URL(entry.url).protocol) ? new SocksProxyAgent(entry.url) : new HttpsProxyAgent(entry.url)
      this.agents.set(entry.key, agent)
    }
    return agent
  }

  private async assign(academyId: string): Promise<ProxyEntry> {
    const known = this.entries.find((e) => e.key === this.assigned.get(academyId))
    if (known) return known

    const row = await this.pool.query('select proxy_key from wa_proxy_assignments where academy_id = $1', [academyId])
    const kept = this.entries.find((e) => e.key === row.rows[0]?.proxy_key)
    if (kept) {
      this.assigned.set(academyId, kept.key)
      return kept
    }

    const load = await this.pool.query(
      'select proxy_key, count(*)::int as n from wa_proxy_assignments where proxy_key = any($1) and academy_id <> $2 group by proxy_key',
      [this.entries.map((e) => e.key), academyId],
    )
    const counts = new Map<string, number>(load.rows.map((r) => [r.proxy_key as string, Number(r.n)]))
    // Least loaded; the order of PROXY_URLS breaks a tie.
    let pick = this.entries[0]!
    for (const e of this.entries) {
      if ((counts.get(e.key) ?? 0) < (counts.get(pick.key) ?? 0)) pick = e
    }
    await this.pool.query(
      `insert into wa_proxy_assignments (academy_id, proxy_key) values ($1, $2)
       on conflict (academy_id) do update set proxy_key = excluded.proxy_key, assigned_at = now()`,
      [academyId, pick.key],
    )
    this.assigned.set(academyId, pick.key)
    this.logger.info(
      { academyId, proxy: pick.label, moved: Boolean(row.rows[0]) },
      row.rows[0] ? 'academy moved to another proxy (its old one left PROXY_URLS)' : 'academy assigned a proxy',
    )
    return pick
  }
}
