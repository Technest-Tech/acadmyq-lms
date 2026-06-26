# 05 — Implementation Roadmap (phased, test-gated)

The build order. **One phase at a time** (rule [V-PROC-1](00-OVERVIEW.md#rules)). A phase is "done"
only when its acceptance criteria (`AC-V*`) pass with green automated tests (`TC-V*`) **and** a short
manual verification. Do not start the next phase early — that is how details get dropped.

Read [00-OVERVIEW](00-OVERVIEW.md) and [01-ARCHITECTURE](01-ARCHITECTURE.md) first.

---

## How to work a phase

1. If the phase has a deep-dive doc marked "⏳ Next" in the [README](README.md), **write that doc first**.
2. Implement only what is in the phase's scope.
3. Write tests alongside (Pest for `apps/api`, Vitest for `apps/web`, Flutter test for the app).
4. Run the phase's exit gate (tests + manual verification). Record the result.
5. Only then move on. Update the README status table and the todo list.

**Testing baselines:**
- `apps/api`: `php artisan test` (Pest on a real PostgreSQL `academiq_test` DB as the non-superuser
  `academiq_app` role, so RLS is genuinely exercised). New tests under `apps/api/tests/Feature/Video/`.
- `apps/web`: `npm run test` (Vitest) + `npm run typecheck`.
- Flutter: `flutter test` + `flutter analyze` (strict lints).

---

## Phase map

| Phase | Title | Goal | Deep-dive doc |
|---|---|---|---|
| **0** | Infra spike & proof | Prove a 1:1 call works on a real network on one Hetzner box | [02-INFRASTRUCTURE](02-INFRASTRUCTURE.md) |
| **1** | Backend foundation | Rooms, tokens, gating, webhooks in Laravel | [03-DATA-MODEL](03-DATA-MODEL.md) |
| **2** | Web panel integration | Manage rooms + recordings in the Next.js panel | — |
| **3** | Flutter client core | The audio-first 1:1–1:3 call app | [04-FLUTTER-CLIENT](04-FLUTTER-CLIENT.md) |
| **4** | Recording by choice | On-demand Egress → storage → filed under student | — |
| **5** | Accounts & solo teachers | Academy-of-one, video-only entitlement, onboarding, per-room billing | — |
| **6** | Hardening & scale | Stage-1 topology, observability, TURN/TCP-443, load test | — |
| **7** | Extras | Broadcast (1:many), whiteboard, chat, desktop | — |

Phases 0–4 are **v1**. Ship and stabilise v1 before 5–7. (Phase 5 can begin in parallel with 4 if capacity allows, but v1 launch needs 0–4.)

---

## Phase 0 — Infrastructure spike & proof of reliability

**Goal:** before writing any product code, prove the media stack works for our real use case on real
conditions. De-risks the entire project for the price of one server.

**Scope**
- Provision **one Hetzner CCX23** (Stage 0). Install Docker.
- Run LiveKit SFU + **built-in TURN** + Egress via official Docker images + config generator.
- TLS via Caddy/Let's Encrypt; open required UDP/TCP ports incl. **TCP/443** for TURN.
- A throwaway minimal Flutter spike (or LiveKit example app) that joins a room with a hand-minted token.
- Object storage bucket (Backblaze B2/Wasabi) wired for a test recording.

**Acceptance criteria**
- `AC-V0.1` Two devices join a 1:1 room and see/hear each other.
- `AC-V0.2` A 1:3 room works (4 participants).
- `AC-V0.3` Audio survives a forced WiFi→cellular handover (walk test) via reconnect (V-MOB-2).
- `AC-V0.4` A call connects from a UDP-blocked network via TURN/TCP-443 (V-MOB-2).
- `AC-V0.5` Under throttled bandwidth, video degrades but audio stays clean (V-AUD-1).
- `AC-V0.6` One on-demand recording lands in object storage and plays back.

**Exit gate (manual verification)**
- A short written report capturing each AC result on **real low-end Android + a mobile network**
  (V-MOB-1/2), including measured latency to the Hetzner box from MENA. No automated tests this phase.

> Output of this phase also produces the first draft of [02-INFRASTRUCTURE](02-INFRASTRUCTURE.md) with
> the exact commands, ports, and config used.

---

## Phase 1 — Backend foundation (Laravel control plane)

> **Status: ✅ Implemented & tested (2026-06-26).** 10 Pest tests green in
> `apps/api/tests/Feature/Video/` covering AC-V1.1–1.7 + participant history + the retention purge
> job. Zero regressions (the 34 other failing suites pre-date this work — showcase-seed count drift,
> verified via a stashed baseline). Pint clean. Guest-join (`V-ACC-2`) is scaffolded in the token
> service but its public route is deferred to pair with the WhatsApp reminder + Flutter join (Phase 4).

**Prereq:** write [03-DATA-MODEL](03-DATA-MODEL.md) first.

**Scope**
- `config/services.php` `livekit` block + `.env.example` entries.
- `app/Services/Livekit/`: `LivekitTokenService`, `LivekitRoomClient`, `LivekitEgressClient` (stateless
  `final`, structured `['ok'=>…]` returns, never throw — mirror `app/Services/Whatsapp/`).
- Migrations: `video_rooms`, `room_participants`, `room_recordings` (RLS, FORCE RLS, `tenant_isolation`).
- RBAC: add `room.read/create/join/manage`, `recording.view` to `PermissionCatalog` + `roleMap()`;
  seed in `PermissionSeeder`.
- Entitlement: add `video.conferencing` to `FeatureCatalog`; seed per-currency `add_ons` rows; add to
  PRO plan capabilities for the bundled case.
- API: `VideoRoomController` (CRUD + `token`), `VideoRecordingController` (start/stop/index), routes
  with stacked `entitled:video.conferencing` + `can:room.*` gates.
- Webhook: `POST /internal/livekit/webhook` + `VerifyLivekitWebhook` middleware; handlers for
  `egress_ended`, `room_finished`, `participant_joined/left`, writing via `Tenancy::withContext`.
- Jobs (`routes/console.php`): recording-retention purge, stale-room/egress sweep.

**Acceptance criteria**
- `AC-V1.1` A room can be created, listed, fetched, updated, deleted — all tenant-scoped.
- `AC-V1.2` `POST /video/rooms/{room}/token` returns a valid LiveKit JWT whose grants match the caller's
  capabilities (student → join+publish+subscribe; `room.manage` → roomAdmin; never recording).
- `AC-V1.3` Without `video.conferencing` entitlement, every video route returns **402**.
- `AC-V1.4` Without the relevant `room.*` capability, the route returns **403**.
- `AC-V1.5` A user from academy B cannot read/token a room owned by academy A (RLS — zero rows).
- `AC-V1.6` A signed LiveKit webhook is accepted; an unsigned/tampered one is rejected; the handler
  never 500s and is idempotent on duplicate delivery.
- `AC-V1.7` `egress_ended` webhook finalises a `room_recordings` row linked to the room (+ session/student when present).

**Test cases (Pest, `apps/api/tests/Feature/Video/`)**
- `TC-V1.1` Room CRUD happy path + tenant scoping.
- `TC-V1.2` Token grant mapping per role (table-driven).
- `TC-V1.3` Entitlement gate → 402 when add-on/plan lacks `video.conferencing`.
- `TC-V1.4` Capability gate → 403 per missing `room.*`.
- `TC-V1.5` Cross-tenant isolation (academy A vs B) under RLS.
- `TC-V1.6` Webhook signature valid/invalid/replayed; idempotency on duplicate `egress_id`.
- `TC-V1.7` Retention purge job deletes expired recordings only, per tenant.

**Exit gate:** all `TC-V1.*` green via `php artisan test`; `pint` clean.

---

## Phase 2 — Web panel integration (Next.js)

> **Status: ✅ Implemented & tested (2026-06-26).** `/video-classroom` route + screen (rooms card
> grid, create/edit/archive modal, recordings list), nav entry with the `video.conferencing`
> upgrade badge, `videoClassroom` i18n (en + ar/RTL), and typed API helpers. 3 Vitest tests green;
> `npm run typecheck` clean; zero new regressions (the 12 failing web tests pre-date this work —
> see [[sprint9-preexisting-test-failures]]). The live call is the Flutter client (Phase 3), so this
> surface is management-only; per-room billing detail follows in Phase 5.

**Scope** (mirror `apps/web/src/app/invoices/`)
- `app/video-classroom/page.tsx` + `screen.tsx` (gated by `can('room.read')`).
- Nav entry in `app-shell.tsx` + `NAV_CAPABILITY['videoClassroom'] = 'video.conferencing'` (upgrade badge).
- Components: room list (`DataTable`), create/edit room modal, recordings library, video-billing widget.
- i18n: `videoClassroom` namespace in `messages/ar.json` + `en.json`; RTL-correct.

**Acceptance criteria**
- `AC-V2.1` An owner sees the Video Classroom section; rooms list/create/edit/delete work against the API.
- `AC-V2.2` Recordings library lists recordings with playback/download (signed URLs) gated by `recording.view`.
- `AC-V2.3` When the academy lacks the video entitlement, the nav item shows the **UPGRADE** badge and routes to `/plan`; API 402s are handled.
- `AC-V2.4` All strings render correctly in Arabic/RTL and English/LTR.

**Test cases (Vitest)** `TC-V2.1` room-list rendering + fetch; `TC-V2.2` create-room modal submit;
`TC-V2.3` locked-state/upgrade-badge logic; `TC-V2.4` recordings library access gating.

**Exit gate:** `npm run test` + `npm run typecheck` green; manual click-through in both locales.

---

## Phase 3 — Flutter client core (the call)

**Prereq:** write [04-FLUTTER-CLIENT](04-FLUTTER-CLIENT.md) first.

**Scope**
- New Flutter repo/app: layered, feature-first; `MediaSession` abstraction + `LivekitMediaSession` adapter (V-ARCH-1).
- Auth against the control plane; fetch room token; connect to SFU.
- **Lobby**: device check, mic/cam preview, network test before joining.
- **Room screen**: audio-first call UI (active speaker focus, control bar, connection-quality indicator),
  mic/cam toggle, screen share, leave. 1:1–1:3.
- Audio-first runtime config (V-AUD-1); auto-reconnect across handover (V-MOB-2).
- Design system foundation (tokens + core components); Arabic/RTL; light/dark.

**Acceptance criteria**
- `AC-V3.1` A teacher and student join the same room from two phones; bidirectional audio/video.
- `AC-V3.2` 1:3 works smoothly on mid-range Android.
- `AC-V3.3` Screen share works (teacher → students).
- `AC-V3.4` On network loss/handover the call auto-recovers without a full rejoin (V-MOB-2).
- `AC-V3.5` Under throttling, audio stays clean while video degrades (V-AUD-1).
- `AC-V3.6` No LiveKit type is imported outside `LivekitMediaSession` (enforced by a lint/grep check) (V-ARCH-1).
- `AC-V3.7` UI is correct in Arabic/RTL.

**Test cases (Flutter)** `TC-V3.1` `MediaSession` contract tests against a mock adapter (call flow w/o
a server); `TC-V3.2` design-system widget tests; `TC-V3.3` reconnect state-machine unit test;
`TC-V3.4` grep/lint guard that no `livekit_client` import exists outside the adapter file.

**Exit gate:** `flutter test` + `flutter analyze` green; live verification on **two real devices over a
mobile network** against the Phase-0 server.

---

## Phase 4 — Recording by choice (end-to-end)

**Scope**
- Teacher toggles recording in-call → control-plane `POST /video/rooms/{room}/recording` → `LivekitEgressClient` starts Egress to object storage.
- `egress_ended` webhook → finalise `room_recordings`, link to room/session/student.
- Recordings library (web) playback via signed URLs; retention tier enforced by the purge job (V-REC-2).
- Consent state captured on the recording (V-SEC-2).

**Acceptance criteria**
- `AC-V4.1` Recording starts/stops on demand; file appears under the student in the web library.
- `AC-V4.2` Recording is never forced; default is off unless the room's `record_default` is set (V-REC-1).
- `AC-V4.3` Expired recordings are purged by the job per tenant retention; access requires `recording.view`.
- `AC-V4.4` Consent state is recorded and surfaced (V-SEC-2).

**Test cases** `TC-V4.1` start/stop orchestration + `egress_ended` finalisation; `TC-V4.2` retention
purge boundary; `TC-V4.3` signed-URL access gating; `TC-V4.4` recording-by-choice default off.

**Exit gate:** `TC-V4.*` green; manual record→store→playback verified end-to-end.

---

## Phase 5 — Accounts & solo teachers

**Scope**
- **Academy-of-one** provisioning (V-ACC-1): onboarding that creates a minimal academy + single
  teacher/owner for a solo seller, hiding the tenancy from the user.
- Video-only entitlement path: grant the `video.conferencing` add-on to an otherwise-minimal academy.
- **Per-room billing**: metering rooms (solo = 1, academy = N) and reflecting it in the add-on/subscription total.
- Upgrade path: solo → full platform by granting more capabilities (no migration).

**Acceptance criteria**
- `AC-V5.1` A solo teacher signs up and reaches "their room" without seeing academy concepts.
- `AC-V5.2` A video-only academy has video access but no management modules surfaced.
- `AC-V5.3` Room count maps to billing; adding a room updates the subscription total (same-currency rule).
- `AC-V5.4` Upgrading a video-only account to full platform is an entitlement change, not a data migration.

**Test cases** `TC-V5.1` academy-of-one provisioning; `TC-V5.2` video-only surfacing; `TC-V5.3`
per-room billing recompute; `TC-V5.4` upgrade flips capabilities only.

**Exit gate:** `TC-V5.*` green; manual solo-onboarding walkthrough.

---

## Phase 6 — Hardening & scale

**Scope**
- Move to **Stage-1 topology**: separate SFU / coturn / Egress nodes; ≥2 SFU for redundancy; managed Redis.
- Dedicated coturn with TCP/443 + TLS at scale.
- **Observability**: LiveKit Prometheus metrics → Grafana; per-call quality webhooks into AcademIQ so
  support can *see* packet loss; alerts (node down, CPU, bandwidth, loss).
- Load test to target concurrent lessons; document the capacity per node.
- Backups, runbooks, on-call procedure.

**Acceptance criteria**
- `AC-V6.1` A single SFU node failure does not drop all calls; clients reconnect.
- `AC-V6.2` Per-call quality metrics are queryable for support.
- `AC-V6.3` Documented, reproducible capacity numbers from a load test.
- `AC-V6.4` Alerts fire on node down / high loss / bandwidth ceiling.

**Exit gate:** load-test report + runbook in [02-INFRASTRUCTURE](02-INFRASTRUCTURE.md); chaos check
(kill a node mid-call) passes.

---

## Phase 7 — Extras (post-v1)

Only after v1 (0–4) is boringly stable.
- **1:many broadcast/lecture mode** (one publisher, many subscribers) — far cheaper than conferencing.
- **Whiteboard** (Excalidraw/tldraw) synced over LiveKit data channels.
- **In-call chat** over data channels.
- **Desktop build** (Flutter macOS/Windows) + web client — new build targets, platform code isolated
  behind interfaces.
- **White-label** room branding per academy (theme tokens).

Each becomes its own scoped sub-phase with its own AC/TC when picked up.

---

## Definition of Done (every phase)

- [ ] Scope implemented; nothing outside scope.
- [ ] Acceptance criteria met.
- [ ] Automated tests written and green (Pest / Vitest / Flutter as applicable).
- [ ] Linters/formatters clean (`pint`, `flutter analyze`, `typecheck`).
- [ ] Rules ([V-*](00-OVERVIEW.md#rules)) upheld; deviations documented in the decision log.
- [ ] Manual verification performed and recorded (especially real-device/network for media phases).
- [ ] README status table + todo list updated.
