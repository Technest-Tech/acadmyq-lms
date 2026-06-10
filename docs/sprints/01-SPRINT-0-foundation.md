# Sprint 0 — Foundation & Project Setup

> **Status:** Detailed / Ready to execute
> **Depends on:** Nothing (first sprint)
> **Blocks:** All other sprints
> **References:** Master Spec §6 (Architecture), §6.3 (cross-cutting concerns)

---

## 1. Goal

Stand up a running, deployable, bilingual project skeleton with the chosen stack fully wired together — no business logic, but every architectural primitive in place and proven by a health check. This sprint initializes **two projects**: a **Laravel 11 JSON API** (`apps/api`) and a **Next.js 15 frontend** (`apps/web`), confirms they can communicate, and establishes the shared conventions (money, time, enums) in both languages. This sprint exists to **de-risk the toolchain** before any domain code is written.

## 2. Scope

### In scope

**`apps/api` — Laravel 11 JSON API**
- Laravel 11 project initialized via `composer create-project laravel/laravel apps/api "11.*"` (version pinned so the latest major is not pulled).
- API routing scaffolded via `php artisan install:api` (creates `routes/api.php`, registers the `api` route group in `bootstrap/app.php`, and installs + configures Sanctum).
- PostgreSQL connection configured (Supabase DB-only URL in `.env` via `DB_URL`); no Supabase Auth SDK.
- Laravel Sanctum installed and configured (wired for auth in Sprint 2; present and idle here).
- CORS configured to accept requests from the Next.js frontend origin.
- PHP shared utilities:
  - `MoneyMinorUnits` value object: integer `amount` + ISO `currency`; rejects float construction; no raw `float`/`double` for money anywhere.
  - `TimeHelper`: UTC store/convert helpers; render-in-timezone helper.
  - `app/Enums/*.php`: PHP 8.1 backed enums for all canonical enum types from Master Spec §9.
- `GET /api/health` route: returns `{ app: "ok", db: "ok" | "error", version, time }`.
- Laravel Pint (code style), strict-types enforced in all PHP files, PHP 8.3.
- Pest installed and configured for the API test suite.

**`apps/web` — Next.js 15 Frontend**
- Next.js 15 (App Router) + TypeScript; this is a **pure frontend client** — no Route Handlers for business logic, no Server Actions for domain writes.
- Tailwind CSS + shadcn/ui configured with the base theme (emerald/gold, Noto Kufi Arabic).
- next-intl configured with **Arabic (RTL, default)** and **English (LTR)**, including direction switching.
- HTTP API client wrapper (`lib/api.ts`): base URL from env, JSON headers, forwards Sanctum CSRF cookie (wired in Sprint 2; placeholder here).
- Frontend-only shared utilities: money formatting/display (reads amounts from the API; no business logic), time display helpers (UTC → timezone render), typed enums mirroring Master Spec §9.
- ESLint, Prettier, strict TypeScript config (`strict: true`, `noUncheckedIndexedAccess: true`).
- The empty authenticated-looking shell (sidebar/header) as static layout, bilingual.

**Shared / infra**
- Monorepo: `apps/api` (Laravel), `apps/web` (Next.js); pin PHP 8.3 and Node version.
- **Shared API contract** (decoupled FE/BE — establish the discipline now): treat the Laravel API as the contract source and generate **TypeScript types** for the Next.js client from it (e.g. an OpenAPI spec → generated types, or typed API responses), so the two apps cannot silently drift as endpoints evolve in Sprints 2–9. Even a thin hand-maintained shared types package is better than re-typing responses on the client.
- CI pipeline on PR:
  - Laravel job: Pint check → Pest.
  - Next.js job: typecheck → ESLint → Vitest.
- Deploy pipelines: Vercel (Next.js, preview + production); Railway (Laravel API).
- Env management: `.env` for Laravel, `.env.local` for Next.js; all secrets in CI/Vercel/Railway env vars. **Railway must have `APP_KEY` set** (plus `APP_ENV=production`, `APP_DEBUG=false`, `DB_URL`) — `key:generate` only ran in the local checkout, so the deploy fails to boot without it.
- Deferred (no consumer in Sprint 0, configured in a later sprint): queue driver and `php artisan storage:link`. DB SSL is handled here (see §8 risk).

### Out of scope (explicitly deferred)
- Any database tables or schema (Sprint 1).
- Real authentication logic / roles (Sprint 2).
- Any domain entity or CRUD.
- RLS policies (Sprint 1).

## 3. Tasks

1. **Repo & tooling**
   - Monorepo root at repo root; `apps/api` (Laravel), `apps/web` (Next.js); pin PHP 8.3 (`.php-version`), pin Node (`.nvmrc`).
   - Root `pnpm-workspace.yaml` covers `apps/web`; Laravel managed by Composer separately under `apps/api`.

2. **Laravel API (`apps/api`)**
   - `composer create-project laravel/laravel apps/api "11.*"` (version pinned to Laravel 11; `composer create-project` auto-runs `php artisan key:generate` locally).
   - `php artisan install:api` — scaffolds `routes/api.php`, registers the `api` route group in `bootstrap/app.php`, and installs + publishes **Laravel Sanctum** (config + `personal_access_tokens` migration).
   - Configure `config/database.php` for PostgreSQL; set `DB_URL` in `.env` (Supabase DB-only connection string). *(Laravel 11's pgsql connection reads `env('DB_URL')`, not `DATABASE_URL`.)*
   - Configure **Laravel Sanctum**: adjust `config/sanctum.php`; set `SANCTUM_STATEFUL_DOMAINS` and `SESSION_DOMAIN` for the Next.js origin (Sprint 2 wires the actual login; here it is configured but idle).
   - **⚠️ Production-domain prerequisite (validate now, not in Sprint 2):** Sanctum SPA **cookie** auth requires the frontend and API to share a **registrable parent domain** (e.g. `app.academiq.com` + `api.academiq.com`, with `SESSION_DOMAIN=.academiq.com`). The default `*.vercel.app` and `*.up.railway.app` are **different** registrable domains, so the session cookie is third-party and modern browsers will block it → login silently fails. **Plan custom subdomains for both apps before relying on cookie auth.** If a shared parent domain isn't possible, switch to Sanctum **token** auth (bearer token in an `Authorization` header) instead — decide this in Sprint 0, since it changes the `lib/api.ts` contract.
   - Publish and configure CORS: `php artisan config:publish cors`, then in `config/cors.php` allow the Next.js origin and set `'supports_credentials' => true`.
   - Install **Laravel Pint** (`composer require laravel/pint --dev`); add `pint.json` with strict style rules including the `declare_strict_types` rule to enforce `declare(strict_types=1)` in all PHP files.
   - Install **Pest** (`composer require pestphp/pest pestphp/pest-plugin-laravel --dev --with-all-dependencies`); run `./vendor/bin/pest --init` to generate `tests/Pest.php`.
   - Shared PHP utilities:
     - `app/Values/MoneyMinorUnits.php`: `readonly class MoneyMinorUnits { public function __construct(public readonly int $amount, public readonly string $currency) {} }` — constructor rejects non-integer input; static factory validates; no float path.
     - `app/Support/TimeHelper.php`: `toUtc(string $localTime, string $timezone): Carbon`, `renderInTimezone(Carbon $utc, string $timezone): string`.
     - `app/Enums/SessionStatus.php`, `InvoiceStatus.php`, `PaymentMethod.php`, `AcademyStatus.php`, `SubscriptionStatus.php`, `ReportFieldType.php` — PHP 8.1 backed string enums mirroring Master Spec §9. Plus `AppRole.php` (members from §4 Actors & Roles) and `InvoiceGrouping.php` (`PER_GUARDIAN | PER_STUDENT`, from R-INV-4) — both now added to Master Spec §9 as canonical.
   - `GET /api/health` route (public, in `routes/api.php`): pings the DB (`DB::select('select 1')`); returns `{ app: "ok", db: "ok"|"error", version, time }`.
   - Force JSON responses for all API routes (`Accept: application/json` via middleware registered in `bootstrap/app.php` — note: Laravel 11 has no `app/Http/Kernel.php`).

3. **Next.js frontend (`apps/web`)**
   - Next.js App Router scaffold (existing `apps/web`); base layout; error and not-found boundaries.
   - Remove any Supabase SDK dependency; the frontend has no direct DB or auth SDK.
   - `lib/api.ts`: typed fetch wrapper — base URL from `NEXT_PUBLIC_API_URL` env var; sets `Accept: application/json`, `Content-Type: application/json`; credential mode `include` (for Sanctum SPA cookies, wired in Sprint 2).
   - Tailwind config with design tokens (colors, font family Noto Kufi Arabic, radius scale).
   - Install shadcn/ui; theme to the tokens; verify a Button/Card render RTL.
   - Frontend utilities:
     - `lib/money.ts`: display-only — takes `{ amount: number, currency: string }` from API responses; formats for locale; no floats, no business logic.
     - `lib/time.ts`: display-only — UTC ISO strings from API → formatted wall-clock in viewer's timezone.
     - `lib/enums.ts`: TypeScript string unions mirroring Master Spec §9 (match the PHP enums).
   - next-intl setup; `ar` and `en` message catalogs; `dir` attribute switches with locale; locale switcher in header.
   - ESLint + Prettier + strict `tsconfig`.

4. **App shell (static)**
   - Port the prototype's sidebar + header as a static, unauthenticated layout; bilingual labels; responsive + RTL verified.

5. **CI/CD**
   - GitHub Actions — two parallel jobs on PR:
     - **Laravel:** `composer install` → `./vendor/bin/pint --test` → `./vendor/bin/pest`. The job must run a **PostgreSQL service container** and supply test-DB credentials (via `.env.testing` / `phpunit.xml`) so the integration tests (TC-0.10/TC-0.11) can assert `db: "ok"`/`db: "error"`.
     - **Next.js:** `pnpm install` → `tsc --noEmit` → `eslint` → `vitest run`.
   - Vercel project linked to `apps/web`; preview deploys on PR; production on `main`.
   - Railway project linked to `apps/api`; deploy on `main`.

## 4. Schema / Data deltas
None. (Schema begins in Sprint 1.) No Supabase `auth` schema is used — auth is Laravel Sanctum with users in a Postgres `users` table. Sanctum's `personal_access_tokens` table is the only auth-related table and is created when migrations run.

## 5. API surface
- `GET /api/health` → `200 { app: "ok", db: "ok" | "error", version, time }` (Laravel route, public, no auth).

## 6. Definition of Done / Acceptance Criteria
- **AC-0.1** Laravel API deploys to Railway and is reachable; Next.js app deploys to Vercel and loads.
- **AC-0.2** `GET /api/health` returns `db: "ok"` against the real PostgreSQL instance.
- **AC-0.3** Switching locale flips both copy **and** layout direction (RTL↔LTR) across the shell.
- **AC-0.4** Default locale is Arabic and the shell renders RTL by default.
- **AC-0.5** CI runs both Laravel (Pint + Pest) and Next.js (typecheck + lint + Vitest) jobs and both are green on main.
- **AC-0.6** `MoneyMinorUnits` (PHP) rejects non-integer construction and round-trips an amount without precision loss; `lib/money.ts` (TS) formats without floats.
- **AC-0.7** `TimeHelper` (PHP) stores a known local time as correct UTC and renders it back in a given timezone.
- **AC-0.8** shadcn/ui components render correctly mirrored in RTL (no clipped icons/padding).
- **AC-0.9** `declare(strict_types=1)` present in every PHP file; zero `any` in TypeScript shared utilities.
- **AC-0.10** The deployed Next.js app successfully calls `GET /api/health` **through `lib/api.ts`** (cross-origin, `credentials: "include"`) and renders the result — proving the CORS + credentials path the decoupled architecture introduces.

## 7. Test Cases

> Test IDs are stable and referenced in CI. Format: `TC-0.<n>`. Each maps to one or more acceptance criteria.
> PHP tests run via Pest (`apps/api`); TypeScript tests run via Vitest (`apps/web`).

### Unit — money utility (PHP / Pest)
- **TC-0.1** `new MoneyMinorUnits(1500, "EGP")` — `amount` is `1500`, `currency` is `"EGP"`. *(AC-0.6)*
- **TC-0.2** Passing a float to `MoneyMinorUnits` (e.g. `15.0`) throws a `TypeError` or validation exception. *(AC-0.6)*
- **TC-0.3** `MoneyMinorUnits::add(new MoneyMinorUnits(1000,"EGP"), new MoneyMinorUnits(500,"EGP"))` returns `amount=1500, currency="EGP"`. *(AC-0.6)*
- **TC-0.4** Adding two `MoneyMinorUnits` of different currencies throws. *(AC-0.6, R-INV-7)*
- **TC-0.5** Frontend `lib/money.ts`: formatting `{ amount: 1500, currency: "EGP" }` in `ar` locale yields Arabic-numeral output with the EGP symbol. *(AC-0.6)*

### Unit — time utility (PHP / Pest)
- **TC-0.6** `TimeHelper::toUtc('2026-06-10 18:00', 'Africa/Cairo')` returns the correct UTC Carbon instant. *(AC-0.7)*
- **TC-0.7** `TimeHelper::renderInTimezone($utcInstant, 'Asia/Riyadh')` returns the correct wall-clock string. *(AC-0.7)*
- **TC-0.8** A DST-affected timezone round-trips a time across a DST boundary without drift. *(AC-0.7)*

### Integration — health & DB (PHP / Pest)
- **TC-0.9** `GET /api/health` returns `200` with `app: "ok"`. *(AC-0.1)*
- **TC-0.10** `GET /api/health` returns `db: "ok"` when the PostgreSQL connection is live. *(AC-0.2)*
- **TC-0.11** With DB credentials broken, `GET /api/health` returns `db: "error"` and a degraded (non-500-crash) payload. *(AC-0.2)*

### UI / i18n (Next.js)
- **TC-0.12** On first load with no locale set, the document `dir` is `rtl` and language is Arabic. *(AC-0.4)*
- **TC-0.13** Selecting English sets `dir="ltr"`, swaps all visible shell strings, and persists the choice. *(AC-0.3)*
- **TC-0.14** Selecting Arabic returns to `dir="rtl"` and Arabic strings. *(AC-0.3)*
- **TC-0.15** A shadcn Button with a leading icon mirrors icon placement correctly in RTL (icon on the right). *(AC-0.8)*
- **TC-0.16** The shell is usable at 360px width (mobile): sidebar collapses, no horizontal scroll. *(AC-0.8)*

### Pipeline
- **TC-0.17** A PR introducing a PHP type error or Pint violation fails the Laravel CI job. *(AC-0.5)*
- **TC-0.18** A PR introducing a TypeScript type error fails the Next.js CI job at the typecheck step. *(AC-0.5)*
- **TC-0.19** Merging to main triggers both a Railway deploy (Laravel) and a Vercel deploy (Next.js); smoke test `GET /api/health` returns 200. *(AC-0.1, AC-0.5)*
- **TC-0.20** Browser/E2E: the deployed Next.js app loads a page that calls `GET /api/health` via `lib/api.ts` (cross-origin, `credentials: "include"`); the response is received with no CORS error and rendered. *(AC-0.10)*

## 8. Risks & mitigations
- **Risk:** next-intl RTL/LTR switching interacting badly with shadcn/ui defaults. **Mitigation:** verify with TC-0.15 early; isolate direction logic in the root layout.
- **Risk:** CORS misconfiguration blocking the Next.js frontend from reaching the Laravel API. **Mitigation:** configure `config/cors.php` with the exact Next.js origin and `supports_credentials = true`; verify in TC-0.19 smoke test.
- **Risk:** Money/time conventions adopted inconsistently across PHP and TypeScript. **Mitigation:** PHP side uses the `MoneyMinorUnits` value object (no float path); TS side is display-only (no business math). TC-0.2 and TC-0.5 enforce the boundary.
- **Risk:** Laravel deploy on Railway behaving differently from local (env vars, DB SSL). **Mitigation:** add `?sslmode=require` to the DB URL; test the health route in the Railway environment before Sprint 1 begins.
- **Risk (release-blocking for auth):** Sanctum SPA **cookie** auth fails across the default `*.vercel.app` / `*.up.railway.app` domains (third-party cookie blocking) — this would only surface in Sprint 2, too late. **Mitigation:** decide the production domain strategy **now** (shared parent domain with `app.`/`api.` subdomains, or token auth as fallback — see §3 task 2); make AC-0.10/TC-0.20 run against the **real deployed domains**, not just localhost, so a cross-site cookie failure is caught in Sprint 0.

## 9. Estimate
Small–Medium. This is plumbing across two projects instead of one; the value is in getting both deploys live and the conventions (money, time, enums, CORS) right so later sprints move fast in both PHP and TypeScript.
