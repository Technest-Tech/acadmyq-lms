"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Eraser,
  FileUp,
  Loader2,
  Lock,
  PencilLine,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatElapsed, useCallElapsed } from "./call-timer-context";
import { useWhiteboard } from "./whiteboard-context";

// PDF / document annotation (Slice 2) is paused — finishing later. Flip to `true` to restore the
// Open-PDF button + page navigation; the underlying render/sync code stays intact behind it.
const SHOW_PDF = false;

// Excalidraw reads `window` and ships its own canvas — it must never render on the server. The
// curated-menu wrapper lives in its own module (whiteboard-canvas) so it can import MainMenu
// statically and replace the stock menu (drops the GitHub/Discord/X + Excalidraw+ links).
const WhiteboardCanvas = dynamic(() => import("./whiteboard-canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-slate-400">
      <Loader2 className="size-6 animate-spin" />
    </div>
  ),
});

/**
 * The shared whiteboard surface, rendered (by <CallMain>) AS the main stage area while the board is
 * open — a flex child filling the space above the always-visible control bar, so it stays responsive
 * on any phone with no fixed offsets. The host can open a PDF: its pages become a locked background the
 * class annotates over (page-nav pill at the bottom). Non-hosts are read-only until the host grants
 * drawing. RTL-aware: Excalidraw gets the locale's langCode so its UI flips for Arabic.
 */
/** The same call-duration clock as the stage, kept visible (and running) while on the board. */
function BoardTimer() {
  const t = useTranslations("videoCall");
  const elapsed = useCallElapsed();
  if (elapsed === null) return null;
  return (
    <span
      aria-label={t("callDuration")}
      className="flex shrink-0 items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600"
    >
      <Clock className="size-3.5 text-slate-400" aria-hidden />
      {formatElapsed(elapsed)}
    </span>
  );
}

export function WhiteboardPanel() {
  const t = useTranslations("videoCall");
  const locale = useLocale();
  const {
    canDraw,
    canManage,
    allowDraw,
    registerApi,
    notifyLocalChange,
    initialElements,
    closeBoard,
    setAllowDraw,
    clearBoard,
    doc,
    docBusy,
    loadDocument,
    goToPage,
    closeDocument,
  } = useWhiteboard();
  const fileRef = useRef<HTMLInputElement>(null);

  // Drop the API reference when the board unmounts so stale updateScene calls can't fire.
  useEffect(() => () => registerApi(null), [registerApi]);

  const navBtn =
    "flex size-9 items-center justify-center rounded-full transition hover:bg-white/15 disabled:opacity-40 sm:size-8";

  return (
    <div
      data-testid="whiteboard-panel"
      className="relative flex min-h-0 flex-1 flex-col bg-white"
    >
      {/* Header: title + host controls (or a read-only badge for ungranted students). Wrap-safe and
          compact on phones — control labels collapse to icons below sm, color carries the state. */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-2 py-1.5 sm:px-3 sm:py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700">
          <PencilLine className="size-4 shrink-0 text-slate-500" />
          <span className="truncate">{t("whiteboard")}</span>
          <BoardTimer />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {canManage ? (
            <>
              {SHOW_PDF && (
                <>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={docBusy}
                    title={t("whiteboardOpenPdf")}
                    className="flex h-9 items-center gap-1.5 rounded-full bg-slate-200 px-2.5 text-xs font-medium text-slate-700 transition hover:bg-slate-300 disabled:opacity-50 sm:h-8"
                  >
                    {docBusy ? (
                      <Loader2 className="size-4 shrink-0 animate-spin sm:size-3.5" />
                    ) : (
                      <FileUp className="size-4 shrink-0 sm:size-3.5" />
                    )}
                    <span className="hidden sm:inline">
                      {t("whiteboardOpenPdf")}
                    </span>
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) loadDocument(f);
                      e.target.value = "";
                    }}
                  />
                </>
              )}
              <button
                type="button"
                onClick={() => setAllowDraw(!allowDraw)}
                aria-pressed={allowDraw}
                title={t("whiteboardAllowDraw")}
                className={`flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition sm:h-8 ${
                  allowDraw
                    ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                    : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                }`}
              >
                <PencilLine className="size-4 shrink-0 sm:size-3.5" />
                <span className="hidden sm:inline">
                  {t("whiteboardAllowDraw")}
                </span>
              </button>
              <button
                type="button"
                onClick={clearBoard}
                aria-label={t("whiteboardClear")}
                title={t("whiteboardClear")}
                className="flex size-9 items-center justify-center rounded-full bg-slate-200 text-slate-600 transition hover:bg-slate-300 sm:size-8"
              >
                <Eraser className="size-4" />
              </button>
              <button
                type="button"
                onClick={closeBoard}
                aria-label={t("whiteboardClose")}
                title={t("whiteboardClose")}
                className="flex size-9 items-center justify-center rounded-full bg-red-100 text-red-600 transition hover:bg-red-200 sm:size-8"
              >
                <X className="size-4" />
              </button>
            </>
          ) : (
            !canDraw && (
              <span className="flex items-center gap-1.5 rounded-full bg-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600">
                <Lock className="size-3.5 shrink-0" />
                {t("whiteboardReadOnly")}
              </span>
            )
          )}
        </div>
      </div>

      {/* The canvas — Excalidraw fills an explicitly-sized box (absolute inset-0 over a flex-1 parent). */}
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          <WhiteboardCanvas
            registerApi={registerApi}
            initialElements={initialElements()}
            canDraw={canDraw}
            langCode={locale === "ar" ? "ar-SA" : "en"}
            onChange={() => {
              if (canDraw) notifyLocalChange();
            }}
          />
        </div>

        {/* Page navigation — host drives the page for everyone; students see the indicator. Forced LTR
            so the page chevrons read unambiguously regardless of locale. */}
        {SHOW_PDF && doc && (
          <div
            dir="ltr"
            data-testid="whiteboard-doc-nav"
            className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-slate-900/90 px-1.5 py-1 text-white shadow-lg ring-1 ring-white/10 backdrop-blur"
          >
            {canManage && (
              <button
                type="button"
                onClick={() => goToPage(doc.page - 1)}
                disabled={doc.page <= 1 || docBusy}
                aria-label={t("whiteboardPrevPage")}
                className={navBtn}
              >
                <ChevronLeft className="size-4" />
              </button>
            )}
            <span className="px-1.5 text-xs font-medium tabular-nums">
              {doc.page} / {doc.totalPages}
            </span>
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() => goToPage(doc.page + 1)}
                  disabled={doc.page >= doc.totalPages || docBusy}
                  aria-label={t("whiteboardNextPage")}
                  className={navBtn}
                >
                  <ChevronRight className="size-4" />
                </button>
                <span className="mx-0.5 h-5 w-px bg-white/20" />
                <button
                  type="button"
                  onClick={closeDocument}
                  aria-label={t("whiteboardCloseDoc")}
                  className={`${navBtn} text-red-300 hover:bg-red-500/20`}
                >
                  <X className="size-4" />
                </button>
              </>
            )}
            {docBusy && (
              <Loader2 className="ms-0.5 size-3.5 animate-spin text-white/70" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
