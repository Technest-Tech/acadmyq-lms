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
3. **REC badge tension.** Monitor-triggered recording would normally trip the existing live "REC"
   badge (server-truth `useIsRecording`). **Default: keep it shown (disclosed).** Suppressing it =
   fully-covert recording — I will NOT build that variant without your explicit go-ahead and your
   confirmation of local (Egypt/MENA) law (§12-D2).

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
- **D2 — monitor → disclosed + audited + auth-required**, REC badge **kept shown (disclosed)**. The
  fully-covert variant is explicitly NOT built without a separate go-ahead + local-law check.
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
</content>
</invoke>
