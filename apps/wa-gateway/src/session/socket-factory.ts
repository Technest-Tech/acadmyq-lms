import makeWASocket, {
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type AuthenticationState,
  type CacheStore,
  type GroupMetadata,
  type proto,
  type WASocket,
} from 'baileys'
import type { Agent } from 'node:https'
import type { Logger } from '../logger.js'

type WAVersion = [number, number, number]

let cachedVersion: WAVersion | undefined
let versionFetchedAt = 0
const VERSION_TTL_MS = 6 * 3_600_000
const VERSION_FETCH_TIMEOUT_MS = 5_000
const VERSION_RETRY_MS = 10 * 60_000

/** Cache the WhatsApp web version so we don't hit the version endpoint on every (re)connect. */
async function getVersion(logger: Logger): Promise<WAVersion | undefined> {
  const now = Date.now()
  if (cachedVersion && now - versionFetchedAt < VERSION_TTL_MS) return cachedVersion
  // Whatever the outcome, do not ask again for a while: a slow or unreachable version endpoint must
  // not add its timeout to every reconnect of every session.
  versionFetchedAt = now
  try {
    // The timeout matters: this request has none by default, and a hung one froze the session in
    // `starting` for good — the watchdog skips a session that is still starting.
    const { version, isLatest } = await fetchLatestBaileysVersion({ timeout: VERSION_FETCH_TIMEOUT_MS })
    if (isLatest) cachedVersion = version
    else {
      versionFetchedAt = now - VERSION_TTL_MS + VERSION_RETRY_MS
      logger.warn('fetchLatestBaileysVersion failed; using the last known / bundled version')
    }
  } catch (e) {
    versionFetchedAt = now - VERSION_TTL_MS + VERSION_RETRY_MS
    logger.warn(
      { err: e instanceof Error ? e.message : String(e) },
      'fetchLatestBaileysVersion failed; using the last known / bundled version',
    )
  }
  return cachedVersion
}

/** What a session keeps across its sockets and hands to each new one. */
export interface SocketStores {
  /** A message we sent, by id — WhatsApp asks for it again when a recipient's phone could not decrypt it. */
  getMessage: (key: proto.IMessageKey) => Promise<proto.IMessage | undefined>
  /** Group membership we already know, so a group send does not query WhatsApp every time. */
  cachedGroupMetadata: (jid: string) => Promise<GroupMetadata | undefined>
  /** Retry counters, kept across reconnects so a message is not retried forever. */
  msgRetryCounterCache: CacheStore
}

/**
 * Construct a Baileys socket for one session. `markOnlineOnConnect:false` keeps the linked phone
 * receiving notifications and the session looking less bot-like. Caller binds events + persistence.
 */
export async function createSocket(
  state: AuthenticationState,
  logger: Logger,
  keepAliveIntervalMs: number,
  baileysLogLevel: string = 'warn',
  stores?: SocketStores,
  /** The academy's proxy, when the gateway runs with a proxy pool; null/undefined dials directly. */
  agent?: Agent | null,
): Promise<WASocket> {
  const version = await getVersion(logger)
  const baileysLogger = logger.child({ module: 'baileys' }, { level: baileysLogLevel })
  return makeWASocket({
    ...(version ? { version } : {}),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    logger: baileysLogger,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    keepAliveIntervalMs,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    retryRequestDelayMs: 2_000,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    ...(stores ?? {}),
    // Media goes out the same way as the socket: an upload from another address than the session's
    // own would give the proxy away.
    ...(agent ? { agent, fetchAgent: agent } : {}),
  })
}
