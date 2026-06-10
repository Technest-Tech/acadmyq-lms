# Sprint 1 — Data Model & Multi-Tenancy Core

> **Status:** Detailed / Ready to execute
> **Depends on:** Sprint 0 (running Laravel API + Next.js, Postgres/Supabase DB wired, shared utils, enums)
> **Blocks:** Sprints 2–9 (every feature reads/writes this schema)
> **References:** Master Spec §3 (Glossary), §4 (Roles), §5 (all R-* rules), §6.1 (tenancy), §6.3 (cross-cutting), §7 (entity overview), §9 (enums)

---

## 1. Goal

Translate the conceptual entity model (Master Spec §7) into a **complete, migration-managed PostgreSQL schema**, and enforce **tenant isolation at the database layer** via Row-Level Security (RLS). By the end of this sprint, the data backbone exists, isolation is provably enforced (not just trusted in app code), and a demo Qur'an academy can be seeded. There is **no feature UI** here — this sprint is the foundation the rest of the product stands on.

The deliverable is judged on one question: *can a user from Academy A ever, through any path, read or write a row belonging to Academy B?* The answer must be a database-enforced **no**.

## 2. Scope

### In scope
- Full schema: all tables from the entity overview, with columns, types, constraints, indexes, and foreign keys.
- Canonical enums (Master Spec §9) as PostgreSQL enum types.
- `academy_id` on every tenant-scoped table (R-TEN-1).
- **RLS policies** on every tenant-scoped table, keyed on a per-request session variable (R-TEN-2).
- The **tenant-context mechanism**: how `app.current_academy_id` and the current role are set on each connection/request, and how Super Admin bypasses it intentionally (R-TEN-3).
- Money stored as integer minor units + ISO currency code (§6.3).
- Timestamps stored in UTC; schedule rules vs concrete session datetimes (§6.3).
- Soft-delete columns where history matters; append-only audit table.
- Migrations (forward + rollback) and a repeatable **seed** for a demo academy.
- A minimal **isolation test harness** (a Pest test helper that opens a connection, sets the `app.*` GUCs to simulate a given user/academy/role, and runs queries) used solely to prove RLS — not user-facing.

### Out of scope (deferred)
- Auth wiring / login (Sprint 2) — this sprint sets the *contract* RLS expects (the Sanctum-authenticated user resolves to an `academy_id` and `role`, which a Laravel middleware pushes into the DB session), and tests simulate it.
- Any CRUD UI or business logic (Sprints 3+).
- Session generation algorithm (Sprint 5) — the `sessions` table exists; the generator does not.
- Invoice close job (Sprint 7) — invoice tables exist; the scheduled close does not.

---

## 3. Design decisions (locked for this sprint)

1. **Single shared schema, RLS-isolated.** One Postgres database, one schema, every tenant row tagged with `academy_id`. Chosen in Master Spec §6.1.
2. **Tenant context via session GUC.** Each DB request sets `app.current_academy_id` (and `app.current_role`, `app.current_user_id`). RLS policies read these. In production the values are set by Laravel's **`TenantContextMiddleware`** from the authenticated **Sanctum** user (resolving `academy_id`/`role` from the `users`/`user_roles` tables) and issued as `SET LOCAL` on the request's transaction; tests set them directly.
3. **Super Admin bypass is explicit.** Super Admin does not silently see all rows through normal queries. A dedicated, audited path (a `SECURITY DEFINER` function or an explicit "admin" role flag in the GUC) is the only way to cross tenants. Default policies deny cross-tenant access even for Super Admin in normal app queries.
4. **UUID primary keys** (v7 preferred for index locality; v4 acceptable). Never expose sequential integer IDs (also matters for the public invoice link, R-INV-5).
5. **Money = `amount_minor BIGINT` + `currency CHAR(3)`.** No `numeric` for monetary columns in domain tables; never floats. (§6.3, R-INV-7)
6. **Timestamps = `timestamptz`, stored UTC.** Wall-clock rendering happens in app using academy/teacher timezone. (§6.3)
7. **Soft delete** via `deleted_at timestamptz NULL` on entities with history (students, schedules, teachers, guardians, subscriptions). **Hard delete is prohibited** for these in app code.
8. **Append-only** `audit_log`; no UPDATE/DELETE policy granted to anyone but the system. (R-AUD-1)
9. **Immutability of closed invoices** enforced by a DB trigger, not just app code. (R-INV-3)

---

## 4. The tenant-context contract

RLS policies depend on three session settings, set once per request **after** authentication:

```
app.current_user_id    -- uuid of the authenticated user
app.current_academy_id -- uuid of the academy the request operates within
app.current_role       -- 'SUPER_ADMIN' | 'ACADEMY_OWNER' | 'TEACHER'
```

- In production these are populated by `TenantContextMiddleware` from the authenticated Sanctum user (Sprint 2 wires the middleware → GUC bridge; this sprint defines and documents the contract and provides a helper to set them in tests).
- A helper reads them safely:

```sql
-- returns NULL if unset, never errors
create or replace function app.current_academy_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.current_academy_id', true), '')::uuid
$$;

create or replace function app.current_role() returns text
language sql stable as $$
  select nullif(current_setting('app.current_role', true), '')
$$;

create or replace function app.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid
$$;
```

**Rule of thumb for every tenant-scoped table:** the row is visible/writable only if `academy_id = app.current_academy_id()`. Super Admin crossing tenants happens only via the explicit admin path (§7.4), never through these default policies.

---

## 5. Enum types (from Master Spec §9)

```sql
create type session_status as enum (
  'SCHEDULED','ATTENDED','ABSENT_UNEXCUSED','ABSENT_EXCUSED',
  'CANCELLED_BY_TEACHER','CANCELLED_BY_STUDENT','RESCHEDULED'
);
create type invoice_status as enum (
  'OPEN','CLOSED','PAID','PARTIALLY_PAID','VOID'
);
create type payment_method as enum (
  'CASH','BANK_TRANSFER','GATEWAY','OTHER'
);
create type academy_status as enum ('ACTIVE','SUSPENDED','TRIAL');
create type subscription_status as enum ('ACTIVE','PAUSED','ENDED');
create type report_field_type as enum ('TEXT','TEXTAREA','NUMBER','SELECT','RATING');
create type app_role as enum ('SUPER_ADMIN','ACADEMY_OWNER','TEACHER');
create type invoice_grouping as enum ('PER_GUARDIAN','PER_STUDENT');
```

---

## 6. Schema

> Conventions: every tenant-scoped table has `academy_id uuid not null references academies(id)`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`. History-bearing tables also have `deleted_at timestamptz`. PKs are `id uuid primary key default uuid_generate_v7()`.

### 6.1 Platform-level (NOT tenant-scoped)

**`plans`** — subscription tiers the platform sells to academies (business model §2).
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| code | text unique | e.g. 'BASIC','PRO' |
| name | text | |
| price_minor | bigint | platform's price to the academy |
| currency | char(3) | |
| features | jsonb | capability flags unlocked by this plan |
| is_active | boolean default true | |

**`add_ons`** — paid extras on top of a plan.
| id | uuid PK |
| code | text unique |
| name | text |
| price_minor | bigint |
| currency | char(3) |
| feature_key | text | the capability it unlocks |

**`academies`** — the tenant root. (Has no `academy_id`; it *is* the academy.)
| column | type | notes |
|---|---|---|
| id | uuid PK | also the tenant key everywhere else |
| name | text not null | |
| academy_type_id | uuid not null → academy_types(id) | drives report-field template |
| status | academy_status not null default 'TRIAL' | |
| plan_id | uuid → plans(id) | current tier |
| default_currency | char(3) not null | |
| timezone | text not null default 'UTC' | IANA tz, e.g. 'Africa/Cairo' |
| invoice_grouping | invoice_grouping not null default 'PER_GUARDIAN' | R-INV-4 |
| billing_day | smallint not null default 1 | day month-end close attributes to (Sprint 7 uses) |
| **branding** (reserved, R-BRA-1) | | |
| brand_logo_url | text null | reserved, unused in MVP |
| brand_display_name | text null | reserved |
| subdomain | text unique null | reserved for Sprint 12 |
| created_at / updated_at | timestamptz | |

**`academy_types`** — configurable category (Qur'an, Languages…). Data, not code (R-CRF, generalization).
| id | uuid PK |
| code | text unique | 'QURAN','LANGUAGES' |
| name | text |
| description | text null |

> `academy_types` is platform-level (shared catalog). The **report-field definitions** that belong to a type are tenant-scoped (§6.4) so each academy can customize, satisfying R-CRF-1.

### 6.2 Identity & access (tenant-scoped except super admin)

**`users`** — login identities, owned by Laravel (this extends Sprint 0's default `users` migration; Sanctum issues tokens/cookies against these rows). No Supabase `auth.users` — passwords and auth live here.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| academy_id | uuid null | NULL only for SUPER_ADMIN (platform-level) |
| full_name | text not null | |
| email | text unique not null | login identifier |
| password | text not null | bcrypt/argon hash (Laravel `Hash`) |
| phone | text null | |
| is_active | boolean default true | |
| remember_token | text null | Laravel "remember me" |
| email_verified_at | timestamptz null | Laravel convention |

**`user_roles`** — RBAC assignment (a user has one or more roles within an academy).
| id | uuid PK |
| user_id | uuid not null → users(id) |
| academy_id | uuid null | NULL for SUPER_ADMIN |
| role | app_role not null |
| unique(user_id, academy_id, role) |

**`permissions`** — discrete capabilities (RBAC; Master Spec §4 design note).
| id | uuid PK |
| code | text unique | e.g. 'student.create','invoice.mark_paid' |
| description | text |

**`role_permissions`** — which capabilities each role has (seedable, editable later → add roles without code change).
| role | app_role |
| permission_id | uuid → permissions(id) |
| primary key (role, permission_id) |

> Modeling permissions as data (not `if role === 'OWNER'` in code) is what lets a future "Supervisor" role be a data change. Sprint 2 consumes these tables for authorization.

### 6.3 People (tenant-scoped, history-bearing)

**`teachers`**
| id | uuid PK |
| academy_id | uuid not null |
| user_id | uuid null → users(id) | linked login (a teacher is also a user) |
| full_name | text not null |
| phone | text null |
| specialization | text null |
| session_rate_minor | bigint not null | payroll rate (R-PAY-1) |
| currency | char(3) not null | (R-PAY-3) |
| timezone | text null | overrides academy tz for their calendar |
| is_active | boolean default true |
| deleted_at | timestamptz null |

**`guardians`** — the payer; may own multiple students (R-STU-1).
| id | uuid PK |
| academy_id | uuid not null |
| full_name | text not null |
| whatsapp_phone | text not null | report & invoice recipient |
| country | text null |
| currency | char(3) not null | default for their invoices |
| deleted_at | timestamptz null |

**`students`**
| id | uuid PK |
| academy_id | uuid not null |
| guardian_id | uuid not null → guardians(id) | (R-STU-1; adult solo = own guardian, R-STU-2) |
| full_name | text not null |
| whatsapp_phone | text null | optional own contact |
| country | text null |
| status | text null | display status ('REGULAR' etc.) — operational, not billing |
| deleted_at | timestamptz null |

**`student_teacher_assignments`** — current + historical teacher per student (R-STU-3).
| id | uuid PK |
| academy_id | uuid not null |
| student_id | uuid not null → students(id) |
| teacher_id | uuid not null → teachers(id) |
| started_at | timestamptz not null default now() |
| ended_at | timestamptz null | NULL = current active assignment |
| partial index: unique(student_id) where ended_at is null | enforces one active teacher |

### 6.4 Enrollment, custom report fields

**`subscriptions`** — per-student enrollment terms; **price lives here** (R-STU-4).
| id | uuid PK |
| academy_id | uuid not null |
| student_id | uuid not null → students(id) |
| plan_label | text not null | e.g. '8 sessions/month' (display) |
| sessions_per_month | smallint null | quota if applicable |
| price_minor | bigint not null | agreed per-student price |
| currency | char(3) not null | (R-INV-7) |
| price_basis | text not null default 'PER_SESSION' | 'PER_SESSION' | 'PER_MONTH' |
| status | subscription_status not null default 'ACTIVE' |
| start_date | date not null |
| deleted_at | timestamptz null |

> Whether the per-session price is `price_minor` directly, or `price_minor / sessions_per_month`, is resolved by `price_basis`. The invoicing engine (Sprint 7) reads this; here we only store it.

**`report_field_definitions`** — each academy designs its own session-report fields (R-CRF-1/2).
| id | uuid PK |
| academy_id | uuid not null |
| key | text not null | machine key, unique per academy |
| label_ar | text not null |
| label_en | text not null |
| field_type | report_field_type not null |
| options | jsonb null | for SELECT |
| sort_order | int not null default 0 |
| is_required | boolean default false |
| is_active | boolean default true |
| unique(academy_id, key) |

### 6.5 Scheduling & sessions

**`schedules`** — weekly recurring template per student (R-SCH-1).
| id | uuid PK |
| academy_id | uuid not null |
| student_id | uuid not null → students(id) |
| teacher_id | uuid not null → teachers(id) | teacher at time of scheduling |
| timezone | text not null | the tz the local times are expressed in |
| is_active | boolean default true |
| deleted_at | timestamptz null |

**`schedule_slots`** — the per-weekday times (times may differ per day, R-SCH-1).
| id | uuid PK |
| academy_id | uuid not null |
| schedule_id | uuid not null → schedules(id) |
| weekday | smallint not null | 0=Sun … 6=Sat (document the convention once) |
| start_time_local | time not null | wall-clock in schedule.timezone |
| duration_minutes | smallint not null default 30 |
| unique(schedule_id, weekday, start_time_local) |

**`sessions`** — concrete occurrences (generated in Sprint 5; table defined now).
| id | uuid PK |
| academy_id | uuid not null |
| student_id | uuid not null → students(id) |
| teacher_id | uuid not null → teachers(id) | teacher for this occurrence |
| schedule_id | uuid null → schedules(id) | source; NULL for ad-hoc |
| scheduled_at_utc | timestamptz not null | concrete instant |
| duration_minutes | smallint not null |
| status | session_status not null default 'SCHEDULED' |
| status_reason | text null | e.g. who cancelled/why (R-SCH-2 / 5.4) |
| original_session_id | uuid null → sessions(id) | if this is a reschedule of another |
| billed | boolean not null default false | set true when a line item is created (R-BIL-1, idempotency) |
| paid_to_teacher | boolean not null default false | set when payout line created (R-PAY) |
| created_at / updated_at | timestamptz |
| index (academy_id, teacher_id, scheduled_at_utc) | calendar queries |
| index (academy_id, student_id, scheduled_at_utc) | |

> Billable/payable classification (§5.4 matrix) is **derived from `status`** by a pure function shared in code; we do not store the boolean classification, only the `status`. `billed`/`paid_to_teacher` are idempotency guards, not classification.

**`session_reports`** — one report per session, dynamic values (R-CRF-3, R-BIL-3).
| id | uuid PK |
| academy_id | uuid not null |
| session_id | uuid not null unique → sessions(id) |
| values | jsonb not null default '{}' | keyed by report_field_definitions.key |
| filled_by_user_id | uuid → users(id) | teacher or owner (R-BIL-4) |
| filled_at | timestamptz |

### 6.6 Invoicing

**`invoices`** — monthly, per grouping config (R-INV-1/2/3/4).
| id | uuid PK |
| academy_id | uuid not null |
| guardian_id | uuid null → guardians(id) | set when PER_GUARDIAN |
| student_id | uuid null → students(id) | set when PER_STUDENT |
| period_year | smallint not null |
| period_month | smallint not null |
| status | invoice_status not null default 'OPEN' |
| currency | char(3) not null | (R-INV-7, no FX) |
| subtotal_minor | bigint not null default 0 | maintained as line items change |
| total_minor | bigint not null default 0 |
| public_token | text unique not null | unguessable; powers public page (R-INV-5) |
| closed_at | timestamptz null | set at month-end close (R-INV-2) |
| paid_at | timestamptz null |
| payment_method | payment_method null | when marked paid (R-INV-6) |
| payment_reason | text null | free text for OTHER/outside-system (R-INV-6) |
| check (exactly one of guardian_id / student_id is set, matching grouping) | |
| unique(academy_id, coalesce(guardian_id,student_id), period_year, period_month) | one invoice per payer per month |

**`invoice_line_items`** — one billable session, price **snapshotted** (R-INV-3).
| id | uuid PK |
| academy_id | uuid not null |
| invoice_id | uuid not null → invoices(id) |
| session_id | uuid not null → sessions(id) |
| student_id | uuid not null → students(id) | which child (for per-guardian breakdown) |
| description | text not null | e.g. 'Session 10 Jun, surah Aal-Imran' |
| amount_minor | bigint not null | snapshot at billing time |
| currency | char(3) not null |
| created_at | timestamptz |
| unique(invoice_id, session_id) | idempotency (R-BIL-1) |

### 6.7 Payroll

**`payouts`** — per teacher per period (R-PAY-1/3).
| id | uuid PK |
| academy_id | uuid not null |
| teacher_id | uuid not null → teachers(id) |
| period_year | smallint not null |
| period_month | smallint not null |
| total_minor | bigint not null default 0 |
| currency | char(3) not null |
| finalized_at | timestamptz null |
| unique(academy_id, teacher_id, period_year, period_month) |

**`payout_line_items`** — one attended session (R-PAY-2).
| id | uuid PK |
| academy_id | uuid not null |
| payout_id | uuid not null → payouts(id) |
| session_id | uuid not null → sessions(id) |
| amount_minor | bigint not null | snapshot of teacher rate |
| currency | char(3) not null |
| unique(payout_id, session_id) | idempotency |

### 6.8 Audit (append-only, R-AUD-1/2)

**`audit_log`**
| id | uuid PK |
| academy_id | uuid null | NULL for platform-level actions |
| actor_user_id | uuid null → users(id) |
| actor_role | app_role null |
| action | text not null | e.g. 'invoice.close','subscription.price_change' |
| entity_type | text not null |
| entity_id | uuid null |
| before | jsonb null |
| after | jsonb null |
| created_at | timestamptz not null default now() |
| index (academy_id, created_at desc) | |

---

## 7. Row-Level Security

### 7.1 Enabling
RLS is enabled and **forced** on every tenant-scoped table:
```sql
alter table students enable row level security;
alter table students force row level security;   -- applies even to table owner
-- ...repeat for every tenant-scoped table
```

### 7.2 The standard tenant policy (applied to every tenant-scoped table)
```sql
create policy tenant_isolation on students
  using      (academy_id = app.current_academy_id())
  with check (academy_id = app.current_academy_id());
```
- `using` filters reads; `with check` constrains writes so a row can never be inserted/updated into another tenant.
- The same policy shape is applied verbatim to: users (where academy_id not null), user_roles, teachers, guardians, students, student_teacher_assignments, subscriptions, report_field_definitions, schedules, schedule_slots, sessions, session_reports, invoices, invoice_line_items, payouts, payout_line_items, audit_log.

### 7.3 Platform-level tables
`plans`, `add_ons`, `academy_types`, `permissions`, `role_permissions` are a **shared read catalog**: readable by all authenticated roles, writable only by Super Admin. `academies` is special — readable for the row matching `app.current_academy_id()`, and fully accessible only through the Super Admin admin path.

### 7.4 Super Admin path
- Normal app queries from a Super Admin still pass through tenant policies and therefore see **nothing** cross-tenant by default (prevents accidental leaks).
- To operate on a specific academy, the Super Admin path **sets `app.current_academy_id` to the target** (an explicit, audited "enter academy" action), then operates within standard policies.
- Platform-wide reads (e.g. list all academies) go through a `SECURITY DEFINER` function `app.admin_list_academies()` that checks `app.current_role() = 'SUPER_ADMIN'` and is itself audited. No blanket "see all rows" policy exists.

### 7.5 Append-only & immutability
```sql
-- audit_log: insert + tenant-scoped select only
create policy audit_insert on audit_log for insert with check (true);
create policy audit_select on audit_log for select using (academy_id = app.current_academy_id());
-- Append-only is enforced by RLS itself: with FORCE row level security and NO update/delete
-- policy present, those operations are denied even for the table owner (the Laravel app role).
-- (There is no Supabase `authenticated` role here; the API connects as a single Postgres role,
--  so no GRANT/REVOKE juggling is needed — the absence of a policy is the denial.)

-- closed invoice immutability (R-INV-3) enforced by trigger
create function forbid_closed_invoice_mutation() returns trigger language plpgsql as $$
begin
  if old.status in ('CLOSED','PAID','PARTIALLY_PAID','VOID')
     and (new.status is distinct from old.status
          and not (old.status='CLOSED' and new.status in ('PAID','PARTIALLY_PAID','VOID'))) then
    raise exception 'closed invoice is immutable';
  end if;
  -- block changes to financial fields once closed
  if old.status <> 'OPEN'
     and (new.subtotal_minor <> old.subtotal_minor or new.total_minor <> old.total_minor or new.currency <> old.currency) then
    raise exception 'cannot modify totals of a non-open invoice';
  end if;
  return new;
end $$;
create trigger trg_invoice_immutable before update on invoices
  for each row execute function forbid_closed_invoice_mutation();

-- line items cannot be added to a non-open invoice
create function forbid_line_on_closed_invoice() returns trigger language plpgsql as $$
declare s invoice_status;
begin
  select status into s from invoices where id = new.invoice_id;
  if s <> 'OPEN' then raise exception 'cannot add line item to non-open invoice'; end if;
  return new;
end $$;
create trigger trg_line_open_only before insert on invoice_line_items
  for each row execute function forbid_line_on_closed_invoice();
```

### 7.6 Public invoice read by token (RLS-safe path for the public page)
The public invoice page (Sprint 7) is served **with no tenant context** — so a normal `select` on `invoices` would match the tenant policy's `academy_id = app.current_academy_id()` against `NULL` and return **zero rows**. FORCE RLS means even the table owner is filtered. The token lookup therefore needs an explicit, narrow bypass — defined here so the schema accounts for it from the start:

```sql
-- Returns ONLY the curated display payload for the one invoice matching an exact, unguessable
-- token — never raw tenant rows, never a list. SECURITY DEFINER runs it with the owner's rights
-- (bypassing RLS) but the body is the whole allow-list: a single equality on public_token.
create or replace function app.public_invoice_by_token(p_token text)
returns jsonb
language sql stable security definer
set search_path = public, app as $$
  select case when i.id is null then null else jsonb_build_object(
    'academy_name', a.name, 'payer_name', /* guardian or student */ null,
    'period_year', i.period_year, 'period_month', i.period_month,
    'status', i.status, 'currency', i.currency,
    'subtotal_minor', i.subtotal_minor, 'total_minor', i.total_minor,
    'line_items', (select jsonb_agg(jsonb_build_object(
        'date', li.created_at::date, 'description', li.description, 'amount_minor', li.amount_minor)
        order by li.created_at)
      from invoice_line_items li where li.invoice_id = i.id)
  ) end
  from invoices i join academies a on a.id = i.academy_id
  where i.public_token = p_token
$$;
revoke all on function app.public_invoice_by_token(text) from public;
grant execute on function app.public_invoice_by_token(text) to <app_db_role>;
```
- **What's locked in Sprint 1:** the RLS-bypass mechanism, the `SECURITY DEFINER` boundary, and the exact-single-token `where` clause. The **display projection is illustrative** — Sprint 7 refines it via `create or replace` once it adds line-item display columns (`session_date`) and the payer-name resolution (guardian vs student).
- The Sprint-7 public endpoint calls **only** this function (never a raw `select` on `invoices`). It returns `NULL` on no match → the endpoint responds 404 (no enumeration signal).
- This is the invoice analogue of `app.admin_list_academies()` (§7.4): a single, narrow `SECURITY DEFINER` hole, not a blanket policy.

### 7.7 `updated_at` maintenance
A shared `set_updated_at()` trigger on every table with `updated_at`.

---

## 8. Migrations

- Tooling: **Laravel migrations** under `apps/api/database/migrations/`, run via `php artisan migrate` (and `migrate:rollback`) in CI and on deploy. The RLS/enum/trigger/function DDL is raw Postgres, so those migrations use `DB::unprepared(...)` (and the reverse SQL in `down()`); the table migrations use Laravel's Schema builder where practical (`Schema::create`, `$table->uuid('id')->primary()`, etc.), dropping to raw SQL for enum-typed columns, partial unique indexes, and check constraints.
- Run order is by Laravel's timestamp-prefixed filenames. Keep the same logical grouping (use ascending timestamps so they apply in this order); the Sprint 0 default `users` migration is modified here to a UUID PK + the columns in §6.2.
  1. `..._extensions_and_enums` (uuid-v7 fn, `create type … as enum`, the `app` schema + `app.*` helper functions)
  2. `..._platform_tables` (plans, add_ons, academy_types, permissions, role_permissions)
  3. `..._academies_and_users` (academies; alter `users` to §6.2; user_roles, role_permissions links)
  4. `..._people` (teachers, guardians, students, assignments)
  5. `..._enrollment_and_reports` (subscriptions, report_field_definitions)
  6. `..._scheduling` (schedules, schedule_slots, sessions, session_reports)
  7. `..._invoicing` (invoices, invoice_line_items + triggers)
  8. `..._payroll`
  9. `..._audit`
  10. `..._rls_policies` (enable+force RLS, all policies, super-admin functions)
  11. `..._triggers` (updated_at, immutability)
- **Each migration implements a working `down()`** so `migrate:rollback` is clean (AC-1.1/1.2).
- A migration must never be edited after it has run in any shared environment; corrections are new migrations.
- **Note on the migrating role:** `php artisan migrate` connects as the table-owning Postgres role. `FORCE ROW LEVEL SECURITY` is therefore essential (RLS would otherwise be skipped for the owner). DDL itself is unaffected by RLS; only DML (seed inserts) must set the tenant GUCs.

---

## 9. Seed data (demo Qur'an academy)

Implemented as **Laravel seeders** (`apps/api/database/seeders/`, run via `php artisan db:seed`). Repeatable (idempotent upsert by stable codes/keys via `updateOrInsert`/`upsert`) producing:
- 1 `academy_type` = QURAN; 2 `plans` (BASIC, PRO); core `permissions` + `role_permissions`.
- 1 `academy` "Noor Al-Qur'an Academy", tz `Africa/Cairo`, currency `EGP`, grouping `PER_GUARDIAN`, plan PRO.
- `report_field_definitions` for QURAN: `surah_from`, `surah_to`, `tajweed_rating` (SELECT), `next_assignment` (TEXT), `notes` (TEXTAREA).
- 1 Owner user (with a hashed password via Laravel `Hash::make`) + 2 teachers; 1 guardian "Mohamed" with 2 students; subscriptions with per-student prices in EGP.
- A couple of schedules + slots, and a handful of past `sessions` in varied statuses to make later sprints demoable.
- The seeder sets the tenant GUCs appropriately (e.g. `DB::statement("select set_config('app.current_academy_id', ?, false)", [$academyId])` and the role/user GUCs) so it inserts under RLS (proving the policies allow legitimate writes), then clears them.

---

## 10. Definition of Done / Acceptance Criteria

- **AC-1.1** All migrations apply cleanly from an empty database and roll back cleanly.
- **AC-1.2** Every tenant-scoped table has RLS **enabled and forced**, with the standard tenant policy.
- **AC-1.3** With `app.current_academy_id` = Academy A, a `SELECT *` on any tenant table returns **only** Academy A rows. (R-TEN-1/2)
- **AC-1.4** Attempting to INSERT a row with `academy_id` = Academy B while the context is Academy A is **rejected** by `with check`. (R-TEN-2)
- **AC-1.5** Attempting to UPDATE an Academy A row to set `academy_id` = Academy B is rejected.
- **AC-1.6** A Super Admin doing a normal query without entering an academy sees **no** tenant rows; entering Academy A scopes them to A. (R-TEN-3)
- **AC-1.7** `audit_log` accepts INSERTs but rejects UPDATE and DELETE for all non-system roles. (R-AUD-1)
- **AC-1.8** A CLOSED invoice cannot have its totals modified and cannot receive new line items (trigger fires). (R-INV-3)
- **AC-1.9** Only one active `student_teacher_assignment` per student is allowed (partial unique index). (R-STU-3)
- **AC-1.10** Money columns are integer minor units; a migration check confirms no monetary column is float/`numeric`. (§6.3, R-INV-7)
- **AC-1.11** `invoice_line_items` and `payout_line_items` reject a duplicate `(invoice_id/payout_id, session_id)` — idempotency. (R-BIL-1, R-PAY)
- **AC-1.12** The seed runs idempotently (running twice yields the same row counts) and produces the demo Qur'an academy.
- **AC-1.13** The `(academy_id, teacher_id, scheduled_at_utc)` and student equivalents indexes exist for calendar queries.
- **AC-1.14** All canonical enums (§9) exist as Postgres types with exactly the documented values.
- **AC-1.15** With **no tenant context set**, a normal `select` on `invoices` returns zero rows (FORCE RLS), but `app.public_invoice_by_token(<valid token>)` returns that one invoice's curated payload, and `app.public_invoice_by_token(<wrong token>)` returns NULL. (§7.6, supports R-INV-5)

---

## 11. Test Cases

> `TC-1.<n>`, mapped to ACs. Isolation tests run via Pest using the harness that sets the tenant GUCs to simulate users (the real `TenantContextMiddleware` bridge arrives in Sprint 2).

### Migrations & structure
- **TC-1.1** Apply all migrations to a fresh DB → success; schema matches expected table list. *(AC-1.1)*
- **TC-1.2** Roll back all migrations → database returns to empty; re-apply succeeds. *(AC-1.1)*
- **TC-1.3** Introspect every tenant-scoped table → `relrowsecurity` and `relforcerowsecurity` are true. *(AC-1.2)*
- **TC-1.4** Introspect enum types → each of the 8 enums has exactly the documented labels. *(AC-1.14)*
- **TC-1.5** Static check: no column in domain tables is of type `real`, `double precision`, or `numeric` for money; monetary columns are `bigint`. *(AC-1.10)*
- **TC-1.6** Calendar indexes exist on `sessions`. *(AC-1.13)*

### Tenant isolation (the core of this sprint)
- **TC-1.7** Seed two academies A and B with students. Set context A → `select count(*) from students` equals A's count only; none of B's rows appear. *(AC-1.3)*
- **TC-1.8** Context A: `select * from invoices where academy_id = <B.id>` returns 0 rows (policy filters even an explicit cross-tenant filter). *(AC-1.3)*
- **TC-1.9** Context A: INSERT a student with `academy_id = B.id` → rejected by `with check`. *(AC-1.4)*
- **TC-1.10** Context A: UPDATE one of A's students setting `academy_id = B.id` → rejected. *(AC-1.5)*
- **TC-1.11** Context A: attempt to DELETE one of B's students (by id) → affects 0 rows (invisible, so not deletable). *(AC-1.3)*
- **TC-1.12** No context set (`app.current_academy_id` empty) → tenant tables return 0 rows (fail closed, never open). *(AC-1.3)*
- **TC-1.13** Iterate this isolation suite across **all** tenant-scoped tables, not just students (parameterized test). *(AC-1.2/1.3)*

### Super Admin path
- **TC-1.14** Role SUPER_ADMIN, no academy entered → tenant tables return 0 rows via normal query. *(AC-1.6)*
- **TC-1.15** SUPER_ADMIN enters Academy A (sets GUC) → sees A's rows only. *(AC-1.6)*
- **TC-1.16** `app.admin_list_academies()` returns all academies only when role is SUPER_ADMIN; for any other role it raises/denies. *(AC-1.6)*

### Append-only audit & immutability
- **TC-1.17** INSERT into `audit_log` succeeds under a normal academy context. *(AC-1.7)*
- **TC-1.18** UPDATE an `audit_log` row → denied. DELETE → denied. *(AC-1.7)*
- **TC-1.19** Create an OPEN invoice, add a line item → success; totals update. *(AC-1.8 baseline)*
- **TC-1.20** Close the invoice (status→CLOSED); attempt to add another line item → trigger raises 'cannot add line item to non-open invoice'. *(AC-1.8, R-INV-3)*
- **TC-1.21** On a CLOSED invoice, attempt to change `total_minor` → trigger raises. *(AC-1.8)*
- **TC-1.22** Transition CLOSED→PAID with payment_method+reason → allowed (the one permitted state move). *(AC-1.8, R-INV-6)*
- **TC-1.22b** No context set: `select * from invoices` → 0 rows; `app.public_invoice_by_token(valid)` → the invoice payload; `app.public_invoice_by_token(bogus)` → NULL; the function never returns more than one invoice. *(AC-1.15, §7.6)*

### Relationship integrity
- **TC-1.23** Insert a second active assignment (ended_at null) for a student that already has one → unique partial index rejects. *(AC-1.9, R-STU-3)*
- **TC-1.24** Closing the first assignment (set ended_at) then adding a new active one → succeeds (teacher change with history). *(R-STU-3)*
- **TC-1.25** Duplicate `invoice_line_items (invoice_id, session_id)` → unique constraint rejects. *(AC-1.11, R-BIL-1)*
- **TC-1.26** Duplicate `payout_line_items (payout_id, session_id)` → rejected. *(AC-1.11)*
- **TC-1.27** Invoice with neither guardian_id nor student_id, or with both → check constraint rejects. *(R-INV-4)*
- **TC-1.28** Two invoices for the same payer + same period → unique constraint rejects. *(R-INV-1)*

### Money & currency
- **TC-1.29** Subscription stores `price_minor=10000, currency='EGP'`; read back exact, no precision loss. *(AC-1.10)*
- **TC-1.30** Invoice line snapshot retains its `amount_minor`/`currency` even after the subscription price later changes (set via app in Sprint 7; here verify the column is independent and not a FK to live price). *(R-INV-3)*

### Seed
- **TC-1.31** Run seed on empty DB → demo Qur'an academy with expected counts (1 academy, 1 guardian, 2 students, 2 teachers, 5 report fields). *(AC-1.12)*
- **TC-1.32** Run seed again → same counts (idempotent upsert, no duplicates). *(AC-1.12)*
- **TC-1.33** Seeded `report_field_definitions` for QURAN include keys surah_from, surah_to, tajweed_rating, next_assignment, notes with correct types. *(R-CRF-1, AC-1.12)*

## 12. Risks & mitigations
- **Risk:** A new table added in a later sprint forgets RLS → silent cross-tenant leak. **Mitigation:** TC-1.13 is parameterized over *all* tenant tables discovered by introspection; a new table without the standard policy fails CI automatically. Document the rule in the README.
- **Risk:** `with check` omitted on a policy (reads filtered but writes not constrained). **Mitigation:** TC-1.9/1.10 run per-table; introspection test asserts both `qual` and `with_check` are present.
- **Risk:** Failing **open** when GUC unset (e.g. a background job without context). **Mitigation:** TC-1.12 asserts fail-closed; helper returns NULL and `academy_id = NULL` matches nothing.
- **Risk:** uuid-v7 extension availability on the Supabase Postgres instance. **Mitigation:** provide a fallback `uuid_generate_v7()` implemented in SQL/PLpgSQL in the first (`extensions_and_enums`) migration via `DB::unprepared`.
- **Risk (novel — spike this FIRST):** RLS-on-Laravel is off the beaten path, and three things must line up before any isolation test can pass: **(a)** the app must connect as a role for which RLS is enforced (FORCE RLS covers the owner, so this works, but verify the connection role); **(b)** the **connection pooler must be session-compatible** — Supabase's *transaction-mode* pooler (port 6543) breaks session/transaction GUCs, so the app connects via the *session-mode* pooler or the direct connection (port 5432); **(c)** Pest's `RefreshDatabase` wraps each test in its own transaction, which interacts with the per-request transaction-local GUCs — tests must `set_config(..., true)` **inside the same transaction** they query in. **Mitigation:** before building the full schema, run a one-day spike: a single table with the standard policy, a Pest test that sets the GUCs and proves both fail-closed (no context → 0 rows) and isolation (context A → only A). Lock the DB-role + pooler + test-harness pattern, then replicate across all tables. This de-risks the whole sprint.

## 13. Estimate
**Large.** This is the backbone and the highest-leverage sprint for correctness. The schema breadth is wide but mechanical; the **RLS policy correctness and the isolation test suite** are where the time goes — and where it must be spent. **Start with the RLS-on-Laravel spike (§12, last risk)** — the test-harness/pooler pattern it locks is a prerequisite for every other AC. Do not rush AC-1.3 through AC-1.6.

## 14. Handoffs to later sprints
- **Sprint 2** wires `TenantContextMiddleware` (Sanctum user → `app.*` GUC bridge) and consumes `permissions`/`role_permissions` via Laravel Gates/Policies.
- **Sprint 5** implements the session generator writing into `sessions`/`schedule_slots`.
- **Sprint 6** writes `session_reports.values` against `report_field_definitions`.
- **Sprint 7** implements the billing hook (session→line item with snapshot) and the month-end close job that flips invoices to CLOSED (relying on the immutability triggers built here).
- **Sprint 8** aggregates `payout_line_items`.
- **Sprint 9** reads `audit_log` and enforces `plans.features` gating.
