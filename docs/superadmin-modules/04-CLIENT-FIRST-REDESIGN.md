# 04 — Client-First Panel Redesign

> **Status: APPROVED by owner 2026-07-12 ("go ahead implement") — R1 + R2 BUILT & TESTED
> 2026-07-12 (uncommitted). Defaults locked: trial 5 days/module; paid-at-create offers
> "activate now" in the enable form; Staff Departments/Roles fold into Settings in R3;
> proof review stays a global Billing inbox.**
>
> **Progress:**
> - **R1 ✅ (backend)** — `App\Services\ModuleBilling` (per-module enable/trial/extend/activate/
>   pause/end + `setPrimaryPlan` + `videoAccess` + `expireTrialsFor` + `recompute`/`syncLegacy`
>   write-through mirrors); scoped suspension live in `Entitlement::resolveFromModules` (grants
>   only from ACTIVE subs inside their trial window; VIDEO override container still applies, its
>   ENABLED grant gated by the sub lifecycle); store/setPlan/setAccess/subscription endpoints +
>   `ExpireAcademyTrialsJob` rewired through the engine (legacy fallback for engine-untouched
>   academies); `plans.module` in Plan CRUD; `/admin/clients` + per-module subscription endpoints
>   (`ClientController`) + `app.admin_client_directory()` (migration `2026_07_16_000001`).
>   Deviations from §5: existing `admin_subscription_overview`/`admin_billing_overview` still read
>   the legacy MIRROR (correct via write-through; re-pointed with the R3 billing rebuild);
>   consolidated per-module invoice line items also land in R3. Tests:
>   `tests/Feature/Modules/ModuleBillingLifecycleTest.php` (10) + parity harness green; Modules/
>   AcademyBilling/Gating/Video/Security/Auth suites green vs the pre-existing baseline.
> - **R2 ✅ (frontend core)** — flat platform sidebar (11 items, dropdowns deleted;
>   `PLATFORM_NAV` in app-shell.tsx); `/admin/clients` roster (module chips, status+module
>   filters); `/admin/clients/[id]` client page (header Enter/Suspend, **Subscriptions card** =
>   the one writer, tabs: Billing/WhatsApp/Video/Settings, module tabs only when enabled);
>   `/admin/clients/new` (wizard + Video/WhatsApp enable picks); `/academies` → redirect;
>   `lib/api.ts` client fns; i18n en+ar (`clients.*`, nav renames); vitest: app-shell 14 ✓ +
>   clients screen/card 5 ✓. NOTE: the Billing tab reuses `AcademySubscriptionPanel`, which still
>   shows its own extend/activate (same engine underneath) — removed in R3 when bills split out.
> - **R3 ✅ (2026-07-13)** — Billing page rebuilt: MRR per currency now SPLIT BY MODULE (from the
>   client directory), proof inbox unchanged (the one writer for proof review), the per-client
>   table shows module chips and links to `/admin/clients/[id]` — its extend/activate/suspend row
>   buttons are GONE. Plans page: module tabs (Management | Video | WhatsApp | Add-ons), plan form
>   gains the module select, the Sprint-9 add-on editor is finally surfaced. Settings gains Roles +
>   Staff departments tabs (screens folded in; old routes redirect) → the flat sidebar is now the
>   final **9 items**. `AcademySubscriptionPanel` (the client page's Billing tab) lost its
>   extend-trial/activate controls — it is the client's LEDGER only — and bill rows show the new
>   per-module composition chips. Backend: `academy_invoices.module_breakdown` jsonb (migration
>   `2026_07_16_000002`), stamped by `generateInvoiceForPeriod` from live ACTIVE non-trial module
>   subs (M-BILL-1 line items, lightweight). Tests: +1 Pest (consolidated bill breakdown, 49 green
>   across Modules/AcademyBilling/Gating), web 301 pass / 9 pre-existing fails unchanged.
>   NOTE: `admin_subscription_overview`/`admin_billing_overview` SQL functions still read the
>   legacy mirror (kept correct by the engine's write-through); dropping them moves to R5 with the
>   mirrors themselves — the UI no longer depends on their lifecycle semantics.
> - **R4 ✅ (2026-07-13)** — ops pages are monitoring-only and every per-client control lives on
>   the client page. **WhatsApp-only external clients ship (M-CLI-2):** `POST /admin/clients`
>   (ClientController::store) provisions a lightweight academies row with NO owner login + a
>   WHATSAPP sub via the engine (`ensure()` now lazy-backfills ONLY when legacy billing state
>   exists, so fresh external clients get exactly one sub); quick-create card on
>   `/admin/clients/new`. Client page tabs got real: WhatsApp tab = connection pill + the full
>   ManageModal (QR/toggles/test/API keys/connect link — reused, one surface); Video tab = tier +
>   limit/flag overrides editor (`set_tier` + overrides) with rooms/logs link. WhatsApp Ops:
>   API-clients tab deleted, overview is READ-ONLY (on/off pills, rows link to clients, bulk bar +
>   row toggles gone). Video Ops: Add-academy button + modal deleted; the video detail page lost
>   its access controls + duplicated subscription block (usage/rooms/logs only, links to the
>   client). DELETED: `academy-automation-panel` (the Wasender token panel), `academy-detail`,
>   `academy-manager`, `academies-list`, `academy-plan-manager`, `report-fields-editor`,
>   `/academies/screen.tsx`, `add-academy-modal`, `api-clients-tab` (+ their orphaned tests).
>   Tests: Pest 62 green (incl. external-client lifecycle: no user row, cap granted, pause → 402 +
>   suspend); web 287 pass / 9 pre-existing unchanged (video detail test rewritten to assert the
>   controls are GONE).
> - **R5a ✅ (2026-07-13)** — the LAST writer of `academy_subscriptions` outside the engine's
>   mirror is gone: `AcademyBilling::rollAndBill` (the nightly `GenerateAcademyInvoicesJob`) now
>   rolls the billing period on the PRIMARY MODULE SUB via `ModuleBilling::setFields` (mirror
>   follows); the direct legacy write survives only for engine-untouched academies. Test: roll on
>   a lapsed module period → bill issued, module sub advanced, mirror identical (32 green).
>   With R5a, every legacy row is a pure derived mirror — old and new CANNOT disagree.
>
> ### R5b — the destructive drops (dedicated pass; only AFTER R1–R5a are deployed & verified)
>
> 1. **Prod pre-flight:** run `ModuleSubscriptionBackfill::run()` (idempotent), then verify every
>    academy has module subs matching its legacy state and every legacy sub equals its mirror.
> 2. **Port the remaining legacy READERS** to module subs: the SQL fns
>    (`admin_list_academies`, `admin_subscription_overview`, `admin_billing_overview`,
>    `admin_video_stats`, `admin_video_academy`), `AcademyBilling`'s legacy bodies +
>    `generateInvoiceForPeriod`'s total/currency source, the owner `/my-subscription` widget,
>    `AcademyController::store`/wizard `plan_id` handling.
> 3. **Remove the shims:** `Entitlement::resolveLegacy` + the dual-read dispatcher,
>    `ModuleBilling::syncLegacy` + `hasLegacyBillingState`, `ModuleSubscriptionBackfill`.
> 4. **Test-fixture sweep:** `CreatesTenantData::createAcademy` and every direct academy insert
>    with `plan_id` must provision module subs instead — the big blast radius (also clears much of
>    the pre-existing plan-less-402 baseline).
> 5. **Migrations:** drop `academies.plan_id`/`video_access`/`video_trial_ends_at`/
>    `video_plan_id`/`video_overrides`; rename `academy_subscriptions` → archive, drop next release.
> 6. Retire the `/admin/academies/{id}/subscription*` aliases (bills endpoints stay); AC-M6.2
>    grep-clean + full suites green.

> Originally: **PROPOSAL (2026-07-12).**
> Triggered by owner feedback: the panel is "not easy at all… everything conflicting… many pages…
> sidebar not understandable"; trial must be "direct and controlled from one place and reflect
> correctly"; a "direct way to specify this academy is management only, or video only, or whatsapp
> only, or any combination."
>
> This doc **replaces `02-PANEL-AND-API §1–3`** (the module-dropdown sidebar and module-first page
> tree) and **re-sequences the remainder of `03-ROADMAP`**. The data model (`01-DATA-MODEL`), the
> locked decisions (`00 §5`) and the `M-*` rules are **unchanged** — this is a different UI on the
> same model, plus the backend work that was always required to finish it.

## 1. Diagnosis — why the panel feels conflicting (verified 2026-07-12)

The refactor stopped halfway. The modular backend exists, but **nothing in the panel reads or
writes it**, so the UI still operates three parallel legacy systems:

| # | Finding | Evidence |
|---|---|---|
| 1 | **`module_subscriptions` is a write-only shadow.** Only `Entitlement.php` reads it. No admin controller or `admin_*` SQL function touches it. The whole panel runs on `academies.plan_id` + `academy_subscriptions` + `academies.video_*` + `academy_automation_settings`. | grep-verified; `Entitlement.php:121` dual-read |
| 2 | **Trial state lives in 5 places.** `academies.status`, `academy_subscriptions.is_trial/trial_*` (authoritative), `module_subscriptions.trial_*` (**frozen — `reconcile()` skips trial columns**, `ModuleSubscriptionBackfill.php:133-137`), `academies.video_trial_ends_at`, VIDEO-sub `overrides.trialEnd`. The SaaS trial and the video trial are two independent clocks. | `AcademyBilling.php:129`, `VideoOversightController.php:181-193` |
| 3 | **The same action exists in several places with different behavior.** Extend trial: academy detail (any days) vs billing row (fixed +5d) vs video detail (separate video clock). Activate ×2, suspend ×2, proof review ×2 (+1 read-only), WhatsApp toggles ×3, plan set ×3. | web inventory, 14 documented duplications |
| 4 | **Two competing WhatsApp connect mechanisms.** Academy detail still ships the legacy **Wasender token** panel (`academy-automation-panel.tsx:108-179`) while the real path is the gateway QR connect (`manage-modal.tsx:349-398`). | — |
| 5 | **Plan CRUD cannot set `plans.module`** — validation omits it (`PlanController.php:65,99`), so VIDEO/WHATSAPP plans can only be created by migration. | — |
| 6 | **The Phase-4 sidebar groups pages by module, but the pages don't match.** "Management System" holds only Plans + Staff Departments; clients and billing sit under "Platform". Create-academy sets no modules and no trial length (FREE→TRIAL hack, paid→ACTIVE, video/WhatsApp configured later in two other pages). | `app-shell.tsx:372-394`, `academy-wizard.tsx:102-103` |
| 7 | Assorted debris: `trials` table naming trap (student taster lessons, not the SaaS trial); dead `ReportFieldsEditor`; hidden add-on editor; dead `14`-day fallback (`AcademyBilling.php:42`). | — |

**Conclusion:** the module-dropdown IA (02 §1) multiplied surfaces (each module gets its own
clients/plans/billing) while the data stayed legacy. The owner experiences that as conflict and
duplication — correctly.

## 2. The new track — two principles

1. **Client-first, not module-first.** "Module" stops being a sidebar section and becomes a
   **property of the client**: chips on the roster, three subscription rows on the client page,
   tabs on the plan catalog. The sidebar goes back to a short flat list.
2. **One writer per fact.** Every fact has exactly ONE page where it can be changed; everywhere
   else it appears read-only and links there. Enforced by review, not convention: a PR that adds a
   second writer for a fact is rejected.

| Fact | The one writer |
|---|---|
| Module on/off, plan, trial start/extend, activate, pause | Client page → **Subscriptions card** (+ initial state from the create wizard) |
| Client bills: generate / send / mark paid / void | Client page → Billing tab |
| Payment-proof approve/reject | **Billing → Review inbox** (the queue is the writer; client tab shows status + links) |
| Manual full suspension | Client page header (removed from billing rows) |
| Video tier/overrides/recording flags | Client page → Video tab |
| WhatsApp connection (QR), toggles, API keys | Client page → WhatsApp tab |
| Plan catalog (incl. `module`), add-ons | Plans page |
| Gateway rate limits, feature flags, payment methods, staff departments | Settings |

## 3. Sidebar — 9 flat items, no dropdowns

```
Overview        /admin              KPIs per module, trials ending, proof inbox count → links only
Clients         /admin/clients      THE hub: roster + client page + create wizard
Billing         /admin/billing      proof review inbox · dues · MRR by module (money only — no lifecycle buttons)
Plans           /admin/plans        tabs: Management | Video | WhatsApp | Add-ons
Video Ops       /admin/video        LiveKit health · usage · compliance (platform-wide only)
WhatsApp Ops    /admin/whatsapp     gateway health · activity feed · rate limits (platform-wide only)
Users           /admin/users        platform user admin (roles per user)
Settings        /admin/settings     tabs: General | Payment | Feature flags | Roles matrix | Staff departments
Audit           /audit              unchanged
```

- `/academies` and the in-place detail view retire; **`/admin/clients/[id]` becomes a real route**
  so every trial chip, proof row and ops row can deep-link to the client. Old routes redirect.
- Tenant/owner sidebar: untouched (`00 §8`).

## 4. The client page — the control center

Header: name · derived status chip · module chips · **Enter** · **Suspend/Reactivate** ·
created/currency/timezone meta.

**Subscriptions card — the centerpiece.** Three fixed rows (Management / Video / WhatsApp), each
backed 1:1 by a `module_subscriptions` row:

```
MANAGEMENT   [PRO ▾]      ● Active · renews Aug 1     EGP 999/mo   [Change…]
VIDEO        [MEET ▾]     ◐ Trial · 3 days left       —            [Extend…] [Activate] [Pause]
WHATSAPP     [— off —]                                             [Enable…]
```

- **Enable** on an empty row = pick plan → choose "start N-day trial" (default from settings) or
  "activate paid now" → creates the module sub. **This is the "management only / video only /
  whatsapp only / any mix" control.**
- Extend trial (any days), Activate, Change plan, Pause — actions live HERE and nowhere else.
- Row shows the module's own trial countdown / renewal date / price from its sub row. No other
  clock exists.

Tabs (each rendered only when its module is on): **Billing** (this client's bills + proof status),
**Video** (tier, overrides, recording/monitor flags, rooms + logs), **WhatsApp** (QR connect,
type1/type2 toggles, API keys + connect link, send log), **Settings** (name, branding, subdomain,
owner email/reset, danger zone).

Deleted outright: Wasender token panel, duplicated subscription block on the video detail page,
billing-row lifecycle buttons, `ReportFieldsEditor`.

**Create wizard** gains a Modules step: check Management / Video / WhatsApp (any combination,
min 1); per checked module pick plan + trial-or-active; trial days prefilled from settings.
A WhatsApp-only client with no owner login (`M-CLI-2`) is the same wizard with only WHATSAPP
checked and "create owner login" unchecked. Wizard still sets name/type/owner/branding.

## 5. Backend — make `module_subscriptions` the single source of truth

The half-built model becomes the real one; legacy stores become derived mirrors until dropped.

1. **Port the lifecycle** — `AcademyBilling` methods (`ensureSubscription`, `startTrial`,
   `extendTrial`, `activate`, `expireTrial`, `recomputeTotals`, `rollAndBill`) parameterized by
   module, writing `module_subscriptions` **first**; legacy `academy_subscriptions` +
   `academies.plan_id`/`video_*` become write-through mirrors (inverse of today's `reconcile()`),
   dropped in R5. `reconcile()`'s trial-skip bug disappears with it. (= old Phase 2c.)
2. **Trial engine** — per-module `is_trial/trial_end` on the sub row is THE clock.
   `ExpireAcademyTrialsJob` expires **per module** → that sub `PAUSED` (scoped suspension,
   `M-BILL-2`); the academy goes `SUSPENDED` only when no live sub remains (or manual suspend).
   Default trial days: platform setting (existing `billing.trial_days`), editable in
   Settings → General, overridable per enable-action.
3. **Endpoints** — the uniform per-module set from `02 §4` (unchanged), plus
   `GET /admin/clients` directory (modules + statuses per client, SECURITY DEFINER) and
   `GET /admin/clients/{id}` composite. Old `/admin/academies/*` + `/admin/video/*` aliases kept
   during transition (`AC-M3.3`).
4. **Plan CRUD** — add `module` to `PlanController` validation + editor; module-mismatched
   `plan_id` on a sub stays rejected app-side (`01 §6`).
5. **Billing page reads** — `app.admin_subscription_overview()` and `app.admin_billing_overview()`
   re-point to module subs (consolidated invoice per `M-BILL-1` unchanged).
6. **Entitlement** — untouched. It already reads module subs; parity harness keeps guarding.

## 6. Revised roadmap (supersedes remaining `03-ROADMAP` phases)

| # | Ships | Replaces | Risk |
|---|---|---|---|
| R1 | Backend §5: lifecycle port + trial engine + endpoints + plan.module | 2c + 3 | **high** (billing engine) — gate: legacy-vs-module lifecycle parity tests + full suite green |
| R2 | Clients hub: roster, `/admin/clients/[id]`, subscriptions card, wizard w/ modules; flat sidebar; redirects | 4 (route reorg) | med |
| R3 | Billing rebuild (inbox + dues + module MRR) + Plans module tabs + add-on editor unhidden | — | low |
| R4 | Ops cleanup: Video Ops strips per-client controls; WhatsApp Ops = health/activity/settings; per-client WhatsApp+Video → client tabs; delete legacy panels; WhatsApp-only wizard path | 5 | med |
| R5 | Drop `academies.plan_id`/`video_*`, archive `academy_subscriptions`, remove mirrors + aliases; docs/memory → shipped | 6 | low |

Order rationale: R1+R2 deliver the owner's four asks (one trial place, module mix per client,
readable subscriptions, clean client page) in the first two phases; cosmetics follow.

Global definition of done per phase: unchanged (`03-ROADMAP` footer). `M-PROC-1` applies — one
phase at a time, test-gated.

## 7. Open questions for the owner (defaults apply if unanswered)

1. Default trial days per module — **default: 5 for all three** (current setting).
2. Should a paid plan chosen at creation also start with a trial? — **default: yes, trial first**
   (admin can "activate paid now" in the wizard).
3. Staff Departments as a Settings tab — **default: yes** (it's rarely-touched catalog data).
4. Payment-proof review stays a global inbox on Billing — **default: yes** (it's a work queue).
