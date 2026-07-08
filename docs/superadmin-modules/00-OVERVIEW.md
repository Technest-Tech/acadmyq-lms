# 00 — Overview, Module Model & Decisions

## 1. The problem

The Super Admin panel grew feature-by-feature (see [docs/admin-panel-buildout-plan.md](../admin-panel-buildout-plan.md),
all 7 phases done) and then absorbed two new product lines — the **WhatsApp gateway** and the **Video
platform**. The result:

- **One flat sidebar.** [apps/web/src/components/app-shell.tsx](../../apps/web/src/components/app-shell.tsx)
  has a single `NAV` array with four hard-coded groups (`general`/`management`/`financial`/`system`).
  The Super Admin's items — Academies, Users, Plans, Staff Departments, WhatsApp Automation, Video,
  Billing, Platform Settings, Roles — are scattered across those groups, interleaved with the *tenant*
  (academy owner) items and separated only by permission gating. There is no notion of a "module".
- **One subscription per client.** `academies.plan_id` is a single scalar FK; `academy_subscriptions`
  enforces one live row per academy. Every product is a *capability bundled inside that one plan*. So
  all three products share a single tangled subscription — you cannot see or sell them separately.

The owner's words: *"all subscriptions is with each other so everything is not understandable and
doesn't organized at all."* That is literally true at the schema level, not just the UI.

## 2. The vision

A **modular platform** where the Super Admin manages three products in isolation:

```
                         ┌─────────────────────────────────────────┐
                         │            SUPER ADMIN PANEL             │
                         ├─────────────────────────────────────────┤
   ▸ Platform            │  overview · clients · users · roles ·    │  cross-cutting governance
                         │  settings/flags · audit · revenue        │
                         ├─────────────────────────────────────────┤
   ▸ Management System   │  clients+subs · plans · billing · staff  │  the academy SaaS product
                         ├─────────────────────────────────────────┤
   ▸ WhatsApp Service    │  clients+subs · connections · activity · │  automation-as-a-service
                         │  gateway health · guide                  │  (incl. EXTERNAL QR clients)
                         ├─────────────────────────────────────────┤
   ▸ Video Platform      │  clients+access · plans · usage ·        │  self-hosted LiveKit
                         │  compliance · infra health               │
                         └─────────────────────────────────────────┘
```

Each module is a **product a client subscribes to independently**. A client can be management-only,
video-only, WhatsApp-only, or any mix.

## 3. The module model

**A client is one `academies` record. A module is something a client subscribes to.**

- The `academies` table is the **universal client/tenant identity** — the same record whether the
  client uses one module or all three. We do **not** create separate client rosters per module.
  This generalizes the existing **MEET plan "academy-of-one"** pattern (a video-only academy already
  reuses all RLS/billing today).
- Each `(client, module)` pair may have **at most one live subscription**, held in a new
  `module_subscriptions` table. A subscription carries its own plan, price, trial window, billing
  period, and status — independent of the client's other modules.
- **Capabilities are the union** of every active module subscription's plan capabilities. `video.only`
  stops being a stored plan marker and becomes a *derived* state: "has a VIDEO subscription and no
  MANAGEMENT subscription."

The three modules:

| Module code | Product | Capabilities (today) | Sold as |
|---|---|---|---|
| `MANAGEMENT` | Academy management SaaS | `invoicing`, `payroll`, `certificates`, `staff`, `custom_roles`, `trials`, `student_reports`, `audit.full`, `report_field.custom` | FREE / BASIC / PRO plans |
| `WHATSAPP` | WhatsApp automation-as-a-service | `whatsapp.automation` | new `WA_*` plans (admin-provisioned) |
| `VIDEO` | Self-hosted video classroom | `video.conferencing`, `video.only` | MEET plan / VIDEO tiers / grants |

## 4. Packaging & pricing

- **Management** keeps its FREE/BASIC/PRO tiers ([plan tiers catalog](../../)). BASIC currently bundles
  `whatsapp.automation`; see `01-DATA-MODEL §7` for how bundled WhatsApp is handled at migration.
- **Video** keeps its three sales routes (MEET plan, `VIDEO_<cur>` add-on, per-academy grant). These
  collapse into a single VIDEO **module subscription** with its overrides in `module_subscriptions.overrides`.
- **WhatsApp** becomes a first-class module. Per the owner (`M-CLI-2` below), WhatsApp is **not a
  self-serve storefront product** — the Super Admin onboards a client, connects them by QR, and serves
  the automation over the API. A WhatsApp client may be **external** to the management system: a
  lightweight `academies` record with a WHATSAPP subscription and a gateway session, **no owner login
  required**. Billing for it is admin-managed (a WHATSAPP plan/price attached to the module sub).

## 5. Locked decisions (owner, 2026-07-08 — AskUserQuestion)

1. **`M-SUB-1` — Full per-module subscriptions.** Build the real independent-subscription model now
   (not UI-only, not deferred). New schema (`module_subscriptions`), entitlement + billing rewrite,
   parity migration.
2. **`M-CLI-1` — One shared client, many module subscriptions.** Extend `academies` as the universal
   client. No per-module client rosters. A client holds 0..1 live subscription per module.
3. **`M-CLI-2` — WhatsApp serves external QR clients.** *"Yes but not literally"* — WhatsApp is
   admin-provisioned, not a self-serve tier. A WhatsApp-only client can be outside the management
   system: a client record + WHATSAPP subscription + gateway session, connected by QR, served via API,
   with **no management login**.

## 6. Non-negotiable rules (`M-*`)

- **`M-PROC-1`** — Build one tested phase at a time, in `03-ROADMAP` order. Each phase ships with
  passing Pest + Vitest and satisfies its acceptance criteria.
- **`M-ENT-1` — Parity before cutover.** The entitlement rewrite (Phase 2) MUST resolve **byte-identical**
  capabilities and limits for every existing academy before the old single-plan resolver is removed.
  A snapshot/diff test gates the cutover (`AC-M2.1`). A silent entitlement regression would break live
  tenants' gating.
- **`M-ENT-2` — Capabilities fail closed, limits/flags fail open.** Preserve the existing semantics
  ([Entitlement.php](../../apps/api/app/Support/Entitlement.php) §3.3): unknown capability ⇒ denied;
  absent limit ⇒ unlimited; absent flag ⇒ allowed.
- **`M-SUB-2` — One live subscription per (client, module).** Enforced by a partial unique index.
  ENDED rows are history, mirroring today's `academy_subscriptions_one_live_uidx`.
- **`M-BILL-1` — Independent lifecycle, consolidated invoice.** Each module sub trials/activates/lapses
  independently, but a client with multiple modules receives **one invoice** with per-module line items.
- **`M-BILL-2` — Per-module suspension is scoped.** A lapsed module disables only its own surface
  (management → panel; video → rooms; WhatsApp → sends); it never suspends the whole client unless the
  client has no other active module.
- **`M-UI-1` — Two-layer authz unchanged.** Every endpoint keeps its `Gate::authorize()` capability
  check backed by Postgres RLS; UI `can()` stays UX-only. Cross-tenant reads via audited
  `SECURITY DEFINER` functions; cross-tenant writes via `Tenancy::withContext()`.
- **`M-UI-2` — Plans are data, never code.** No module code hardcodes a plan code; the `module` a plan
  belongs to is a column, and plan/capability edits stay a DB change, not a deploy.
- **`M-PROC-2` — Migration-vs-RLS discipline.** Backfilling FORCE-RLS tenant tables and seeding the
  platform catalog use the established dances (`no force row level security` wrap; SUPER_ADMIN GUC for
  catalog seeds) — see `01-DATA-MODEL §8`.

## 7. Decision log

| # | Decision | Rationale |
|---|---|---|
| D1 | Extend `academies` as the universal client; no separate client tables | `M-CLI-1`; reuses all RLS/billing/auth; MEET academy-of-one already proves it |
| D2 | New `module_subscriptions` table rather than N per-module tables | One uniform lifecycle/billing engine; `module` is a column, not a table split |
| D3 | `plans.module` scopes each plan to one module | Keeps plans data-driven; a client's capabilities = union over its subs' module plans |
| D4 | Video's `video_access`/`video_plan_id`/`video_overrides` fold into the VIDEO sub's `overrides` jsonb | Removes three special-case columns from `academies`; unifies the override path |
| D5 | `video.only` becomes derived, not stored | "VIDEO sub ∧ ¬MANAGEMENT sub"; avoids the MEET-exclusive-capability special case |
| D6 | Bundled WhatsApp for existing academies → auto-provisioned WHATSAPP sub at migration | Preserves current behavior for academies that had `whatsapp.automation` (see `01 §7`) |
| D7 | WhatsApp is admin-provisioned, not self-serve | `M-CLI-2`; external QR clients need no management login |
| D8 | Consolidated invoice with per-module line items (not N invoices) | `M-BILL-1`; one client, one bill, clear module breakdown |

## 8. What explicitly stays the same

- The tenant (academy owner) app shell and its nav. This initiative reorganizes the **Super Admin**
  surface; the owner-facing sidebar keeps its plan-gated groups (though the *entitlement source* behind
  it changes in Phase 2, transparently).
- Postgres RLS, tenancy, audit, the two-layer authz model.
- The LiveKit control plane and the WhatsApp gateway service themselves — only their **billing/subscription
  wrapper and admin surface** change.
</content>
