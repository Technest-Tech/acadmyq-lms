# Super Admin Panel — Buildout Plan

> Living plan. We build one phase at a time, in order. Each phase lists scope, backend
> work, frontend work, permissions, tests, and acceptance criteria. Check items off as we go.

## Context & principles (do not violate)

- **Two-layer authz**: every endpoint calls `Gate::authorize()` (capability) AND is backed by
  Postgres RLS. UI `can(permission)` is UX-only — never the real control.
- **Cross-tenant reads** go through audited `SECURITY DEFINER` functions (pattern:
  `app.admin_list_academies()`, `app.admin_audit()`). Never bypass RLS ad-hoc.
- **Cross-tenant writes** run inside the target academy's context via `Tenancy::withContext()`.
- **Data-driven config**: roles, permissions, plans, add-ons, academy-types are DB rows.
- **Audit everything destructive/sensitive** via `Audit::log()` with before/after.
- **No hard-delete academies** — suspend only.
- **Frontend conventions**: `page.tsx` (server, wraps AuthProvider→AppShell) + `screen.tsx`
  (`"use client"`, permission-gated). API in `lib/api.ts` typed functions. i18n keys in
  `messages/en.json` + `ar.json`. RTL-safe (logical CSS props). shadcn UI in `components/ui/`.
- Super Admin session: `role = SUPER_ADMIN`, `academyId = null`, `permissions: string[]`.

## Current state (baseline — already built)

| Capability | API | UI |
| --- | --- | --- |
| Academy list / create / edit / suspend / reactivate | ✅ | ✅ |
| Academy enter/exit (impersonate) | ✅ | ❌ |
| Provision/re-provision owner | ✅ | ❌ |
| Per-academy plan + add-on assignment | ✅ | ❌ |
| Plan & add-on catalog CRUD | ✅ | 🟡 read-only |
| Platform-wide audit log | ✅ | ✅ |
| Staff departments catalog | ✅ | ✅ |
| **Admin dashboard / KPIs** | ❌ | ❌ |
| **Cross-tenant user management** | ❌ | ❌ |
| **Billing / revenue view** | ❌ | ❌ |
| **Feature flags** | ❌ | ❌ |
| **Platform settings** | ❌ | ❌ |
| **Role / permission editor** | ❌ | ❌ |

---

## Phase 1 — Admin shell & dashboard ✅ DONE

**Goal:** Give Super Admin a real home: a landing dashboard with platform KPIs and recent
activity. Establishes the `/admin` shell that later phases plug into.

**Shipped:** `app.admin_dashboard_stats()` SECURITY DEFINER fn (migration
`2026_06_21_000001`), `Admin\DashboardController@index` → `GET /api/admin/dashboard`,
`/admin` page + `AdminDashboardScreen`, `adminHome` nav item, Super-Admin redirect from
`/dashboard` → `/admin`, en/ar i18n, 4 Pest tests (all green).

### Backend
- New `Admin\DashboardController@index` → `GET /api/admin/dashboard`.
  - Gate: `academy.read`.
  - Returns KPI bundle via a new audited `app.admin_dashboard_stats()` SECURITY DEFINER fn:
    - total academies (by status: TRIAL / ACTIVE / SUSPENDED)
    - total students, teachers, guardians (platform-wide)
    - academies created in last 30 days
    - plan distribution (count per plan)
    - recent audit events (last 10, platform-wide) — reuse `app.admin_audit()`
  - All counts come from one SECURITY DEFINER function (RLS-safe), no per-tenant loop.

### Frontend
- New route `/admin` → `page.tsx` + `screen.tsx` (`AdminDashboardScreen`).
- KPI cards (reuse card styling from plan screen), plan-distribution mini-bars,
  recent-activity list linking to `/audit`.
- Add `dashboard`-style nav entry **"Platform"** group? — No: add to existing `management`
  group as `adminHome` (icon `LayoutDashboard`, permission `academy.read`, href `/admin`).
- Optional: make `/admin` the default landing for SUPER_ADMIN after login.

### Permissions
- Reuse `academy.read`. No new permission.

### Tests
- Pest: `GET /api/admin/dashboard` as SUPER_ADMIN returns 200 + stat shape; as ACADEMY_OWNER
  returns 403; counts match seeded demo data.

### Acceptance
- [x] SUPER_ADMIN sees dashboard with correct counts.
- [x] Non-super roles get 403 and no nav item.
- [x] Recent activity links into audit log.

---

## Phase 2 — Academy detail control center ✅ DONE

**Goal:** Surface the powerful, already-built APIs that have no UI: impersonate, provision
owner, assign plan, grant/revoke add-ons. This is the highest operational value.

**Shipped:** `enterAcademy()` + `provisionAcademyOwner()` in api.ts; new
`AcademyPlanManager` (plan select + add-on grant/revoke toggles) and `AcademyOwnerSection`
(idempotent owner provisioning) components; a "Support access" section in `academy-detail`
with an audited Enter-academy confirm Modal that refreshes the session and lands on
`/dashboard` (Exit banner already lived in app-shell). en/ar i18n. No new backend — wired to
already-tested endpoints (EntitlementTest: plan/addon; SuperAdminTest: enter; AuthzMatrix).

### Backend
- No new endpoints — all exist:
  - `POST /api/admin/academies/{id}/enter` + `POST /api/admin/academies/exit`
  - `POST /api/admin/academies/{id}/owner`
  - `GET/POST /api/admin/academies/{id}/addons`, `POST /api/admin/academies/{id}/plan`
- Verify `enter`/`exit` audit entries and session var `entered_academy_id` flow end-to-end.

### Frontend
- `api.ts`: add `enterAcademy(id)`, `provisionAcademyOwner(id, {email, fullName})` (the
  rest — `setAcademyPlan`, `setAcademyAddOn`, `getAcademyAddOns` — already exist).
- Extend `academy-detail.tsx` with sections:
  1. **Plan & add-ons**: current plan + dropdown to change; add-on toggles (uses existing API).
  2. **Owner**: show owner; "Resend set-password link" / "Provision owner" button → modal.
  3. **Support / impersonate**: "Enter academy" button → calls `enter`, then redirects to
     `/dashboard` in entered context. A persistent "Exit academy" banner (in `app-shell`)
     when `entered_academy_id` is set (wire `exitAcademy()` from `useAuth`, already present).
- Confirmation modals for impersonate (it's auditable + sensitive).

### Permissions
- Existing: `academy.enter`, `plan.manage`, `user.invite`, `role.assign`.

### Tests
- Pest already covers most; add: provision owner from detail re-sends link idempotently;
  entering sets context + audits; exiting clears it.
- Frontend: detail renders plan/owner/impersonate sections gated by `can`.

### Acceptance
- [x] Change a plan & toggle an add-on from the UI; persists + audited.
- [x] Provision/resend owner link from the UI.
- [x] Enter an academy, see an "Exit" banner, exit back to platform view.

---

## Phase 3 — Plan & add-on catalog CRUD UI ✅ DONE

**Goal:** Make the read-only `/admin/plans` screen fully editable.

**Shipped:** `App\Support\FeatureCatalog` (canonical gated-feature/limit catalog) +
`PlanController@capabilities` → `GET /api/admin/capabilities`; api.ts `createPlan`,
`updatePlan`, `createAddOn`, `updateAddOn`, `getCapabilityCatalog`; `PlanFormModal` +
`AddOnFormModal` (capability checkboxes + limit inputs + feature_key select — no free text);
"New plan"/"New add-on" buttons + per-card Edit on `/admin/plans`; en/ar i18n; 6 Pest tests
(catalog 200/403, plan create-with-features, dup-code 422, plan edit, add-on round-trip).

### Backend
- Exists: `POST/PATCH /api/admin/plans`, `POST/PATCH /api/admin/add-ons`.
- Confirm the `features` JSON shape contract: `{ capabilities: string[], limits: { maxStudents?, maxTeachers?, ... } }`.

### Frontend
- `api.ts`: add `createPlan`, `updatePlan`, `createAddOn`, `updateAddOn` typed fns.
- `admin/plans/screen.tsx`: add "New plan" + per-card "Edit" → Modal form.
  - Plan form: code, name, price_minor (+ currency), is_active, capabilities (multi-select
    from a known capability catalog), limits (numeric inputs).
  - Add-on form: code, name, price, currency, feature_key (select from capability catalog).
- Surface the capability catalog to the UI — add `GET /api/admin/capabilities` returning
  `PermissionCatalog` keys + the gated feature keys, so forms aren't free-text.

### Permissions
- Existing `plan.manage`.

### Tests
- Pest: create/update plan + add-on; validation (duplicate code 422); features JSON persisted.
- Frontend: form create/edit round-trips and refreshes list.

### Acceptance
- [x] Create a plan with capabilities + limits from the UI.
- [x] Edit price/active and see it reflected on academy plan assignment (Phase 2).
- [x] Create an add-on bound to a feature_key.

---

## Phase 4 — Cross-tenant user management ✅ DONE

**Goal:** Super Admin can see and manage users across all academies (today only academy
owners manage their own staff). Biggest real capability gap.

**Shipped:** new `user.read_platform` permission (PermissionCatalog + SUPER_ADMIN map);
migration `2026_06_21_000002` with `app.admin_list_users()` + `app.admin_user_detail()`
SECURITY DEFINER fns; `Admin\UserController` (index/show/deactivate/reactivate/
reset-password/roles) — reads via the hatches, writes inside the target user's academy
context, all audited. **Caught a real authz leak**: Owners hold `role.assign` for their own
staff, so the `/roles` endpoint needs `user.read_platform` FIRST, then `role.assign`.
Frontend: `/admin/users` table (search + academy/role/status filters + pagination),
`UserDetailModal` (roles across academies, assign/revoke, deactivate, reset password), `users`
nav item, en/ar i18n. 9 Pest tests + 175 cross-suite green.

### Backend
- New `Admin\UserController`:
  - `GET /api/admin/users` — paginated, filterable (academy, role, active, search) via new
    `app.admin_list_users()` SECURITY DEFINER fn. Gate: new `user.read_platform`.
  - `GET /api/admin/users/{id}` — detail incl. roles across academies.
  - `POST /api/admin/users/{id}/deactivate` / `reactivate` — toggle `is_active`. Audited.
  - `POST /api/admin/users/{id}/reset-password` — send reset link. Audited.
  - `POST /api/admin/users/{id}/roles` — assign/revoke a role in an academy (writes inside
    target academy context). Gate: `role.assign`. Audited before/after.
- New permission `user.read_platform` added to `PermissionCatalog` + SUPER_ADMIN role map.

### Frontend
- New route `/admin/users` (`page.tsx` + `screen.tsx`), nav item in `management` group
  (icon `Users`, permission `user.read_platform`).
- `DataTable` (server-driven, already exists) with filters: academy, role, status, search.
- Row → user detail drawer/modal: roles, deactivate/reactivate, reset password, assign role.
- `api.ts`: `listPlatformUsers(query)`, `getPlatformUser(id)`, `deactivateUser`,
  `reactivateUser`, `resetUserPassword`, `setUserRole`.

### Permissions
- New: `user.read_platform`. Existing: `role.assign`.

### Tests
- Pest: list users RLS-safe & filtered; deactivate blocks login; reset sends link; role
  assign/revoke audited; ACADEMY_OWNER gets 403 on platform user list.
- Frontend: table filters, detail actions gated.

### Acceptance
- [x] List/search users across all academies.
- [x] Deactivate a user → they can't log in.
- [x] Send a password reset; assign/revoke a role with audit trail.

---

## Phase 5 — Billing & revenue dashboard ✅ DONE

**Goal:** Visibility into the revenue model. Read-only first (no payment provider yet).

**Shipped:** migration `2026_06_21_000003` with `app.admin_billing_overview()` SECURITY
DEFINER fn (MRR grouped strictly per currency — no FX — from ACTIVE academies' plan + active
add-on prices; status counts; per-academy monthly-value rows) + bypass SELECT grant on
`academy_addons`/`add_ons`; `Admin\BillingController@overview` → `GET /api/admin/billing/
overview`; api.ts `getBillingOverview`; `/admin/billing` screen (MRR cards by currency, status
counts, per-academy table); `billing` nav in the financial group; en/ar i18n. 4 Pest tests
(MRR math via an isolated KWD currency, counts, per-academy row, Owner 403).

### Backend
- New `Admin\BillingController@overview` → `GET /api/admin/billing/overview`. Gate: `plan.manage`.
  - MRR estimate = Σ(active academy plan price + active add-on prices), grouped by currency.
  - Per-academy billing rows: plan, add-ons, monthly value, status, billing_day.
  - Trial → active conversion count, suspended (churn) count, last-30d.
  - Computed via SECURITY DEFINER fn joining academies × plans × academy_addons.
- (Future hook) leave room for a `payment_provider` field + webhook ingestion — out of scope now.

### Frontend
- New route `/admin/billing` (`page.tsx` + `screen.tsx`), nav in `financial` group
  (icon `CreditCard`, permission `plan.manage`).
- KPI cards (MRR by currency, active/trial/suspended), per-academy billing table linking
  to academy detail (Phase 2).
- `api.ts`: `getBillingOverview()`.

### Permissions
- Existing `plan.manage` (or split a `billing.read` later).

### Tests
- Pest: MRR math correct vs seeded plans/add-ons; currency grouping; gating.

### Acceptance
- [x] MRR + counts render and reconcile with seeded data.
- [x] Drill from a billing row into academy detail.

---

## Phase 6 — Feature flags & platform settings ✅ DONE

**Goal:** Operational control beyond plan gating: kill-switches and global config.

**Shipped:** migration `2026_06_21_000004` — `feature_flags` (shared-read/super-write catalog,
seeded from FeatureCatalog) + `platform_settings` (super-read/super-write, secrets-safe); new
`platform.manage` permission; `Entitlement::resolve` now subtracts any disabled flag's key
(kill-switch over plan gating); `Admin\SettingsController` (flags list/toggle, settings
get/upsert), all audited; `/admin/settings` tabbed screen (flag toggles + general settings
form), `platformSettings` nav in the system group; en/ar i18n. 4 Pest tests incl. the
flag-off-disables-a-plan-capability override. **Gotcha logged:** the migration first seeded
under a session-level `set_config(is_local=false)` which leaked across the test connection and
broke later suites — fixed by seeding BEFORE enabling RLS (no GUC at all). Full backend: 446
passed.

### Backend
- New `platform_settings` table (key/value JSON, singleton-ish) + `feature_flags` table
  (key, description, enabled, optional academy override).
- `Admin\SettingsController`: `GET/PATCH /api/admin/settings`, `GET/POST/PATCH
  /api/admin/feature-flags`. Gate: new `platform.manage`. Audited.
- `Entitlement` (or a new `FeatureFlags` helper) consults flags as an override layer over
  plan capabilities (flag off → feature off even if plan grants it).

### Frontend
- New route `/admin/settings` with tabs: General settings, Feature flags. Nav in `system`
  group (icon `Settings`/`ToggleLeft`, permission `platform.manage`).
- `api.ts`: `getPlatformSettings`, `updatePlatformSettings`, `listFeatureFlags`,
  `setFeatureFlag`.

### Permissions
- New: `platform.manage`.

### Tests
- Pest: flag off disables a capability the plan grants; settings persist + audit; gating.

### Acceptance
- [x] Toggle a feature flag and see a gated feature disabled live.
- [x] Edit a platform setting; persisted + audited.

---

## Phase 7 — Role & permission editor (stretch) ✅ DONE

**Goal:** Manage `role_permissions` (currently seed-only) from the UI. Highest blast radius —
do last, behind strong guards.

**Shipped:** `Admin\RoleController` — `GET /api/admin/roles` (each role's caps + the full
catalog + lockout-critical list) and `PATCH /api/admin/roles/{role}/permissions` (rewrites
`role_permissions`, audited before/after). Lockout guard: SUPER_ADMIN can never shed
`platform.manage` (422). Changes take effect on next session resolution (PermissionResolver,
no cache). Frontend: `/admin/roles` capability×role matrix with locked cells for critical caps,
a dirty-tracking save bar, and a confirmation modal; `roles` nav in the system group; en/ar
i18n. 6 Pest tests (grant/revoke reflected in resolution, lockout 422, unknown role/cap,
Owner 403). Full backend: 452 passed.

### Backend
- `Admin\RoleController`: `GET /api/admin/roles` (+ permissions), `PATCH
  /api/admin/roles/{role}/permissions` (set capability list). Gate: `platform.manage`.
  Guard: cannot strip SUPER_ADMIN's own platform capabilities (lockout protection). Audited.

### Frontend
- New route `/admin/roles`. Matrix of role × capability checkboxes. Confirmation on save.
- `api.ts`: `listRoles`, `setRolePermissions`.

### Permissions
- Existing `platform.manage`.

### Tests
- Pest: changing a role's permissions reflects in resolved sessions; lockout guard blocks
  removing SUPER_ADMIN core caps; audited.

### Acceptance
- [x] Edit a role's capabilities; affected users' `can()` updates after refresh.
- [x] Cannot lock out Super Admin.

---

## Suggested order & rationale

1. **Phase 1** (dashboard) — fast, gives the panel a shell. *Start here.*
2. **Phase 2** (academy control center) — highest operational value, zero new backend.
3. **Phase 3** (catalog CRUD) — completes plan management loop.
4. **Phase 4** (user management) — first big new capability.
5. **Phase 5** (billing) — visibility on revenue.
6. **Phase 6** (flags/settings) — operational maturity.
7. **Phase 7** (role editor) — powerful, riskiest, last.

## Cross-cutting (apply every phase)

- i18n keys added to BOTH `en.json` and `ar.json`; RTL verified.
- Every new endpoint: Gate + RLS + audit (where mutating) + Pest test for 403 path.
- Reuse `DataTable`, `Modal`, `AlertBanner`, `Button` — no new primitives unless needed.
- Update this doc's checkboxes as we complete each phase.
