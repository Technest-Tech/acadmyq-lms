# 06 — Web Call Client & Shareable Room Links (PRIORITY)

**Goal:** let teachers AND students join a live video class **from any browser** — desktop and
**mobile web** — via a **shareable per-room link**, with a **premium, modern, unique, fully
responsive** UI on par with the big platforms (Zoom / Google Meet) but unmistakably AcademIQ.

This elevates the web from management-only (Phase 2) to a **first-class call surface**. It is a
**high-priority** workstream (user request, 2026-06-27): "the web version is very important; each
room should have a link both student and teacher can join; design must be very modern, professional,
premium, unique, and work great on mobile browsers."

Read [00-OVERVIEW](00-OVERVIEW.md), [01-ARCHITECTURE](01-ARCHITECTURE.md), and
[03-DATA-MODEL](03-DATA-MODEL.md) first. The backend already mints scoped tokens
(`POST /api/video/rooms/{id}/token`, verified working) — this builds the **link model** + the
**browser call UI** on top.

---

## 1. Requirements (what "done" feels like)
- Join a live call **from the browser** (desktop + mobile web), no app install.
- Each room has a **shareable link** that **both teacher and student** use to join (Zoom-style).
- **Premium, unique, modern** design; **excellent on mobile browsers**; fully responsive; RTL/Arabic.
- Honor the rules: secrets server-side (`V-SEC-1`), audio-first (`V-AUD-1`), RLS (`V-TEN-1`),
  academy-owns-the-room (`V-CTL-1`), the brand design system.

---

## 2. The join-by-link model (the heart of it)

Each room gets a stable, unguessable **`join_token`** → a shareable link **`/r/{join_token}`** (like a
Zoom personal-room link). Opening it lands on a **pre-join lobby**, then the call. **One link, two
joiner types:**

- **Authenticated host** (teacher/owner with `room.join` in that academy) → joins with their identity
  and role grants (`roomAdmin` if they hold `room.manage`).
- **Guest** (student/parent — NOT a `users` row) → enters a display name → joins with **publish +
  subscribe only**, never admin/record. This realises the guest-join concept (`V-ACC-2`) as a
  copy-paste link, complementing the WhatsApp-delivered signed link in [03-DATA-MODEL §3](03-DATA-MODEL.md).

### Backend additions (`apps/api`)
1. **Migration** — add `video_rooms.join_token text unique` (unguessable, generated at room creation;
   backfill existing rows in the migration). Generate at creation in `VideoRoomController::store`.
2. **SECURITY DEFINER lookup** — a public request carries no tenant context, so RLS hides the room.
   Add `app.video_room_by_join_token(text)` (owned by the bypass role, granted EXECUTE to the app role
   — mirror `app.public_invoice_by_token` / the custom-roles migration pattern) returning
   `{room_id, academy_id, livekit_name, name, status}` for an ACTIVE room, else nothing.
3. **Public join endpoint** — `POST /api/video/join/{token}` (NOT Sanctum, throttled like `/i/{token}`),
   body `{ display_name? }`:
   - Resolve room + academy via the SECURITY DEFINER function; 404 if missing/archived.
   - If `Auth::check()` AND the user has `room.join` in that academy → **host** grants (`roomAdmin` if
     `room.manage`); else → **guest** grants (publish+subscribe only).
   - Mint with `LivekitTokenService`; write a `room_participants` row inside `Tenancy::withContext`.
   - Return `{ url, token, roomName, identity, displayName, role }`.
4. **Expose `join_token`** on the management API (room list/detail) so the panel can render a
   **"Copy link / Share"** action. The token is a shareable secret by design (anyone with the link can
   join — exactly the Zoom model). Add a per-room **rotate-link** action (regenerate `join_token`).

> Tests (Pest, `tests/Feature/Video/`): host-vs-guest grant mapping, RLS isolation via `join_token`,
> archived room rejected, rate-limit, idempotent participant rows.

---

## 3. The web call client (`apps/web`)

### Routes & files
- `src/app/r/[token]/page.tsx` — the **public join page**: full-screen, NO academy-panel chrome.
  Renders the **PreJoin lobby** → the **CallRoom**.
- `src/components/video-call/` — `pre-join.tsx`, `call-room.tsx`, `participant-tile.tsx`,
  `control-bar.tsx`, `connection-indicator.tsx`, `share-link.tsx`, etc.
- In the existing `video-classroom` panel (Phase 2 screen), add a **"Copy link / Share"** action and a
  **"Join"** button on each room card (host path).

### Tech
- **`livekit-client`** (web SDK) for media. Use **`@livekit/components-react` hooks**
  (`useTracks`, `useParticipants`, `useConnectionState`, `useRoomContext`, `useLocalParticipant`) for
  plumbing — but **render CUSTOM tiles/controls** for the unique premium look. **Do NOT ship the stock
  LiveKit `<VideoConference />`** — it's recognisable and not "unique". Custom UI on top of the hooks is
  the sweet spot (fast plumbing, bespoke design).

### Pre-join lobby (premium)
Live mirrored camera preview, mic level meter, device pickers (camera/mic), mic/cam toggles, a
display-name field (guests), the room name, and a prominent **Join** button. Permission + secure-context
check (§5) with graceful messaging when camera/mic is blocked.

### In-call UI (premium, responsive)
- **Layouts**: 1:1 → large remote + a draggable self-PiP; small group → adaptive grid; screen-share →
  presenter (shared screen large, people as a filmstrip). Subtle active-speaker emphasis.
- **Control bar**: mic · camera · screen-share (desktop) · **leave** (red) · participants · more. Bottom
  bar on mobile, large touch targets, safe-area insets.
- **Polish**: dark calm aesthetic, rounded tiles, speaking ring, mute/name badges, smooth join/leave
  transitions, a connection-quality pill, a calm "reconnecting…" banner (`V-MOB-2`), brand emerald
  accent. (Background blur, raise-hand, chat = later.)
- **Audio-first** (`V-AUD-1`): adaptiveStream + dynacast on subscribe; prioritise audio; degrade video
  first.
- **RTL/Arabic** + a `videoCall` i18n namespace (en + ar).

### Responsiveness / mobile web
`100dvh` layout, safe-area insets, orientation handling, touch targets ≥44px, no hover-only affordances,
a user-gesture to start audio (mobile autoplay), screen wake-lock during a call, PiP where supported.

---

## 4. Phasing (build + test each — rule V-PROC-1)
- **W1 — Backend link**: `join_token` migration + SECURITY DEFINER lookup + public `POST /video/join/{token}`
  + expose token on the panel API + rotate action. Pest green.
- **W2 — Web call core**: `livekit-client` connect + a basic functional call (tiles + controls) on
  `/r/[token]`, wired to the local stack. **Verify a real 1:1 call between two browser tabs.**
- **W3 — Premium UI**: full lobby + layouts + control bar + polish + responsive + RTL. Vitest for the
  non-media logic (token fetch, lobby state machine, share-link copy, layout selection).
- **W4 — Mobile web**: real-device testing (mind §5), tuning, the share/copy UX.

---

## 5. ⚠️ Critical gotchas (read BEFORE building — they will bite otherwise)
- **Secure context for camera/mic**: `getUserMedia` requires **HTTPS or `localhost`**. A phone hitting
  the dev server over the LAN IP (`http://192.168.x.x:3000`) will **block camera/mic**. For real
  mobile-browser testing you need **HTTPS** — a tunnel (ngrok/cloudflared) or Next.js with a local cert.
  Two desktop tabs on `localhost` work without this — start there.
- **Mixed content**: an HTTPS page cannot open a `ws://` SFU. So once the page is HTTPS (for mobile
  camera), the SFU must be `wss://` too. Plan the mobile test path with TLS on both (tunnel, or the
  Hetzner box from [02-INFRASTRUCTURE](02-INFRASTRUCTURE.md) Part B). Laptop-tab testing uses
  `ws://localhost:7880` from an `http://localhost:3000` page — fine.
- **Token grants**: guests get publish+subscribe ONLY — never `roomAdmin`/record. Short-lived; refresh
  before expiry.
- **Local stack must be up**: `cd infra/video/local && docker compose up -d` (macOS Docker PATH gotcha:
  prefix with `PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"`).

---

## 6. Acceptance criteria
- **AC-W1** — a room exposes a copy-pasteable link; opening `/r/{token}` lands on the pre-join lobby.
- **AC-W2** — an authenticated teacher AND a named guest both join the same room via the link, from two
  browsers, and see/hear each other (local stack).
- **AC-W3** — guest tokens are publish/subscribe only; a `room.manage` host gets `roomAdmin`.
- **AC-W4** — the call UI is premium + fully responsive (great at a phone-sized viewport), RTL-correct,
  audio-first.
- **AC-W5** — backend Pest green (host/guest grants, RLS via `join_token`, rate-limit); web typecheck +
  Vitest green; no new regressions (mind the known pre-existing failures).

---

## 7. Honor these
`V-SEC-1` (secrets server-side, scoped short-lived tokens), `V-AUD-1` (audio-first), `V-TEN-1` (RLS — the
`join_token` lookup goes through a SECURITY DEFINER function, never a raw cross-tenant read), `V-CTL-1`
(academy owns the room), the design system + Arabic/RTL. The web call client is the **browser sibling of
the Flutter room screen** (`apps/mobile`) — keep behaviour and audio-first semantics consistent.
