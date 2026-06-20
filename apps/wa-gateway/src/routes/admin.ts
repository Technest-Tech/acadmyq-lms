import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { makeAdminGuard } from '../auth/guards.js'
import type { SessionManager } from '../session/session-manager.js'
import type { AppConfig } from '../config.js'

const CreateBody = z.object({ academyId: z.string().min(1) })

/**
 * Super-Admin session lifecycle (authenticated by the gateway admin secret). These are the endpoints
 * the old Wasender dashboard used to provide; Laravel calls them to connect/inspect/logout sessions.
 */
export function registerAdminRoutes(app: FastifyInstance, manager: SessionManager, config: AppConfig): void {
  const guard = makeAdminGuard(config)

  // POST /sessions {academyId} -> { sessionId, token }  (token returned once; Laravel encrypts it)
  app.post('/sessions', { preHandler: guard }, async (req, reply) => {
    const parsed = CreateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ error: 'invalid_body' })
    const { sessionId, token } = await manager.create(parsed.data.academyId)
    return reply.code(201).send({ sessionId, token })
  })

  // GET /sessions/:id/qr -> { state, qr? }
  app.get('/sessions/:id/qr', { preHandler: guard }, async (req, reply) => {
    const s = manager.getById((req.params as { id: string }).id)
    if (!s) return reply.code(404).send({ error: 'not_found' })
    if (s.state === 'connected') return reply.send({ state: 'connected' })
    return reply.send({ state: s.state, qr: s.qrDataUrl })
  })

  // GET /sessions/:id/status -> SessionStatusView
  app.get('/sessions/:id/status', { preHandler: guard }, async (req, reply) => {
    const s = manager.getById((req.params as { id: string }).id)
    if (!s) return reply.code(404).send({ error: 'not_found' })
    return reply.send(s.view())
  })

  // DELETE /sessions/:id -> { ok }  (logout + remove)
  app.delete('/sessions/:id', { preHandler: guard }, async (req, reply) => {
    const s = manager.getById((req.params as { id: string }).id)
    if (!s) return reply.code(404).send({ error: 'not_found' })
    await manager.remove(s.sessionId)
    return reply.send({ ok: true })
  })

  // GET /sessions -> { sessions: [...] }
  app.get('/sessions', { preHandler: guard }, async (_req, reply) => {
    return reply.send({ sessions: manager.all().map((s) => s.view()) })
  })
}
