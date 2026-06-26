# 00 — Overview, Principles & Decisions

> **This is the keystone document.** Every other doc and every implementation phase derives from the
> vision, non-negotiables, and decisions recorded here. If a later choice contradicts this doc,
> either this doc is wrong (update it) or the choice is wrong (revert it). Nothing is "just code".

---

## 1. The problem we are solving

Online academies (Qur'an, languages, tutoring) run their classes on **Zoom**, and suffer from:

1. **Cost** — per-host licensing adds up across many teachers.
2. **No control over the room** — the teacher *owns* the Zoom account and link. The teacher holds the
   student relationship and can walk away with students. Recordings live in the teacher's account.
3. **No history / accountability** — the academy has no central record of what happened in each
   teacher's classes, no recordings tied to the student, no oversight.

**The most valuable pain is #2 (control / lock-in), not #1 (cost).** Cost gets us in the door;
*control is the moat.* A classroom that lives inside AcademIQ — where the academy owns the room, the
recording is filed under the student, and the teacher never exchanges a personal link — changes the
academy's relationship with its teachers permanently. Zoom (a horizontal tool) structurally cannot
offer this. We (the vertical operating system for the academy) can.

---

## 2. What we are building

An **embedded video classroom** for AcademIQ:

- A **native Flutter app** for the live class (Android + iOS now; desktop + web later from the same codebase).
- A **management surface** inside the existing Next.js academy panel (`apps/web`): room list, recordings library, video billing.
- A **control plane** in the existing Laravel API (`apps/api`): room lifecycle, scoped access tokens, on-demand recording, gating via existing RBAC + entitlements.
- **Self-hosted media** (LiveKit SFU + coturn + Egress) on a **separate server**, integrated at the application level exactly like the existing WhatsApp gateway.

### What we are explicitly NOT building
- **Not a media engine.** We stand on LiveKit (open source). We will not write WebRTC/SFU/codec code.
- **Not "Zoom".** No 100-person webinars in v1. Our market is **1:1, 1:2, 1:3** with a minority needing **1:many** (handled later as a one-way *broadcast/lecture mode*, which is far cheaper than full conferencing).
- **Not LiveKit Cloud.** Cost is a primary driver; we self-host from day one.

---

## 3. Product principles (non-negotiables)

These are the spirit of the product. They override convenience.

- **Audio is sacred.** In a Qur'an/recitation lesson, frozen video is acceptable; cut audio is fatal.
  On bad networks we degrade video (resolution → freeze) and *never* let audio break. Marketing
  promise: *"we never cut your recitation."* (Rule [V-AUD-1](#rules))
- **Mobile-first, measured on real MENA networks.** Customers judge quality on a phone on a mobile
  network. We build native (not mobile web), and we test on real low-end Android and throttled/mobile
  connections, including WiFi↔cellular handover. (Rules [V-MOB-1](#rules), [V-MOB-2](#rules))
- **The academy owns the room.** Teachers never own or share personal room links. Identity, room
  creation, and recordings are controlled by the academy through AcademIQ. (Rule [V-CTL-1](#rules))
- **Recording by choice.** Recording is opt-in per room/session (a teacher action or a per-room
  default), never forced — this controls CPU/storage cost. (Rule [V-REC-1](#rules))
- **Clean and scalable by construction.** The Flutter client never imports LiveKit types directly;
  all media goes through one `MediaSession` abstraction so the engine can be swapped, mocked, or
  extended. Features are isolated modules. (Rule [V-ARCH-1](#rules))
- **Secrets stay server-side.** The app never holds LiveKit admin secrets; it receives short-lived,
  narrowly-scoped access tokens minted by the control plane. (Rule [V-SEC-1](#rules))

---

## 4. Who we sell to (packaging)

| Segment | Needs | Rooms | Account shape |
|---|---|---|---|
| **Solo private teacher** | Video only; does not want the management system | 1 | An **academy-of-one** (see §6) |
| **Academy** | Multiple teachers, each with room(s), central management | N | A normal academy tenant |

Two strategic consequences:
- The **video-only** product is a **wedge / acquisition funnel** with a far larger addressable market
  than the full management SaaS. A solo teacher can start with just a room and later upgrade to the
  full platform — by flipping an entitlement, not migrating accounts.
- Therefore the video service **must run with zero dependency on the management module being present.**
  It is a clean entitlement the panel *surfaces* when present.

---

## 5. Pricing & entitlement model

We reuse the **existing paid add-on machinery** (`add_ons` + `academy_addons` +
`AcademyBilling::recomputeTotals()`), which is already "a separately-priced feature that unlocks a
capability." No new billing engine.

- **Capability key:** `video.conferencing` (added to `apps/api/app/Support/FeatureCatalog.php`).
- **Standalone (video-only):** seed `add_ons` rows with `feature_key = 'video.conferencing'`, granted
  per academy via `academy_addons`. Granting auto-recomputes the academy's subscription total.
- **Bundled:** add `video.conferencing` to the PRO plan's `plans.features.capabilities` JSON.
- **Multi-currency:** because money never converts (`MoneyMinorUnits` forbids cross-currency math),
  we seed **one `add_ons` row per currency** (e.g. `VIDEO_EGP`, `VIDEO_USD`, `VIDEO_GBP`, …) all
  sharing `feature_key = 'video.conferencing'`, and grant the row matching the academy's plan currency.
- **Per-room pricing** (solo = 1 room, academy = N rooms) is the intuitive billable unit. Mechanics of
  metering rooms are finalised in [05-ROADMAP](05-ROADMAP.md) Phase 5; the entitlement *gate* itself is
  the capability above.
- **Recording retention** is a tiered limit (e.g. 30/90 days included, pay for more) so storage does
  not grow unbounded. (Rule [V-REC-2](#rules))

Two independent gates protect every video route (matching the existing pattern):
- **RBAC** — "is this *role* allowed?" → `can:room.*` → **403**.
- **Entitlement** — "does this *academy's plan* include video?" → `entitled:video.conferencing` → **402**.

---

## 6. Account model decision (important)

**Finding:** In the current system every tenant row is isolated by RLS predicate
`academy_id = app.current_academy_id()`, and `users.academy_id` is a single nullable FK (null only for
SUPER_ADMIN). There is **no concept of a user without an academy**.

**Decision (`V-ACC-1`):** A **solo private teacher is modeled as an "academy-of-one"** — a normal
academy tenant with a single teacher/owner. We do **not** introduce academy-less users.

**Why:** Provisioning a lightweight academy reuses *all* existing plumbing unchanged — RLS isolation,
billing, multi-currency, roles, the entire `apps/api` request pipeline. The alternative (nullable
`academy_id` + a parallel "video-only" identity universe) would require touching every RLS policy and
would create a painful migration when a solo teacher later wants the full platform. With academy-of-one,
"upgrade to full platform" is just granting more capabilities — no migration.

Onboarding hides this: the solo teacher signs up and gets "their room." Under the hood it is an
academy with one teacher. Detailed provisioning flow is in [05-ROADMAP](05-ROADMAP.md) Phase 5.

---

## 7. Scope boundaries

**v1 (must be rock-solid before anything else):**
- 1:1 / 1:2 / 1:3 rooms, audio-first, on mobile (Flutter).
- Screen share.
- Optional on-demand recording, filed under the student.
- Room management + recordings library in the web panel.
- Entitlement + RBAC gating; academy and academy-of-one accounts.

**Later (only after v1 is boringly stable):**
- 1:many **broadcast/lecture mode** (one publisher, many subscribers).
- Whiteboard (Excalidraw/tldraw, synced over LiveKit data channels).
- In-call chat.
- Desktop build (Flutter macOS/Windows) and web client.
- Per-academy white-label branding of the room (theme tokens).

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **SFU** | Selective Forwarding Unit — the media server that relays audio/video between participants. We use **LiveKit**. |
| **TURN** | Relay server (we use **coturn**) for participants behind restrictive NAT/firewalls or blocked UDP. Must support TCP/443. |
| **Egress** | LiveKit's server-side recording component — joins a room, composites, writes the file to storage. |
| **Control plane** | The Laravel API (`apps/api`) — issues tokens, manages rooms, gates access, triggers recording. Holds all secrets. |
| **Room** | A persistent classroom entity (`video_rooms` table) owned by an academy/teacher. Distinct from a LiveKit "room session". |
| **Access token** | A short-lived signed LiveKit JWT minted by the control plane, scoped to one room + identity + grants. |
| **Entitlement** | Whether an academy's plan/add-ons include a capability (`video.conferencing`). Gate returns 402 if missing. |
| **Capability / permission** | A role-level ability (`room.create`, `room.join`, `recording.view`). Gate returns 403 if missing. |
| **Academy-of-one** | A normal academy tenant provisioned for a single solo teacher (see §6). |

---

## 9. Rules {#rules}

Durable rules referenced by ID throughout the docs and acceptance criteria.

| ID | Rule |
|---|---|
| **V-AUD-1** | Audio is prioritised above video at all times. Under bandwidth pressure: lower video resolution → freeze video → drop video track entirely, but never degrade or drop audio first. |
| **V-MOB-1** | The live client is a **native** app (Flutter), not mobile web. Hardware echo cancellation, hardware codecs, and audio-session control are required. |
| **V-MOB-2** | Connectivity must survive a WiFi↔cellular handover via reconnection/ICE-restart, and must connect through restrictive carrier networks via **TURN over TCP/443 (TLS)**. |
| **V-CTL-1** | The academy owns the room. No personal/teacher-owned room links. Room creation, access, and recordings are controlled by the control plane. |
| **V-REC-1** | Recording is opt-in (per session action or per-room default), never forced. |
| **V-REC-2** | Recordings have a retention policy enforced by entitlement tier; a scheduled job purges expired recordings. |
| **V-SEC-1** | LiveKit admin/API secrets live only on the control plane (config + per-tenant encrypted DB values). The client only ever receives short-lived, narrowly-scoped access tokens. |
| **V-SEC-2** | Recordings may contain **minors**. Capture requires consent state, access is gated by `recording.view`, and storage location/retention is explicit. |
| **V-ARCH-1** | The Flutter client accesses media only through the `MediaSession` abstraction; no LiveKit type is imported outside its adapter. Features are isolated modules. |
| **V-TEN-1** | Every new DB table is tenant-scoped (`academy_id` + RLS `tenant_isolation` policy, FORCE RLS). All non-HTTP writes go through `App\Support\Tenancy::withContext`. |
| **V-ACC-1** | Solo teachers are modeled as academy-of-one tenants; no academy-less users. |
| **V-PROC-1** | Build and document one phase at a time. A phase is not "done" until its acceptance criteria pass with green tests and a short manual verification. Do not start the next phase early. |

---

## 10. Decision log

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Build vs. stand on a stack | **Stand on LiveKit (self-hosted)** | Reliability is LiveKit's job; the control layer is ours. Never build a media engine. |
| D2 | Managed vs. self-hosted | **Self-hosted** (no LiveKit Cloud) | Cost is a primary driver; per-minute pricing re-creates the Zoom problem. |
| D3 | Hosting provider for media | **Hetzner** (CCX/CPX, dedicated vCPU for SFU) | Generous/flat bandwidth (≈10× cheaper than metered clouds for video); ~50–90 ms to MENA. |
| D4 | Client framework | **Flutter** (native), via LiveKit Flutter SDK | One codebase → Android/iOS now, desktop/web later. Native = real mobile reliability. |
| D5 | Account model for solo teachers | **Academy-of-one** | Reuses all RLS/billing/currency plumbing; upgrade is an entitlement flip, not a migration. |
| D6 | Pricing mechanism | **Existing add-on machinery**, one `add_ons` row per currency | Already "separately-priced capability unlock"; near-zero new billing code; respects no-FX rule. |
| D7 | Recording default | **On-demand (by choice)** + retention tiers | Controls the largest hidden costs (Egress CPU + storage). |
| D8 | Engine independence | **`MediaSession` abstraction** in the client | Avoids lock-in; enables mocking/testing and future second backend. |
| D9 | Integration style with Laravel | **Mirror the WhatsApp gateway pattern** | Proven in this codebase: stateless `final` HTTP clients, `config/services.php`, HMAC webhooks, encrypted per-tenant secrets. |
