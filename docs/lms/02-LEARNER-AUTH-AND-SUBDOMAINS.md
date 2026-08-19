# 02 — Learner auth & subdomains

The learner is the one new *actor* the LMS introduces. Everything here keeps the learner strictly
separate from staff `users` and strictly scoped to one academy.

## Why a separate identity, not a `student` login

- `students` are academy-managed records under `guardians` — no credentials, no login, and their
  lifecycle is owned by staff. Bolting auth onto them would entangle two very different concerns.
- A learner **self-registers** on a public site and authenticates against a different surface than
  staff. It must be impossible for a learner token to reach a staff route or vice-versa.
- A person can be a learner at two different academies (two subdomains) with the same email — so
  learner email is unique **per academy**, not globally (`unique (academy_id, lower(email))`).

## Auth guard

Add a second Laravel auth guard, `learner`, backed by the `learners` table:

```php
// config/auth.php
'guards' => [
    'api'     => ['driver' => 'sanctum', 'provider' => 'users'],     // existing staff
    'learner' => ['driver' => 'sanctum', 'provider' => 'learners'],  // new
],
'providers' => [
    'users'    => ['driver' => 'eloquent', 'model' => App\Models\User::class],
    'learners' => ['driver' => 'eloquent', 'model' => App\Models\Learner::class],
],
```

- Learner tokens carry an ability/audience so middleware can reject a learner token on any
  `auth:api` route and a staff token on any `auth:learner` route.
- Learner routes live under a dedicated prefix (`/api/learn/*`) and a `resolve.academy` middleware
  (below) that sets the tenant context from the subdomain, **not** from the token — a learner token
  is only valid within the academy it was minted for.

## Registration & login

- **Register**: `POST /api/learn/auth/register` `{ full_name, email, password, phone? }` in the
  subdomain's academy context → creates a `learners` row (status ACTIVE), issues a token. Optional
  email verification (magic link) can gate first redemption; not required for MVP.
- **Login**: `POST /api/learn/auth/login` `{ email, password }` → token scoped to the academy.
- **Me**: `GET /api/learn/me` → learner profile + enrolled course ids.
- Password reset by emailed token, same as staff but on the `learners` provider.

Rate-limit register/login per IP + per academy (public endpoints).

## Subdomain → academy resolution

The learner site is served from `<academy>.<PLATFORM_ROOT_DOMAIN>`. Two pieces resolve it:

### 1. A subdomain handle on the academy

Add `academies.lms_subdomain text unique` (nullable). Set when the Super Admin enables the LMS module
(defaulting to a slugified academy name, editable, validated `^[a-z0-9-]{3,40}$` and not in the
reserved list `www, app, api, admin, mail, …`). A NULL handle means "LMS site not published".

> Reuse vs. new column: if the academy already carries a global slug/handle we can reuse it, but a
> dedicated `lms_subdomain` avoids coupling the public course URL to anything else and lets an academy
> pick a marketing-friendly handle. Prefer the dedicated column.

### 2. Next.js middleware

`apps/web/src/middleware.ts` inspects the `Host` header:

- Host = `app.<root>` (or the apex) → the existing staff app. No change.
- Host = `<sub>.<root>` where `<sub>` is not reserved → resolved per §"One address space, two
  products" below: a course-platform client's handle rewrites into the **learner segment**
  (`/learn/<sub>/...`); every other client's handle serves the management app on that host. An
  unknown handle 404s.

The API mirrors this: `/api/learn/*` requests carry the subdomain (from `Host` or an
`X-Academy` header the web layer sets), and `resolve.academy` middleware maps it → `academy_id` →
`set_config('app.current_academy_id', …)` for RLS, before auth runs.

### DNS / infra

- One **wildcard** DNS record `*.<root>` → the web app (and `*.api.<root>` or a shared `/api` → the
  API). No per-academy DNS work; adding an academy is a row, not an ops task.
- TLS: a wildcard certificate for `*.<root>` (Let's Encrypt DNS-01 or the platform's managed certs).
- This is exactly why **subdomains, not custom domains**, keep everything in one deploy: custom
  domains would need per-client cert issuance + domain verification, which is what would have pushed
  the learner site into its own app.

## One address space, two products

`<handle>.<root>` is not the course site's address — it is the CLIENT's address, and two very
different products can answer on it:

| Client | `/` on their host | Their other surface |
|---|---|---|
| Course platform (`lms.only` — the LMS is their whole product) | the public course site | — |
| Management (a school on the panel, with or without courses) | their **branded sign-in**, then their panel | course site at `/learn/<handle>` |

Why this exists: a management client provisioned with a subdomain used to land on the LMS learner
site (usually an empty one), because the middleware mapped *every* handle to `/learn/<handle>`.
Their own address should open their own system.

**The predicate.** `lms.only` survives `Entitlement`'s guard only when the course platform is the
client's entire product (under docs/superadmin-modules/05 it is derived from
`academies.client_type = 'LMS'`). `App\Support\LmsSite::ownsRoot($academyId)` is the single place
that asks, and BOTH consumers read it — so the routing and the course-site link can never disagree:

- `GET /api/site` (public, `X-Academy: <handle>`, `resolve.academy` → 404 for an unknown handle)
  answers `{ kind: MANAGEMENT | LMS, academy: { name, display_name, logo_url, subdomain, status } }`.
  The web middleware memoises it per handle (60s, with stale-on-outage fallback); the sign-in page
  reads the same call server-side for the name and logo it paints.
- `LmsSite::url()` puts a hybrid client's course site at `<origin>/learn/<handle>`, because `/` on
  their host is their sign-in.

**Signing in.** The branded page posts `subdomain` with the credentials. The API binds the attempt
to that client: a user of another academy is refused with the *same* neutral message as a wrong
password (so the door never becomes an "does X work here?" oracle). A SUPER_ADMIN is exempt — the
platform admin can sign in anywhere. `app.<root>/login` (no handle posted) is unchanged.

After sign-in the browser stays on `<handle>.<root>` and lands on `/dashboard`: the app routes are
host-agnostic and the Sanctum session cookie is set on the parent domain (`SESSION_DOMAIN=.<root>`,
`SANCTUM_STATEFUL_DOMAINS` includes `*.<root>`), so one session covers the apex and every client
host. A visitor who already has a live session is sent straight in rather than shown the form.

**Local development.** Rendering a client door works on any root, but SIGNING IN on one needs the
app and the API to share a registrable parent — so `*.localhost` is not enough: Chrome computes
`alfurqan.localhost` and `localhost` as different *sites*, so the SameSite=Lax session cookie is
never sent from the subdomain (the attempt 419s), and without `*.localhost:3000` in
`SANCTUM_STATEFUL_DOMAINS` it fails even earlier with *"Session store not set on request."* — Sanctum
saw a stateless request and bound no session. Use a dev domain with a real parent instead: `lvh.me`
and every `*.lvh.me` resolve to 127.0.0.1 in public DNS, so

```
apps/api/.env   SESSION_DOMAIN=.lvh.me
                FRONTEND_URL=http://lvh.me:3000
                SANCTUM_STATEFUL_DOMAINS=lvh.me:3000,*.lvh.me:3000
                LMS_SITE_ROOT_DOMAIN=lvh.me:3000
apps/web/.env.local  NEXT_PUBLIC_API_URL=http://lvh.me:8000
                     NEXT_PUBLIC_ROOT_DOMAIN=lvh.me:3000
```

gives `http://lvh.me:3000` for the platform app and `http://<handle>.lvh.me:3000` for a client door,
mirroring `app.acadmyq.com` ↔ `api.acadmyq.com` exactly. (`NEXT_PUBLIC_*` is read when `next dev`
starts — restart it after editing.) Offline: `127.0.0.1 acadmyq.test alfurqan.acadmyq.test` in
/etc/hosts works the same way.

`NEXT_PUBLIC_ROOT_DOMAIN` takes a COMMA-SEPARATED list (canonical first), so keeping
`lvh.me:3000,localhost:3000` means `<handle>.localhost:3000` still RENDERS a client door — handy
when that URL is already in your history — while `<handle>.lvh.me:3000` is where a sign-in actually
completes. Every root is matched; only the first is used to build links.

**Fail-safe.** With `NEXT_PUBLIC_ROOT_DOMAIN` unset the middleware is a pure pass-through (both
surfaces stay reachable at `/learn/<handle>` and `/login`). If the API cannot be reached, a handle's
last known answer is reused for up to a day; a handle never yet resolved is assumed MANAGEMENT,
which renders an unbranded sign-in rather than a stranger's 404.

## Security posture

- Learner tokens are academy-scoped; `resolve.academy` re-derives the tenant from the host on every
  request, so a stolen token can't be replayed against another academy.
- A `BLOCKED` learner (status) is rejected at login and on token use — the academy can bar a learner.
- Enrollment (not the token) gates course content; the token only proves *who* the learner is.
