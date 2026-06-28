"use client";

import { ScanEye, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Supervisor "observation console" chrome (08-ROOM-ACCESS §5). Rendered ONLY for the hidden monitor
 * role — the supervisor who opened the monitor link joins invisibly (publishes nothing, in no tile),
 * so this is purely their own on-screen treatment, never seen by the teacher or students.
 *
 * The look is a tasteful surveillance/viewfinder theme (indigo, corner brackets, a live "observing"
 * pulse) — deliberately ETHICAL, not covert-creepy: it states plainly that the watcher is hidden AND
 * that the session is logged for quality & safety (every monitor entry is audited server-side). The
 * ambient layer is pointer-events-none so it never blocks the call controls underneath.
 */
export function MonitorFrame() {
  const t = useTranslations("videoCall");

  return (
    <>
      {/* Ambient viewfinder — frames the call like a monitoring console (purely decorative). */}
      <div className="pointer-events-none fixed inset-0 z-30" aria-hidden>
        {/* soft indigo edge glow */}
        <div className="absolute inset-0 ring-1 ring-inset ring-indigo-400/15" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-indigo-500/10 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-indigo-500/10 to-transparent" />
        {/* corner brackets */}
        <span className="absolute start-3 top-3 size-7 rounded-ss-lg border-s-2 border-t-2 border-indigo-400/40" />
        <span className="absolute end-3 top-3 size-7 rounded-se-lg border-t-2 border-e-2 border-indigo-400/40" />
        <span className="absolute bottom-3 start-3 size-7 rounded-es-lg border-b-2 border-s-2 border-indigo-400/40" />
        <span className="absolute bottom-3 end-3 size-7 rounded-ee-lg border-b-2 border-e-2 border-indigo-400/40" />
      </div>

      {/* Status pill — top-centre (the header keeps the title on the start side, status on the end). */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-[calc(env(safe-area-inset-top)+0.85rem)]">
        <div
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-950/80 px-3 py-1.5 text-indigo-100 shadow-lg ring-1 ring-inset ring-white/5 backdrop-blur-md"
          role="status"
          data-testid="monitor-frame"
        >
          <span className="relative flex size-2" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-indigo-400/70" />
            <span className="relative inline-flex size-2 rounded-full bg-indigo-300" />
          </span>
          <ScanEye className="size-4 text-indigo-300" aria-hidden />
          <span className="text-xs font-semibold tracking-wide">{t("monitorBannerTitle")}</span>
          <span className="hidden items-center gap-1 text-[11px] text-indigo-200/70 sm:flex">
            <span className="text-indigo-300/40">·</span>
            <ShieldCheck className="size-3.5" aria-hidden />
            {t("monitorBannerNote")}
          </span>
        </div>
      </div>
    </>
  );
}
