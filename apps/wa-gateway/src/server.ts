import Fastify from 'fastify'
import { loadConfig } from './config.js'
import { logger, REDACT_PATHS } from './logger.js'
import { pool } from './db/pool.js'
import { WebhookClient } from './webhook/webhook-client.js'
import { SessionManager } from './session/session-manager.js'
import { registerSendRoutes } from './routes/send.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerHealthRoutes } from './routes/health.js'

async function main(): Promise<void> {
  const config = loadConfig()

  // Configure Fastify's own request logger from the same options (keeps `app` the default
  // FastifyInstance type so route-registration helpers stay compatible).
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      ...(config.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } }
        : {}),
    },
    trustProxy: true,
    bodyLimit: 1_048_576,
  })

  const webhook = new WebhookClient(config.LARAVEL_WEBHOOK_URL, config.WEBHOOK_SIGNING_SECRET, logger)
  const manager = new SessionManager(pool, config, webhook, logger)

  registerSendRoutes(app, manager)
  registerAdminRoutes(app, manager, config)
  registerHealthRoutes(app, manager, config)

  // Fail fast if the DB is unreachable, then apply schema + rehydrate sessions.
  await pool.query('select 1')
  await manager.bootstrap()

  // Periodic webhook outbox flush (retries failed deliveries to Laravel).
  const outboxTimer = setInterval(() => void webhook.flushOutbox(), 60_000)
  outboxTimer.unref?.()

  await app.listen({ host: config.BIND_ADDR, port: config.PORT })
  logger.info({ host: config.BIND_ADDR, port: config.PORT }, 'wa-gateway listening')

  // Global safety nets — survive stray rejections; only a true uncaught exception warrants exit
  // (systemd restarts; creds are safe in Postgres so sessions reconnect silently).
  process.on('unhandledRejection', (e) =>
    logger.error({ err: e instanceof Error ? e.message : String(e) }, 'unhandledRejection'),
  )
  process.on('uncaughtException', (e) => {
    logger.fatal({ err: e instanceof Error ? e.stack : String(e) }, 'uncaughtException')
    process.exit(1)
  })

  let shuttingDown = false
  const shutdown = async (sig: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ sig }, 'shutting down (sockets closed, NOT logged out)')
    clearInterval(outboxTimer)
    manager.shutdown()
    try {
      await app.close()
    } catch {
      /* ignore */
    }
    try {
      await pool.end()
    } catch {
      /* ignore */
    }
    setTimeout(() => process.exit(0), 500).unref?.()
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((e: unknown) => {
  logger.fatal({ err: e instanceof Error ? e.stack : String(e) }, 'fatal startup error')
  process.exit(1)
})
