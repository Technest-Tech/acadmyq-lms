import { z } from 'zod'

/**
 * Environment configuration for the WhatsApp gateway. Parsed + validated once at startup; a missing
 * or malformed required value aborts the process with a readable error rather than failing later in
 * a half-started state.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8088),
  // Bind to the VPC private interface in production so the gateway is never publicly reachable.
  BIND_ADDR: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Global secret authorising the Super-Admin lifecycle endpoints (/sessions*).
  GATEWAY_ADMIN_SECRET: z.string().min(16, 'GATEWAY_ADMIN_SECRET must be >= 16 chars'),
  // HMAC secret for signing webhooks sent back to Laravel.
  WEBHOOK_SIGNING_SECRET: z.string().min(16, 'WEBHOOK_SIGNING_SECRET must be >= 16 chars'),
  // Where to POST connection/QR/message webhooks (Laravel). Optional so the gateway can run headless.
  LARAVEL_WEBHOOK_URL: z.string().min(1).optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Baileys' own logger, kept at warn so the log stays readable. `trace` prints every frame to and
  // from WhatsApp (XML) — the only way to see what the servers actually answered when a query
  // "succeeds" with nothing in it. Turn it on for a diagnosis, never leave it on.
  BAILEYS_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('warn'),

  // One proxy per academy, so the numbers do not all dial WhatsApp from this server's one address.
  // Comma-separated http://user:pass@host:port or socks5://user:pass@host:port; each academy is
  // pinned to one of them (see proxy-pool.ts). Empty = every socket dials directly. Use STATIC
  // addresses only — a rotating proxy changes a number's address mid-session, which is worse than
  // no proxy at all.
  PROXY_URLS: z.string().default(''),

  // Baileys keep-alive ping interval. Baileys drops the socket when nothing arrives for this + 5s, so
  // 10s meant any 15s network hiccup tore a healthy session down; WhatsApp Web itself pings ~25s.
  KEEPALIVE_MS: z.coerce.number().int().positive().default(25_000),

  // ── Anti-ban send pacing (per session) ───────────────────────────────────
  SEND_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(6_000),
  SEND_MAX_INTERVAL_MS: z.coerce.number().int().nonnegative().default(15_000),
  SEND_DAILY_CAP: z.coerce.number().int().positive().default(500),
  // A freshly-paired number sends slower/less for the first WARMUP_DAYS to avoid spam flags.
  WARMUP_DAYS: z.coerce.number().int().nonnegative().default(3),
  WARMUP_DAILY_CAP: z.coerce.number().int().positive().default(40),
  WARMUP_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(20_000),
  WARMUP_MAX_INTERVAL_MS: z.coerce.number().int().nonnegative().default(45_000),
  // After the warm-up days the cap and the gaps climb to the full profile over this many days
  // instead of jumping (40 a day → 500 a day overnight is exactly what a spam filter looks for).
  RAMP_DAYS: z.coerce.number().int().nonnegative().default(11),
  // A person does not send 300 messages in a row: after every BURST_MIN..BURST_MAX messages the
  // queue rests REST_MIN_MS..REST_MAX_MS.
  BURST_MIN: z.coerce.number().int().positive().default(15),
  BURST_MAX: z.coerce.number().int().positive().default(30),
  REST_MIN_MS: z.coerce.number().int().nonnegative().default(45_000),
  REST_MAX_MS: z.coerce.number().int().nonnegative().default(120_000),
  // A queued message older than this is failed ("expired") instead of going out a day late.
  QUEUE_MAX_AGE_MS: z.coerce.number().int().positive().default(12 * 3_600_000),
  // A send that has not finished in this long is failed so one hung message cannot block the queue.
  SEND_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  // Ask WhatsApp whether a number exists before the first message to it (cached). Messages to
  // numbers that are not on WhatsApp are a spam signal, and they "send" into nothing.
  CHECK_RECIPIENTS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // The brake: this many messages in a row refused by WhatsApp pauses the number's queue, because
  // pushing on while WhatsApp is refusing is how a restriction becomes a ban.
  BRAKE_ERROR_STREAK: z.coerce.number().int().positive().default(5),
  BRAKE_PAUSE_MS: z.coerce.number().int().positive().default(30 * 60_000),
  // Pause after WhatsApp answers with a restriction code (463: the account may not start new chats).
  BRAKE_RESTRICTED_PAUSE_MS: z.coerce.number().int().positive().default(6 * 3_600_000),

  // ── Reconnection / health ────────────────────────────────────────────────
  RECONNECT_BASE_MS: z.coerce.number().int().positive().default(1_000),
  RECONNECT_CAP_MS: z.coerce.number().int().positive().default(60_000),
  // A session that has failed this many dials in a row is retried at the slow cap instead — it still
  // never gives up, but it stops knocking on WhatsApp's door every 30 seconds for days.
  RECONNECT_SLOW_AFTER: z.coerce.number().int().positive().default(10),
  RECONNECT_SLOW_CAP_MS: z.coerce.number().int().positive().default(300_000),
  // An unpaired session shows QR codes for this long, then stops until someone presses Connect again.
  QR_MAX_WAIT_MS: z.coerce.number().int().positive().default(600_000),
  WATCHDOG_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  WATCHDOG_STALE_MS: z.coerce.number().int().positive().default(90_000),
  // A paired number that has been off this long is reported to the app (operator alert). Shorter
  // drops heal by themselves and are not worth a ping.
  DOWN_ALERT_MS: z.coerce.number().int().positive().default(15 * 60_000),
})

export type AppConfig = z.infer<typeof EnvSchema>

let cached: AppConfig | null = null

export function loadConfig(): AppConfig {
  if (cached) return cached
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('[wa-gateway] Invalid environment configuration:')
    for (const issue of parsed.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    }
    process.exit(1)
  }
  cached = parsed.data
  return cached
}
