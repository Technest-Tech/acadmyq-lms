"use client";

import { useParticipants } from "@livekit/components-react";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * The collapsed presenter UI: a small round "bubble" that fills the shrunk floating window while the
 * teacher screen-shares. Tapping it expands back to the full panel (`expandPresenter` resizes the
 * desktop window). Shows the live participant count + a pulsing "live" dot so the teacher always knows
 * the call is up without the panel taking screen space. Desktop-only; content-protected window.
 */
export function PresenterBubble({ onExpand }: { onExpand: () => void }) {
  const t = useTranslations("videoCall");
  const participants = useParticipants();

  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={t("expandPanel")}
      title={t("expandPanel")}
      className="group flex size-full items-center justify-center bg-slate-900"
    >
      <span className="relative flex size-16 items-center justify-center rounded-full bg-slate-800 ring-2 ring-emerald-400/70 shadow-lg transition group-hover:ring-emerald-300 group-active:scale-95">
        <Users className="size-6 text-white" />
        <span className="absolute -end-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-xs font-bold text-white ring-2 ring-slate-900">
          {participants.length}
        </span>
        <span className="absolute -bottom-0.5 start-1/2 size-2 -translate-x-1/2 animate-pulse rounded-full bg-emerald-400 ring-2 ring-slate-900 rtl:translate-x-1/2" />
      </span>
    </button>
  );
}
