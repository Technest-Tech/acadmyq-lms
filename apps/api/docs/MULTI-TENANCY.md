# Multi-tenancy & Row-Level Security (Sprint 1)

Tenant isolation in AcademIQ is a **database guarantee**, not an application convention.
Every tenant row carries an `academy_id`, and PostgreSQL Row-Level Security (RLS) — with
`FORCE ROW LEVEL SECURITY` — decides what each request may read or write. The question the
schema must answer is: *can a user from Academy A ever read or write a row of Academy B?*
The answer is a DB-enforced **no**.

## Roles

RLS only bites if the app connects as a role that is subject to it. Two roles matter
(provisioned by `database/bootstrap/roles_and_databases.sql`):

| Role | Attributes | Purpose |
|---|---|---|
| `academiq_app` | LOGIN, **NOSUPERUSER, NOBYPASSRLS** | The single role Laravel uses for migrations **and** runtime. Owns every table; `FORCE RLS` is what makes RLS apply to the owner. |
| `academiq_rls_bypass` | NOLOGIN, **BYPASSRLS** | Owns the SECURITY DEFINER escape-hatch functions so they (and only they) can cross tenants in an audited, allow-listed way. `academiq_app` is a member so a migration can hand it function ownership; membership does **not** grant the BYPASSRLS attribute. |

> A superuser or a BYPASSRLS role silently defeats isolation. Never point the app at one.
> On this machine the OS superuser has `Bypass RLS`, which is exactly why tests connect as
> `academiq_app`.

## The tenant-context contract (§4)

Three session GUCs are set per request, **after** authentication:

```
app.current_user_id    uuid of the authenticated user
app.current_academy_id uuid of the academy the request operates within
app.current_role       'SUPER_ADMIN' | 'ACADEMY_OWNER' | 'TEACHER'
```

Policies read them via `app.current_*()`, which return `NULL` (never error) when unset —
so **no context ⇒ zero rows** (fail closed). In production `TenantContextMiddleware` wraps
each request in one transaction and `SET LOCAL`s these from the Sanctum user (the GUC
writer is `App\Support\TenantContext`). Because the context is transaction-local, the app
**must** use the Supabase SESSION-mode pooler / direct connection (port 5432), never the
transaction-mode pooler (6543).

## The rule for every new tenant-scoped table

Any table that holds tenant data **must**:

1. have `academy_id uuid not null references academies(id)`,
2. be `enable`d **and** `force`d for row level security,
3. carry the standard policy:

```sql
create policy tenant_isolation on <table>
  using      (academy_id = app.current_academy_id())
  with check (academy_id = app.current_academy_id());
```

This is enforced in CI: `tests/Feature/Rls/IntrospectionTest.php` is parameterized over
the canonical tenant-table list and asserts both `USING` and `WITH CHECK` are present and
that RLS is forced. A new tenant table added without the policy fails the suite.

## Escape hatches (the only cross-tenant paths)

- `app.admin_list_academies()` — platform-wide academy list; raises unless
  `app.current_role() = 'SUPER_ADMIN'`.
- `app.public_invoice_by_token(text)` — the public invoice page; returns a curated payload
  for one exact token or `NULL`. Never a list, never raw rows.

Both are `SECURITY DEFINER`, owned by `academiq_rls_bypass`, `EXECUTE` granted only to the
app role. There is **no** blanket "see all rows" policy.

## Sprint 2: the bridge is real (auth → GUCs)

`TenantContextMiddleware` is now registered (`tenant.context`) on the authenticated API
group, after `auth:sanctum`. It resolves the role + academy, loads the role's capability
set, and runs the request inside one `Tenancy::withContext()` transaction that `SET LOCAL`s
the three GUCs. `Tenancy::withContext()` is the equivalent entry point for jobs/commands.

**Login-under-RLS.** Auth runs *before* any context exists, so a plain `select` on the
RLS-protected `users` / `user_roles` would match zero rows and every login would fail. Four
more `SECURITY DEFINER` / BYPASSRLS-owned escape hatches (migration
`..._auth_rls_bypass_functions`) are the only sanctioned context-free path into the identity
tables:

- `app.auth_find_by_email(text)` — credential lookup for `Auth::attempt`.
- `app.auth_find_by_id(uuid)` — session resumption (the guard's `retrieveById`).
- `app.auth_user_roles(uuid)` — resolve a user's `(role, academy_id)` assignments.
- `app.auth_touch_last_login(uuid)` — stamp `last_login_at` at login.

They are consumed by `App\Auth\RlsBypassUserProvider` (the `rls-eloquent` provider) and the
middleware. Everything else still flows through the context.

**Super-Admin rows.** A `SUPER_ADMIN` user/role has `academy_id NULL`, which the standard
`= app.current_academy_id()` policy can never admit. `users` and `user_roles` therefore
carry an augmented policy: `academy_id = app.current_academy_id() OR (academy_id is null and
app.is_super_admin())`. Still fail-closed (no role ⇒ both branches false), and an Owner never
sees platform-admin rows. All other tenant tables keep the plain Sprint-1 policy.

**Authorization is data.** `$user->can(code)` / `Gate::authorize(code)` are answered by a
single `Gate::before` (in `AuthServiceProvider`) consulting the request's `AuthContext`,
whose permission set comes from `role_permissions ⋈ permissions`. No `if ($role === …)`
anywhere — a new capability or role is a row change. RLS remains the backstop under any
app-layer gap.

## Local setup

```bash
# 1. Provision roles + databases once (as a Postgres superuser):
psql -h 127.0.0.1 -p 5432 -d postgres -f database/bootstrap/roles_and_databases.sql

# 2. Migrate + seed the demo Qur'an academy:
php artisan migrate
php artisan db:seed

# 3. Tests run against academiq_test as academiq_app (see phpunit.xml):
php artisan test
```
