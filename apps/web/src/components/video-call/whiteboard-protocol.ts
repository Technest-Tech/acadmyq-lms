/**
 * The shared-whiteboard wire protocol + reconciliation, kept pure (no React, no LiveKit) so the
 * merge rule is unit-testable in isolation. Messages are JSON over the LiveKit data channel on the
 * `whiteboard` topic; Excalidraw elements satisfy {@link SyncElement} structurally. See
 * docs/video-platform/09-WHITEBOARD-AND-ANNOTATION.md.
 */

export const WHITEBOARD_TOPIC = "whiteboard";

/** The minimal element shape needed to merge two scenes deterministically. */
export interface SyncElement {
  id: string;
  version: number;
  versionNonce: number;
  isDeleted?: boolean;
}

export type WhiteboardMessage<E extends SyncElement = SyncElement> =
  /** Host broadcasts the board's open/closed + draw-permission state to everyone. */
  | { t: "state"; open: boolean; allowDraw: boolean }
  /** Any editor broadcasts a (throttled) full scene; receivers reconcile it in. */
  | { t: "scene"; elements: E[] }
  /** A (late) joiner asks the host for the current board. */
  | { t: "sync-request" }
  /** The host's targeted reply with the full board state + scene. */
  | { t: "sync-full"; elements: E[]; open: boolean; allowDraw: boolean }
  /** Host wipes the board for everyone. */
  | { t: "clear" }
  /** Host shows a document page (metadata only — the image bytes follow as doc-chunk msgs). */
  | { t: "doc-page"; meta: DocPageMeta }
  /** One slice of a page image's base64 bytes (chunked so it never overruns the data channel). */
  | { t: "doc-chunk"; fileId: string; i: number; n: number; s: string }
  /** Host closes the document (clears the board). */
  | { t: "doc-close" }
  /** An embedded image's bytes are coming (metadata) — the image ELEMENT rides the scene feed. */
  | { t: "file"; fileId: string; mimeType: string; n: number }
  /** One slice of an embedded image's data-URL (chunked like doc bytes; reassembled then addFiles'd). */
  | { t: "file-chunk"; fileId: string; i: number; n: number; s: string }
  /**
   * Screen-share annotation delta: strokes drawn over the LIVE shared screen. A separate lane from
   * the Excalidraw whiteboard scene (above) so the two surfaces never bleed into each other; it
   * still reuses {@link mergeElements} for convergence. On the teacher's desktop app these are
   * forwarded to the overlay and baked into the shared screen pixels.
   */
  | { t: "sa-scene"; elements: E[] }
  /** Host wipes all screen-share annotations. */
  | { t: "sa-clear" };

/** A document page broadcast: metadata here, the image bytes across the matching doc-chunk msgs. */
export interface DocPageMeta {
  docId: string;
  page: number; // 1-based
  totalPages: number;
  fileId: string; // the Excalidraw file id holding this page's rendered image
  naturalW: number;
  naturalH: number;
  mimeType: string;
}

/** Max base64 chars per data-channel message — kept well under the WebRTC message ceiling. */
export const DOC_CHUNK_SIZE = 12_000;
/** Page width in SCENE units — every client lays a page out identically so annotations line up. */
export const DOC_PAGE_WIDTH = 1000;
/** Vertical slot per page; pages stack down the canvas so each page keeps its own annotations. */
export const DOC_PAGE_SLOT = 1600;

/** Deterministic scene element id for a page's locked background image. */
export function bgElementId(page: number): string {
  return `wb-doc-bg-${page}`;
}

/** Deterministic scene bounds for a page — identical on every client, so annotations align. */
export function pageBounds(
  page: number,
  naturalW: number,
  naturalH: number,
): { x: number; y: number; width: number; height: number } {
  const height = naturalW > 0 ? Math.round((DOC_PAGE_WIDTH * naturalH) / naturalW) : DOC_PAGE_WIDTH;
  return { x: 0, y: (page - 1) * DOC_PAGE_SLOT, width: DOC_PAGE_WIDTH, height };
}

/** Split a base64 payload into channel-sized chunks (always ≥ 1, even for the empty string). */
export function splitChunks(data: string, size = DOC_CHUNK_SIZE): string[] {
  if (data.length <= size) return [data];
  const out: string[] = [];
  for (let i = 0; i < data.length; i += size) out.push(data.slice(i, i + size));
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeMessage(msg: WhiteboardMessage): Uint8Array {
  return encoder.encode(JSON.stringify(msg));
}

/** Decode a data-channel payload to a whiteboard message, or null if it isn't one (foreign topic, junk). */
export function decodeMessage(payload: Uint8Array): WhiteboardMessage | null {
  try {
    const parsed: unknown = JSON.parse(decoder.decode(payload));
    return isWhiteboardMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const MESSAGE_TYPES = new Set([
  "state",
  "scene",
  "sync-request",
  "sync-full",
  "clear",
  "doc-page",
  "doc-chunk",
  "doc-close",
  "file",
  "file-chunk",
  "sa-scene",
  "sa-clear",
]);

function isWhiteboardMessage(v: unknown): v is WhiteboardMessage {
  if (typeof v !== "object" || v === null) return false;
  return MESSAGE_TYPES.has((v as { t?: unknown }).t as string);
}

/**
 * Merge a remote scene into the local one with Excalidraw's reconciliation rule, as a pure function:
 * union by `id`; the higher `version` wins; ties break on the LOWER `versionNonce` — deterministic on
 * every peer, so all clients converge on the same scene. Deletions ride along as `isDeleted` elements
 * (Excalidraw keeps them and bumps the version), so a delete reconciles like any other change.
 */
export function mergeElements<E extends SyncElement>(local: readonly E[], remote: readonly E[]): E[] {
  const byId = new Map<string, E>();
  for (const el of local) byId.set(el.id, el);
  for (const el of remote) {
    const current = byId.get(el.id);
    if (!current || winsOver(el, current)) byId.set(el.id, el);
  }
  return [...byId.values()];
}

/** True when `candidate` should replace `current`: higher version, or equal version + lower nonce. */
export function winsOver(candidate: SyncElement, current: SyncElement): boolean {
  if (candidate.version !== current.version) return candidate.version > current.version;
  return candidate.versionNonce < current.versionNonce;
}

/**
 * The DELTA to broadcast: only elements whose `version` differs from what was last sent for that id
 * (`sent` maps id → last-broadcast version). Cuts a typing/drawing burst down to the few touched
 * elements instead of re-sending the whole scene every tick. Deletions ride along — Excalidraw keeps
 * a deleted element with `isDeleted` and a bumped version, so it falls out as a normal change.
 */
export function changedSince<E extends SyncElement>(
  elements: readonly E[],
  sent: Map<string, number>,
): E[] {
  return elements.filter((el) => sent.get(el.id) !== el.version);
}

/** A cheap fingerprint of a scene's mutable state (count + summed versions) to skip no-op broadcasts. */
export function sceneSignature(elements: readonly SyncElement[]): string {
  let sum = 0;
  for (const el of elements) sum += el.version;
  return `${elements.length}:${sum}`;
}
