# AcademIQ Video Platform — Documentation

A self-hosted, mobile-first video classroom that replaces Zoom for online academies, embedded
into the AcademIQ platform and sold either **standalone** ("video-only") or **bundled** with the
management system.

This folder is the **single source of truth** for the initiative. It is written so that *any*
engineer or AI agent can pick up any phase and know exactly what to build, why, and how it plugs
into the existing AcademIQ system (`apps/api` Laravel + `apps/web` Next.js + PostgreSQL/RLS).

> **Read order for a newcomer:** `00-OVERVIEW` → `01-ARCHITECTURE` → `05-ROADMAP`, then the
> deep-dive doc for whatever phase you are working on.

---

## Document map

| Doc | Purpose | Status |
|---|---|---|
| [00-OVERVIEW.md](00-OVERVIEW.md) | Vision, product principles, packaging, account & pricing model, decision log, rule IDs (`V-*`) | ✅ Written |
| [01-ARCHITECTURE.md](01-ARCHITECTURE.md) | System architecture, component responsibilities, token/trust flow, Laravel/Next integration, webhooks, RBAC + entitlement wiring | ✅ Written |
| [05-ROADMAP.md](05-ROADMAP.md) | The phased build plan. One tested phase at a time, with acceptance criteria (`AC-V*`) and test cases (`TC-V*`) | ✅ Written |
| [02-INFRASTRUCTURE.md](02-INFRASTRUCTURE.md) | Local Docker setup + Hetzner runbook, staged sizing, TURN/coturn, Egress, object storage, ports/firewall, observability — the Phase-0 runbook | ✅ Written |
| [03-DATA-MODEL.md](03-DATA-MODEL.md) | New tables + migrations (RLS-scoped), enums, indexes, seed data, entitlement/permission seeds, guest-join design | ✅ Written |
| [04-FLUTTER-CLIENT.md](04-FLUTTER-CLIENT.md) | Flutter app clean architecture, the `MediaSession` abstraction, design system, state mgmt, multi-platform (mobile→desktop) | ✅ Written |
| [06-WEB-CALL-CLIENT.md](06-WEB-CALL-CLIENT.md) | **PRIORITY** — browser call client + shareable per-room join links (Zoom-style), premium responsive UI, mobile web | 📋 Spec (next build) |
| [09-WHITEBOARD-AND-ANNOTATION.md](09-WHITEBOARD-AND-ANNOTATION.md) | Shared Excalidraw whiteboard + PDF/document annotation over the LiveKit data channel | ✅ Written |
| [10-DESKTOP-CLIENT.md](10-DESKTOP-CLIENT.md) | Teacher Electron app (`apps/desktop`) — baked-into-screen annotation, native picker, deep-link (`V-DESK-*`) | 🚧 In progress |
| [11-DESKTOP-BUILD.md](11-DESKTOP-BUILD.md) | Building & distributing the Windows `.exe` (unsigned) — build command, SmartScreen/AV notes for academies, icon, versioning, future signing (Azure Trusted Signing) | ✅ Written |

**Status legend:** ✅ written · ⏳ to be written next · 🚧 in progress

All seven docs are written. Per the project working rule ([V-PROC-1](00-OVERVIEW.md#rules)), we still
**build** one phase at a time — the docs are the blueprint; implementation proceeds phase by phase per
[05-ROADMAP](05-ROADMAP.md). The local media stack is live in [`infra/video/local/`](../../infra/video/local/)
(Phase 0, Part A — verified).

---

## How to use these docs

**If you are an AI agent or new engineer:**
1. Read `00-OVERVIEW` fully. Internalise the **non-negotiables** and the **decision log**.
2. Read `01-ARCHITECTURE` to understand how the new service plugs into the existing codebase.
3. Open `05-ROADMAP`, find the **current phase**, and work only inside it.
4. Every change must satisfy the phase's acceptance criteria and ship with passing tests.

**Conventions (mirroring [docs/00-MASTER-SPEC.md](../00-MASTER-SPEC.md)):**
- **Rule IDs** `V-<AREA>-<n>` — durable product/engineering rules (e.g. `V-AUD-1`). Defined in `00-OVERVIEW`.
- **Acceptance criteria** `AC-V<phase>.<n>` — what "done" means for a phase. Defined in `05-ROADMAP`.
- **Test cases** `TC-V<phase>.<n>` — concrete tests proving an AC. Defined in `05-ROADMAP`.
- Code is referenced by repo-relative path (e.g. `apps/api/app/Support/Entitlement.php`).

---

## One-paragraph summary of the decision

Build the video product as a **control layer on top of self-hosted LiveKit** (open-source SFU) — we
do **not** build a media engine, and we do **not** use LiveKit Cloud (cost). The Laravel API
(`apps/api`) is the control plane: it mints scoped LiveKit access tokens, manages rooms, gates
access via the existing RBAC + entitlement systems, and records (on demand) via LiveKit Egress to
S3-compatible storage. The live-call client is a **native Flutter app** (one codebase → Android,
iOS, later desktop/web) built audio-first for poor MENA mobile networks. Media runs on a **separate
Hetzner server**, integrated at the application level exactly like the existing WhatsApp gateway.
