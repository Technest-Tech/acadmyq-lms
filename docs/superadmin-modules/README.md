# Super Admin — Modular Platform Reorganization

Rebuild the Super Admin panel from **one flat sidebar + one subscription-per-academy** into a
**module-organized platform** where each product line — **Management System**, **WhatsApp Service**,
**Video Platform** — is a distinct module a client can subscribe to **independently**, each with its
own plans, pricing, trial, and billing lifecycle.

This folder is the **single source of truth** for the initiative, written so any engineer or AI agent
can pick up any phase and know exactly what to build, why, and how it plugs into the existing system
(`apps/api` Laravel + `apps/web` Next.js + PostgreSQL/RLS).

> **Read order for a newcomer:** `00-OVERVIEW` → `01-DATA-MODEL` → `03-ROADMAP`, then `02-PANEL-AND-API`
> for the surface you are building.

---

## Document map

| Doc | Purpose | Status |
|---|---|---|
| [00-OVERVIEW.md](00-OVERVIEW.md) | Vision, the problem, the module model, packaging & pricing, **locked decisions**, non-negotiable rules (`M-*`), decision log | ✅ Written |
| [01-DATA-MODEL.md](01-DATA-MODEL.md) | The schema change: `plans.module`, `module_subscriptions`, the entitlement rewrite, parity migration, RLS gotchas | ✅ Written |
| [02-PANEL-AND-API.md](02-PANEL-AND-API.md) | The module-aware sidebar, route namespacing, module→pages map, API reorg, per-module permissions, billing/suspension semantics, WhatsApp external-client flow | ✅ Written |
| [03-ROADMAP.md](03-ROADMAP.md) | The phased build plan (Phases 0–6), acceptance criteria (`AC-M*`), test cases (`TC-M*`), checkboxes | ✅ Written |

**Status legend:** ✅ written · ⏳ to be written · 🚧 in progress

---

## Conventions (mirroring [docs/00-MASTER-SPEC.md](../00-MASTER-SPEC.md) and `docs/video-platform/`)

- **Rule IDs** `M-<AREA>-<n>` — durable product/engineering rules (e.g. `M-SUB-1`). Defined in `00-OVERVIEW`.
  Areas: `SUB` (subscriptions), `CLI` (client identity), `ENT` (entitlement), `BILL` (billing),
  `UI` (panel/IA), `PROC` (process).
- **Acceptance criteria** `AC-M<phase>.<n>` — what "done" means for a phase. Defined in `03-ROADMAP`.
- **Test cases** `TC-M<phase>.<n>` — concrete tests proving an AC. Defined in `03-ROADMAP`.
- Code is referenced by repo-relative path (e.g. `apps/api/app/Support/Entitlement.php`).
- We **build one tested phase at a time** (`M-PROC-1`). The docs are the blueprint; implementation
  proceeds phase by phase per `03-ROADMAP`.

---

## One-paragraph summary

Today an academy is bound to **exactly one plan** (`academies.plan_id`, a scalar FK) with **exactly one
live subscription** (`academy_subscriptions` unique-partial index). Every product — management, WhatsApp,
video — is a bundle of *capabilities inside that one plan*. This initiative turns each product into an
**independently-subscribable module**: a new `module_subscriptions` table lets **one shared client**
(the `academies` record — the "academy-of-one" pattern generalized) hold any combination of a
Management, WhatsApp, and/or Video subscription, each with its own plan/price/trial/status. Capabilities
become the **union across a client's active module subscriptions**. The Super Admin panel is then
reorganized into a collapsible **module sidebar** where each module has its own client list, plans,
subscriptions, and operational pages — replacing today's single flat list where all subscriptions are
tangled together.

- **[05-MODULES-NOT-PACKAGES.md](05-MODULES-NOT-PACKAGES.md)** — packages removed (2026-08-18).
  Four client types, modules that grant every feature they own, per-client feature switches and
  per-client pricing. Supersedes everything about plans/tiers in 00–04.
