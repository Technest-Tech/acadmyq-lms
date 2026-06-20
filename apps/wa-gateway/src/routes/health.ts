import type { FastifyInstance } from 'fastify'
import { makeAdminGuard } from '../auth/guards.js'
import type { SessionManager } from '../session/session-manager.js'
import type { AppConfig } from '../config.js'

export function registerHealthRoutes(app: FastifyInstance, manager: SessionManager, config: AppConfig): void {
  // Unauthenticated (private-bound) liveness probe for uptime monitors + deploy smoke tests.
  app.get('/health', async (_req, reply) => {
    return reply.send({ ok: true, uptime: process.uptime(), sessions: manager.stats() })
  })

  // Per-session metrics (admin-authenticated).
  app.get('/metrics', { preHandler: makeAdminGuard(config) }, async (_req, reply) => {
    return reply.send({ sessions: manager.all().map((s) => s.view()) })
  })
}
