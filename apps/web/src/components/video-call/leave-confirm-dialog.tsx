"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRoomContext } from "@livekit/components-react";
import { PhoneOff } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * "Leave the call?" — the guard on the one control in the bar that can't be undone with another
 * click. Portalled to <body> like recording-saved-dialog: the presenter dock's `overflow-hidden`
 * would otherwise clip it, and <body> is still inside the fullscreen element (useFullscreen
 * fullscreens `document.documentElement`), so it stays visible in fullscreen too.
 */
function LeaveConfirmDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("videoCall");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      data-testid="leave-confirm"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 text-white"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden onClick={onCancel} />
      <div
        role="dialog"
        aria-modal
        aria-labelledby="leave-confirm-title"
        className="relative flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-slate-800/95 p-6 text-center shadow-2xl ring-1 ring-white/10 backdrop-blur"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-red-500/15 ring-1 ring-red-400/30">
          <PhoneOff className="size-7 text-red-400" />
        </span>
        <div className="space-y-1.5">
          <h2 id="leave-confirm-title" className="text-lg font-semibold">
            {t("leaveConfirmTitle")}
          </h2>
          <p className="text-sm text-slate-300">{t("leaveConfirmBody")}</p>
        </div>
        <div className="mt-1 flex w-full gap-2">
          <button
            type="button"
            onClick={onCancel}
            autoFocus
            className="flex-1 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20"
          >
            {t("leaveConfirmStay")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700"
          >
            {t("leaveConfirmCta")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Wires the confirmation to the room for any Leave control: call `requestLeave` from the button's
 * onClick and render `dialog` anywhere in the same tree (it portals out, so it adds no layout).
 * Both control bars use this, so the guard can't drift between them.
 */
export function useLeaveConfirm() {
  const room = useRoomContext();
  const [open, setOpen] = useState(false);

  const requestLeave = useCallback(() => setOpen(true), []);
  const cancel = useCallback(() => setOpen(false), []);
  const confirm = useCallback(() => {
    setOpen(false);
    void room.disconnect();
  }, [room]);

  return {
    requestLeave,
    dialog: <LeaveConfirmDialog open={open} onCancel={cancel} onConfirm={confirm} />,
  };
}
