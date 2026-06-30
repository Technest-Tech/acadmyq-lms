# 10 — Teacher Desktop App & Baked-In Screen Annotation

> A **teacher-only** Electron app (`apps/desktop`) that wraps the existing web call UI and adds the
> one thing a browser tab physically cannot: **annotations painted onto the teacher's real screen and
> baked into the screen-share pixels**, so every participant *and the recording* sees them — Zoom-style.
> Students stay on plain web (zero install). Read [06-WEB-CALL-CLIENT](06-WEB-CALL-CLIENT.md) and
> [09-WHITEBOARD-AND-ANNOTATION](09-WHITEBOARD-AND-ANNOTATION.md) first.

## Why this exists

A teacher shares a book/PDF/app and a student marks it up; the mark must appear **on the shared
screen** — not only inside the meeting UI. A browser tab is sandboxed and cannot draw over the OS
screen, so the marks could never reach a screen-share or a recording. A small native client closes
that gap. It also gives the teacher a more powerful share/control UX than the browser (native source
picker, system audio, always-on-top, global shortcuts) — the "Zoom desktop > Zoom web" delta — while
students keep the friction-free browser experience.

## Product principles

- **Teacher-only, students on web.** Only the person *sharing the screen* needs the app; everyone else
  joins from the browser. The app loads the **existing web call client by URL** — we never fork the UI.
- **Reuse the sync engine.** Live marks ride the **same LiveKit data channel** as the whiteboard, with
  the same `mergeElements` reconciliation — no new server, no new infra.
- **The overlay has no authority.** It holds no LiveKit connection and no identity; it only *renders*
  marks the room already agreed are valid, host-side.

## Rules (`V-DESK-*`, see [00-OVERVIEW §rules](00-OVERVIEW.md#rules))

- **V-DESK-1 — display-share only.** Baking the overlay into the capture works only when the teacher
  shares a whole **display**, never a single window (window-capture grabs that window's own pixels, not
  a separate floating overlay). When annotation is armed the picker offers **screens only**.
- **V-DESK-2 — overlay has no authority.** No LiveKit connection, no identity; host-side render only.
  Nothing new server-side — gating reuses the whiteboard's `canManage` + `allowDraw` → `canDraw`.
- **V-DESK-3 — web is unchanged when the bridge is absent.** Every `apps/web` addition is guarded by
  `window.academiqDesktop`; in a plain browser the experience is byte-identical.

## Architecture

```
Electron main (apps/desktop/src/main)
 ├─ MAIN WINDOW   → loads the web call client by URL (ACADEMIQ_WEB_URL); preload exposes
 │                  window.academiqDesktop { isDesktop, pushAnnotationScene, setAnnotateMode }
 ├─ OVERLAY WINDOW→ transparent · frameless · alwaysOnTop · click-through · sized to the SHARED display.
 │                  NOT content-protected → OS display-capture composites it INTO the shared stream.
 │                  Lean <canvas> painter (overlay.ts) — render-only, reuses the protocol not Excalidraw.
 ├─ display-capture → setDisplayMediaRequestHandler intercepts getDisplayMedia → OUR source picker
 │                    (Electron ships none); records the chosen screen's display_id.
 └─ overlay-controller → display_id → screen bounds → places overlay; arms via Ctrl/⌘+Alt+G or the web toggle.

Data path (overlay has NO LiveKit connection):
 any participant draws on the share video (apps/web screen-annotate-layer)
   → whiteboard data channel, "sa-scene" lane (separate from the Excalidraw scene)
   → teacher's MAIN WINDOW (WhiteboardProvider) merges + → window.academiqDesktop.pushAnnotationScene()
   → IPC annotation:scene → main → overlay:scene → painter draws on the shared display
   → display capture bakes it in → every participant + the recording sees it.
```

### Why a separate sync lane (not the Excalidraw scene)

The whiteboard (Excalidraw) is a *different surface*, swapped in **instead of** the video, and its scene
is tightly coupled to Excalidraw's API. Screen-share marks instead get their own lane — `sa-scene` /
`sa-clear` messages on the same `whiteboard` topic, reusing `mergeElements`, with state kept separate in
`WhiteboardProvider` (`screenSceneRef` / `screenAnnotations`). This avoids surface-bleed (screen marks
appearing on the PDF/board at overlapping coordinates) while still riding one data channel.

### Coordinate alignment (the `pageBounds` idea, for a live screen)

Marks are authored in a fixed **share frame**: `SHARE_W = 1000` scene units wide ×
`SHARE_W·(displayH/displayW)` tall (the shared display's aspect). The web authoring layer maps the
pointer relative to the **`object-contain` video rect** (`screen-annotate-coords.ts`); the overlay maps
the same frame onto the display with a single uniform scale `k = displayWidthCss / SHARE_W`, DPR applied
once via the canvas backing store. Because the frame carries the display's aspect ratio, x and y scale
identically — a mark at share-(x,y) lands at the same fraction of the screen for everyone. This is the
same deterministic-frame trick `pageBounds`/`DOC_PAGE_WIDTH` uses for PDF pages.

### Who renders what (no double-paint)

The teacher's overlay bakes marks into the shared stream, so all viewers receive them in the video. The
web `screen-annotate-layer` *also* renders the scene crisply on its canvas — at the exact same fractions
— giving low-latency local feedback and making the feature work even before the baked frame round-trips;
the two overlap exactly, so there is no visible doubling.

## Phases (build + verify each — `V-PROC-1`)

1. **Shell** — Electron wraps the web client; media permissions; `useIsDesktop()`. *(done)*
2. **Capture gate** — transparent overlay composites into a `desktopCapturer` display frame.
   *(done — verified on macOS; confirm on Windows. The make-or-break test; if it ever fails on a target
   OS, fall back to compositing marks into the LiveKit track via a canvas track-processor.)*
3. **Native picker + placement** — own source picker, screens-only when armed, overlay on the shared
   display (multi-monitor, HiDPI). *(done)*
4. **Data path** — lean overlay painter + share-frame coords + IPC; web `screen-annotate-layer` +
   `sa-scene` lane + guarded forward. *(done — desktop side verified with synthetic scenes; web side
   typechecks + whiteboard tests pass; live two-participant test pending.)*
5. **Power UX** — web control-bar "Annotate"/clear toggle + `setAnnotateMode` bridge + global shortcut.
   *(done; teacher-draws-on-own-screen via interactive overlay + colour/width toolbar = follow-up.)*
6. **Productionization** — `academiq://room/<token>` deep-link, NSIS installer (unsigned to start —
   local + friends; code-signing + macOS dmg/notarize + auto-update = follow-up). *(deep-link done.)*

## Tooling & build

`electron-vite` (main / preload / overlay+picker renderers) + `electron-builder` (NSIS). Node 24 is
build-only — Electron ships its own. **pnpm gotcha:** pnpm 10 ignores dependency build scripts, so
Electron's ~150 MB binary isn't downloaded by CI/deploy (which never run the app); developers fetch it
with `pnpm --filter @academiq/desktop run rebuild:electron`. See [apps/desktop/README](../../apps/desktop/README.md).

## Gotchas

- **Window-share has no marks (V-DESK-1).** A separate overlay window is not part of another window's
  captured pixels — only display-share composites it. The picker disables window sources when armed.
- **Electron has no built-in picker.** `setDisplayMediaRequestHandler` only *intercepts*
  `getDisplayMedia`; we render the picker from `desktopCapturer.getSources()` and supply the stream.
- **System audio** is `audio: 'loopback'` (Windows); macOS is best-effort — never block the share on it.
- **macOS Screen Recording permission (TCC)** is required for capture; detect and guide, then relaunch.
- **Never `setContentProtection(true)` on the overlay** — that *excludes* it from capture (the opposite
  of what we want). And never `webSecurity:false`.
- **Confirm the prod web origin** baked into `ACADEMIQ_WEB_URL` — the deploy doc uses `acadmyq.com`, the
  web `.env.example` references `academiq.com`.
