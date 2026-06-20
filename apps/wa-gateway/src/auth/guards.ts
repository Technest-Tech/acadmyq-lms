import type { FastifyReply, FastifyRequest } from 'fastify'
import { constantTimeEqual } from '../util/crypto.js'
import type { SessionManager } from '../session/session-manager.js'
import type { ManagedSession } from '../session/managed-session.js'
import type { AppConfig } from '../config.js'

declare module 'fastify' {
  interface FastifyRequest {
    waSession?: ManagedSession
  }
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization
  if (!h) return null
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m?.[1]?.trim() ?? null
}

/** Per-session auth (send surface): `Authorization: Bearer <minted session token>`. */
export function makeSessionTokenGuard(manager: SessionManager) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = bearer(req)
    if (!token) {
      await reply.code(401).send({ error: 'missing_token' })
      return
    }
    const session = manager.getByToken(token)
    if (!session) {
      await reply.code(401).send({ error: 'invalid_token' })
      return
    }
    req.waSession = session
  }
}

/** Super-Admin auth (lifecycle surface): `X-Gateway-Admin: <gateway admin secret>`. */
export function makeAdminGuard(config: AppConfig) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const provided = (req.headers['x-gateway-admin'] as string | undefined)?.trim() ?? ''
    if (!provided || !constantTimeEqual(provided, config.GATEWAY_ADMIN_SECRET)) {
      await reply.code(401).send({ error: 'unauthorized' })
    }
  }
}
