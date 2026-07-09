import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { generateMessageID } from 'baileys'
import { toUserJid } from '../util/jid.js'
import { isSafePublicImageUrl } from '../util/url-guard.js'
import { makeSessionTokenGuard } from '../auth/guards.js'
import type { SessionManager } from '../session/session-manager.js'

// Backward-compatible with the Wasender text contract ({to, text}); `imageUrl`+`caption` are the
// new media path. At least one of text / imageUrl must be present.
const SendBody = z
  .object({
    to: z.string().min(1),
    text: z.string().min(1).optional(),
    imageUrl: z.string().url().optional(),
    caption: z.string().optional(),
  })
  .refine((b) => Boolean(b.text) || Boolean(b.imageUrl), { message: 'text_or_image_required' })

/**
 * The Wasender-compatible send surface (per-session bearer token). Response shapes match exactly what
 * the Laravel WasenderClient expects so the app's send path is reused unchanged.
 */
export function registerSendRoutes(app: FastifyInstance, manager: SessionManager): void {
  const guard = makeSessionTokenGuard(manager)

  // POST /api/send-message {to, text?} | {to, imageUrl, caption?} -> { data: { msgId } }
  app.post('/api/send-message', { preHandler: guard }, async (req, reply) => {
    const session = req.waSession
    if (!session) return reply.code(401).send({ error: 'invalid_token' })
    const parsed = SendBody.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ error: 'invalid_body' })
    if (session.state !== 'connected') {
      return reply.code(409).send({ error: 'not_connected', status: session.statusUpper() })
    }
    const { to, text, imageUrl, caption } = parsed.data
    // SSRF guard: Baileys fetches imageUrl server-side, so reject non-public / non-https targets.
    if (imageUrl && !(await isSafePublicImageUrl(imageUrl))) {
      return reply.code(422).send({ error: 'unsafe_image_url' })
    }
    const jid = toUserJid(to)
    const messageId = generateMessageID()
    session.enqueueSend(jid, messageId, { text, imageUrl, caption })
    return reply.code(200).send({ data: { msgId: messageId } })
  })

  // GET /api/on-whatsapp/:jid -> { exists }
  app.get('/api/on-whatsapp/:jid', { preHandler: guard }, async (req, reply) => {
    const session = req.waSession
    if (!session) return reply.code(401).send({ error: 'invalid_token' })
    const { jid } = req.params as { jid: string }
    const exists = await session.onWhatsApp(toUserJid(jid))
    return reply.send({ exists })
  })

  // GET /api/status -> { status }
  app.get('/api/status', { preHandler: guard }, async (req, reply) => {
    const session = req.waSession
    if (!session) return reply.code(401).send({ error: 'invalid_token' })
    return reply.send({ status: session.statusUpper() })
  })
}
