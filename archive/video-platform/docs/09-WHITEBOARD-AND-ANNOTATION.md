# 09 — Shared Whiteboard & Document Annotation

> The in-call teaching surface. A real, professional collaborative whiteboard (Excalidraw) plus PDF/
> document annotation, synced peer-to-peer over the LiveKit data channel and gated by the host — so an
> academy class gets a proper board, not a generic call. Read [06-WEB-CALL-CLIENT](06-WEB-CALL-CLIENT.md)
> and [08-ROOM-ACCESS-AND-MONITORING](08-ROOM-ACCESS-AND-MONITORING.md) first.

## Why this exists

A tutoring/Qur'an/language class lives or dies on a shared surface: the teacher draws, marks up a
mushaf page or a worksheet, and the student follows. This is the difference between "a video call" and
"a classroom". It also deepens the moat ([00-OVERVIEW](00-OVERVIEW.md)): the academy owns the board and
(later) the saved annotations are filed under the student.

## Product principles

- **Host-led by default.** The host opens/closes the board for everyone; students are **read-only**
  until the host grants drawing. This mirrors Zoom/Teams annotation gating and fits academy control
  (`V-CTL-1`). A covert monitor never appears as an editor and is never disclosed.
- **No new backend for the live board.** Drawing rides the **LiveKit data channel** (the same pipe as
  chat), so there is no server round-trip per stroke and no new infra to operate. Documents (Slice 2)
  DO need storage — see below.
- **Professional, not a toy.** We embed **Excalidraw** (MIT — no watermark, no per-seat licence, React
  19 native, image embedding for PDF annotation), never a hand-rolled canvas.

## Library decision — Excalidraw vs tldraw

| | Excalidraw ✅ chosen | tldraw |
|---|---|---|
| Licence | **MIT** — free for commercial SaaS | source-available; **watermark unless a paid business licence** |
| React 19 | supported (peer dep) | supported |
| Images / PDF-as-image | yes (locked background elements) | yes |
| Collab transport | `onChange` + `updateScene` + exported `reconcileElements` — drivable over any socket | store diffs / yjs |
| Look | clean, slightly hand-drawn | FigJam-clean |

The watermark/licence cost is the deciding factor for a commercial academy product. If the FigJam look
is later deemed essential and the licence is acceptable, the transport seam (`whiteboard-protocol.ts`)
is library-agnostic enough to swap the surface.

## Architecture

```
ControlBar ── Whiteboard button (host) ─┐
                                        ▼
                    WhiteboardProvider (one per room, inside RoomContext)
                      • useDataChannel("whiteboard")  ← reliable, topic-filtered
                      • board state: { open, allowDraw }   (host is authority)
                      • holds excalidrawAPI ref; reconciles remote scenes
                      • late-join: joiner asks "sync-request" → host replies "sync-full"
                        ▼                         ▲
              WhiteboardPanel (overlay)   broadcast local onChange (throttled, full scene)
              • <Excalidraw> dynamic, ssr:false
              • viewModeEnabled = !canDraw   (read-only for ungranted students)
```

### Message protocol (`whiteboard-protocol.ts`, JSON over the data channel)

| `t` | sender | payload | meaning |
|---|---|---|---|
| `state` | host | `{ open, allowDraw }` | board opened/closed / draw permission changed (everyone reacts) |
| `scene` | any editor | `{ elements }` | throttled full-scene broadcast; receivers **reconcile** (merge by version) |
| `sync-request` | any joiner | — | "I just opened the board — send me the current scene" |
| `sync-full` | host | `{ elements, open, allowDraw }` | targeted (`destinationIdentities`) reply to a joiner |
| `clear` | host | — | wipe the board for everyone |

### Reconciliation

Concurrent edits merge with Excalidraw's own rule (re-implemented as a **pure, unit-tested**
`mergeElements`): union by `id`; the element with the higher `version` wins; ties break on the lower
`versionNonce` (deterministic on every peer). Deletions ride along as `isDeleted` elements (Excalidraw
keeps them and bumps the version), so a delete propagates like any other change. Full-scene broadcasts
are cheap for classroom-sized scenes; the throttle keeps the channel quiet.

### Authority & late join

The **host** (`canManage`) is the single source of truth for board state and the snapshot a late joiner
receives — avoids reply storms (only the host answers `sync-request`). If no host is present the board
simply stays closed (students can't open it).

## Slices (build + verify each — `V-PROC-1`)

- **S1 — live whiteboard** *(this slice)*: Excalidraw surface, host opens for all, real-time sync +
  reconciliation, late-join snapshot, student read-only/draw toggle, clear, RTL + i18n, tests.
- **S2 — document annotation** *(done)*: the host opens a PDF and the class annotates over it. See the
  detailed design below.
- **S3 — stage & polish**: whiteboard-as-main-stage layout (video → filmstrip/PiP), laser pointer,
  follow-presenter, and **save the board to the student's file** (the moat payoff), self-hosted fonts.

## Slice 2 — document annotation (PDF)

The host opens a PDF; its pages become a locked, scene-aligned background the whole class annotates over.

**Host-only rasterisation (the mobile win).** ONLY the host runs `pdfjs-dist` (`whiteboard-pdf.ts`,
dynamically imported so it never enters a student's bundle). Each page is rendered to a compressed JPEG
host-side; a student's phone only ever **decodes one image** — no PDF engine, no heavy CPU. pdf.js's
worker is pinned to the library version from a CDN (a host-only, online concern; self-host later with the
Excalidraw fonts).

**Sync = scene-aligned background + chunked image, NOT object storage.** A page is broadcast as a
`doc-page` (metadata: docId, page, totalPages, fileId, natural size) followed by `doc-chunk` messages
carrying the JPEG's base64 bytes **split into ≤12 KB pieces** so a single message never overruns the data
channel. Every client lays the page out at **deterministic scene bounds** (`pageBounds` — fixed width,
pages stacked by a fixed vertical slot), so a mark drawn at scene (x,y) lands on the same spot for
everyone. This keeps it fully self-contained (no upload endpoint, storage, CORS, or guest-auth) at the
cost of re-sending a page (~100–250 KB) on each navigation — fine for a slow-changing classroom. Backend
storage + sync-by-reference is the scale-up path if documents get large or page-flips frequent.

**Two sync lanes, kept separate.** Page **backgrounds** sync via `doc-page`/`doc-chunk`; **annotations**
sync via the normal throttled `scene` feed. The scene feed *excludes* background elements (id prefix
`wb-doc-bg-`) so page bytes never ride the continuous broadcast, and the annotation signature ignores
them so loading a page doesn't trigger a spurious annotation broadcast. Pages stack down the canvas, so
**each page keeps its own annotations** (flip back and they're still there). `clear` wipes annotations but
keeps the pages; `doc-close` wipes everything.

**Late join.** When a joiner asks for the board, the host replies with the annotations (sync-full) **and**
re-sends the current page (`doc-page` + chunks) targeted at them — so they land on the right page. Pages
the host has already moved past won't have their background for a late joiner (acceptable; the next
navigation re-broadcasts).

## Gotchas

- **Next 15 / SSR**: Excalidraw is browser-only — load it with `next/dynamic({ ssr: false })` and import
  `@excalidraw/excalidraw/index.css`. It reads/writes `window`, so it must never render on the server.
- **`useDataChannel` returns only the latest message** — handle every packet in the `onMessage`
  callback, not via the returned `message` field.
- **Fonts/assets**: Excalidraw fetches its fonts from a CDN by default. For a strict self-hosted academy,
  set `window.EXCALIDRAW_ASSET_PATH` and ship the assets (S3 polish item).
- **Bandwidth**: never put image bytes in the *continuous* `scene` broadcast. Page bytes ride their own
  one-shot `doc-page`/`doc-chunk` lane (≤12 KB/message) and the scene feed filters background elements
  out — so drawing never re-sends the page, and only one page (the current) is ever in flight.
- **pdf.js v6 render**: `RenderParameters` requires BOTH `canvas` and `canvasContext`; the worker
  (`GlobalWorkerOptions.workerSrc`) must match the library version exactly — derive it from `pdfjs.version`.
