# @academiq/wa-gateway

Self-hosted WhatsApp gateway built on [Baileys](https://github.com/WhiskeySockets/Baileys). Replaces
the paid Wasender SaaS: holds one WhatsApp socket per academy, exposes a send API that is **drop-in
compatible** with the Laravel `WasenderClient`, and manages the QR pairing / reconnection lifecycle.

Runs as a standalone Node.js service on its **own droplet** (separate from the Laravel/Next app),
reachable only over the DigitalOcean VPC private network.

## Architecture

- **Routing key:** `bearer token → sha256 → session → live Baileys socket`.
- **Auth-state in Postgres** (`wa_sessions` + `wa_signal_keys`) so a restart/crash/redeploy reconnects
  **without re-scanning the QR**.
- **Reconnection decision table** (`src/session/reconnect.ts`): transient closes auto-reconnect with
  jittered backoff forever; only `loggedOut` (401) / `forbidden` (403) stop and require a re-scan;
  `badSession` (500) wipes creds → fresh QR.
- **Per-session send queue** (`src/queue/send-queue.ts`): rate-limit + jitter + daily caps + warm-up +
  typing presence — the anti-ban layer.
- **Signed webhooks** back to Laravel (`qr.generated`, `connection.update`, `message.status`,
  `message.inbound`) with an outbox for guaranteed delivery.

## Endpoints

Send surface — `Authorization: Bearer <session token>` (what `WasenderClient` calls):

| Method | Path | Response |
|---|---|---|
| POST | `/api/send-message` `{to,text}` | `{ data: { msgId } }` |
| GET | `/api/on-whatsapp/:jid` | `{ exists }` |
| GET | `/api/status` | `{ status }` |

Lifecycle surface — `X-Gateway-Admin: <GATEWAY_ADMIN_SECRET>` (Super Admin):

| Method | Path | Response |
|---|---|---|
| POST | `/sessions` `{academyId}` | `{ sessionId, token }` (token returned once) |
| GET | `/sessions/:id/qr` | `{ state, qr? }` |
| GET | `/sessions/:id/status` | `SessionStatusView` |
| DELETE | `/sessions/:id` | `{ ok }` (logout + remove) |
| GET | `/sessions` | `{ sessions: [...] }` |
| GET | `/health` | `{ ok, uptime, sessions }` (no auth) |
| GET | `/metrics` | `{ sessions }` (admin) |

## Local development

```bash
cp .env.example .env            # set DATABASE_URL + secrets
pnpm install                    # from repo root (workspace)
pnpm --filter @academiq/wa-gateway migrate:dev   # create tables
pnpm --filter @academiq/wa-gateway dev           # watch mode
```

## Production (gateway droplet)

```bash
pnpm install --frozen-lockfile --filter @academiq/wa-gateway...
pnpm --filter @academiq/wa-gateway build
pnpm --filter @academiq/wa-gateway migrate       # node dist/migrate.js
node dist/server.js                              # via systemd (see deploy/systemd/wa-gateway.service)
```

## Reliability note

~99% uptime is achievable on the **controllable** layer (process supervision, durable auth-state,
auto-reconnect). WhatsApp-side **forced logouts and bans cannot be prevented** by any unofficial
library — they are surfaced immediately via the `connection.update`/`logged_out` webhook so an admin
can re-scan. See `docs/` and the project plan for the full framing.
