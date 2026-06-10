# Academiq — Academy Management SaaS

Multi-tenant SaaS for managing teaching academies (first vertical: Qur'an academies, 1-on-1).
The product/technical source of truth lives in [`docs/00-MASTER-SPEC.md`](docs/00-MASTER-SPEC.md);
work is delivered sprint-by-sprint under [`docs/sprints/`](docs/sprints/).

## Monorepo layout

```
academiq-sass/
├── apps/
│   ├── api/        Laravel 11 JSON REST API (PHP 8.2) — all business logic
│   └── web/        Next.js 15 (App Router, TS) — pure UI client
├── packages/
│   └── contracts/  Shared TS types: canonical enums (§9) + API response shapes
├── docs/           Master spec + per-sprint specs
└── .github/        CI (Pint+Pest for api; typecheck+lint+Vitest for web)
```

`apps/api` and `apps/web` are each fully self-contained projects that build, test, and
deploy independently. `packages/contracts` is the single source of truth shared by both so
the API and client cannot silently drift.

## Architecture (locked — see Master Spec §6)

- **Backend:** Laravel 11 JSON API, Sanctum auth, PostgreSQL (Supabase, DB-only).
- **Frontend:** Next.js 15 App Router, Tailwind + shadcn/ui, next-intl (Arabic-RTL default + English).
- **Multi-tenancy:** PostgreSQL Row-Level Security via per-request session GUCs (Sprint 1+).
- **Money:** integer minor units + ISO currency, never floats. **Time:** store UTC, render in tz.

> **Local toolchain note:** the spec pins PHP 8.3 and Next.js 15. This checkout runs on
> **PHP 8.2** (Laravel 11 supports it; `.php-version` pins 8.2) and **Next.js 15.5**.

## Prerequisites

- PHP 8.2 + Composer
- Node 24 (`.nvmrc`) + pnpm 10

## Develop

```bash
# Backend (http://localhost:8000)
cd apps/api
cp .env.example .env && php artisan key:generate
php artisan serve

# Frontend (http://localhost:3000)
pnpm install          # from repo root — installs the whole workspace
pnpm --filter web dev
```

Set a real PostgreSQL connection in `apps/api/.env` (`DB_URL` = Supabase session-mode
pooler or direct connection, with `?sslmode=require`) for `GET /api/health` to report `db: "ok"`.

## Test & lint

```bash
# Backend
cd apps/api && ./vendor/bin/pint --test && ./vendor/bin/pest

# Frontend
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
```

## Deploy

See [`DEPLOY.md`](DEPLOY.md) — Railway (API) + Vercel (web) + the Sanctum cross-domain auth strategy.
