# 03 — Roadmap (phased, test-gated)

> Living plan. We build **one phase at a time, in order** (`M-PROC-1`). Each phase lists scope,
> backend/frontend work, acceptance criteria (`AC-M*`), test cases (`TC-M*`), and checkboxes. The
> hard gate is **Phase 2 parity** (`M-ENT-1`) — do not remove the old resolver until it is green.

## Phase overview

| Phase | Title | Layer | Risk | Ships |
|---|---|---|---|---|
| 0 | Blueprint | docs | none | this folder |
| 1 | Schema + parity backfill | backend | low | `plans.module`, `module_subscriptions`, migrated rows (resolver unchanged) |
| 2 | Entitlement + billing cutover | backend | **high** | union resolver + per-module billing, parity-proven |
| 3 | Module admin API | backend | med | `/admin/{module}/*` endpoints, per-module caps |
| 4 | Module sidebar + route reorg | frontend | med | collapsible module nav, re-homed pages |
| 5 | WhatsApp module build-out | full-stack | med | WA plans/subs + external QR-only provisioning |
| 6 | Consolidated revenue + cleanup | full-stack | low | cross-module revenue, drop legacy columns |

---

## Phase 0 — Blueprint ✅

- [x] `docs/superadmin-modules/` written (README, 00-OVERVIEW, 01-DATA-MODEL, 02-PANEL-AND-API, 03-ROADMAP).
- [ ] Owner sign-off on the locked decisions (`00 §5`) and D6 (bundled-WhatsApp → module sub).

---

## Phase 1 — Schema + parity backfill  (backend, low risk)

**Goal:** stand up the new tables and migrate current state into them, **without changing behavior**.
The old `Entitlement::resolve` still runs; the new rows are written but not yet read.

**Backend** — DONE (2026-07-08), not yet committed
- [x] Migration `2026_07_14_000001_plans_module` — `plans.module` + `check`; MEET → VIDEO.
- [x] Migration `2026_07_14_000003_module_subscriptions` — table + indexes + tenant RLS (`01 §2.2`).
- [x] Migration `2026_07_14_000002_seed_whatsapp_plans` — `WA_BUNDLED` (price 0) + `WA_STANDARD`.
- [x] Migration `2026_07_14_000004_backfill_module_subscriptions` — parity backfill via
      `App\Support\ModuleSubscriptionBackfill`, folding `video_*` into the VIDEO sub `overrides`.
- [x] `DemoAcademySeeder` seeds the demo academy's module subs (`Schema::hasTable`-guarded).
- [ ] `ShowcaseAcademySeeder` — deferred (not exercised by tests; do before Phase 4).
- [ ] `AcademyBilling` module-aware methods — **deferred to Phase 2** (written where they're wired in).

> **Implementation learning — supersedes `01 §8`'s no-force-RLS dance.** The `alter table … no force
> row level security` dance POISONS the suite: `Rls/MigrationsRollbackTest` re-runs migrations without
> RefreshDatabase, and FORCE-RLS DDL in that flow aborts the connection and cascades into later tests.
> `ModuleSubscriptionBackfill` instead sets the tenant context per academy and runs RLS-admitted plain
> INSERTs (`run()` enumerates under SUPER_ADMIN then loops each academy's own context; `runForAcademy()`
> for the in-context seeder). **Rule for later phases: no FORCE-RLS DDL in code any test re-executes.**

**Acceptance criteria — MET**
- `AC-M1.1` ✅ Correct derived subs — verified on the dev DB (MEET→VIDEO w/ folded overrides; PRO/FREE→
  MANAGEMENT + bundled WHATSAPP) and by `TC-M1.1`.
- `AC-M1.2` ✅ `module_subscriptions_one_live_uidx` holds (`TC-M1.2`).
- `AC-M1.3` ✅ Fresh seed == migrated DB (`TC-M1.3`).
- No net regressions: full suite 241 failed (unchanged pre-existing WIP baseline) / +3 new green.

**Tests — `tests/Feature/Modules/ModuleSubscriptionBackfillTest.php` (3 green)**
- `TC-M1.1` ✅ PRO / BASIC+video-grant / MEET / plan-less-trial → exact module subs.
- `TC-M1.2` ✅ idempotent re-run + partial unique index rejects a second live sub.
- `TC-M1.3` ✅ every plan has a module; the demo academy gets MANAGEMENT + WHATSAPP subs.

---

## Phase 2 — Entitlement + billing cutover  (backend, **HIGH RISK** — the gate)

**Goal:** switch `Entitlement::resolve` to the union-over-module-subs model and make billing per-module,
**proven identical** for existing academies first (`M-ENT-1`).

**Phase 2a — resolver + parity gate — DONE (2026-07-08), not committed. NO live cutover yet.**
- [x] `Entitlement::resolveFromModules()` — the union-over-module-subs resolver, built ALONGSIDE the
      live `resolve()` (zero runtime risk; `resolve()` untouched). Primary plan = MANAGEMENT sub (or
      VIDEO for a MEET client); WHATSAPP sub adds its capability; VIDEO sub `overrides` drive the video
      override + video limit keys; add-ons + kill-switch unchanged. Does NOT gate on sub status
      (mirrors `resolve()`; per-module suspension is a later deliberate change, not parity).
- [x] Parity harness `tests/Feature/Modules/EntitlementParityTest.php` — 13 academy shapes, 52
      assertions, `resolve()` == `resolveFromModules()` byte-for-byte. **`AC-M2.1` GREEN.**

**Phase 2b — the cutover — DONE (2026-07-08), not committed. Live resolver now reads module subs.**
- [x] `ModuleSubscriptionBackfill::reconcile($academyId)` — UPSERT/end each module sub to the current
      single-plan state (handles plan switches incl. to/from video-only MEET). Wired into
      `AcademyController::store` + `::setPlan` and `VideoOversightController::setAccess` (each already in
      the academy's context). Add-ons stay on the `academy_addons` path — the resolver reads it directly.
- [x] `Entitlement::resolve()` is now a DISPATCHER: reads module subs when the academy has them, else
      falls back to `resolveLegacy()` (the old body, renamed). A **dual-read shim** so a not-yet-
      reconciled academy (test-inserted, or missed by backfill) still resolves correctly. All
      `check/withinLimit/limit/limitFor/flag/flagFor` signatures unchanged (they call `resolve`).
      `resolveFromModules` reads only LIVE (non-ENDED) subs.
- [x] `modules: string[]` added to `GET /api/entitlements`.
- [ ] Simplify `FeatureCatalog` video.only handling — SKIPPED (parity holds with MEET's stored
      `video.only`; not needed).
- [ ] Drop `academies.video_*` reads from the live path — deferred to **Phase 6** (the fallback still
      needs them; the shim reads the folded VIDEO-sub `overrides` on the module path).

**AC-M2.1 met + reconcile proven** — `EntitlementParityTest` (13 shapes) + a reconcile test (PRO→MEET→
BASIC+grant→drop) both green. **Full suite: 241 failed (pre-existing baseline UNCHANGED), no regressions.**

**Phase 2c — per-module billing (can follow 2b)**
- [ ] Rewrite `AcademyBilling`/`Invoicing` to per-module lifecycle + consolidated invoice (`01 §4`,
      `M-BILL-1`, `M-BILL-2`).

**Acceptance criteria**
- `AC-M2.1` **Parity:** the harness reports zero diffs across all academies (capabilities + limits).
- `AC-M2.2` A video-only client (VIDEO sub, no MANAGEMENT sub) resolves `video.only`; the owner shell
  still collapses to the video classroom.
- `AC-M2.3` Pausing one module's sub removes only that module's capabilities; other modules unaffected.
- `AC-M2.4` A client with MGMT + VIDEO gets one invoice with two line items summing to the correct total.
- `AC-M2.5` The full existing Pest suite (video, subscription, entitlement, invoicing, payroll) stays
  green — **no regressions** vs the pre-Phase-2 baseline.

**Tests**
- `TC-M2.1` The parity harness itself (a Pest test asserting zero diffs).
- `TC-M2.2` Entitlement union: fixtures for each module combination → expected capability/limit set.
- `TC-M2.3` Scoped suspension: pause VIDEO → rooms gated (402), management still works.
- `TC-M2.4` Invoicing: multi-module client → one consolidated invoice, per-module line items.
- `TC-M2.5` Re-run `SubscriptionTest`, `EntitlementTest`, `AuditSurfacingTest`, Video suite — green.

---

## Phase 3 — Module admin API  (backend, med)

**Backend**
- [ ] Namespaced controllers `Admin\{Platform,Management,Whatsapp,Video}\*` (split/move existing).
- [ ] Uniform `/admin/{module}/clients|plans|subscription…` endpoints (`02 §4`) over `module_subscriptions`.
- [ ] `SECURITY DEFINER` readers: `app.admin_module_subscriptions(module)`, `app.admin_client_directory()`.
- [ ] Per-module admin capabilities in `PermissionCatalog` (`management.admin`/`whatsapp.admin`/
      `video.admin`/`platform.admin`); map `platform.manage` ⇒ all (additive, no break).

**Acceptance criteria**
- `AC-M3.1` Every new endpoint has a `Gate::authorize` + a Pest 403 test (per-module cap enforced).
- `AC-M3.2` Cross-tenant reads never bypass RLS ad-hoc (only via the audited `SECURITY DEFINER` fns).
- `AC-M3.3` Old `/admin/*` endpoints still respond (aliased) for the frontend transition.

**Tests**
- `TC-M3.1` 403 matrix: a `video.admin`-only user can hit video endpoints, 403s on management/whatsapp.
- `TC-M3.2` Client directory returns correct module chips per client.

---

## Phase 4 — Module sidebar + route reorg  (frontend, med)

**Frontend**
- [ ] `app-shell.tsx`: add `module` to Super Admin nav items; render collapsible module sections with
      remembered open state; active route auto-expands (`02 §1`). Owner nav unchanged.
- [ ] Move pages under `/admin/{module}/*`; redirect old paths.
- [ ] Module overview pages (Platform/Management/WhatsApp/Video landing screens).
- [ ] `adminNav.*` i18n keys (en + ar), RTL verified.
- [ ] `lib/api.ts`: typed fns for the new `/admin/{module}/*` endpoints.

**Acceptance criteria**
- `AC-M4.1` Super Admin sees four module sections; each expands to its pages; deep-link expands the
  owning module.
- `AC-M4.2` A Super Admin with only some module-admin caps sees only those modules.
- `AC-M4.3` Old bookmarked routes redirect to their new home.

**Tests**
- `TC-M4.1` Vitest: `app-shell` renders/collapses module sections; cap-filtered visibility; active-expand.
- `TC-M4.2` Vitest: locked/upgrade-badge logic still works for owner-side plan gating (no regression).

---

## Phase 5 — WhatsApp module build-out  (full-stack, med)

**Backend + Frontend**
- [ ] `WA_*` plan CRUD in the WhatsApp module plan editor.
- [ ] External-client provisioning: `POST /admin/whatsapp/clients` (lightweight academy, no owner user)
      + attach WHATSAPP sub + existing QR connect lifecycle (`02 §6`).
- [ ] WhatsApp → Clients list shows internal + external clients with connection/plan/volume columns.
- [ ] Send path honors the WHATSAPP sub lifecycle (lapsed ⇒ sends blocked, `M-BILL-2`).

**Acceptance criteria**
- `AC-M5.1` A WhatsApp-only client can be created without an owner login, connected by QR, and sends via API.
- `AC-M5.2` Lapsing the WHATSAPP sub blocks sends but doesn't touch the client's other modules (if any).
- `AC-M5.3` External WhatsApp clients appear in WhatsApp→Clients and Platform→Clients, not Management→Clients.

**Tests**
- `TC-M5.1` Pest: provision external client → WHATSAPP sub only, no user row, send allowed; pause → send 402.
- `TC-M5.2` Vitest: WhatsApp clients screen renders internal + external rows correctly.

---

## Phase 6 — Consolidated revenue + cleanup  (full-stack, low)

- [ ] Platform → Revenue: MRR per module + total, per currency.
- [ ] Drop `academies.plan_id`, `video_access`, `video_trial_ends_at`, `video_plan_id`,
      `video_overrides` once no code reads them; archive/drop `academy_subscriptions`.
- [ ] Remove dual-read/dual-write shims.
- [ ] Docs + memory updated to "shipped".

**Acceptance criteria**
- `AC-M6.1` Revenue reconciles: per-module MRR sums to the platform total.
- `AC-M6.2` No code references the dropped columns/table (grep-clean); full suite green.

---

## Global definition of done (every phase)

- Pest (`apps/api`) + Vitest (`apps/web`) green; no regressions vs the phase's starting baseline.
- New endpoints: `Gate::authorize` + RLS + a 403 Pest test.
- New capabilities in `FeatureCatalog`; new permissions in `PermissionCatalog`.
- i18n keys in **both** `messages/en.json` and `ar.json`; RTL-safe.
- Migrations respect the RLS/seed gotchas (`01 §8`).
- Checkboxes ticked here; the [superadmin-modules-refactor memory] status line advanced.
</content>
