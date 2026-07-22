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
- Host = `<sub>.<root>` where `<sub>` is not reserved → rewrite into the **learner segment**
  (`/(learn)/...`), passing `<sub>` as the tenant. A `not-found` renders if the subdomain doesn't
  resolve to an academy with an active LMS module.

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

## Security posture

- Learner tokens are academy-scoped; `resolve.academy` re-derives the tenant from the host on every
  request, so a stolen token can't be replayed against another academy.
- A `BLOCKED` learner (status) is rejected at login and on token use — the academy can bar a learner.
- Enrollment (not the token) gates course content; the token only proves *who* the learner is.
