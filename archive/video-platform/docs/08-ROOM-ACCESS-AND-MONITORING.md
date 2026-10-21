# 08 — Room Access, Settings & Supervisor (Monitor) Mode

**Goal:** redesign how people *enter* a video room. Today there is one shareable link
(`/r/{join_token}`) and the role is decided purely by whether the opener is a logged-in teacher.
This doc upgrades that to a real **access model**: role-separated links, short memorable slugs,
optional per-room passwords + a waiting room, and a **supervisor (monitor) mode** that lets academy
management silently observe and record a session for quality & safety — disclosed and audited.

Read [00-OVERVIEW](00-OVERVIEW.md) (the rules `V-*`), [03-DATA-MODEL](03-DATA-MODEL.md) (the tables +
RLS + SECURITY DEFINER pattern), and [06-WEB-CALL-CLIENT](06-WEB-CALL-CLIENT.md) (the link model +
`VideoJoinController` we extend) first. Everything here builds on the **existing**
`video_rooms` table, its `config` JSONB, the public `POST /api/video/join/{token}` endpoint, and the
`app.video_room_by_join_token()` SECURITY DEFINER reader.

> **Non-negotiable carried from the brief:** *every password is OPTIONAL per room.* A room may have no
> password, guest-only, host-only, or both. We never force a password.

---

## 1. What "done" feels like

- A room exposes **three** purpose-built links: a **guest** link (short, public, shareable), a
  **host** link (private to the teacher, full control, no login needed), and a **monitor** link
  (private to management, ghost mode, audited).
- The logged-in teacher path still works and is the **strongest** path: a teacher with `room.join`
  who opens *any* link becomes host by identity. The host link is the no-login convenience path.
- A room can carry **optional** settings — passwords, waiting room, recording gate, host-present
  gate, mute-on-join, guest-screenshare gate, max participants, monitor-enabled — all stored in the
  existing `config` JSONB and **enforced server-side** at `/join` and in the token grants.
- Management can drop into any monitor-enabled session **invisibly**, see + hear everything, and
  optionally record — with a **join-time disclosure** to all participants and a **server-side audit**
  of every monitor entry.

---

## 2. The access model — three links, one room

| Link | Role granted | Audience | Entropy | Rotatable | Login needed |
|---|---|---|---|---|---|
| **Guest** | `guest` — `roomJoin + publish + subscribe` only | public, shareable | short (slug) or legacy `join_token` | yes | no |
| **Host** | `host` — `roomAdmin`, full control | private, the teacher | high (≥32 chars) | yes | no (link *is* the secret) |
| **Monitor** | hidden supervisor — `subscribe` only, `hidden:true` | private, management | high (≥32 chars) | yes | **yes** (see §5) |

**How role is decided at `/join` (precedence, highest first):**

1. **Authenticated host** — `Auth::guard('sanctum')->user()` holds `room.join` in the room's academy
   → host (with `roomAdmin` iff `room.manage`). This overrides whatever link was used. *(Unchanged
   from today — the strongest path.)*
2. **Link role** — the matched secret decides: `host_token` → host, `monitor_token` → monitor (then
   the §5 auth/cap gate applies), `join_token`/slug → guest.
3. **Fallback** — the legacy random `join_token` keeps working as a guest link forever (no break).

This means the **link carries the role** (a bearer secret, exactly the Zoom model for host/guest),
while authentication can always *upgrade* a guest link to host for a real logged-in teacher.

> **Security:** host and monitor links are shared secrets — they MUST stay high-entropy
> (`Str::random(32)`) and rotatable. Only the **guest** link is allowed to be short/friendly, and a
> short guest link is only safe behind a password or the waiting room (§4). `V-SEC-1` still holds: the
> browser never sees a LiveKit admin secret, only the short-lived scoped access token minted at
> `/join`.

---

## 3. Short, memorable slugs

> ⚠️ **Superseded by §14 (S5, 2026-06-28).** Links are now **auto-generated** short links of the form
> `/r/{kebab-room-name}-{code}` stored in the token columns — there is no academy-chosen slug input.
> The `/r/{academy}/{room}` route + `app.video_room_by_slug()` remain only for back-compat.

A room may set an academy-chosen **slug** (e.g. `halaqa1`), so the guest link reads naturally instead
of `/r/9fA3...`. Slugs are **unique per academy**, kebab-case, min length 4, format
`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` (same shape as `academies.subdomain`), with a small reserved-word
blocklist. A slug is **guessable**, so a slugged room is only allowed if it has a **guest password OR
the waiting room is on** (enforced when the slug is set, and again at `/join`).

### Route shape (⚠️ open decision — §12-D1)

Slugs are unique *per academy*, not globally, so the route must namespace the academy. The academy
already has an optional unique `academies.subdomain` we can reuse as the namespace. Three candidates:

| Option | Example | Pros | Cons |
|---|---|---|---|
| **A — two-segment** | `/r/noor/halaqa1` | clean, robust, no delimiter ambiguity | needs the academy to have a `subdomain` set; new route `/r/[academy]/[room]` |
| **B — combined** | `/r/noor-halaqa1` | single segment, matches the brief example literally | hyphen ambiguity (room slug can't contain a hyphen, or split is fragile) |
| **C — global-unique** | `/r/halaqa1` | simplest routing; no academy namespace needed | drops the per-academy namespace; academies race for nice slugs |

**✅ DECIDED (2026-06-27): Option A** — two-segment, namespaced by `academies.subdomain`
(`/r/{academy}/{room}`), with the legacy `/r/{token}` route kept for the host/monitor/legacy tokens.
Host & monitor links stay on the unguessable `/r/{token}` form (never slugged). If an academy has no
`subdomain` set, slugs are unavailable until one is chosen (the long guest `join_token` link still
works) — surfaced in the modal.

---

## 4. Per-room settings (`video_rooms.config` JSONB — no table migration)

All settings live in the existing `config` JSONB. They are **enforced server-side** (never trusted
from the client) and surfaced in the room create/edit modal.

```jsonc
// video_rooms.config
{
  "guest_password":          null,    // OPTIONAL string; null = no guest password (DEFAULT)
  "host_password":           null,    // OPTIONAL string; null = no host-link password (DEFAULT)
  "waiting_room":            false,   // guests knock → host admits  (heaviest; built last)
  "recording_enabled":       true,    // gates the host record button for this room
  "require_host_present":    false,   // guests can't start before a host is in the room
  "mute_guests_on_join":     false,   // guests join with mic off (can unmute)
  "allow_guest_screenshare": true,    // false → guest token can't publish screen_share
  "max_participants":        null,    // OPTIONAL int; null = unlimited
  "monitor_enabled":         false    // whether supervisor mode is allowed for this room
}
```

**Defaults are chosen to preserve today's behaviour** (no passwords, recording allowed for managing
hosts, guests can screen-share, no caps) so existing rooms keep working unchanged.

### Enforcement matrix

| Setting | Where enforced | Behaviour |
|---|---|---|
| `guest_password` | `/join`, guest role | require `password` in body, compare with `hash_equals`; 422 on miss/mismatch. Hosts (auth or host link) bypass. |
| `host_password` | `/join`, host-link role | require `password`; **authenticated** host (identity-verified) bypasses — this only guards the no-login host *link*. |
| `waiting_room` | `/join`, guest role | mint nothing yet → return a "knock" state; host admits via a new control (built last, §8-S4). |
| `recording_enabled` | join response flag **+** `VideoRecordingController::start` | web hides record button when false; server returns 403 if start attempted. Defense in depth. |
| `require_host_present` | `/join`, guest role | LiveKit `ListParticipants` → if no participant with `metadata.role=host`, 409 "waiting for the teacher". |
| `mute_guests_on_join` | join response flag | guest call starts with mic disabled (client default); can unmute. |
| `allow_guest_screenshare` | guest token grant | when false, `canPublishSources: ['camera','microphone']` (excludes `screen_share`). |
| `max_participants` | `/join`, before mint | `ListParticipants` count (excluding hidden monitors) ≥ max → 409 "room is full". Best-effort (racy). |
| `monitor_enabled` | `/join`, monitor role | monitor link rejected with 403 if false, even with a valid `monitor_token`. |

> **Password storage:** room passwords are low-sensitivity **shared** secrets (the owner views and
> shares them, like a Zoom meeting password), not user-account credentials — so they're stored in
> `config` as-is (server-side, RLS-protected) and compared with `hash_equals` for constant-time. They
> are returned to the panel (room.manage only) so the owner can display/share them; they are **never**
> returned to a guest or in the public `/join` response.

The public `/join` controller has no tenant context, so it reads `config` through the SECURITY DEFINER
reader (§6.2) — never a raw cross-tenant read (`V-TEN-1`).

---

## 5. Supervisor / Monitor mode (the "ghost" link)

**Purpose:** academy management can silently enter any monitor-enabled session to see + hear
everything and record it — to catch a teacher going off-topic or poaching students. Invisible to the
teacher and the students.

**Mechanism:** LiveKit supports a **hidden participant** — token grant `hidden:true` +
`canSubscribe:true` + `canPublish:false`. It subscribes to all A/V but appears in **no** participant
list and **no** tile grid (the SFU does not announce hidden participants to others). Our
`LivekitTokenService.mint(identity, grant)` already takes an arbitrary grant, so this is a small
`monitorToken()` addition.

**Capability gate:** new `room.monitor` capability (`PermissionCatalog` PERMISSIONS + roleMap →
`ACADEMY_OWNER`, and into `$academyScoped` so custom management roles can compose it). Pure catalog +
seed data — `PermissionSeeder` already auto-syncs from the catalog, no resolver change.

### ⚠️ Responsible design (the model I'm building — flag before any change)

The monitor is invisible **in the call**, but the system is **not** covert:

1. **Disclosure at join.** When a room is `monitor_enabled`, every joiner sees a one-time notice:
   *"Sessions may be monitored & recorded by academy management for quality & safety."* This up-front
   consent is what keeps recording (often of **minors**, `V-SEC-2`) on the right side of the
   "this call may be recorded" model.
2. **Audit every entry.** Each monitor join writes `App\Support\Audit` (`video_room.monitor_join`)
   with **who** watched, **which** room, **when** — so a rogue admin can't abuse it silently. This is
   why monitor entry **requires authentication** (not a pure bearer link): we must record a real user
   identity. The monitor link is a convenience deep-link, but the joiner must be logged in **and** hold
   `room.monitor`; otherwise → login redirect / 403. *(This is the one place I deviate from "links need
   no login" — accountability requires it. Flagged in §12-D2.)*
3. **REC badge / covert mode.** Disclosure is a per-room toggle `monitor_disclose` (default `true`).
   With it **on**, the live "REC" badge (server-truth `useIsRecording`) stays visible. With it **off**
   (COVERT — explicitly authorised by the academy owner, who owns the legal call): the notice is hidden
   and the recording indicator is suppressed for participants (`suppressRecordingIndicator` →
   `RecIndicator suppress`). **Audit is unconditional in both modes** — the academy's safeguard against
   abuse. The join endpoint exposes `monitorDisclosure` + `suppressRecordingIndicator` accordingly.

The monitor does **not** write a `room_participants` (attendance) row — it's a ghost; its presence
lives only in the audit log. Server-side counts (`require_host_present`, `max_participants`) exclude
hidden monitors. Management can trigger server-side recording while hidden via the existing
`VideoRecordingController::start` (gate widened to `room.manage` OR `room.monitor`).

---

## 6. Backend design

### 6.1 Migrations

- **S1 (settings):** `CREATE OR REPLACE app.video_room_by_join_token(text)` to additionally return
  `config` (so the public controller can enforce settings without tenant context). No table change —
  settings live in the existing `config` JSONB.
- **S2 (links):** add columns `slug text`, `host_token text`, `monitor_token text`; partial unique
  indexes `unique (academy_id, lower(slug)) where slug is not null and deleted_at is null`,
  `unique (host_token)`, `unique (monitor_token)`. Backfill `host_token`/`monitor_token` for existing
  rows — **wrap the backfill in `alter table video_rooms no force row level security; … force;`** (the
  W1 gotcha: a backfill on a FORCE-RLS tenant table matches 0 rows as the migration owner). Then
  `CREATE OR REPLACE` a generalized reader `app.video_room_by_access_token(text)` returning
  `{room_id, academy_id, livekit_name, name, status, config, link_role}` where `link_role ∈
  {guest,host,monitor}` is decided by which token column matched. Add `app.video_room_by_slug(...)` for
  slug resolution (shape depends on §12-D1).

### 6.2 SECURITY DEFINER reader

Owned by the bypass role, `EXECUTE` granted to the app role (mirrors `app.public_invoice_by_token`
and the existing `app.video_room_by_join_token`). Returns JSON incl. `config` and `link_role`. Only
ACTIVE, non-deleted rooms resolve.

### 6.3 `LivekitTokenService` additions

```php
// host link (no-login): same as accessToken(..., canManage:true) but minted from the host_token path
// guest token: gains canPublishSources restriction + metadata role
public function guestToken($room, $identity, $name, bool $allowScreenshare = true): string;

// NEW — hidden supervisor
public function monitorToken(string $room, string $identity, ?string $name): string
{
    return $this->mint($identity, [
        'room' => $room, 'roomJoin' => true,
        'canSubscribe' => true, 'canPublish' => false, 'hidden' => true,
    ], $name ? ['name' => $name] : []);
}
```

Also add a top-level `metadata` claim `{"role":"host|guest"}` to host/guest tokens so
`require_host_present` and the participant UI can distinguish roles. (Monitors are hidden, so their
metadata is never delivered to others.)

### 6.4 `VideoJoinController` changes

- Resolve via `app.video_room_by_access_token()` → get `config` + `link_role`.
- Precedence per §2: auth-host → link-host → monitor → guest.
- Enforce the §4 matrix (passwords, host-present, max, screenshare grant, mute flag, monitor_enabled).
- Monitor branch: require auth + `room.monitor` → mint `monitorToken` with the **user's** identity →
  `Audit::log('video_room.monitor_join', …)`; **no** attendance row.
- Response gains: `recordingEnabled`, `muteOnJoin`, `monitorDisclosure` (true when `monitor_enabled`),
  and for monitors `role:'monitor'`.

### 6.5 `VideoRoomController` changes

- `store`/`update`: validate + persist the `config` settings block; generate `host_token` +
  `monitor_token` at creation; validate & set `slug` (uniqueness-per-academy + min length + the
  "slug requires password or waiting room" rule).
- Expose `slug`, `host_token`, `monitor_token` (and the `config` settings) on `index`/`show` — the
  passwords only to `room.manage`.
- Generalize rotate: `POST /video/rooms/{id}/rotate-link` takes `{ which: 'guest'|'host'|'monitor' }`
  (default guest, preserving today's behaviour). `monitor` rotation requires `room.monitor`.

---

## 7. Web design (`apps/web`)

> ⚠️ **The room-modal + panel design here are superseded by §14 (S5, 2026-06-28):** the modal is
> reduced to name + a 4-way password selector + waiting-list + allow-recording (plus the
> room.monitor-gated supervisor block), and the panel is revamped into cards + a togglable table with
> a copyable short-link preview and a professional recordings player.

- **Room modal** ([room-modal.tsx](apps/web/src/components/video-classroom/room-modal.tsx)) — a
  "Access & settings" section: slug field, optional guest/host password fields (clearly marked
  optional), toggles for the §4 booleans, max-participants, monitor-enabled. Plus three link rows
  (guest / host / monitor) each with copy + rotate; the monitor row only renders for `room.monitor`.
- **Lobby / join** — render the password prompt + the monitor disclosure notice + the waiting-room
  "knock" state. *(Coordinate: `lobby.tsx` is currently owned by the parallel device-picker session —
  I'll land password/disclosure UI in the call-entry flow to minimise collision, then reconcile.)*
- **api.ts** — `joinRoom` gains an optional `password`; add `rotateRoomLink(id, which)`,
  `roomHostUrl`/`roomMonitorUrl` helpers. *(Not in the parallel session's file set — safe.)*
- **i18n** — new `videoCall`/`videoClassroom` keys (en + ar parity, RTL) for passwords, waiting room,
  disclosure, monitor. *(Coordinate: `messages/{en,ar}.json` are touched by the parallel session.)*

---

## 8. Phasing (build + test each — `V-PROC-1`)

- **S1 — Settings + optional passwords** *(mostly backend; lowest collision)*: `config` schema +
  validation in `store`/`update`, the SECURITY DEFINER reader returns `config`, `/join` enforcement
  (guest/host password, recording gate, host-present, max, screenshare grant, mute flag) + modal
  settings UI. **Pest** for grants/enforcement; **Vitest** for modal logic.
- **S2 — Short slugs + guest/host link split** *(migration)*: slug + host_token + monitor_token
  columns, generalized reader + `link_role` precedence, slug route (§12-D1), panel link rows +
  generalized rotate. **Pest** for link→role mapping + slug uniqueness; **Vitest** for the link UI.
- **S3 — Supervisor / monitor mode**: `room.monitor` cap + seed, `monitorToken`, the auth+cap+audit
  monitor branch, disclosure notice, REC-badge decision, recording gate widened to `room.monitor`.
  **Pest** for hidden grant + cap gate + audit write; **puppeteer** to prove the monitor is invisible
  to a guest while still subscribing.
- **S4 — Waiting room** *(heaviest, last)*: knock state at `/join`, a host "admit/deny" control, and
  the data path (LiveKit data message or a short-poll). **Pest** + **puppeteer** for the admit flow.

Each phase: green Pest (backend grants/enforcement), green Vitest (non-media logic), puppeteer for
live flows, no new regressions (mind the known pre-existing failures recorded in the memory note).

---

## 9. Acceptance criteria

- **AC-8.1** — a room exposes three distinct links; guest = publish/subscribe, host = roomAdmin,
  monitor = hidden/subscribe-only. Auth host always wins regardless of link.
- **AC-8.2** — every password is optional; a room with no passwords behaves exactly as today; a guest
  password blocks a guest with no/incorrect password (422) and an authenticated host bypasses it.
- **AC-8.3** — a slug resolves to its room, is unique per academy, ≥ min length, and is rejected
  unless the room has a guest password or waiting room.
- **AC-8.4** — settings are enforced server-side: `recording_enabled=false` blocks start (403);
  `allow_guest_screenshare=false` yields a guest token without `screen_share`;
  `require_host_present`/`max_participants` reject with 409 as specified.
- **AC-8.5** — a monitor joins a monitor-enabled room **hidden** (a guest's `useParticipants` never
  lists it), entry **requires `room.monitor`** and writes an audit row; a non-`monitor_enabled` room
  rejects the monitor link.
- **AC-8.6** — the monitor disclosure shows for joiners of a monitor-enabled room; monitor-triggered
  recording shows the REC badge (default disclosed).
- **AC-8.7** — backend Pest green; web typecheck + Vitest green; RLS isolation preserved on all paths.

---

## 10. Security & legal

- `V-SEC-1` — secrets server-side; clients only get scoped short-lived tokens. Host/monitor link
  secrets are high-entropy + rotatable; only the guest slug is short, and only behind password/waiting.
- `V-SEC-2` — recordings may contain minors → the monitor flow is **disclosed + audited**, recording
  stays gated by `recording.view`, retention unchanged. Fully-covert (no-disclosure) recording is a
  separate variant that requires your explicit go-ahead + a local-law check (§12-D2).
- `V-TEN-1` — the context-free `/join` reads everything (room + config + link_role) through the
  SECURITY DEFINER reader; all writes (attendance, audit) go through `Tenancy::withContext`.
- `V-CTL-1` — the academy owns the room: every link, password, slug, and the monitor capability are
  controlled by the control plane, never a teacher-owned secret.

---

## 11. Decisions (✅ confirmed 2026-06-27)

- **D1 — slug route shape → Option A** (two-segment `/r/{academy}/{room}`, namespaced by
  `academies.subdomain`). Host/monitor stay on `/r/{token}`.
- **D2 — monitor → auth-required + ALWAYS audited.** Disclosure is a **per-room toggle**
  (`monitor_disclose`, default `true` = disclosed). **The academy owner explicitly authorised the
  COVERT variant (2026-06-27)** and accepted legal responsibility for using it lawfully in their
  jurisdiction. When `monitor_disclose=false`: no "may be monitored" notice **and** the live recording
  indicator is suppressed for participants — but **every monitor entry is still audited** (who/when/
  room), which is non-negotiable and the academy's protection against a rogue admin. The disclosed
  variant remains available by leaving the toggle on. *(In-call disclosure banner UI for the disclosed
  variant = follow-up; the `monitorDisclosure` flag is already delivered.)*
- **D3 — defaults → `recording_enabled=true`, `allow_guest_screenshare=true`** (preserve today's
  behaviour).
- **Collision policy** — build S1 backend-first; touch only files outside the parallel device-picker
  session's set (`VideoJoinController`, `VideoRoomController`, `LivekitTokenService`, the migration,
  Pest tests, `room-modal.tsx`, `api.ts`); defer `lobby.tsx` + `messages/{en,ar}.json` edits until
  that session lands, then reconcile.

---

## 12. Rules honored

`V-SEC-1`, `V-SEC-2`, `V-TEN-1`, `V-CTL-1`, `V-AUD-1` (audio-first unchanged), `V-PROC-1` (phase +
test). The web access client stays the browser sibling of the Flutter room screen; settings semantics
are shared.

---

## 13. S4 — The Waiting Room (knock → admit)

> The last access phase. The `waiting_room` config flag has shipped since S1 (default `false`,
> validated + persisted in [VideoRoomController](apps/api/app/Http/Controllers/Video/VideoRoomController.php))
> but the admit flow was never built. S4 makes it real: a guest **knocks** and **waits**; a host
> **admits or denies**; on admit the guest is minted their token and drops into the call.

### 13.1 The flow

```
GUEST                              SERVER                                   HOST (manager)
  │  POST /join  (waiting_room=true)  │                                          │
  │ ────────────────────────────────►│  create room_knocks row (PENDING)        │
  │ ◄──────────── { state:'knocking', │  + high-entropy knock_token              │
  │                 knockToken }       │  (NO LiveKit token minted)               │
  │                                   │                                          │
  │  POST /knock/{knockToken}  (poll) │       GET /manage/{manageToken}/knocks   │
  │ ────────────────────────────────►│◄──────────────────────────────────────  │  (poll, host-token authed)
  │ ◄──────────── { state:'knocking' }│  ──► { knocks:[{id,displayName,…}] }     │
  │            … repeat ~3s …          │                                          │
  │                                   │   POST /manage/{manageToken}/knocks/{id} │
  │                                   │◄────────────── { decision:'admit' }      │
  │                                   │  knock → ADMITTED, audit                  │
  │  POST /knock/{knockToken}  (poll) │                                          │
  │ ────────────────────────────────►│  mint guest token + write attendance     │
  │ ◄────── { state:'admitted', token,│                                          │
  │           url, … full join body } │                                          │
  │  ── join the call ──►             │                                          │
```

**Bypass for free:** in `performJoin` the precedence is monitor → auth-host → host-link → guest, and
the knock branch lives **inside the guest branch only**. So an **authenticated host, the no-login host
link, and the monitor link all skip the wait** with zero extra code — exactly the brief's requirement.

### 13.2 Data path — a dedicated `room_knocks` table (✅ decided 2026-06-27)

A new tenant-scoped, FORCE-RLS table (same conventions as the other three video tables). Reusing
`room_participants` was rejected: it fights the `role` check-constraint + `joined_at NOT NULL`, has no
per-knock secret, and pollutes attendance history with people who never joined — and it would need a
migration anyway.

```sql
create type video_knock_status as enum ('PENDING','ADMITTED','DENIED');

create table room_knocks (
  id            uuid primary key default uuid_generate_v7(),
  academy_id    uuid not null references academies(id),
  room_id       uuid not null references video_rooms(id) on delete cascade,
  knock_token   text not null unique,         -- the guest's bearer secret to poll status (no auth)
  identity      text not null,                -- pre-allocated guest identity, used at admit-mint
  display_name  text not null,                -- shown to the host in the queue
  status        video_knock_status not null default 'PENDING',
  decided_by    uuid references users(id),    -- the manager who admitted/denied (null for host-link)
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  updated_at    timestamptz not null default now()
);
-- + tenant_isolation policy (FORCE RLS), academy/room indexes, set_updated_at trigger.
```

**Expiry is lazy** (no job in v1): a `PENDING` knock older than **15 min** is treated as expired by
both the status reader and the host-list query (`created_at > now() - interval '15 minutes'`). A
periodic cleanup/sweeper is an optional follow-up.

### 13.3 Migrations (`2026_07_09_000001_video_room_waiting_room`)

1. `create type video_knock_status` + `create table room_knocks` + RLS (FORCE + `tenant_isolation`).
2. **`SECURITY DEFINER app.video_knock_status(p_token text) → json`** — the context-free guest poll
   reader (the poll route carries no tenant context). Returns
   `{ status, room_id, academy_id, livekit_name, name, config, identity, display_name }` for the
   matching knock whose room is ACTIVE/non-deleted; a `PENDING` row past the 15-min TTL is reported as
   `'EXPIRED'`. `null` if not found. Owned by the bypass role, `EXECUTE` to the app role (mirrors the
   existing readers).
3. **`CREATE OR REPLACE app.video_room_by_access_token(text)`** to additionally return `host_token` in
   its JSON. This is the room's **management credential** (see §13.5) and is needed so an
   *authenticated* host who opened a **guest** link still receives a `manageToken`. It is read
   server-side only — `performJoin` decides what to expose (never returned raw to a client). (Re-create
   needs `set role <bypass>` since that role owns the SECURITY DEFINER fn — `academiq_app` is a member.)

The host management endpoints need **no** new reader: they resolve the room through
`app.video_room_by_access_token(manageToken)` and require `link_role = 'host'`.

### 13.4 `/join` — the knock branch

In the guest branch of `performJoin`, **after** the optional guest-password check and **before**
presence/capacity/mint:

```php
// Guest, waiting_room=true → knock instead of mint. Auth-host / host-link / monitor never reach here.
if ((bool) ($config['waiting_room'] ?? false)) {
    $identity = 'guest-'.Str::lower(Str::random(16));
    $knockToken = VideoJoinToken::generateSecret();           // 40-char bearer secret
    // write the PENDING knock inside the room's tenant context (same discipline as recordParticipant)
    $this->recordKnock($academyId, $roomId, $knockToken, $identity, $displayName);
    return response()->json([
        'state'      => 'knocking',
        'knockToken' => $knockToken,
        'roomId'     => $roomId,
        'roomTitle'  => (string) $room['name'],
    ]);
}
```

The guest-password gate stays **above** the knock (you must know the password, if any, to knock at
all). No SFU calls at knock time; `require_host_present` / `max_participants` are re-checked at
**admit-mint** (the right moment).

### 13.5 Host management — unified `manageToken` (= the room's `host_token`)

**Decision (✅ 2026-06-27): the no-login host link can admit too.** Rather than split into a
session-`room.manage` path and a host-token path, knock management is authenticated by a single
**`manageToken` — the room's `host_token`** — which is only ever handed to a verified host/manager:

- The **no-login host link** holder already has it (it *is* the `/r/{host_token}` URL).
- The **`/join` response now returns `manageToken`** on every host-role join (host-link branch: the URL
  token; auth-host branch: read from the widened reader). So an in-call owner who joined via cookie —
  on *any* link — also gets it.
- The **panel** already exposes `host_token` to `room.manage` holders (S2), so a manager can run the
  queue from outside a call too.

This satisfies both intents: the host *link* works no-login, **and** a logged-in manager works (they
receive the same `manageToken`). It also keeps the queue a host-only power — `host_token` is a strict
*subset* of the roomAdmin authority the host link already grants in-call, so no new privilege surface.

Two new public, throttled (`throttle:60,1`) routes — resolve the room via
`app.video_room_by_access_token(manageToken)`, require `link_role='host'` (else 403), then CRUD the
knocks inside `Tenancy::withContext` (academy from the reader):

| Route | Body | Returns | Notes |
|---|---|---|---|
| `GET  /api/video/manage/{manageToken}/knocks` | — | `{ knocks: [{ id, displayName, createdAt }] }` | PENDING + fresh (≤15 min) only |
| `POST /api/video/manage/{manageToken}/knocks/{knockId}` | `{ decision: 'admit'\|'deny' }` | `{ ok, status }` | `Audit::log('video_room.knock_admit'\|'…knock_deny')`; idempotent (a non-PENDING knock returns its current status) |

> **Note (cap nuance):** the existing moderation gate is `room.manage`, which **owners hold but plain
> teachers don't** (teacher = read/join/view). Using the `host_token` as the queue credential sidesteps
> that cleanly — anyone holding the room's host link/credential can admit, which is the desired host
> power, independent of the per-user RBAC cap.

### 13.6 Guest poll

`POST /api/video/knock/{knockToken}` (public, `throttle:60,1`) → `app.video_knock_status()`:

| Reader status | Response | Side effect |
|---|---|---|
| not found | `404` | — |
| `PENDING` | `{ state: 'knocking' }` | — |
| `DENIED` | `{ state: 'denied' }` | — |
| `EXPIRED` | `{ state: 'expired' }` | — |
| `ADMITTED` | the **full join body** (`url, token, roomName, roomTitle, roomId, identity, displayName, role:'guest', canManage:false, manageToken:null, recordingEnabled, muteOnJoin, monitorDisclosure, suppressRecordingIndicator`) + `state:'admitted'` | mint guest token (stored identity + `allow_guest_screenshare`), write attendance via `Tenancy::withContext` |

Minting on the poll (not at admit time) keeps the host action cheap and means the token only ever lives
in the admitted guest's own response. Re-polling after admit re-mints harmlessly (attendance is deduped
by `(room, identity)`). **The host's explicit admit is the gate** — `require_host_present` /
`max_participants` are *not* re-checked at admit-mint (re-running host-present would contradict an admit
the host just made); the manager decides who comes in.

### 13.7 Two riders that land with S4

- **Slug protection broadened** — [resolveSlug](apps/api/app/Http/Controllers/Video/VideoRoomController.php)
  changes from "needs `guest_password`" to "needs `guest_password` **OR** `waiting_room`" (a waiting
  room makes a guessable slug safe — every entrant is gated by a human admit). New code
  `slug_needs_password_or_waiting`.
- **Modal toggle** — the `waiting_room` switch is added to the room modal's access section (deferred in
  S1 because it did nothing). With it on, the guest-password requirement for a slug relaxes.

### 13.8 Web (`apps/web`) — collision-safe

Per the live-coordination check, all S4 web code is **new files** mounted in **`call-experience.tsx`
(this session's file)** — never `call-room.tsx` / `participants-panel.tsx` / `lobby.tsx` (the parallel
in-call session's). `messages/{en,ar}.json` edited surgically.

- **`waiting-screen.tsx`** (new) — the guest "knocking" view (branded, RTL, calm: "You're in the
  waiting room — the host will let you in shortly", a quiet spinner + cancel). Polls
  `pollKnock(knockToken)` ~every 3s; on `admitted` it hands the full creds up to `CallExperience` →
  in-call; on `denied`/`expired` a friendly terminal screen.
- **`knock-control.tsx`** (new) — the host queue. Rendered **only when the join response carried a
  `manageToken`** (i.e. the joiner is a host). Polls `listKnocks(manageToken)` ~every 4s; shows each
  pending knocker with **Admit** / **Deny**; empty = renders nothing (no chrome). Pure REST — needs no
  LiveKit context, so it mounts safely beside the in-call surface.
- **`call-experience.tsx`** (mine) — handle `state:'knocking'` from `joinRoom`/`joinRoomBySlug` →
  render `WaitingScreen` instead of the lobby/in-call; mount `<KnockControl>` in the in-call branch
  when `manageToken` is present.
- **`api.ts`** (mine) — `joinRoom`/`joinRoomBySlug` return type gains `state?`, `knockToken?`,
  `manageToken?`; add `pollKnock(knockToken)`, `listKnocks(manageToken)`,
  `decideKnock(manageToken, knockId, 'admit'|'deny')`.
- **`room-modal.tsx`** (mine) — the `waiting_room` toggle.
- **i18n** — new `videoCall` keys: `waitingTitle`, `waitingSubtitle`, `waitingCancel`, `knockDenied`,
  `knockExpired`, `waitingQueueTitle`, `admit`, `deny`, `someoneWaiting` (en + ar parity, RTL).

> **Delivery = short-poll in v1** (both sides). A LiveKit data-channel push (knock → instant host
> notification, no poll) is a documented **optimisation** for later — the poll is simple, robust, and
> needs no in-call data wiring.

### 13.9 Phasing within S4 (build + test each)

- **S4.1 — backend**: migration (`room_knocks` + `video_knock_status` reader + widened access-token
  reader), `/join` knock branch, guest poll, host manage endpoints, slug broadening, routes. **Pest**.
- **S4.2 — web**: `api.ts` + `waiting-screen.tsx` + `knock-control.tsx` + `call-experience.tsx` wiring
  + modal toggle + i18n. **Vitest** for the waiting screen + knock control (mocked fetch).
- **S4.3 — live**: **puppeteer** knock → host admit → guest joins; deny path; auth-host/host-link
  bypass smoke. Restore the shared test room's config to `{}` afterward.

### 13.10 Acceptance criteria

- **AC-8.8** — a guest joining a `waiting_room=true` room gets `state:'knocking'` + a `knockToken` and
  **no** LiveKit token; a `room_knocks` PENDING row is written.
- **AC-8.9** — the guest poll returns `knocking` while PENDING, `admitted` (with a real token +
  attendance row) after a host admit, and `denied` after a host deny.
- **AC-8.10** — an authenticated host, the host link, and the monitor link all **bypass** the wait
  (token minted directly).
- **AC-8.11** — host management is authenticated by the `manageToken` (host_token); a guest/monitor
  token is rejected (403); admit/deny are audited.
- **AC-8.12** — a slug is allowed when the room has a guest password **or** the waiting room is on; the
  modal exposes the `waiting_room` toggle.
- **AC-8.13** — backend Pest green; web typecheck + Vitest green; RLS isolation preserved (the
  context-free knock paths read via SECURITY DEFINER, write via `Tenancy::withContext`).

### 13.11 Gotchas to respect (carried from S1–S3)

- The migration adds **no** column to a populated FORCE-RLS table (only a fresh table), so the
  no-force backfill trick isn't needed here — but the `CREATE OR REPLACE` of the bypass-owned reader
  still needs `set role <bypass>`.
- Postgres `jsonb` via the query builder returns a **string** — decode `config` in the controller.
- Each SFU test gets its **own explicit** `Http::fake()` (no global catch-all in `beforeEach`).
- Pest file-scoped helpers are **global** — use a unique seed-helper name (e.g. `seedWaitingRoom`).
- Tests needing an academy subdomain use one other than `noor` (DemoAcademySeeder uses it).


---

## 14. S5 — Simplified creation, auto short links & panel revamp (✅ 2026-06-28)

This section **supersedes** the academy-chosen-slug parts of §2/§3 and the bloated-form parts of §7.
The access *grants* (host/guest/monitor roles, passwords, waiting room, monitor mode) are unchanged —
only **how links are minted** and **what the create form surfaces** change.

### 14.1 Auto short links (replaces the academy-chosen slug, §3)

- Every room link is now an **auto-generated short link** of the form `/r/{kebab-room-name}-{code}`,
  where `code` is **≤ 7 lowercase alphanumeric** characters (e.g. `/r/halaqa-live-k3p9x`). The room
  name is kebab-cased and truncated; a non-ASCII-only name falls back to `room-{code}`.
- The short link is stored **in the existing token columns** — `join_token` (guest), `host_token`
  (host), `monitor_token` (monitor) — so the existing `/r/{token}` route and the
  `app.video_room_by_access_token()` reader resolve it with **no new lookup**. The legacy
  `app.video_room_by_slug()` / `/r/{academy}/{room}` route stays for back-compat but new rooms no
  longer set an academy `slug`.
- `VideoJoinToken::forRoom($name)` builds the link; `store()` and `rotate()` use it. The
  `/video/join/{token}` route regex now allows the `-` separator (`[A-Za-z0-9][A-Za-z0-9-]*`).
- The 24-char `join_token` and the 40-char host/monitor secrets are **gone from the UI** — a backfill
  migration regenerates short links for any pre-existing rooms so the long token never surfaces.
- **Entropy trade-off (accepted):** the host/monitor links drop from ≥128-bit secrets to a ≤7-char
  code. This is the brief's explicit call (short, human-readable links); the **optional host
  password** is the additional guard for the no-login host link, and links remain rotatable.

### 14.2 The create/edit form — exactly the essentials (replaces §7 modal)

The modal is reduced to four controls (plus the management-only supervisor block):

1. **Room name.**
2. **Password** — one selector: `None` · `Teacher only` · `Student only` · `Both`, mapping to
   `host_password` (teacher) + `guest_password` (student). A password input appears only for the
   selected side(s). **Every password stays OPTIONAL** — blank ⇒ no password.
3. **Guest waiting list** — the `waiting_room` toggle.
4. **Allow recording** — the `recording_enabled` toggle.
5. *(room.monitor only)* the existing **Supervisor mode** subsection (`monitor_enabled` /
   `monitor_disclose`), kept so S3 is not orphaned.

**Removed from the form + API contract:** `record_default` (recording is **on-demand only** — a host
starts it from the call; the column/field is dropped), the academy `slug` input (links are
auto-generated), and `max_participants`. `require_host_present` and `allow_guest_screenshare` are no
longer surfaced — they keep their server defaults (`false` / `true`). Because `update()` merges only
the keys the form sends over the stored `config`, dropping a control never clobbers an existing
room's value.

**Guest screen-share** is therefore allowed by default for both hosts and guests (the `guestToken`
grant already includes `screen_share` when `allow_guest_screenshare` is true, which is the default).

### 14.3 Panel revamp (Part C / D)

- **Rooms** render as polished cards **and** a togglable client-side table (search by name, filter by
  status / has-password / has-recording, sortable columns). Each surface shows a **short-link preview
  with one-click copy**, status + password/waiting-list/recording chips, and Join / Copy / Edit /
  Archive actions. Loading skeletons, an empty state, and a prominent Create CTA.
- **Recordings** open in a professional **player modal** (large `<video>` with play/pause, seek,
  volume, fullscreen, playback-speed, plus metadata + Download + Copy-link), reachable from a modern
  recordings table (thumbnail/placeholder, duration, date, size, status, Play). The presigned
  `video_recordings` playback URL plumbing is unchanged.

---

## 15. S6 — Per-room access log page (✅ 2026-06-28)

Each room gets a **dedicated page** (`/video-classroom/rooms/{id}`) that answers *who accessed this
room, when, and for how long* — plus every administrative action on the room, all timestamped. Built
on data that already exists; **no new tables**.

### 15.1 Data sources

- **Access sessions** = `room_participants` rows (the join/leave history written at `/join`). Each row
  → `{ identity, display_name, user_id, user_name, role, joined_at, left_at, duration_s, ongoing }`.
  `duration_s` is `left_at − joined_at` (null while `left_at` is null → *ongoing*).
- **Activity** = `audit_log` rows where `entity_type = 'video_room'` and `entity_id = {id}`
  (`video_room.create|update|delete|rotate_link|knock_admit|knock_deny|monitor_join`), joined to
  `users` for the actor name. Ordered newest-first.
- **Stats** = derived: total sessions, unique participants (by identity), total watch-time, last access.

### 15.2 Endpoint

`GET /api/video/rooms/{id}/logs` — inside the `entitled:video.conferencing` group, gated `room.read`,
RLS-scoped (the room must resolve in the caller's academy or 404). Returns `{ room, sessions, events,
stats }`. **`video_room.monitor_join` events are stripped unless the caller holds `room.monitor`** —
the same privacy gate that hides `monitor_token` (a covert supervision entry must not leak to a plain
manager via the activity feed). Sessions + events are capped (most-recent N) with a `truncated` flag.

### 15.3 Web

A premium screen: a header (back to rooms, name, status, created), a row of **stat cards**, an
**Access sessions** table (participant avatar/initial + name, role chip, joined / left date-times,
duration, an *Ongoing* pill for live rows), and an **Activity timeline** (per-action icon + dot rail,
actor + role, human-readable line, timestamp). Reached from a **Logs** action on every room card/row.
Bilingual + RTL; loading skeletons + empty states.
