# 01 — Architecture & Integration Blueprint

How the video platform is structured and exactly how it plugs into the existing AcademIQ codebase
(`apps/api` Laravel 11 + PostgreSQL/RLS, `apps/web` Next.js 15, and a new Flutter client). Read
[00-OVERVIEW](00-OVERVIEW.md) first.

---

## 1. System context

```
            ┌──────────────────────────┐        ┌──────────────────────────┐
            │  Flutter app (the call)  │        │  Next.js panel (apps/web)│
            │  Android · iOS · later   │        │  rooms · recordings ·    │
            │  desktop/web             │        │  video billing surface   │
            └───────────┬──────────────┘        └─────────────┬────────────┘
                        │  (1) REST: login, get room token,                 │
                        │      start/stop recording                         │
                        ▼                                                   ▼
            ┌───────────────────────────────────────────────────────────────────┐
            │                 CONTROL PLANE  —  Laravel API (apps/api)           │
            │  • Sanctum auth + TenantContext (RLS GUCs)                         │
            │  • RBAC (can:room.*)  +  Entitlement (entitled:video.conferencing) │
            │  • Mints scoped LiveKit JWT access tokens   (holds ALL secrets)    │
            │  • Room CRUD, recording orchestration, webhook ingestion          │
            └───────┬───────────────────────────────────────────┬───────────────┘
                    │ (2) admin API: create/delete room,         │ (4) webhooks: room_finished,
                    │     start/stop egress  (admin secret)      │     participant_*, egress_ended
                    ▼                                            ▲     (HMAC-verified, /internal/...)
            ┌─────────────────────────────────────────────────────────────────┐
            │       MEDIA PLANE  —  separate Hetzner server(s)                 │
            │  ┌────────────┐   ┌──────────────┐   ┌───────────────────────┐   │
            │  │ LiveKit SFU│   │ coturn (TURN)│   │ LiveKit Egress (record)│  │
            │  └─────┬──────┘   └──────────────┘   └───────────┬───────────┘   │
            └────────│──────────────────────────────────────── │ ──────────────┘
                     │ (3) WebRTC media (app ⇆ SFU, TURN fallback)              │ (5) upload
                     ▼                                                          ▼
            ┌──────────────────────────┐                  ┌──────────────────────────┐
            │ Flutter app  (media)     │                  │ S3-compatible storage    │
            └──────────────────────────┘                  │ (Backblaze B2 / Wasabi)  │
                                                          └──────────────────────────┘
```

**The cardinal rule (V-SEC-1):** the client never talks to the LiveKit admin API and never holds a
secret. It calls the control plane (1), receives a short-lived scoped token, and uses it to connect to
the SFU (3). All privileged operations (2) and all recording orchestration happen server-side.

---

## 2. Component responsibilities

| Component | Runs where | Responsibility |
|---|---|---|
| **Flutter client** | User devices | The live call UI; connects to the SFU with a scoped token; audio-first UX; lobby/device checks. Accesses media only via `MediaSession` (V-ARCH-1). |
| **Next.js panel** | Existing web app | Management surfaces: room list, create/manage rooms, recordings library, video billing. Reuses `app-shell`, `DataTable`, `apiFetch`, `useAuth().can()`. |
| **Control plane (Laravel)** | Existing `apps/api` | Auth, tenancy, RBAC + entitlement gating, room CRUD, **token minting**, recording orchestration, webhook ingestion. Single holder of secrets. |
| **LiveKit SFU** | Separate Hetzner box | Relays WebRTC media. Simulcast/adaptive bitrate for mobile resilience. |
| **coturn (TURN)** | Separate Hetzner box (or co-located at Stage 0) | Relays media for restrictive NAT/firewall; **TCP/443 + TLS** required (V-MOB-2). |
| **LiveKit Egress** | Separate process/box | On-demand recording → composite → upload to storage. |
| **Object storage** | Backblaze B2 / Wasabi | Stores recordings. Cheap replay egress. Retention enforced by job (V-REC-2). |

Server topology, sizing, and ops are specified in [02-INFRASTRUCTURE.md](02-INFRASTRUCTURE.md).

---

## 3. The trust & token flow (the heart of the design)

This mirrors the existing two-surface WhatsApp integration: a **global admin surface** (like
`GatewayAdminClient` with its `X-Gateway-Admin` secret) for room/egress lifecycle, and a **per-request
scoped credential** (like the per-academy bearer token) — here, a minted LiveKit JWT.

```
Student/teacher opens a class in the Flutter app
  │
  ├─(1) POST /api/video/rooms/{room}/token        [auth:sanctum, tenant.context,
  │                                                 can:room.join, entitled:video.conferencing]
  │        Laravel:
  │          • resolves AuthContext (user, academy, role, permissions) — already done by middleware
  │          • verifies the room belongs to app.current_academy_id() (RLS guarantees this)
  │          • maps the caller's capabilities → LiveKit grants:
  │                room.join            → roomJoin, room=<room.livekit_name>
  │                (publisher allowed)  → canPublish, canSubscribe
  │                room.manage          → roomAdmin
  │                recording.* (server) → NOT given to clients; recording is server-triggered only
  │          • signs a short-lived JWT (TTL minutes) with LIVEKIT_API_KEY/SECRET
  │        ← returns { url: wss://media.host, token: <jwt>, room, identity }
  │
  └─(3) Flutter connects to wss://media.host with that token → joins the SFU room.
        TURN/TCP-443 used automatically when UDP is blocked.
```

Key properties:
- The token encodes **exactly** what the caller may do, derived from RBAC. A student gets join +
  publish/subscribe; only a `room.manage` holder gets `roomAdmin`. Clients never get recording rights.
- Tokens are **short-lived**; the app refreshes via the same endpoint if a session runs long.
- The control plane can mint a token only for a room the tenant owns, because the room lookup runs
  under the request's RLS context (`academy_id = app.current_academy_id()`).

> **Students join differently — they are not `users`.** The flow above is for authenticated hosts
> (teacher/owner/staff) with `can:room.join`. A student has no login, so they join via a **stateless
> signed guest link delivered over WhatsApp**, validated by a public route + `VerifyGuestToken`
> middleware that mints a join+publish-only token. Full design in
> [03-DATA-MODEL §3](03-DATA-MODEL.md#3-guest-join-for-students-design-decision) (rule `V-ACC-2`).

---

## 4. Laravel integration — mirror the WhatsApp gateway pattern

The WhatsApp gateway (`apps/api/app/Services/Whatsapp/`) is the proven template. We copy it verbatim
in spirit.

### 4.1 Config (`apps/api/config/services.php`)
Add a `livekit` block alongside the existing `wasender` / `whatsapp_gateway` blocks. Config reads env;
code reads `config('services.livekit.*')` (never `env()` outside config files).

```php
'livekit' => [
    'host'        => env('LIVEKIT_HOST'),         // wss://media.example.com (client connect URL)
    'api_url'     => env('LIVEKIT_API_URL'),       // https://media.example.com (server admin API)
    'api_key'     => env('LIVEKIT_API_KEY'),
    'api_secret'  => env('LIVEKIT_API_SECRET'),    // signs access tokens — NEVER leaves the server
    'webhook_secret' => env('LIVEKIT_WEBHOOK_SECRET'),
    'timeout'     => (int) env('LIVEKIT_TIMEOUT', 15),
    'token_ttl'   => (int) env('LIVEKIT_TOKEN_TTL', 14400), // seconds (4h — must outlive a full lesson; a mid-call reconnect re-auths with this token)
],
```
New env names documented (empty) in `apps/api/.env.example`. Per-tenant secrets, if any, are stored
**encrypted** in the DB via `Crypt` like `WhatsAppSender` does — never returned to clients.

### 4.2 Service classes (`apps/api/app/Services/Livekit/`)
Stateless `final` classes, auto-resolved by the container (no explicit binding), injected via
controller constructors. Every method is `try/catch (Throwable)` and returns a structured
`['ok' => bool, ...]` shape — **never throws** on a provider hiccup; secrets/stack traces never logged.

| Class | Mirrors | Responsibility |
|---|---|---|
| `LivekitTokenService` | (new) | Pure token minting — build grants from capabilities, sign JWT with `api_secret`. No HTTP. |
| `LivekitRoomClient` | `GatewayAdminClient` | Room lifecycle on the LiveKit server API (create/list/delete room, list participants, remove participant) using the admin key. `->baseUrl(config('services.livekit.api_url'))->timeout(...)`. |
| `LivekitEgressClient` | `GatewayAdminClient` | Start/stop recording (Egress) for a room; configure output to object storage. |

> Use the official LiveKit **PHP server SDK** for token signing and admin calls where it exists;
> otherwise the `Http` facade against the LiveKit REST API, following the exact `GatewayAdminClient`
> style. Decision finalised at the start of Phase 1.

### 4.3 Routes (`apps/api/routes/api.php`)
Add under the authenticated group, stacking both gates (RBAC 403 + entitlement 402):

```php
Route::middleware(['auth:sanctum', 'tenant.context'])->group(function () {
    Route::middleware('entitled:video.conferencing')->group(function () {
        Route::get   ('/video/rooms',                 [VideoRoomController::class, 'index'])->middleware('can:room.read');
        Route::post  ('/video/rooms',                 [VideoRoomController::class, 'store'])->middleware('can:room.create');
        Route::get   ('/video/rooms/{room}',          [VideoRoomController::class, 'show'])->middleware('can:room.read');
        Route::patch ('/video/rooms/{room}',          [VideoRoomController::class, 'update'])->middleware('can:room.manage');
        Route::delete('/video/rooms/{room}',          [VideoRoomController::class, 'destroy'])->middleware('can:room.manage');
        Route::post  ('/video/rooms/{room}/token',    [VideoRoomController::class, 'token'])->middleware('can:room.join');
        Route::post  ('/video/rooms/{room}/recording',[VideoRecordingController::class, 'start'])->middleware('can:room.manage');
        Route::delete('/video/rooms/{room}/recording',[VideoRecordingController::class, 'stop'])->middleware('can:room.manage');
        Route::get   ('/video/recordings',            [VideoRecordingController::class, 'index'])->middleware('can:recording.view');
    });
});
```
Controllers are `final class … extends Controller`, return `JsonResponse`, validate with
`$request->validate([...])`, and open each method with `Gate::authorize('room.…')` as defense-in-depth
(the route middleware already gates, matching the existing convention).

### 4.4 Webhooks (LiveKit → Laravel)
LiveKit emits events (`room_finished`, `participant_joined/left`, `egress_started/ended`). Ingest them
exactly like `/internal/wa/webhook`:

- Public route `POST /internal/livekit/webhook` (NOT Sanctum), declared before the authed group.
- A new middleware `VerifyLivekitWebhook` modeled on
  `apps/api/app/Http/Middleware/VerifyWhatsAppWebhook.php`: LiveKit signs webhooks; verify the
  signature/JWT against `LIVEKIT_WEBHOOK_SECRET` (constant-time), with timestamp replay defense.
- The handler resolves the academy from the room metadata and writes **inside**
  `App\Support\Tenancy::withContext($ctx, …)` (no Sanctum user present), and **never 500s** the
  webhook sender — it logs and acks 200 to prevent retries. (Same discipline as the WA webhook.)

Webhook effects:
- `egress_ended` → finalise the `room_recordings` row (status, file URL, duration), link to room/session/student.
- `room_finished` → close the room session, stamp ended-at, optionally stop any active egress.
- `participant_joined/left` → update `room_participants` (attendance/history — the "history" value prop).

### 4.5 Scheduled jobs (`apps/api/routes/console.php`)
Add jobs following the existing per-academy `Tenancy::withContext` + idempotent pattern:
- **Recording retention purge** (V-REC-2): delete storage objects + rows past the tenant's retention window.
- **Stale room/egress sweep**: stop orphaned egress, close rooms with no participants.

---

## 5. RBAC integration (capabilities)

The RBAC system is data-driven via `app.role_capabilities()` and a single `Gate::before`
(`apps/api/app/Providers/AuthServiceProvider.php`). Adding capabilities is **data + catalog**, no
resolver/Gate changes.

1. Add to `apps/api/app/Support/PermissionCatalog.php` `PERMISSIONS` and `roleMap()`:
   - `room.read` — see the room list / a room.
   - `room.create` — create a room.
   - `room.join` — join a class (teachers + students/participants).
   - `room.manage` — edit/delete a room, control recording, admin in-call.
   - `recording.view` — view/download recordings.
2. Seed rows into `permissions` + `role_permissions` (extend `PermissionSeeder.php`).
3. Map to roles: ACADEMY_OWNER gets all; TEACHER gets `room.read/create/join/manage` (own rooms) +
   `recording.view`; a participant/student identity gets `room.join`.
4. **Custom roles get these automatically** — the academy role-builder composes from the same
   `permissions` catalog. No extra work.

**Capability → LiveKit grant mapping** is implemented in `LivekitTokenService` (see §3).

---

## 6. Entitlement integration (plan gating)

The entitlement system (`apps/api/app/Support/Entitlement.php`, `FeatureCatalog.php`,
`EnsureEntitled` middleware) is also data-driven.

1. Add `video.conferencing` to `apps/api/app/Support/FeatureCatalog.php` `CAPABILITIES`.
2. **Bundled:** add `video.conferencing` to the PRO plan's `plans.features.capabilities` (seeders /
   Super-Admin Plan editor).
3. **Standalone:** seed `add_ons` rows (one per currency) with `feature_key = 'video.conferencing'`;
   grant via `Admin/AcademyController::grantAddOn` → auto-recompute via `AcademyBilling::recomputeTotals()`.
4. Gate routes with `entitled:video.conferencing` (returns **402** `{error:'upgrade_required', …}`).
5. UI: `GET /api/entitlements` already returns capabilities; the sidebar shows the upgrade badge for
   the video nav item when the plan lacks it (see §8).

No changes to the resolver or middleware — purely catalog data + one capability key + the `entitled:`
annotation.

---

## 7. Data model (summary — full detail in 03-DATA-MODEL)

New tables, all following the house conventions (uuid v7 PK, `timestamptz`, `academy_id` + FORCE RLS
`tenant_isolation` policy — rule V-TEN-1):

| Table | Purpose | Key columns (summary) |
|---|---|---|
| `video_rooms` | A persistent classroom owned by an academy/teacher | `academy_id`, `teacher_id`, `livekit_name` (unique), `status`, `record_default`, `session_id?`, `config jsonb` |
| `room_participants` | Join/leave history per room session (the "history" value prop) | `academy_id`, `room_id`, `identity`, `user_id?`, `student_id?`, `joined_at`, `left_at`, `role` |
| `room_recordings` | One recording produced by Egress | `academy_id`, `room_id`, `session_id?`, `student_id?`, `egress_id`, `status`, `storage_url`, `duration_s`, `bytes`, `expires_at`, `consent` |

Plus catalog/seed rows: the `video.conferencing` capability, the `room.*`/`recording.view`
permissions, and the per-currency `add_ons` rows. Migrations live in
`apps/api/database/migrations/` and seed updates in the existing seeders. Exact DDL in
[03-DATA-MODEL.md](03-DATA-MODEL.md).

---

## 8. Frontend integration (Next.js panel)

Mirror the **invoices** feature as the reference (`apps/web/src/app/invoices/` +
`apps/web/src/components/invoices/`).

- **Route:** `apps/web/src/app/video-classroom/page.tsx` (wraps `AuthProvider` + `AppShell`) +
  `screen.tsx` (client component with `useAuth().can('room.read')` gate).
- **Nav:** add an entry to the `NAV` array in `apps/web/src/components/app-shell.tsx`
  (`key:'videoClassroom'`, `icon: Video`, `permission:'room.read'`, `group:'management'`) and map it in
  `NAV_CAPABILITY` to `video.conferencing` so the **upgrade badge** shows when the plan lacks video.
- **Components** (`apps/web/src/components/video-classroom/`): room list (`DataTable`), create/edit
  room modal, recordings library, video-billing widget — built from existing `ui/` primitives
  (`Button`, `Card`, `Modal`, `DataTable`, `Alert`) and OKLch emerald theme.
- **i18n/RTL:** add a `videoClassroom` namespace to `apps/web/messages/ar.json` + `en.json`; use
  logical properties and `rtl:` variants (the panel is Arabic-default, RTL).
- **Data:** all calls via `apiFetch`; handle `ApiError` 402 (→ `/plan`) and 403.

The **live call** itself is the Flutter app; the web panel may host a web-call view later (Flutter web
or a thin LiveKit JS view) but that is out of v1 scope.

---

## 9. Flutter client (summary — full detail in 04-FLUTTER-CLIENT)

- **One codebase**, all platforms (LiveKit Flutter SDK). Mobile now; desktop/web later.
- **Layered, feature-first** architecture; dependencies point one way (presentation → application →
  domain → data).
- **`MediaSession` abstraction** (V-ARCH-1): the LiveKit SDK lives behind one adapter
  (`LivekitMediaSession`); UI/logic never import LiveKit types. Enables swap/mock/test.
- **Audio-first** runtime config (V-AUD-1): simulcast/adaptive, audio redundancy, video degrades first.
- **Design system**: tokens + component kit (calm, audio-first call UI), Arabic/RTL, light/dark,
  future white-label.
- Talks to the control plane for tokens; connects to the SFU; auto-reconnect across handover (V-MOB-2).

---

## 10. Failure modes & resilience

| Failure | Mitigation |
|---|---|
| Bad/variable mobile bandwidth | Audio-first degradation (V-AUD-1); LiveKit simulcast + adaptive bitrate + audio RED. |
| WiFi↔cellular handover | Client auto-reconnect / ICE-restart (V-MOB-2); short token TTL with silent refresh. |
| Carrier blocks UDP | coturn **TCP/443 + TLS** fallback (V-MOB-2). |
| Media node failure | ≥2 SFU nodes at Stage 1+; client reconnect; health checks (see 02-INFRASTRUCTURE). |
| LiveKit/control-plane split-brain on recording | Egress state reconciled via `egress_ended` webhook + the stale-egress sweep job. |
| Webhook sender retries / duplicates | Idempotent handlers keyed by `egress_id`/event id; never 500 the webhook. |
| Cross-tenant data leak | RLS on every table (V-TEN-1); token minted only for tenant-owned rooms; secrets server-side (V-SEC-1). |

---

## 11. Security considerations

- **Secrets** (`LIVEKIT_API_SECRET`, webhook secret) only in server config; per-tenant secrets encrypted
  in DB via `Crypt`; never returned to clients (V-SEC-1).
- **Token scoping**: grants derived strictly from RBAC; short TTL; clients never get recording/admin rights.
- **Webhook auth**: HMAC/JWT verification + replay defense (`VerifyLivekitWebhook`).
- **Minors in recordings** (V-SEC-2): `consent` state on `room_recordings`; access gated by
  `recording.view`; explicit retention; storage in a private bucket with signed URLs only.
- **Tenant isolation**: RLS guarantees a room/recording is only ever visible within its academy.
