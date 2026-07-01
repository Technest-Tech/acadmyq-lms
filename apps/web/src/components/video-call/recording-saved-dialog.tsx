"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * A calm success confirmation shown to the host once a recording has actually been finalised and
 * saved to the academy's recordings (driven by the SFU egress-stopped signal, not the API call).
 * Matches the dark call surface (like settings-dialog); portalled to <body> so the presenter card's
 * `overflow-hidden` can't clip it, and layered above every panel.
 */
export function RecordingSavedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("videoCall");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 text-white">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal
        aria-labelledby="recording-saved-title"
        className="relative flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-slate-800/95 p-6 text-center shadow-2xl ring-1 ring-white/10 backdrop-blur"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-400/30">
          <CheckCircle2 className="size-8 text-emerald-400" />
        </span>
        <div className="space-y-1.5">
          <h2 id="recording-saved-title" className="text-lg font-semibold">
            {t("recordingSavedTitle")}
          </h2>
          <p className="text-sm text-slate-300">{t("recordingSavedDetail")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          autoFocus
          className="mt-1 w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-400"
        >
          {t("recordingSavedDone")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
