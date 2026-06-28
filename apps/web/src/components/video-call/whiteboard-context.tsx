"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useConnectionState, useDataChannel } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toast";
import { useCallControl } from "./call-control-context";
import { loadPdf, renderPage } from "./whiteboard-pdf";
import {
  WHITEBOARD_TOPIC,
  bgElementId,
  decodeMessage,
  encodeMessage,
  mergeElements,
  pageBounds,
  sceneSignature,
  splitChunks,
  type DocPageMeta,
  type SyncElement,
  type WhiteboardMessage,
} from "./whiteboard-protocol";

/** Element shape we pass around — Excalidraw's elements satisfy this structurally. */
export type BoardElement = SyncElement & Record<string, unknown>;

/** A binary file (a rasterised document page) added to Excalidraw's file store. */
export interface BoardFile {
  id: string;
  dataURL: string;
  mimeType: string;
  created: number;
}

/** The slice of the Excalidraw imperative API the sync layer drives (structural, no type coupling). */
export interface BoardApi {
  updateScene: (scene: { elements?: readonly BoardElement[] }) => void;
  getSceneElementsIncludingDeleted: () => readonly BoardElement[];
  addFiles: (files: BoardFile[]) => void;
  scrollToContent: (target?: unknown, opts?: { fitToContent?: boolean; animate?: boolean }) => void;
}

/** The shared document state surfaced to the UI (page indicator + nav), or null when none is open. */
export interface DocState {
  docId: string;
  page: number;
  totalPages: number;
}

export interface WhiteboardValue {
  open: boolean;
  allowDraw: boolean;
  canDraw: boolean;
  canManage: boolean;
  openBoard: () => void;
  closeBoard: () => void;
  toggleBoard: () => void;
  setAllowDraw: (v: boolean) => void;
  clearBoard: () => void;
  registerApi: (api: BoardApi | null) => void;
  notifyLocalChange: () => void;
  initialElements: () => readonly BoardElement[];
  /** The open document (host-driven), or null. */
  doc: DocState | null;
  /** A PDF render is in flight (host) — disables the doc controls. */
  docBusy: boolean;
  /** Host: rasterise + share a PDF as the annotatable background. */
  loadDocument: (file: File) => void;
  /** Host: move everyone to a page (1-based). */
  goToPage: (page: number) => void;
  /** Host: close the document (clears the board). */
  closeDocument: () => void;
}

const WhiteboardContext = createContext<WhiteboardValue | null>(null);

/** Trailing throttle on outbound scene broadcasts — coalesces a burst of strokes into one packet. */
const BROADCAST_THROTTLE_MS = 180;
/** A page's locked background-image element id prefix — these sync via doc-page, NOT the scene feed. */
const BG_PREFIX = "wb-doc-bg-";

const isBg = (el: BoardElement): boolean => typeof el.id === "string" && el.id.startsWith(BG_PREFIX);
const annotationsOf = (els: readonly BoardElement[]): BoardElement[] => els.filter((el) => !isBg(el));
/** Signature over the ANNOTATIONS only — page backgrounds sync out-of-band so they don't trip broadcasts. */
const annotationSig = (els: readonly BoardElement[]): string => sceneSignature(annotationsOf(els));

interface ChunkBuf {
  meta: DocPageMeta | null;
  n: number;
  parts: string[];
  received: number;
}

/**
 * Owns the shared whiteboard + document annotation for the in-call subtree. Live drawing rides the
 * LiveKit data channel (`whiteboard` topic) with a deterministic merge so concurrent edits converge.
 * A host can also open a PDF: ONLY the host runs pdf.js (whiteboard-pdf) — each page is rasterised and
 * broadcast as a locked, scene-aligned background image (chunked over the channel so it never overruns
 * it), and every client annotates over the SAME scene coordinates so marks line up. The host is the
 * authority for board/doc state and the late-join snapshot. See docs/.../09-WHITEBOARD-AND-ANNOTATION.md.
 */
export function WhiteboardProvider({ children }: { children: ReactNode }) {
  const { canManage } = useCallControl();
  const toast = useToast();
  const t = useTranslations("videoCall");
  const connected = useConnectionState() === ConnectionState.Connected;

  const [open, setOpen] = useState(false);
  const [allowDraw, setAllowDrawState] = useState(false);
  const [doc, setDoc] = useState<DocState | null>(null);
  const [docBusy, setDocBusy] = useState(false);

  // Refs so the data-channel handler (a stable closure) always sees the latest state/scene.
  const openRef = useRef(open);
  openRef.current = open;
  const allowDrawRef = useRef(allowDraw);
  allowDrawRef.current = allowDraw;
  const canManageRef = useRef(canManage);
  canManageRef.current = canManage;
  const apiRef = useRef<BoardApi | null>(null);
  const sceneRef = useRef<BoardElement[]>([]); // full local truth (backgrounds + annotations)
  const lastSentSig = useRef("");
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Document refs (host keeps the loaded PDF + the current page so it can answer late joiners).
  const pdfDocRef = useRef<Awaited<ReturnType<typeof loadPdf>> | null>(null);
  const docIdRef = useRef<string | null>(null);
  const hostPageRef = useRef<{ meta: DocPageMeta; dataURL: string } | null>(null);
  const chunkBufRef = useRef<Map<string, ChunkBuf>>(new Map());
  // Pages that arrived before Excalidraw mounted — applied once the API registers.
  const pendingPagesRef = useRef<Array<{ meta: DocPageMeta; dataURL: string }>>([]);

  const handlerRef = useRef<(msg: WhiteboardMessage, from?: string) => void>(() => {});
  // useDataChannel returns only the LATEST message — handle every packet in this callback instead.
  // Param typed structurally (ReceivedDataMessage lives in the transitive @livekit/components-core).
  const onData = useCallback((msg: { payload: Uint8Array; from?: { identity?: string } }) => {
    const decoded = decodeMessage(msg.payload);
    if (decoded) handlerRef.current(decoded, msg.from?.identity);
  }, []);
  const { send } = useDataChannel(WHITEBOARD_TOPIC, onData);

  const sendMessage = useCallback(
    (msg: WhiteboardMessage, to?: string) => {
      void send(encodeMessage(msg), {
        reliable: true,
        topic: WHITEBOARD_TOPIC,
        ...(to ? { destinationIdentities: [to] } : {}),
      });
    },
    [send],
  );

  // Apply a reconciled set of ANNOTATIONS to the live canvas (backgrounds are preserved untouched).
  const applyScene = useCallback((incoming: BoardElement[]) => {
    const merged = mergeElements(sceneRef.current, incoming);
    sceneRef.current = merged;
    lastSentSig.current = annotationSig(merged); // pre-set so the echoing onChange doesn't re-broadcast
    apiRef.current?.updateScene({ elements: merged });
  }, []);

  // Build a page's locked background-image element via Excalidraw's own restore (fills element defaults).
  const buildBg = useCallback(async (meta: DocPageMeta): Promise<BoardElement> => {
    const { restoreElements } = await import("@excalidraw/excalidraw");
    const b = pageBounds(meta.page, meta.naturalW, meta.naturalH);
    const skeleton = {
      id: bgElementId(meta.page),
      type: "image",
      fileId: meta.fileId,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      locked: true,
      status: "saved",
      scale: [1, 1],
    };
    const [bg] = restoreElements([skeleton as never], null);
    return bg as unknown as BoardElement;
  }, []);

  // Show a rasterised page on the canvas: register its bytes, place/replace the locked background at the
  // page's deterministic bounds (so annotations align everywhere), and fit it to the viewport.
  const applyPage = useCallback(
    async (meta: DocPageMeta, dataURL: string) => {
      const api = apiRef.current;
      if (!api) {
        pendingPagesRef.current.push({ meta, dataURL });
        return;
      }
      api.addFiles([{ id: meta.fileId, dataURL, mimeType: meta.mimeType, created: Date.now() }]);
      const bg = await buildBg(meta);
      const rest = sceneRef.current.filter((el) => el.id !== bgElementId(meta.page));
      const next = [bg, ...rest]; // background first → back of the z-order
      sceneRef.current = next;
      setDoc({ docId: meta.docId, page: meta.page, totalPages: meta.totalPages });
      api.updateScene({ elements: next });
      api.scrollToContent(bg, { fitToContent: true, animate: false });
    },
    [buildBg],
  );

  const maybeAssemble = useCallback(
    (fileId: string) => {
      const buf = chunkBufRef.current.get(fileId);
      if (!buf || !buf.meta || buf.n === 0 || buf.received < buf.n) return;
      const dataURL = buf.parts.join("");
      chunkBufRef.current.delete(fileId);
      void applyPage(buf.meta, dataURL);
    },
    [applyPage],
  );

  // Wipe the document + its annotations everywhere (host doc-close, or a remote one).
  const closeDocLocal = useCallback(() => {
    sceneRef.current = [];
    lastSentSig.current = annotationSig([]);
    apiRef.current?.updateScene({ elements: [] });
    setDoc(null);
    hostPageRef.current = null;
    docIdRef.current = null;
    pdfDocRef.current = null;
  }, []);

  const handleMessage = useCallback(
    (msg: WhiteboardMessage, from?: string) => {
      switch (msg.t) {
        case "state":
          setOpen(msg.open);
          setAllowDrawState(msg.allowDraw);
          break;
        case "scene":
          applyScene(msg.elements as BoardElement[]);
          break;
        case "sync-request":
          if (canManageRef.current && from) {
            sendMessage(
              {
                t: "sync-full",
                elements: annotationsOf(sceneRef.current),
                open: openRef.current,
                allowDraw: allowDrawRef.current,
              },
              from,
            );
            // Bring the joiner up to the current page too (bytes + metadata).
            const cur = hostPageRef.current;
            if (cur) {
              sendMessage({ t: "doc-page", meta: cur.meta }, from);
              const chunks = splitChunks(cur.dataURL);
              chunks.forEach((s, i) => sendMessage({ t: "doc-chunk", fileId: cur.meta.fileId, i, n: chunks.length, s }, from));
            }
          }
          break;
        case "sync-full":
          setOpen(msg.open);
          setAllowDrawState(msg.allowDraw);
          applyScene(msg.elements as BoardElement[]);
          break;
        case "clear": {
          // Keep any page backgrounds; drop annotations only.
          const kept = sceneRef.current.filter(isBg);
          sceneRef.current = kept;
          lastSentSig.current = annotationSig(kept);
          apiRef.current?.updateScene({ elements: kept });
          break;
        }
        case "doc-page": {
          const { meta } = msg;
          setDoc({ docId: meta.docId, page: meta.page, totalPages: meta.totalPages });
          const buf = chunkBufRef.current.get(meta.fileId) ?? { meta: null, n: 0, parts: [], received: 0 };
          buf.meta = meta;
          chunkBufRef.current.set(meta.fileId, buf);
          maybeAssemble(meta.fileId);
          break;
        }
        case "doc-chunk": {
          const { fileId, i, n, s } = msg;
          const buf = chunkBufRef.current.get(fileId) ?? { meta: null, n, parts: [], received: 0 };
          buf.n = n;
          if (buf.parts[i] === undefined) buf.received++;
          buf.parts[i] = s;
          chunkBufRef.current.set(fileId, buf);
          maybeAssemble(fileId);
          break;
        }
        case "doc-close":
          closeDocLocal();
          break;
      }
    },
    [applyScene, sendMessage, maybeAssemble, closeDocLocal],
  );
  handlerRef.current = handleMessage;

  // Late join: once connected, a non-host asks the host for the current board (state + scene + page).
  const askedSync = useRef(false);
  useEffect(() => {
    if (connected && !canManage && !askedSync.current) {
      askedSync.current = true;
      sendMessage({ t: "sync-request" });
    }
    if (!connected) askedSync.current = false;
  }, [connected, canManage, sendMessage]);

  const broadcastState = useCallback(
    (nextOpen: boolean, nextAllow: boolean) => sendMessage({ t: "state", open: nextOpen, allowDraw: nextAllow }),
    [sendMessage],
  );

  const openBoard = useCallback(() => {
    if (!canManageRef.current) return;
    setOpen(true);
    broadcastState(true, allowDrawRef.current);
  }, [broadcastState]);

  const closeBoard = useCallback(() => {
    if (!canManageRef.current) return;
    setOpen(false);
    broadcastState(false, allowDrawRef.current);
  }, [broadcastState]);

  const toggleBoard = useCallback(() => {
    if (openRef.current) closeBoard();
    else openBoard();
  }, [openBoard, closeBoard]);

  const setAllowDraw = useCallback(
    (v: boolean) => {
      if (!canManageRef.current) return;
      setAllowDrawState(v);
      broadcastState(openRef.current, v);
    },
    [broadcastState],
  );

  const clearBoard = useCallback(() => {
    if (!canManageRef.current) return;
    const kept = sceneRef.current.filter(isBg);
    sceneRef.current = kept;
    lastSentSig.current = annotationSig(kept);
    apiRef.current?.updateScene({ elements: kept });
    sendMessage({ t: "clear" });
  }, [sendMessage]);

  // Host: rasterise page `p`, show it locally, and broadcast it (metadata + chunked bytes) to the room.
  const showPage = useCallback(
    async (p: number) => {
      const pdf = pdfDocRef.current;
      const docId = docIdRef.current;
      if (!pdf || !docId) return;
      const rp = await renderPage(pdf, p);
      const meta: DocPageMeta = {
        docId,
        page: p,
        totalPages: pdf.numPages,
        fileId: `${docId}-p${p}`,
        naturalW: rp.naturalW,
        naturalH: rp.naturalH,
        mimeType: rp.mimeType,
      };
      hostPageRef.current = { meta, dataURL: rp.dataURL };
      await applyPage(meta, rp.dataURL);
      sendMessage({ t: "doc-page", meta });
      const chunks = splitChunks(rp.dataURL);
      chunks.forEach((s, i) => sendMessage({ t: "doc-chunk", fileId: meta.fileId, i, n: chunks.length, s }));
    },
    [applyPage, sendMessage],
  );

  const loadDocument = useCallback(
    (file: File) => {
      if (!canManageRef.current || docBusy) return;
      setDocBusy(true);
      void (async () => {
        try {
          const pdf = await loadPdf(file);
          pdfDocRef.current = pdf;
          docIdRef.current = crypto.randomUUID();
          await showPage(1);
        } catch {
          toast.error(t("whiteboardDocError"));
          pdfDocRef.current = null;
          docIdRef.current = null;
        } finally {
          setDocBusy(false);
        }
      })();
    },
    [docBusy, showPage, toast, t],
  );

  const goToPage = useCallback(
    (p: number) => {
      const pdf = pdfDocRef.current;
      if (!canManageRef.current || docBusy || !pdf || p < 1 || p > pdf.numPages) return;
      setDocBusy(true);
      void showPage(p)
        .catch(() => toast.error(t("whiteboardDocError")))
        .finally(() => setDocBusy(false));
    },
    [docBusy, showPage, toast, t],
  );

  const closeDocument = useCallback(() => {
    if (!canManageRef.current) return;
    closeDocLocal();
    sendMessage({ t: "doc-close" });
  }, [closeDocLocal, sendMessage]);

  const registerApi = useCallback((api: BoardApi | null) => {
    apiRef.current = api;
    if (!api) return;
    // Seed a freshly-mounted canvas with the last-known scene, then flush any pages that arrived first.
    if (sceneRef.current.length > 0) api.updateScene({ elements: sceneRef.current });
    const pending = pendingPagesRef.current;
    pendingPagesRef.current = [];
    for (const { meta, dataURL } of pending) void applyPage(meta, dataURL);
  }, [applyPage]);

  const notifyLocalChange = useCallback(() => {
    if (flushTimer.current) return; // a flush is already scheduled (trailing throttle)
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      const api = apiRef.current;
      if (!api) return;
      const all = api.getSceneElementsIncludingDeleted() as BoardElement[];
      const sig = annotationSig(all);
      if (sig === lastSentSig.current) return; // no annotation change (e.g. an echoed apply / bg load)
      lastSentSig.current = sig;
      sceneRef.current = all;
      sendMessage({ t: "scene", elements: annotationsOf(all) });
    }, BROADCAST_THROTTLE_MS);
  }, [sendMessage]);

  const initialElements = useCallback(() => sceneRef.current, []);

  useEffect(() => () => void (flushTimer.current && clearTimeout(flushTimer.current)), []);

  const value = useMemo<WhiteboardValue>(
    () => ({
      open,
      allowDraw,
      canDraw: canManage || allowDraw,
      canManage,
      openBoard,
      closeBoard,
      toggleBoard,
      setAllowDraw,
      clearBoard,
      registerApi,
      notifyLocalChange,
      initialElements,
      doc,
      docBusy,
      loadDocument,
      goToPage,
      closeDocument,
    }),
    [
      open,
      allowDraw,
      canManage,
      openBoard,
      closeBoard,
      toggleBoard,
      setAllowDraw,
      clearBoard,
      registerApi,
      notifyLocalChange,
      initialElements,
      doc,
      docBusy,
      loadDocument,
      goToPage,
      closeDocument,
    ],
  );

  return <WhiteboardContext.Provider value={value}>{children}</WhiteboardContext.Provider>;
}

export function useWhiteboard(): WhiteboardValue {
  const ctx = useContext(WhiteboardContext);
  if (!ctx) throw new Error("useWhiteboard must be used within a WhiteboardProvider");
  return ctx;
}
