# AcademIQ Teacher — Desktop App (Electron)

A **teacher-only** desktop client that wraps the existing web call UI (`apps/web`) and will add
screen-share annotations that **bake into the shared screen pixels** (Zoom-style). Students keep
using the browser. See the design in [docs/video-platform/10-DESKTOP-CLIENT.md](../../docs/video-platform/10-DESKTOP-CLIENT.md)
(added in a later phase) and the plan it implements.

> **Status: Phases 1–6 built.** Shell, capture gate (✅ macOS — confirm on Windows), native picker,
> the **real annotation feature** (web draw → bake into the shared screen), web control-bar
> Annotate/Clear toggle, and `academiq://room/<token>` deep-linking. Remaining follow-ups:
> code-signing + macOS dmg/notarize + auto-update, the teacher's own interactive-overlay drawing,
> and a colour/width toolbar. See [docs/video-platform/10-DESKTOP-CLIENT.md](../../docs/video-platform/10-DESKTOP-CLIENT.md).

## Architecture (1 line)

Main window = the real web call UI loaded by URL → preload exposes `window.academiqDesktop` →
later phases add a transparent always-on-top overlay over the shared display + a native source
picker. The overlay holds **no** LiveKit connection; marks arrive over IPC from the web client.

## Run it (dev)

The desktop app loads the **web client**, so run the web dev server first:

```bash
# terminal 1 — the web call UI
pnpm --filter web dev            # Next.js on http://localhost:3000

# terminal 2 — the desktop shell (loads http://localhost:3000)
pnpm --filter @academiq/desktop dev
```

Point it at a different web origin with `ACADEMIQ_WEB_URL` (e.g. a deployed/staging URL):

```bash
ACADEMIQ_WEB_URL=https://staging.example.com pnpm --filter @academiq/desktop dev
```

## Build

```bash
pnpm --filter @academiq/desktop build      # compile main + preload → out/
pnpm --filter @academiq/desktop typecheck  # tsc --noEmit
pnpm --filter @academiq/desktop pack:win   # unpacked Windows app (no installer)  → dist/
pnpm --filter @academiq/desktop dist:win   # NSIS installer (UNSIGNED for now)    → dist/
```

> Windows installers cross-built from macOS/Linux need `wine`; the real Windows build runs on a
> Windows machine or CI. Code-signing + macOS builds land in Phase 6.

## Annotation end-to-end test (the headline feature)

A participant draws on the shared screen and the mark bakes into the stream. Needs **two
participants** in the same room: the **desktop app** (teacher/host, sharing) and a **browser** (the
"student") — a second machine or device/tab works.

1. Start the web client + desktop app (see *Run it*), join the same room from both.
2. In the desktop app, click **✏️ Annotate** in the control bar (host + desktop only). This arms the
   overlay and lets students draw.
3. Screen-share and pick a **whole screen** (the picker is screens-only while armed — `V-DESK-1`).
4. Draw on the shared-screen tile — from the **browser student** and/or the desktop app. Expect the
   mark to appear **on the teacher's real screen** and **baked into the shared video** everyone sees,
   at the same spot for all (share-frame alignment).
5. **Clear** (🧽 eraser, host) wipes all screen annotations. Late joiners receive existing marks.

> `Ctrl/⌘ + Alt + G` also toggles annotation (same as the button). macOS needs Screen Recording
> permission (System Settings → Privacy & Security) or the share is black.

**Capture gate (V-DESK-1).** That a transparent overlay composites into a *display*-share was verified
on macOS via `desktopCapturer`. A *window*-share will NOT contain the marks — expected, which is why
the picker is screens-only when annotating. **Confirm the gate on real Windows.**

## Config baked at build time

- `ACADEMIQ_WEB_URL` — the web origin to load in prod (default is a placeholder; set the real one).
