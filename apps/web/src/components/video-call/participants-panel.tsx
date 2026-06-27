"use client";

import { useParticipants } from "@livekit/components-react";
import { useTranslations } from "next-intl";
import { Mic, MicOff, X } from "lucide-react";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** A slide-over roster of everyone in the room, opened from the control bar. */
export function ParticipantsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("videoCall");
  const participants = useParticipants();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 text-white">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <aside className="absolute inset-y-0 end-0 flex w-full max-w-xs flex-col bg-slate-900 shadow-2xl ring-1 ring-white/10">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <h2 className="text-sm font-semibold">
            {t("participants")} · {participants.length}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </header>
        <ul className="flex-1 overflow-y-auto p-2">
          {participants.map((p) => {
            const label = p.name || p.identity;
            return (
              <li key={p.identity} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold text-slate-200">
                  {initials(label)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {label}
                  {p.isLocal && <span className="ms-1 text-white/50">({t("you")})</span>}
                </span>
                {p.isMicrophoneEnabled ? (
                  <Mic className="size-4 text-slate-400" />
                ) : (
                  <MicOff className="size-4 text-red-400" />
                )}
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}
