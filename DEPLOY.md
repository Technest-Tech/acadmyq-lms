# Deployment (⚠️ OBSOLETE — see `DEPLOYMENT.md`)

> **This plan is superseded and kept only for historical context.** We self-host everything on **Contabo**
> now. The live runbooks are [`DEPLOYMENT.md`](DEPLOYMENT.md) (app: Laravel + Next.js + Postgres on
> Contabo Server 1) and [`docs/video-platform/07-DEPLOYMENT.md`](docs/video-platform/07-DEPLOYMENT.md)
> (media: LiveKit + coturn on Contabo Server 2). DNS is on Cloudflare. Do **not** follow the
> Railway/Vercel/Supabase steps below.

Two independently-deployed apps from one repo: **Railway** runs `apps/api` (Laravel),
**Vercel** runs `apps/web` (Next.js), **Supabase** hosts PostgreSQL (DB-only).

---

## Sanctum cross-domain auth strategy (decided in Sprint 0)

Sanctum SPA **cookie** auth requires the frontend and API to share a **registrable parent
domain**. The default `*.vercel.app` / `*.up.railway.app` hosts are *different* registrable
domains, so the session cookie is third-party and modern browsers block it → login silently
fails. This must be solved before Sprint 2 wires real login.

**Primary (recommended): cookie auth on shared subdomains.**

| App | Domain | Key env |
|---|---|---|
| Web (Vercel) | `app.academiq.com` | `NEXT_PUBLIC_API_URL=https://api.academiq.com`, `NEXT_PUBLIC_AUTH_MODE=cookie` |
| API (Railway) | `api.academiq.com` | `SESSION_DOMAIN=.academiq.com`, `SANCTUM_STATEFUL_DOMAINS=app.academiq.com`, `FRONTEND_URL=https://app.academiq.com` |

**Fallback: token auth.** If a shared parent domain isn't available, set
`NEXT_PUBLIC_AUTH_MODE=token` on the web app. `lib/api.ts` then sends a bearer
`Authorization` header instead of relying on the cookie — **no contract rewrite needed**.
Sprint 2 wires the token issue/store.

---

## API → Railway (`apps/api`)

1. New Railway service from this repo; **Root Directory = `apps/api`**.
2. Required environment variables:
   ```
   APP_KEY=base64:...        # generate locally: php artisan key:generate --show
   APP_ENV=production
   APP_DEBUG=false
   APP_URL=https://api.academiq.com
   DB_CONNECTION=pgsql
   DB_URL=postgresql://postgres:[PW]@db.[REF].supabase.co:5432/postgres?sslmode=require
   FRONTEND_URL=https://app.academiq.com
   SANCTUM_STATEFUL_DOMAINS=app.academiq.com
   SESSION_DOMAIN=.academiq.com
   SESSION_SECURE_COOKIE=true
   ```
   > `APP_KEY` MUST be set on Railway — `key:generate` only ran in the local checkout, so
   > the deploy fails to boot without it.
   > Use Supabase's **session-mode** pooler (port 5432) or the direct connection — **not**
   > the transaction-mode pooler (6543); Sprint 1's RLS GUCs need a session-scoped transaction.
3. Recommended start command (after nixpacks installs PHP + Composer):
   ```
   php artisan config:cache && php artisan migrate --force && php -S 0.0.0.0:$PORT -t public
   ```
4. Verify: `GET https://api.academiq.com/api/health` → `{ "app": "ok", "db": "ok", ... }`.

## Web → Vercel (`apps/web`)

1. Import the repo; **Root Directory = `apps/web`**. Framework preset: Next.js.
   (Vercel honors the pnpm workspace and builds `packages/contracts` via `transpilePackages`.)
2. Environment variables:
   ```
   NEXT_PUBLIC_API_URL=https://api.academiq.com
   NEXT_PUBLIC_AUTH_MODE=cookie
   ```
3. Add the custom domain `app.academiq.com`.

---

## Sprint 0 acceptance status on real infra

`AC-0.1` (both deploy), `TC-0.19` (deploy smoke `GET /api/health` 200), and `TC-0.20`
(deployed browser cross-origin credentialed call) require live Railway/Vercel projects on
the shared domains above. The app code, CORS, and `lib/api.ts` credential path are in place;
run these checks once the deploys + custom domains exist, before relying on cookie auth in Sprint 2.
