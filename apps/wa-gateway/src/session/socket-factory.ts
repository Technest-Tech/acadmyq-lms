import makeWASocket, {
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type AuthenticationState,
  type WASocket,
} from 'baileys'
import type { Logger } from '../logger.js'

type WAVersion = [number, number, number]

let cachedVersion: WAVersion | undefined
let versionFetchedAt = 0
const VERSION_TTL_MS = 6 * 3_600_000

/** Cache the WhatsApp web version so we don't hit the version endpoint on every (re)connect. */
async function getVersion(logger: Logger): Promise<WAVersion | undefined> {
  const now = Date.now()
  if (cachedVersion && now - versionFetchedAt < VERSION_TTL_MS) return cachedVersion
  try {
    const { version } = await fetchLatestBaileysVersion()
    cachedVersion = version
    versionFetchedAt = now
    return version
  } catch (e) {
    logger.warn(
      { err: e instanceof Error ? e.message : String(e) },
      'fetchLatestBaileysVersion failed; using bundled default',
    )
    return cachedVersion
  }
}

/**
 * Construct a Baileys socket for one session. `markOnlineOnConnect:false` keeps the linked phone
 * receiving notifications and the session looking less bot-like. Caller binds events + persistence.
 */
export async function createSocket(
  state: AuthenticationState,
  logger: Logger,
  keepAliveIntervalMs: number,
): Promise<WASocket> {
  const version = await getVersion(logger)
  const baileysLogger = logger.child({ module: 'baileys' }, { level: 'warn' })
  return makeWASocket({
    version,
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
  })
}
