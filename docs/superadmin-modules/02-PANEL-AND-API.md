# 02 — Panel IA, Sidebar, API & Permissions

How the Super Admin surface is reorganized once the module data model (`01-DATA-MODEL`) exists.

## 1. Sidebar redesign — module dropdowns

Today [app-shell.tsx](../../apps/web/src/components/app-shell.tsx) renders a flat `NAV` with four fixed
groups. Target: for a **platform Super Admin** (`role = SUPER_ADMIN`, `academyId = null`), the sidebar
renders **collapsible module sections**, each a dropdown of that module's pages.

```
┌────────────────────────────┐
│  Acadmyq · Platform        │
├────────────────────────────┤
│  ▾ Platform                │   ← always expanded; cross-cutting
│     Overview               │
│     Clients                │
│     Users                  │
│     Roles & permissions    │
│     Settings & flags       │
│     Audit log              │
│     Revenue                │
│  ▸ Management System        │   ← collapsed module dropdowns
│  ▸ WhatsApp Service         │
│  ▸ Video Platform           │
└────────────────────────────┘
```

**Implementation approach:**
- Introduce a `module?: "platform" | "management" | "whatsapp" | "video"` field on nav items (Super
  Admin items only), alongside the existing `group`. Tenant items keep `group` and render unchanged —
  the owner panel is untouched (`M-UI-1`).
- Render Super Admin nav as **collapsible `<details>`-style sections** keyed by `module`, remembering
  open/closed state (localStorage). Active-route auto-expands its module.
- The active-item and locked/upgrade-badge logic already in `app-shell.tsx` is reused; only the grouping
  container changes.
- Keep it accessible: each module header is a real `<button aria-expanded>`; RTL-safe with logical props
  (the codebase's rule).

`app-shell.test.tsx` gains cases: module sections render, collapse/expand, active route expands its
module, a Super Admin with only some module-admin caps sees only those modules.

## 2. Route namespacing

Move Super Admin pages under a module segment so routes mirror the IA. Redirect old paths for safety.

| Module | Route base | Pages |
|---|---|---|
| Platform | `/admin` | `/admin` (overview), `/admin/clients`, `/admin/users`, `/admin/roles`, `/admin/settings`, `/admin/audit`, `/admin/revenue` |
| Management | `/admin/management` | `/admin/management` (overview), `/clients`, `/plans`, `/billing`, `/staff-departments` |
| WhatsApp | `/admin/whatsapp` | `/admin/whatsapp` (overview), `/clients`, `/plans`, `/connections`, `/activity`, `/system`, `/guide` |
| Video | `/admin/video` | `/admin/video` (overview/usage), `/clients`, `/plans`, `/compliance`, `/health`, `/academies/[id]` |

Existing pages move rather than get rewritten:
- `/admin/plans` → `/admin/management/plans` (module-filtered to MANAGEMENT plans; the same editor gains
  a module selector so it can also edit WhatsApp/Video plans, or each module gets its own filtered view).
- `/admin/billing` → `/admin/management/billing` + a Platform `/admin/revenue` that aggregates all modules.
- `/admin/automation/*` → `/admin/whatsapp/*` (the tabbed console already maps 1:1 to these pages).
- `/admin/video/*` → stays; already at target shape.
- Old routes issue a client redirect for a release (`next.config` rewrite or a thin redirect page).

## 3. Module → pages, in detail

### ▸ Platform (cross-cutting)
- **Overview** — cross-module KPIs: clients per module, MRR per module, trials ending, review queues.
  Extends today's `AdminDashboardScreen`.
- **Clients** — the master client directory: every `academies` row with **which modules each has**
  (chips: MGMT / WA / VIDEO + status). Drill-in opens a client detail with a tab per module subscription.
- **Users / Roles / Settings & flags / Audit** — today's `/admin/users`, `/admin/roles`,
  `/admin/settings`, `/audit`, re-homed.
- **Revenue** — consolidated MRR with a per-module breakdown (new; reads all module subs).

### ▸ Management System
- **Clients + subscriptions** — academies with a MANAGEMENT sub; status/plan/trial/renewal columns.
- **Plans & add-ons** — MANAGEMENT-module plans (FREE/BASIC/PRO) + add-ons.
- **Billing** — trials, renewals, payment-proof review (today's billing screen, module-scoped).
- **Staff departments** — the existing catalog.

### ▸ WhatsApp Service
- **Clients + subscriptions** — clients with a WHATSAPP sub, **including external QR-only clients**
  (§6). Columns: connection state, plan/price, session, daily volume.
- **Plans** — the `WA_*` plans (incl. `WA_BUNDLED`).
- **Connections** — per-client connect/QR/status/logout + test-send (today's `manage-modal`).
- **Activity** — platform-wide send feed (`app.admin_whatsapp_activity()`).
- **System** — gateway up/down, uptime, per-state session counts, editable rate-limits.
- **Guide** — the existing guide tab.

### ▸ Video Platform (already built — just re-homed under the module)
- **Clients + access** — video academies + access/tier/override editor (`VideoOversightController`).
- **Plans** — video plans/tiers. **Usage** — rooms/recordings/storage. **Compliance** — monitor/recording
  audit feed. **Health** — LiveKit/Egress/storage reachability.

## 4. API reorg

Keep the two-layer authz and `SECURITY DEFINER` cross-tenant pattern; reorganize endpoints by module.

- **Namespacing:** `Admin\Platform\*`, `Admin\Management\*`, `Admin\Whatsapp\*`, `Admin\Video\*`
  controllers (the existing `Admin\*` controllers move/split; logic is reused).
- **Uniform per-module endpoints** (new, backed by `module_subscriptions`):
  ```
  GET   /admin/{module}/clients                 # clients with a live sub for this module
  GET   /admin/{module}/clients/{id}            # this client's module detail
  GET   /admin/{module}/plans                   # plans where plans.module = {module}
  POST  /admin/{module}/clients/{id}/subscription        # provision/attach a module sub
  PUT   /admin/{module}/clients/{id}/subscription        # change plan / interval / period
  POST  /admin/{module}/clients/{id}/subscription/trial  # start/extend trial
  POST  /admin/{module}/clients/{id}/subscription/activate
  POST  /admin/{module}/clients/{id}/subscription/cancel # → PAUSED/ENDED, scoped suspension (M-BILL-2)
  ```
  `{module}` ∈ `management|whatsapp|video`. Each writes a `module_subscriptions` row via
  `AcademyBilling(module)` and audits it.
- **Cross-tenant reads** stay in audited `SECURITY DEFINER` functions; add
  `app.admin_module_subscriptions(module)` and `app.admin_client_directory()` (modules-per-client) as
  needed, mirroring `app.admin_list_academies()` / `app.admin_video_stats()`.
- Video's existing `/admin/video/*` endpoints keep working; they get thin aliases under the new scheme.

## 5. Permissions (`PermissionCatalog`)

Today one `platform.manage` (plus `academy.read`, `plan.manage`, `automation.manage`,
`academy_billing.manage`) governs the whole panel. To let module ownership be delegated, add per-module
admin capabilities:

- `management.admin`, `whatsapp.admin`, `video.admin` — each gates its module's pages + endpoints.
- `platform.admin` (rename/keep `platform.manage`) — the cross-cutting Platform module (users, roles,
  flags, revenue) and implies all three module admins.
- SUPER_ADMIN retains all. The sidebar shows only modules the session can administer.

This is additive: keep the existing caps working (map `platform.manage` ⇒ all module admins) so nothing
breaks; the granular caps are for future delegation. Seeded in `PermissionCatalog::PERMISSIONS` + role
map, synced by `PermissionSeeder` (auto-run by `DemoAcademySeeder::seedPlatformCatalog`).

## 6. WhatsApp external-client provisioning (`M-CLI-2`)

The flow for onboarding a client who is **outside** the management system and only wants WhatsApp:

1. **Create client** — `POST /admin/whatsapp/clients` creates a lightweight `academies` row (name +
   default currency + timezone), **no owner user**, status set so RLS/billing work but no management
   login exists. Audited.
2. **Attach WHATSAPP subscription** — pick a `WA_*` plan/price + interval; creates the module sub.
3. **Connect by QR** — the existing `whatsappConnect/whatsappQr/whatsappStatus` lifecycle
   (`AcademyAutomationController`) binds a gateway session (`academy_automation_settings.wa_session_id`).
4. **Serve via API** — the send path is unchanged (`WhatsAppSender` → gateway); entitlement now comes
   from the WHATSAPP module sub (`whatsapp.automation`), gated by billing lifecycle (`M-BILL-2`: a lapsed
   WHATSAPP sub stops sends).

Such a client appears in **WhatsApp → Clients** and in **Platform → Clients** (with only a WA chip), but
not in **Management → Clients**. It has no owner-panel session.

## 7. Frontend conventions (unchanged)

`page.tsx` (server, wraps AuthProvider→AppShell) + `screen.tsx` (`"use client"`, permission-gated); API
in `lib/api.ts` typed functions; i18n keys in **both** `messages/en.json` and `ar.json`; RTL-safe logical
CSS; shadcn UI. New nav labels + module names go under an `adminNav.*` namespace in both locales.
</content>
