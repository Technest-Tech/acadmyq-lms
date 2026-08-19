# 05 — Modules, not packages

**Status:** approved 2026-08-18 (owner). Supersedes the plan-tier model of
[00-OVERVIEW](00-OVERVIEW.md) §"plans" and [plan-tiers-catalog] for everything about *features*.
The client-first IA of [04-CLIENT-FIRST-REDESIGN](04-CLIENT-FIRST-REDESIGN.md) stands; this
document replaces what a subscription *grants*.

## 1. The change in one paragraph

Packages (FREE / BASIC / PRO / MEET / WA_* / CRM_* / LMS_*) die. A client is one of **four types**,
each type subscribes to **modules**, and a module grants **every feature it owns** — no tiers, no
caps — until a Super Admin explicitly switches a feature **off for that one client** from the
client's profile page. Features move from "what did they buy?" (plan) to "what did we decide to
turn off?" (per-client override). Price stops living in a catalog and lives on the client's own
module row, so a custom or yearly deal is just a number typed into the profile.

## 2. Client types → modules

| Type | Modules it may hold | Notes |
|---|---|---|
| `MANAGEMENT` | `MANAGEMENT` (always) + optional `VIDEO` + optional `WHATSAPP` | The school/academy client. **Never LMS.** |
| `VIDEO` | `VIDEO` only | The video-platform client (the old MEET workspace). |
| `WHATSAPP` | `WHATSAPP` only | The external WhatsApp-automation client (no management login). |
| `LMS` | `LMS` only | The course-selling client (its own learner site + identity). |

`academies.client_type` stores it. The type is a hard constraint, enforced in `ModuleBilling`:
enabling `LMS` on a `MANAGEMENT` client (or `MANAGEMENT` on an `LMS` client) is a 422, not a policy
note. CRM is **no longer a module** — it is a feature of the management system (§3).

Workspace collapse is now DERIVED from the type, not stored on a plan:
`video.only` ⟺ `client_type = VIDEO`, `lms.only` ⟺ `client_type = LMS`.

## 3. Modules → features

`FeatureCatalog::MODULE_CAPABILITIES` is the map (code, not data — a capability belongs to exactly
one module):

- **MANAGEMENT** — `invoicing`, `payroll`, `certificates`, `staff`, `custom_roles`, `trials`,
  `crm`, `student_reports`, `audit.full`, `report_field.custom`
- **VIDEO** — `video.conferencing`
- **WHATSAPP** — `whatsapp.automation`
- **LMS** — `lms`

A live, grantable module subscription grants ALL of its capabilities. Adding a feature to the
product = add the key to `CAPABILITIES` + its module's list + gate the route; every existing client
of that module gets it on deploy, which is the point.

## 4. Resolution (App\Support\Entitlement)

```
capabilities = ⋃ over grantable live subs:  MODULE_CAPABILITIES[module] − overrides.disabled[]
             + video.only / lms.only        (derived from client_type)
             + add-on feature keys          (unchanged)
             − feature_flags(enabled=false) (platform kill-switch, unchanged, applied last)

limits       = ⋃ over LIVE subs (any status): overrides.limits ∩ MODULE_LIMIT_KEYS[module]
```

- **Grantable** = `status = ACTIVE` and, when a trial is running, `trial_end` in the future
  (scoped suspension M-BILL-2, unchanged).
- **Limits fail open**: no override ⇒ unlimited. Flags fail open (absent ⇒ allowed). Only a
  per-client cap ever constrains anything — no plan does.
- **Capabilities still fail closed**: a client with no module rows gets nothing.
- `plans.features` is no longer read by the module resolver. `module_subscriptions.plan_id` stays
  as a nullable legacy column; new writes leave it null.

`overrides` jsonb per module row now carries:

```jsonc
{
  "disabled": ["certificates", "payroll"],   // per-client feature switches (this module's keys only)
  "limits":   { "maxStudents": 200 },        // optional per-client caps (this module's keys only)
  "access":   "ENABLED|DISABLED",            // VIDEO only, legacy force switch (kept for the ops screen)
  "tierPlanId": "…"                          // VIDEO only, legacy tier pointer — no longer read
}
```

## 5. Price

Per-client, per-module: `module_subscriptions.base_price_minor` + `currency` +
`billing_interval` (MONTHLY|YEARLY), typed in the profile. `platform_settings.module_pricing`
holds a per-module default that only PRE-FILLS the form:

```jsonc
{ "MANAGEMENT": { "price_minor": 99900, "currency": "EGP" }, "VIDEO": { … }, … }
```

Billing lifecycle (invoices, trials, consolidated bill, module_breakdown) is untouched — it always
read the sub row, never the plan.

## 6. What the client sees

A feature switched off is **hidden**, not locked: the nav item disappears and the route 402s as it
always did. The self-serve upgrade page `/plan` and the sidebar "Upgrade" badges are removed —
there are no tiers to upgrade to; a module is sold by us, in the profile.

## 7. Migration (non-destructive)

`2026_08_18_000001_client_types_and_module_features`:
1. `academies.client_type` + CHECK, backfilled: has MANAGEMENT sub → MANAGEMENT; else VIDEO sub →
   VIDEO; else a sub carrying an LMS plan / an `lms.only` academy → LMS; else WHATSAPP → WHATSAPP.
2. Every academy without a live module sub gets one (MANAGEMENT, ACTIVE, mirroring its legacy
   status/price) so the resolver never falls back to the plan path in production.
3. Live `CRM` subs are folded: ENDED, and `crm` becomes a MANAGEMENT feature for that client.
4. Nothing is dropped: `plans`, `plan_id`, `academies.video_*` remain for the legacy fallback and
   the ops screens until the R5b cleanup session.

Existing BASIC clients gain the features their tier withheld. That is intended — "all features
available unless we decide to disable one."

## 8. What landed (2026-08-18)

**API**
- `FeatureCatalog`: `CLIENT_TYPE_MODULES`, `CLIENT_TYPE_PRIMARY`, `MODULE_CAPABILITIES`,
  `MODULE_LIMIT_KEYS` + `capabilitiesOfModule/limitKeysOfModule/moduleOfCapability/moduleAllowedForType`.
- `Entitlement::resolveFromModules` rewritten to the §4 formula. `resolveLegacy` stays as the
  fallback for a client with no module rows (test fixtures; prod is backfilled by the migration).
  A VIDEO-type client can never be force-disabled — the classroom is their whole product.
- `ModuleBilling`: `MODULES` drops CRM; `enable()` is plan-free and takes price/currency/interval and
  enforces the client type; new `setPricing`, `setDisabledFeatures`, `clientType`,
  `assertModuleAllowedForClient`; `recompute()` keeps the row's own base price (a plan can no longer
  overwrite what a client pays).
- `ClientController`: `show` returns `client_type` + `catalog`; `enableModule`/`updateModule` take a
  price instead of a plan; **new** `PUT /admin/clients/{id}/modules/{module}/features`.
- `AcademyController::store` takes `client_type` + `modules[]` (defaults to MANAGEMENT) and
  provisions them through the engine; it no longer stores `plan_id`.
- Migrations: `2026_08_18_000001` (client_type + backfill + CRM fold + bundled-module preservation +
  `platform_settings.module_pricing`), `_000002` (client directory carries type/price/overrides;
  video oversight reads the VIDEO module — new `PAUSED` status, `PLAN` retired),
  `_000003` (platform overview counts modules and client types, not plans).

**Web**
- `/admin/clients/[id]`: **Modules card** (sell/price/trial/activate/pause per module) + **Features
  card** (a switch per feature the module owns, plus optional caps). The video tab is a signpost —
  one writer per fact.
- `/admin/clients/new`: pick one of the four types first; a management client can tick Video and
  WhatsApp with their prices; a WhatsApp client is created in one step with no owner login.
- The wizard sells no package: academy type + owner + "start as trial / paid".
- `/admin/plans` → **Pricing**: the per-module default that pre-fills the sell form, plus add-ons.
- Sidebar: an entitlement the client doesn't have HIDES the item; `/plan` and the Upgrade badges are
  gone; the 402 copy says "not part of this subscription".

**Tests** — `Modules/ModuleEntitlementTest` (9) covers the model end to end; `EntitlementParityTest`
(plan-vs-module parity) and `MeetPlanTest`/`VideoPlanLimitsTest` (package-shaped) were replaced by
`VideoClientTest` / `VideoClientLimitsTest`. `CreatesTenantData::createAcademy` now provisions the
type's module, so a fixture academy is a real client.

**Not done / deliberately left**
- `plans`, `academies.plan_id`, `module_subscriptions.plan_id`, `academies.video_*` and the
  `/admin/academies/{id}/plan` + plan-CRUD endpoints survive as legacy (the resolver fallback reads
  them). They go with the R5b destructive-drop session.
- A client's TYPE is fixed at creation; there is no "convert this client" flow yet.
