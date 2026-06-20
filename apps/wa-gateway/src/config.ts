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

  // Baileys keep-alive ping interval.
  KEEPALIVE_MS: z.coerce.number().int().positive().default(10_000),

  // ── Anti-ban send pacing (per session) ───────────────────────────────────
  SEND_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(6_000),
  SEND_MAX_INTERVAL_MS: z.coerce.number().int().nonnegative().default(15_000),
  SEND_DAILY_CAP: z.coerce.number().int().positive().default(500),
  // A freshly-paired number sends slower/less for the first WARMUP_DAYS to avoid spam flags.
  WARMUP_DAYS: z.coerce.number().int().nonnegative().default(3),
  WARMUP_DAILY_CAP: z.coerce.number().int().positive().default(40),
  WARMUP_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(20_000),
  WARMUP_MAX_INTERVAL_MS: z.coerce.number().int().nonnegative().default(45_000),

  // ── Reconnection / health ────────────────────────────────────────────────
  RECONNECT_BASE_MS: z.coerce.number().int().positive().default(1_000),
  RECONNECT_CAP_MS: z.coerce.number().int().positive().default(60_000),
  WATCHDOG_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  WATCHDOG_STALE_MS: z.coerce.number().int().positive().default(90_000),
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
