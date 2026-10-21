# 04 — Flutter Client Architecture (Phase 3)

The native client for the live class: one Flutter codebase → Android + iOS now, desktop + web later.
This is the blueprint for [05-ROADMAP](05-ROADMAP.md) Phase 3. Read [00-OVERVIEW](00-OVERVIEW.md) and
[01-ARCHITECTURE](01-ARCHITECTURE.md) first.

The whole design serves three goals: **audio-first reliability on mobile** (`V-AUD-1`, `V-MOB-1/2`),
**engine independence** (`V-ARCH-1` — swap/mojk/extend LiveKit), and **clean growth** (add features,
platforms, white-label without rewrites).

---

## 1. Tech choices

| Concern | Choice | Why |
|---|---|---|
| Media SDK | **`livekit_client`** (official Flutter SDK) | Native hardware codecs/AEC, simulcast, adaptive stream — the mobile-survival features (`V-AUD-1`). Hidden behind our abstraction. |
| State mgmt | **Riverpod** | Compile-safe, testable, low ceremony; great for streams from `MediaSession`. (Bloc is the heavier alternative.) |
| Routing | **go_router** | Declarative, deep-link/guest-link friendly. |
| Models | **freezed + json_serializable** | Immutable value types, exhaustive `when`. |
| HTTP | **dio** | Interceptors for auth + token refresh. |
| Secure storage | **flutter_secure_storage** | Session tokens at rest. |
| i18n | **flutter intl / arb** | Arabic (RTL) + English, matching the web panel. |

---

## 2. Layered, feature-first structure

Dependencies point **one way only**: presentation → application → domain → data. Domain is pure Dart
(no Flutter, no LiveKit). Each feature is self-contained.

```
lib/
  core/
    design_system/          # tokens + theme + component kit (§5)
    media/
      media_session.dart    # the abstract contract (§3) — V-ARCH-1
      models/               # Participant, ConnectionQuality, MediaSessionState, RoomCredentials
      livekit/
        livekit_media_session.dart   # the ONLY file that imports package:livekit_client
    network/                # dio client, auth + token-refresh interceptors
    routing/                # go_router config (incl. /join/:token guest route)
    di/                     # Riverpod providers / composition root
    config/  i18n/  errors/
  features/
    auth/                   # teacher/owner/staff login (Sanctum) → session
    lobby/                  # device check, mic/cam preview, network pre-flight
    room/                   # the live call
      presentation/         # RoomScreen, widgets (built from design system)
      application/          # RoomController (Riverpod Notifier) — consumes MediaSession streams
      domain/               # room entities, use-cases
      data/                 # control-plane calls (fetch token, post participant events)
    join/                   # guest join via signed WhatsApp link (no login)
    recordings/             # (later) view own recordings
  app.dart  main.dart
```

**The rule that keeps it clean (`V-ARCH-1`):** `package:livekit_client` is imported in **exactly one
file** — `livekit_media_session.dart`. Everything else speaks `MediaSession`. Enforced by a test
(§7, `TC-V3.4`).

---

## 3. The `MediaSession` abstraction (the keystone)

A small, engine-agnostic contract. The UI and `RoomController` depend only on this.

```dart
/// Engine-agnostic live media session. The LiveKit SDK lives behind the only
/// implementation (LivekitMediaSession). No LiveKit type leaks through this API.
abstract interface class MediaSession {
  Future<void> connect(RoomCredentials creds);
  Future<void> disconnect();

  // Reactive state (Riverpod turns these into providers)
  Stream<MediaSessionState> get state;          // connecting | connected | reconnecting | disconnected | failed
  Stream<List<Participant>> get participants;
  Stream<Participant?>      get activeSpeaker;
  Stream<ConnectionQuality> get connectionQuality; // excellent | good | poor | lost

  // Local controls
  Future<void> setMicEnabled(bool enabled);
  Future<void> setCameraEnabled(bool enabled);
  Future<void> switchCamera();
  Future<void> startScreenShare();
  Future<void> stopScreenShare();

  bool get isMicEnabled;
  bool get isCameraEnabled;
}

class RoomCredentials {            // returned by the control plane (01-ARCH §3 / 03 §3)
  final String url;                // wss://media.host
  final String token;              // scoped LiveKit JWT
  final String identity;
  final String roomName;
}

class Participant {
  final String identity;
  final String? displayName;
  final bool isSpeaking;
  final bool audioEnabled;
  final bool videoEnabled;
  final ParticipantRole role;      // host | coHost | participant
  // videoTrack exposed via a render widget, not a raw LiveKit type
}

enum ConnectionQuality { excellent, good, poor, lost }
enum MediaSessionState { connecting, connected, reconnecting, disconnected, failed }
```

**Why this matters:** swap engines = one new adapter; test the entire call flow with a
`FakeMediaSession` (no server); LiveKit version churn stays in one file. This is the single most
important decision for the client's longevity.

---

## 4. Audio-first & resilience (inside the adapter)

All of this lives in `LivekitMediaSession`, configured so the rest of the app gets reliability for free.

- **Audio is protected (`V-AUD-1`):** enable adaptive stream + dynacast + simulcast; enable audio
  **RED** (redundancy); set video to degrade resolution → freeze → drop under bandwidth pressure, while
  audio is never downgraded first. Subscribe priority favours audio.
- **Reconnect across handover (`V-MOB-2`):** LiveKit auto-reconnects; the adapter maps that to
  `MediaSessionState.reconnecting`, and the UI shows a calm "reconnecting…" banner **while audio keeps
  trying** — no full rejoin, no lost room.
- **Token refresh:** a dio interceptor refreshes the scoped token from the control plane before expiry
  (long lessons), transparently to the user.
- **Restrictive networks:** nothing to do in the client — the server provides TURN/TCP-443
  (02-INFRASTRUCTURE); the SDK uses it automatically.

The `lobby` feature runs a **pre-flight** (mic/cam permission, device preview, a quick network probe)
so the user fixes problems *before* joining, not mid-class.

---

## 5. Design system (unique, modern, calm — and scalable)

"Unique modern UI that scales" = a **design system**, not one-off screens.

- **Tokens** via `ThemeExtension`: colors, typography scale, spacing, radii, elevation, motion —
  defined once. Brand aligns with the web panel (emerald primary, gold accent; **Tajawal** font for
  Arabic).
- **Component kit** built from tokens: `PrimaryButton`, `ControlBar`, `ParticipantTile`,
  `ConnectionIndicator`, `MicButton`, `Sheet`, `Toast`. Screens only compose components.
- **Theming from day one:** light/dark + **per-academy white-label** brand colors later (just token
  overrides — config, not code).
- **Motion:** micro-interactions + smooth transitions are what make it feel modern.
- **RTL/Arabic:** `Directionality` + logical insets; mirror the web panel's Arabic-default behaviour.

**Call-screen direction (the differentiator):** calm and **audio-first** — large active-speaker focus,
minimal chrome, an elegant control bar, a clear connection-quality indicator. Not Zoom's busy grid. For
a Qur'an academy, a respectful, uncluttered aesthetic is itself a selling point.

---

## 6. Talking to the control plane

| Flow | Endpoint | Auth |
|---|---|---|
| Host login | existing Sanctum login | cookie/session |
| Host fetch room token | `POST /api/video/rooms/{room}/token` | Sanctum + `can:room.join` + `entitled:video.conferencing` |
| **Guest (student) join** | `POST /video/guest/join` (public) | signed WhatsApp link → `VerifyGuestToken` |
| Report participant events | webhooks server-side (LiveKit → Laravel) | n/a (client doesn't write history directly) |

The client never holds secrets and never calls the LiveKit admin API (`V-SEC-1`). It only ever holds a
short-lived scoped access token.

---

## 7. Testing strategy

| Test | What it proves | Roadmap |
|---|---|---|
| `MediaSession` contract tests w/ `FakeMediaSession` | `RoomController` join/leave/mute/reconnect logic, no server needed | `TC-V3.1` |
| Design-system widget tests | components render in light/dark + RTL | `TC-V3.2` |
| Reconnect state-machine unit test | `connected → reconnecting → connected` keeps audio intent | `TC-V3.3` |
| **Import guard test** | greps `lib/` to assert `package:livekit_client` appears only in `livekit_media_session.dart` (`V-ARCH-1`, `AC-V3.6`) | `TC-V3.4` |

Plus `flutter analyze` with strict lints failing CI, and a final live verification on **two real devices
over a mobile network** against the Phase-0 server (`AC-V3.1–V3.5`, `V3.7`).

---

## 8. Multi-platform path (mobile now, desktop/web later)

- Today: build Android + iOS from this codebase.
- Later: add macOS/Windows/web build targets. Isolate the *few* platform differences (screen-share
  source picker, permission prompts, picture-in-picture) behind small interfaces with per-platform
  implementations — ~90% of the code is shared. The `MediaSession` abstraction already hides the media
  differences.

---

## 9. Phase-3 checklist (maps to AC-V3.*)

- [ ] App skeleton: layers + `core/`, `features/` as in §2.
- [ ] `MediaSession` + `LivekitMediaSession` (the only LiveKit import).
- [ ] Auth + token fetch; guest-join route.
- [ ] Lobby pre-flight (device + network).
- [ ] Room screen: audio-first call UI, mic/cam, screen share, leave; 1:1–1:3.
- [ ] Audio-first config + reconnect/handover handling.
- [ ] Design-system tokens + core components; Arabic/RTL; light/dark.
- [ ] Tests `TC-V3.1–4` green; `flutter analyze` clean; import guard passes.
- [ ] Live two-device verification on a mobile network against the Phase-0 server.
