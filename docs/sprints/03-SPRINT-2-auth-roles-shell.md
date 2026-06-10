# Sprint 2 — Auth, Roles & App Shell

> **Status:** Detailed / Ready to execute
> **Depends on:** Sprint 0 (running Laravel API + Next.js, Sanctum installed & idle, i18n, shell), Sprint 1 (schema, RLS policies, tenant-context contract, permissions/role_permissions tables)
> **Blocks:** Sprints 3–9 (every feature screen lives inside this authenticated shell and relies on these authorization checks)
> **References:** Master Spec §4 (Roles & RBAC), §5.1 (tenancy rules), §6.2 (tenant-context middleware), §6.3 (cross-cutting); Sprint 1 §4 (tenant-context contract), §6.2 (users / user_roles / permissions / role_permissions), §7.4 (Super Admin path)

---

## 1. Goal

Make the tenant-context contract from Sprint 1 **real**. A person logs in, the system verifies who they are, derives their academy and role, and sets the database session variables (`app.current_user_id`, `app.current_academy_id`, `app.current_role`) so that RLS does its job on every query. Authorization is checked against the **permissions** tables (capabilities), not hardcoded role strings. The prototype's visual shell becomes the real authenticated layout, routing each role to exactly what it's allowed to see.

The deliverable is judged on: *can a user reach, see, or act on anything beyond what their role's permissions allow — through the UI, an API call, or a forged request?* The answer must be **no**, enforced in two independent layers (app authorization **and** database RLS).

## 2. Scope

### In scope
- **Laravel Sanctum SPA auth** (stateful cookie auth): the Next.js client primes the CSRF cookie (`GET /sanctum/csrf-cookie`), posts email/password to a Laravel login route (`Auth::attempt`, session regenerated), and the session rides in an HTTP-only cookie; secure logout invalidates the session.
- **The auth → GUC bridge** (`TenantContextMiddleware`): a Laravel middleware that, on every authenticated request, reads the Sanctum-authenticated user, resolves their academy and role, and sets the three `app.*` session variables on the database connection before any query runs. This is the linchpin that activates Sprint 1's RLS.
- Resolving the authenticated `users` row to its `user_roles` (academy + role). (No Supabase `auth.users` — the `users` table is the auth source, per Sprint 1 §6.2.)
- **RBAC layer**: load the current user's permission set (from `role_permissions`), register them as **Laravel Gate abilities**, expose `$user->can(permission)` / `Gate::authorize(permission)`, and guard both controllers and UI affordances with it.
- Route protection: unauthenticated → login; authenticated-but-unauthorized → 403; role-based landing (Super Admin → platform view; Owner → academy dashboard; Teacher → own schedule).
- The **Super Admin "enter academy"** action (sets target `academy_id` in context) per Sprint 1 §7.4, with an audit entry.
- Convert the prototype shell (sidebar, header, RTL, locale switcher) into the real authenticated layout; render nav items conditionally by permission.
- Session-aware bilingual: locale persists per user; direction follows locale.
- Account essentials: "who am I" endpoint, sign-out, basic profile display (name, role, academy).
- Audit entries for `auth.login`, `auth.logout`, `admin.enter_academy`, `role.assigned` (the latter when seeded/changed).

### Out of scope (deferred)
- User/teacher invitation & onboarding flows, password reset emails (Sprint 3 covers Owner-created teacher logins minimally; full self-service invites are post-MVP / Sprint 13).
- Self-service academy signup (Sprint 13).
- Any domain CRUD screens (Sprints 3+) — this sprint delivers the *empty but real* role-appropriate dashboards.
- Per-academy branding on the login page (reserved fields exist; surfaced in Sprint 12).
- MFA / SSO (post-MVP).

---

## 3. Design decisions (locked for this sprint)

1. **Two-layer authorization.** Laravel Gate/Policy checks **and** database RLS are both enforced. RLS is the backstop: even a bug in app authorization cannot leak cross-tenant data. App checks give good UX (hide what you can't do, return clean 403s).
2. **Capabilities, not roles, in business logic.** Code asks `$user->can('invoice.mark_paid')` (a Gate ability), never `if ($role === 'ACADEMY_OWNER')`. This is what makes a future "Supervisor" role a data change (Master Spec §4 design note).
3. **The GUC bridge runs server-side only, per request, inside the request's DB transaction.** The variables are set with `select set_config('app.current_academy_id', ?, true)` using the **local** (transaction-scoped) flag so they never leak across pooled connections. `TenantContextMiddleware` opens the transaction and sets them before any query; the `Tenancy::withContext()` helper is the equivalent entry point for jobs/commands that run outside the HTTP middleware.
4. **Fail closed.** If there is no valid Sanctum session, or the user has no resolvable academy/role, the context is left unset → Sprint 1's RLS returns zero rows and protected routes reject. Never default to an academy.
5. **Super Admin has `academy_id = NULL`** in `users`/`user_roles`. They see no tenant rows until they explicitly "enter" an academy, which sets `app.current_academy_id` to the target for the duration of that request scope (Sprint 1 §7.4).
6. **Teacher scoping is RLS-plus-filter.** A Teacher is inside their academy (RLS) **and** further limited to their own students/sessions by app-layer query filters (e.g. Eloquent global scopes) keyed on their `teacher_id`. (Teacher-level row filtering beyond academy isolation is an app concern; academy isolation remains DB-enforced.)
7. **The Sanctum session is the source of truth for identity, not for authority.** The session cookie identifies the `users` row; the app resolves academy/role/permissions from our tables on each request (so revoking a role takes effect immediately, not at next login).

---

## 4. The auth → GUC bridge (`TenantContextMiddleware`, the linchpin)

This is the mechanism that connects "who is logged in" to "what the database lets them touch." It is the most important piece of this sprint, implemented as a Laravel middleware on the authenticated route group (running **after** Sanctum's `EnsureFrontendRequestsAreStateful` + `auth:sanctum`).

### 4.1 Flow per authenticated request
```
1. Request arrives with the Sanctum session cookie (+ XSRF-TOKEN header for writes).
2. Sanctum authenticates the session → $request->user() is the users row. Absent/invalid → 401, context unset.
3. (Identity is the authenticated users row itself — no external auth.users lookup.)
   - Inactive (is_active = false) → 401, context unset (fail closed).
4. Resolve role & academy:
   - From user_roles for this user.
   - SUPER_ADMIN → academy_id stays NULL unless an "entered academy" is present in the session.
   - ACADEMY_OWNER / TEACHER → academy_id from their user_roles row.
5. Open the DB work inside a transaction and set the GUCs (transaction-local):
       select set_config('app.current_user_id', <users.id>, true);
       select set_config('app.current_role',    <role>,      true);
       select set_config('app.current_academy_id', <academy_id or ''>, true);
6. Run the query/queries. RLS (Sprint 1) now scopes everything automatically.
7. Transaction ends → GUCs vanish with it (no leakage across pooled connections).
```

### 4.2 Why transaction-local `set_config(..., true)`
The Postgres connection may be pooled (Supabase's PgBouncer, or a long-lived app pool). A session-level `SET` could bleed into the next request that reuses the connection. The `true` (is_local) flag scopes the setting to the current transaction only. **Every authenticated DB operation must run inside such a transaction with the GUCs set first.** `TenantContextMiddleware` (HTTP) and the `Tenancy::withContext()` helper (jobs, Artisan commands, seeders) are the *only* sanctioned DB entry points; raw DB access outside them is banned by review. *(Connect via Supabase's session-mode pooler / direct port for the app role; do not rely on session-level GUCs surviving a transaction-mode pooler hop.)*

### 4.3 The bridge (contract)
```php
// app/Support/Tenancy.php — contract, not final code
final class Tenancy
{
    /** @template T  @param callable():T $fn  @return T */
    public static function withContext(AuthContext $ctx, callable $fn): mixed
    {
        return DB::transaction(function () use ($ctx, $fn) {
            DB::statement("select set_config('app.current_user_id', ?, true)", [$ctx->userId]);
            DB::statement("select set_config('app.current_role', ?, true)", [$ctx->role]);
            DB::statement("select set_config('app.current_academy_id', ?, true)",
                [$ctx->academyId ?? '']);   // '' → helper returns NULL → fail closed
            return $fn();
        });
    }
}
```
- `AuthContext` is built once per request by `TenantContextMiddleware` (steps 1–4 above) and bound into the container.
- For a Super Admin who has entered an academy, `$ctx->academyId` is the entered target; otherwise `null`.

### 4.4 Super Admin "enter academy"
- An explicit action `POST /api/admin/academies/{id}/enter` stores the entered academy id in the Laravel server-side session.
- It writes an `audit_log` entry `admin.enter_academy` (actor, target academy, timestamp) — Sprint 1 §7.4 / R-AUD-1.
- "Exit academy" clears it from the session; the Super Admin returns to the platform (no-tenant) view.
- Platform-wide reads (list all academies) use the audited `app.admin_list_academies()` function from Sprint 1, gated on `app.current_role() = 'SUPER_ADMIN'`.

---

## 5. RBAC layer

### 5.1 Loading permissions
On building `AuthContext`, load the set of permission codes for the user's role(s) from `role_permissions ⋈ permissions`. Register them as Laravel Gate abilities for the request via a `Gate::before` callback (or `Gate::define` per code) that consults the loaded set. Resolved per request only (role changes take effect on next request — decision §3.7).

### 5.2 The permission check (Laravel Gates)
```php
$user->can('student.create')          // boolean
Gate::authorize('invoice.mark_paid')  // throws AuthorizationException → 403 if absent
```
- **Controllers:** every mutation and protected read calls `Gate::authorize(...)` first (e.g. via a `can:` route middleware or `$this->authorize(...)` in the controller). This is mandatory, not optional UX.
- **API responses for the UI:** `GET /api/auth/me` returns the resolved `permissions[]` so the Next.js client can render nav items, buttons, and menu entries only when permitted. A hidden button is not a security control — the server `Gate::authorize` is — but it keeps the UI honest.

### 5.3 Permission catalog (seeded in Sprint 1, consumed here)
Representative codes (full list maintained alongside the seed):
```
academy.create, academy.suspend, academy.configure, academy.enter
plan.manage
user.invite, role.assign
teacher.read, teacher.create, teacher.update, teacher.deactivate
guardian.read, guardian.create, guardian.update
student.read, student.create, student.update, student.deactivate
schedule.read, schedule.manage
session.read, session.mark_attendance, session.write_report, session.reschedule, session.cancel
invoice.read, invoice.mark_paid, invoice.send_link
payout.read, payout.read_own
report_field.manage
audit.read
```

### 5.4 Default role → permission mapping (seed intent)
- **SUPER_ADMIN:** platform caps (`academy.*`, `plan.manage`, `audit.read` platform-wide) + the ability to act within an entered academy.
- **ACADEMY_OWNER:** all academy-scoped caps **except** platform ones; includes `audit.read` (own academy), `invoice.mark_paid`, `report_field.manage`, `role.assign` (within academy, for teachers).
- **TEACHER:** `schedule.read` (own), `session.read/mark_attendance/write_report/reschedule/cancel` (own), `student.read` (own), `payout.read_own`. **No** invoice, payroll-of-others, or configuration caps.

---

## 6. Routing & layout

### 6.1 Route protection
| Situation | Result |
|---|---|
| No valid session | Redirect to `/login` |
| Valid session, route allowed by permission | Render |
| Valid session, route not allowed | `403` page (clean, bilingual) |
| Super Admin, no academy entered, hits academy-scoped route | Redirect to academy picker / platform view |

### 6.2 Role-based landing
- **Super Admin →** platform view (academy list, plans). No tenant data visible until they enter an academy.
- **Academy Owner →** academy dashboard (the prototype's "Overview", but empty/real data from their academy).
- **Teacher →** own weekly schedule (the calendar), limited nav.

### 6.3 Shell conversion (from prototype)
- Port sidebar + header + RTL + locale switcher from the Sprint-0 static shell into an authenticated layout.
- Nav items are filtered by `can(...)`: e.g. a Teacher does not see Invoices, Payroll, Academies, or Settings.
- Header shows the current user (name, role) and, for Super Admin, the "entered academy" indicator with an Exit control.
- Locale switcher persists choice on the `users` row (or session) and flips `dir` (Sprint 0 AC-0.3 still holds).

---

## 7. Schema / Data deltas

Sprint 1 already created `users`, `user_roles`, `permissions`, `role_permissions`. This sprint adds only small, additive columns/records:

- **`users.preferred_locale`** `text not null default 'ar'` — persists the language choice (R-LOC-1).
- **`users.last_login_at`** `timestamptz null` — updated on login (also audited).
- **Session-entered-academy** is **not** a DB column; it lives in the Laravel server-side session (stored in the `sessions` table / secure cookie), because it is per-session UI state for a Super Admin, not durable data. (Audited via `audit_log` when changed.)
- Seed/extend `permissions` and `role_permissions` (Laravel seeders) to match §5.3/§5.4 if not fully seeded in Sprint 1.

A Laravel migration `..._add_auth_prefs_to_users` (with a working `down()`) adds the two columns; `php artisan migrate`.

---

## 8. API surface

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /sanctum/csrf-cookie` | public | Sanctum: issue the `XSRF-TOKEN` cookie before login/any write |
| `POST /api/auth/login` | public | Email/password → `Auth::attempt`, regenerate session; audit `auth.login` |
| `POST /api/auth/logout` | authenticated | `Auth::logout` + invalidate session; audit `auth.logout` |
| `GET /api/auth/me` | authenticated | Returns `{ user, role, academyId, permissions[], locale }` |
| `PATCH /api/auth/locale` | authenticated | Set `preferred_locale`; flips UI direction |
| `GET /api/admin/academies` | `academy.read` (SUPER_ADMIN) | Audited `app.admin_list_academies()` |
| `POST /api/admin/academies/{id}/enter` | `academy.enter` | Enter academy context; audit `admin.enter_academy` |
| `POST /api/admin/academies/exit` | authenticated SUPER_ADMIN | Clear entered academy |

All non-public endpoints run through `TenantContextMiddleware` (GUCs set) and call `Gate::authorize` where a capability applies.

---

## 9. Definition of Done / Acceptance Criteria

- **AC-2.1** A seeded Academy Owner can log in and lands on their academy dashboard; an invalid password is rejected.
- **AC-2.2** On every authenticated DB operation, the three `app.*` GUCs are set **transaction-locally**; they are unset/absent outside the transaction. (decision §3.3/§4.2)
- **AC-2.3** With the bridge active, an Owner of Academy A querying any tenant table receives only Academy A rows (RLS now driven by real login, not test harness). (R-TEN-1/2)
- **AC-2.4** A Teacher cannot load the Invoices, Payroll, Academies, or Settings routes (UI hides them **and** the server returns 403 if forced). (§5.2)
- **AC-2.5** `Gate::authorize` blocks a mutation when the capability is absent, returning 403 without performing the write. (two-layer authorization, §3.1)
- **AC-2.6** A Super Admin with no academy entered sees zero tenant rows on academy-scoped queries; after entering Academy A, sees A's rows. (R-TEN-3, §4.4)
- **AC-2.7** Entering an academy writes an `admin.enter_academy` audit entry; login and logout write `auth.login` / `auth.logout`. (R-AUD-1)
- **AC-2.8** Revoking a user's role takes effect on their **next request** (permissions resolved per request from the tables, not cached on the session). (§3.7)
- **AC-2.9** Connection-pool safety: two interleaved requests from different academies never see each other's GUCs (no leakage). (§4.2)
- **AC-2.10** `GET /auth/me` returns the correct role, academyId, and permission set for each of the three roles.
- **AC-2.11** Locale choice persists across logins and flips layout direction (RTL/LTR) — Sprint 0 behavior now tied to the user.
- **AC-2.12** Nav renders exactly the items each role is permitted to see (snapshot per role).
- **AC-2.13** A missing/invalid/expired Sanctum session results in 401 and unset context (fail closed); no partial data returned.

## 10. Test Cases

> `TC-2.<n>`, mapped to ACs. Auth tests run in Pest using real Sanctum sessions (`actingAs($user)` / posting to the login route) — this sprint replaces the Sprint-1 GUC test harness with the actual `TenantContextMiddleware` bridge.

### Login / session
- **TC-2.1** Valid Owner credentials → 200, session established, redirect to academy dashboard. *(AC-2.1)*
- **TC-2.2** Wrong password → rejected, no session, no context set. *(AC-2.1, AC-2.13)*
- **TC-2.3** Logout clears the session; a subsequent protected request → 401. *(AC-2.7)*
- **TC-2.4** `GET /auth/me` for Owner returns role ACADEMY_OWNER, correct academyId, owner permission set. *(AC-2.10)*
- **TC-2.5** `GET /auth/me` for Teacher returns TEACHER and the limited permission set (no invoice/payroll caps). *(AC-2.10)*
- **TC-2.6** `GET /auth/me` for Super Admin returns SUPER_ADMIN, academyId null. *(AC-2.10)*

### The GUC bridge & isolation under real auth
- **TC-2.7** Logged-in Owner of A: `select count(*) from students` returns A's count only. *(AC-2.3)*
- **TC-2.8** Inspect the DB session during an authenticated request: `current_setting('app.current_academy_id', true)` equals A's id; immediately after the transaction, it is empty/NULL. *(AC-2.2)*
- **TC-2.9** Simulate two concurrent requests — Owner A and Owner B — sharing the pool; each sees only its own academy's rows; neither observes the other's GUC. *(AC-2.9)*
- **TC-2.10** A request with an expired/invalid Sanctum session → 401, GUCs never set, query path not reached. *(AC-2.13)*
- **TC-2.11** A session cookie for a deleted or `is_active = false` user → 401, fail closed. *(AC-2.13)*
- **TC-2.12** Background/no-context code path (a job/command not wrapped in `Tenancy::withContext`) cannot read tenant rows (returns zero rows / is blocked by review). *(AC-2.2, fail closed)*

### RBAC — two layers
- **TC-2.13** Teacher requests `/invoices` route → 403 page; nav never showed the link. *(AC-2.4)*
- **TC-2.14** Teacher forces `POST /api/invoices/{id}/mark-paid` directly → `Gate::authorize('invoice.mark_paid')` returns 403; no DB write occurs. *(AC-2.5)*
- **TC-2.15** Owner calls the same endpoint → permitted (capability present). *(AC-2.5)*
- **TC-2.16** Teacher `session.write_report` on **their own** session → allowed; on another teacher's session → blocked by app-layer teacher filter. *(§3.6)*
- **TC-2.17** Revoke Owner's `invoice.mark_paid` (data change); next request → 403, without re-login. *(AC-2.8)*
- **TC-2.18** Add a new role row mapping (simulate "Supervisor") with a subset of caps → a user with it gets exactly those caps, no code change. *(Master Spec §4 design note)*

### Super Admin path
- **TC-2.19** Super Admin, no academy entered, hits `/students` → redirected to picker; tenant query returns zero rows. *(AC-2.6)*
- **TC-2.20** Super Admin enters Academy A → can now read A's rows; an `admin.enter_academy` audit row exists with the right actor/target. *(AC-2.6, AC-2.7)*
- **TC-2.21** Super Admin exits → tenant queries return zero rows again. *(AC-2.6)*
- **TC-2.22** `GET /admin/academies` as Owner → 403; as Super Admin → list of all academies via the audited function. *(§4.4)*

### Layout / i18n / nav
- **TC-2.23** Owner nav snapshot includes Overview, Academies(if permitted), Students, Teachers, Calendar, Attendance, Invoices, Payroll, Settings as permitted; Teacher nav snapshot includes only Calendar, Attendance(own), and own profile. *(AC-2.12)*
- **TC-2.24** Set locale to English via `PATCH /auth/locale` → `dir=ltr`, English strings; persists after logout/login. *(AC-2.11)*
- **TC-2.25** Set locale back to Arabic → `dir=rtl`, Arabic strings; default for a new user is Arabic. *(AC-2.11)*
- **TC-2.26** Header shows current user name + role; for Super Admin in an entered academy, shows the entered-academy indicator + Exit. *(§6.3)*

### Audit
- **TC-2.27** Successful login writes `auth.login` (actor, timestamp, academy if applicable); logout writes `auth.logout`. *(AC-2.7)*
- **TC-2.28** Role assignment/seed writes `role.assigned`. *(R-AUD-1)*

## 11. Risks & mitigations
- **Risk (highest):** GUC leakage across pooled connections → cross-tenant data exposure. **Mitigation:** transaction-local `set_config(...,true)` only; `TenantContextMiddleware` / `Tenancy::withContext()` are the *only* sanctioned DB entry points; TC-2.8/2.9 explicitly assert no leakage; review bans raw DB calls outside them.
- **Risk:** App authorization and RLS drift apart (one allows what the other denies, causing confusing 500s or, worse, a gap). **Mitigation:** RLS is the backstop by design; tests assert both layers (TC-2.13/2.14). Treat any RLS denial reaching the user as a bug in the app-layer `Gate::authorize`.
- **Risk:** Stale permissions after a role change. **Mitigation:** resolve permissions per request from tables (decision §3.7); TC-2.17 verifies immediate effect.
- **Risk:** Super Admin accidentally operating cross-tenant. **Mitigation:** no blanket policy; explicit audited enter/exit; default no-tenant view (TC-2.19/2.21).
- **Risk:** Forgetting `Gate::authorize` (or the `can:` middleware) on a new endpoint. **Mitigation:** a route-test convention requires every mutating endpoint to have an explicit allowed/denied pair; CI checks coverage of the auth matrix.
- **Risk:** Sanctum SPA cookie auth misconfigured (cross-origin cookies not sent). **Mitigation:** set `SANCTUM_STATEFUL_DOMAINS`, `SESSION_DOMAIN`, and CORS `supports_credentials=true` (Sprint 0); the Next.js client must call `GET /sanctum/csrf-cookie` before the first write and send `credentials: "include"`; assert the login→`/auth/me` round trip in a test.

## 12. Estimate
**Medium–Large.** The schema delta is tiny, but the **`TenantContextMiddleware` auth→GUC bridge and the no-leakage guarantee** are subtle and security-critical — they get the bulk of the effort and the most rigorous tests (TC-2.7 through TC-2.12, TC-2.19 through TC-2.22). The shell conversion is straightforward porting from the prototype.

## 13. Handoffs to later sprints
- Every subsequent sprint builds screens **inside** this authenticated shell; all DB work flows through `TenantContextMiddleware` (or `Tenancy::withContext()` for jobs/commands).
- Sprint 3 (Academy management) uses the Super Admin platform view and the enter/exit flow built here.
- Sprint 4+ use `$user->can(...)` / `Gate::authorize(...)` for all CRUD authorization.
- Sprint 9 (hardening) reads the `audit_log` entries this sprint starts producing and runs a security review against the no-leakage guarantee.
