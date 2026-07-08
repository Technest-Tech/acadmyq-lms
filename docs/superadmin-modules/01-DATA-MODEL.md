# 01 — Data Model & Entitlement Rewrite

This is the heart of the initiative. Read `00-OVERVIEW` first.

## 1. Current model (what we are replacing)

| Concern | Today | File |
|---|---|---|
| Client | `academies` (single `plan_id uuid` FK, nullable) | `2026_06_11_000003_academies_and_users.php` |
| Subscription | `academy_subscriptions`, **one live row per academy** (`… where status <> 'ENDED'` unique idx) | `2026_06_26_000001_academy_subscriptions.php` |
| Plan | `plans (code, price_minor, currency, features jsonb, is_active)` — shared catalog | `2026_06_11_000002_platform_tables.php` |
| Add-ons | `add_ons (feature_key)` + `academy_addons` pivot | `2026_06_17_000001_plan_gating_and_audit_indexes.php` |
| Video axis | `academies.video_access / video_trial_ends_at / video_plan_id / video_overrides` | `2026_07_11_000002…` + `2026_07_12_000001…` |
| Entitlement | `Entitlement::resolve($academyId)` reads the ONE plan ∪ add-ons ∪ video override | `apps/api/app/Support/Entitlement.php` |
| WhatsApp | just the `whatsapp.automation` capability + `academy_automation_settings` (creds/toggles, no price) | `2026_06_26_000005…` |

## 2. Target schema

### 2.1 `plans.module` — scope every plan to a module

```sql
alter table plans
  add column module text not null default 'MANAGEMENT'
    check (module in ('MANAGEMENT','WHATSAPP','VIDEO'));

-- backfill existing catalog:
--   FREE / BASIC / PRO   → MANAGEMENT   (already the default)
--   MEET                 → VIDEO
--   any video tier plans → VIDEO
update plans set module = 'VIDEO' where code = 'MEET';
-- (video tier plans identified by features->capabilities ? 'video.conferencing' with no mgmt caps)
```

Plans stay a shared platform catalog (not tenant-scoped). `module` lets the panel show, e.g., only
`MANAGEMENT` plans in the Management module's plan editor. `M-UI-2`: a plan's module is data.

### 2.2 `module_subscriptions` — the new core table

```sql
create table module_subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  academy_id             uuid not null references academies(id),   -- the shared client (M-CLI-1)
  module                 text not null check (module in ('MANAGEMENT','WHATSAPP','VIDEO')),
  plan_id                uuid references plans(id),                 -- must be a plan of the same module
  status                 subscription_status not null default 'ACTIVE',  -- ACTIVE | PAUSED | ENDED
  is_trial               boolean not null default false,
  trial_start            timestamptz,
  trial_end              timestamptz,
  activated_at           timestamptz,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  billing_interval       billing_interval not null default 'MONTHLY',
  base_price_minor       bigint not null default 0,
  addons_price_minor     bigint not null default 0,
  total_cost_minor       bigint not null default 0,
  currency               char(3) not null default 'EGP',
  overrides              jsonb,     -- module-specific overrides (video access/tier/limits; see §5)
  canceled_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- M-SUB-2: at most one LIVE subscription per (client, module). ENDED rows are history.
create unique index module_subscriptions_one_live_uidx
  on module_subscriptions (academy_id, module) where status <> 'ENDED';

create index module_subscriptions_academy_idx on module_subscriptions (academy_id);
create index module_subscriptions_module_status_idx on module_subscriptions (module, status);
```

Reuses the existing `subscription_status` and `billing_interval` enums. Same shape as
`academy_subscriptions` **plus** `module` and `overrides`, so the billing engine port is mechanical.

### 2.3 Client identity — `academies` stays, three columns retire

- **Keep** `academies` as the universal client. No new client table (`M-CLI-1`, D1).
- **Retire (Phase 6, after cutover):** `academies.plan_id`, `video_access`, `video_trial_ends_at`,
  `video_plan_id`, `video_overrides`. Their information moves into `module_subscriptions` rows:
  - `plan_id` → the MANAGEMENT (or MEET→VIDEO) sub's `plan_id`.
  - the four `video_*` columns → the VIDEO sub's `plan_id` (tier) + `overrides` jsonb.
- During Phases 1–5 these columns remain (dual-write / read-through) so nothing breaks; Phase 6 drops
  them once no code reads them.

### 2.4 A lightweight-client note (external WhatsApp clients, `M-CLI-2`)

An external WhatsApp client is a normal `academies` row provisioned **without** an owner user or a
management subscription — only a WHATSAPP `module_subscription` and a gateway session
(`academy_automation_settings.wa_session_id`). It never logs into the owner panel. `02-PANEL-AND-API §6`
covers the provisioning endpoint. RLS still applies (it is an academy); the Super Admin operates on it
via the usual cross-tenant `SECURITY DEFINER` + `Tenancy::withContext()` paths.

## 3. Entitlement rewrite (`Entitlement::resolve`)

**Today** (`Entitlement.php:116-171`): read `academies.plan_id`'s single plan, union add-ons, apply the
video override, apply the feature-flag kill-switch, merge video-tier limits.

**Target:** union across the client's **active module subscriptions**.

```
resolve(academyId):
  subs = module_subscriptions where academy_id = academyId
         and status = 'ACTIVE'                       # PAUSED/ENDED contribute nothing (M-BILL-2)
         and (is_trial = false or trial_end is null or trial_end > now())

  capabilities = ⋃ over subs of plan(sub.plan_id).features.capabilities
  capabilities ∪= feature_key of each active academy_addons row      # add-ons still supported
  capabilities = applyVideoOverride(capabilities, VIDEO sub.overrides)  # force on/off, trial expiry
  capabilities -= { keys of feature_flags where enabled = false }     # platform kill-switch, LAST

  # video.only is DERIVED, not stored (D5):
  if (VIDEO sub active) and (no MANAGEMENT sub active):
      capabilities += 'video.only'

  limits = merge(plan.limits of each sub)                             # module keys don't collide
  limits = applyVideoLimits(limits, VIDEO sub.plan tier + overrides)  # VIDEO_LIMIT_KEYS only

  return { capabilities, limits, modules: [...active module codes], addOns }
```

Rules preserved (`M-ENT-2`): capabilities fail closed, limits/flags fail open. The public token paths
(`limitFor`, `flagFor`, `flag`) keep the same signatures — they just resolve through the new union.

**`video.only` handling.** The MEET-exclusive special case in `FeatureCatalog` (`MEET_EXCLUSIVE_CAPABILITIES`,
`bundledCapabilities()`) can be simplified: since `video.only` is derived, the MEET plan's stored
capabilities reduce to `['video.conferencing']` and the "strip video.only from full plans" data-fix
migration becomes moot. Keep the derivation in one place (`resolve`) so the app-shell's video-only nav
collapse ([app-shell.tsx](../../apps/web/src/components/app-shell.tsx) `videoOnly` logic) is unchanged.

**`GET /api/entitlements` response** gains a `modules: string[]` field (which modules the client has
active) so the panel and the owner shell can reason per-module. Existing `capabilities`/`limits`/`plan`
fields stay for back-compat (`plan` becomes the MANAGEMENT sub's plan code, or the single active module's).

## 4. Billing rewrite (`AcademyBilling` / `Invoicing`)

`AcademyBilling` today keys everything on `academies.plan_id` and the one subscription
(`ensureSubscription`, `recomputeTotals`, `startTrial`, `activate`, `expireTrial`, `rollAndBill`).
Target: **the same methods, parameterized by `module`**.

- `ensureSubscription(academyId, module)` → lazily creates the module's live row.
- `recomputeTotals(academyId, module)` → `base = module plan price + module add-ons (same currency)`.
- `expireTrial` / lapse → sets that module's row to `PAUSED`; **suspension is scoped** (`M-BILL-2`): a
  paused MANAGEMENT sub suspends the academy's management access; a paused VIDEO sub disables rooms; a
  paused WHATSAPP sub stops sends. The academy is only fully `SUSPENDED` when it has **no** active module.
- **Consolidated invoice** (`M-BILL-1`): `generateInvoiceForPeriod` sums the client's active module subs
  into one bill with a line item per module (`subtotal_minor` per module → one `total_minor`). Multi-currency
  clients keep the existing per-currency handling.

## 5. `overrides` jsonb (video, and future modules)

The VIDEO sub's `overrides` absorbs today's three video columns:

```jsonc
{
  "access":   "ENABLED" | "DISABLED" | null,   // force video.conferencing on/off (was academies.video_access)
  "trialEnd": "2026-08-01T00:00:00Z" | null,   // was academies.video_trial_ends_at
  "tierPlanId": "<uuid>" | null,               // per-client video tier (was academies.video_plan_id)
  "limits": { "maxRoomParticipants": 50, "monitorAllowed": 1, ... }  // was academies.video_overrides
}
```

`applyVideoOverride` and `applyOverrideLimits` (in `Entitlement`) read from here instead of the academy
columns. Scope stays `video.conferencing` + `FeatureCatalog::VIDEO_LIMIT_KEYS` only — a video override
never alters `maxStudents`, etc.

## 6. Enums, indexes, constraints summary

- New column: `plans.module` (checked text, default `MANAGEMENT`).
- New table: `module_subscriptions` (above) — reuses `subscription_status`, `billing_interval`.
- New indexes: `module_subscriptions_one_live_uidx` (partial unique), `_academy_idx`, `_module_status_idx`.
- App-layer constraint (validated in the controller, not the DB): a sub's `plan_id` must reference a
  plan whose `module` matches the sub's `module`.
- `academy_subscriptions` is **kept read-only** through Phase 5 (history + rollback safety), dropped or
  archived in Phase 6.

## 7. Parity migration strategy (Phase 1) — the careful part

Goal: derive `module_subscriptions` from current state so **`Entitlement::resolve` yields identical
output** once the resolver switches (`M-ENT-1`).

For each academy `a`:

1. **MANAGEMENT sub** — if `a.plan_id` references a non-VIDEO plan: create a MANAGEMENT
   `module_subscription` mirroring the current live `academy_subscriptions` row (status, trial dates,
   period, prices, currency). If the academy's only plan is MEET, it has **no** MANAGEMENT sub.
2. **VIDEO sub** — create when the academy is video-entitled today, i.e. **any** of:
   - plan is MEET (`video.only`), or
   - an active `VIDEO_<cur>` add-on in `academy_addons`, or
   - `video_access = 'ENABLED'` (with a future/no trial).
   Its `plan_id` = MEET (for video-only) or the video-tier `video_plan_id` (else null = "grant only");
   `overrides` = `{ access, trialEnd, tierPlanId, limits }` folded from the four `video_*` columns.
3. **WHATSAPP sub (bundled → provisioned, D6)** — for each academy whose current plan grants
   `whatsapp.automation`, create a WHATSAPP `module_subscription` on a seeded **`WA_BUNDLED`** plan
   (price 0, capability `whatsapp.automation`) so existing WhatsApp users keep working after
   `whatsapp.automation` is removed from the MANAGEMENT plans' capability lists. New standalone WhatsApp
   clients get a paid `WA_*` plan instead.

   > **Alternative considered:** leave `whatsapp.automation` inside MANAGEMENT plans and only give NEW
   > standalone clients a WHATSAPP sub. Rejected — it would leave two sources of truth for the same
   > capability (module union vs bundled), defeating the module model. D6 makes WhatsApp uniformly a
   > module sub.

4. **Verify parity:** a one-off command/test snapshots `resolve()` for every academy **before**
   (old resolver) and **after** (new resolver over the migrated rows) and asserts the capability+limit
   sets are identical (`AC-M2.1` / `TC-M2.1`). The Phase-1 migration does NOT switch the resolver — it
   only writes the rows; Phase 2 flips the read after parity is green.

## 8. RLS & migration gotchas (`M-PROC-2`) — learned the hard way on prior work

- **Is `module_subscriptions` tenant-scoped?** Follow `academy_subscriptions`' precedent. If it is
  FORCE-RLS, the parity backfill (which runs as owner `academiq_app` with **no tenant context**) will
  match zero rows. Use the proven wrap:
  `alter table module_subscriptions no force row level security;` … backfill … `… force row level security;`
  (owner is RLS-exempt without FORCE; the txn-wrapped migration can't leave FORCE off).
- **Seeding platform plans** (`plans.module` backfill, `WA_BUNDLED`, new `WA_*`, MEET touch-ups): the
  `plans` catalog is RLS-guarded for writes — seed under a SUPER_ADMIN GUC or `set role` the bypass
  role, exactly as `DemoAcademySeeder::seedPlatformCatalog()` and the MEET migration do. **Never** use
  `set_config(..., is_local=false)` on a FORCE-RLS table in a migration (the GUC leaks across the test
  connection and aborts unrelated suites — the documented admin-panel gotcha).
- **Backfilling a NOT NULL column** on an existing tenant table: add nullable → backfill under
  no-force-RLS → set NOT NULL, never add-NOT-NULL-then-backfill.
- Keep `subscription_status`/`billing_interval` enum reuse so no new enum-in-transaction hazards.

## 9. Files this phase touches (backend)

- New migrations: `…_plans_module.php`, `…_module_subscriptions.php`, `…_seed_whatsapp_plans.php`,
  `…_backfill_module_subscriptions.php` (parity).
- `apps/api/app/Support/Entitlement.php` — the union rewrite (Phase 2).
- `apps/api/app/Support/FeatureCatalog.php` — add `module` grouping to the catalog; simplify
  `video.only` handling.
- `apps/api/app/Services/AcademyBilling.php`, `Invoicing.php` — module-parameterized (Phase 2).
- `apps/api/app/Support/PermissionCatalog.php` — per-module admin capabilities (Phase 3).
- Seeders: `DemoAcademySeeder` / `ShowcaseAcademySeeder` — seed module-scoped plans + demo module subs.
</content>
