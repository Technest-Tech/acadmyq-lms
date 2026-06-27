"use client";

import { useState } from "react";
import { useParticipants } from "@livekit/components-react";
import { useTranslations } from "next-intl";
import { Loader2, Mic, MicOff, PhoneOff, UserX, X } from "lucide-react";
import { endRoomForAll, muteParticipant, removeParticipant } from "@/lib/api";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * A slide-over roster of everyone in the room. For a host (canManage) it becomes actionable:
 * force-mute a participant's mic, remove (kick) them, and end the call for everyone. All actions
 * are server-mediated (the browser never holds the SFU admin secret); the roster reflects the SFU
 * state via LiveKit events, so a mute/remove updates here automatically.
 */
export function ParticipantsPanel({
  open,
  onClose,
  canManage,
  roomId,
}: {
  open: boolean;
  onClose: () => void;
  canManage: boolean;
  roomId: string;
}) {
  const t = useTranslations("videoCall");
  const participants = useParticipants();
  const [busy, setBusy] = useState<string | null>(null);

  if (!open) return null;

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
    } catch {
      // The roster reflects the authoritative SFU state via events; a failed action just no-ops.
    } finally {
      setBusy(null);
    }
  }

  function endForAll() {
    if (!window.confirm(t("endForAllConfirm"))) return;
    void act("end", () => endRoomForAll(roomId));
  }

  return (
    <div className="fixed inset-0 z-40 text-white">
      <button
        type="button"
        aria-label={t("close")}
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
            aria-label={t("close")}
            className="flex size-9 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </header>

        <ul className="flex-1 overflow-y-auto p-2">
          {participants.map((p) => {
            const label = p.name || p.identity;
            const actionable = canManage && !p.isLocal;
            return (
              <li
                key={p.identity}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/5"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold text-slate-200">
                  {initials(label)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {label}
                  {p.isLocal && <span className="ms-1 text-white/50">({t("you")})</span>}
                </span>

                {actionable ? (
                  <div className="flex items-center gap-1">
                    {p.isMicrophoneEnabled ? (
                      <button
                        type="button"
                        onClick={() => void act(`${p.identity}:mute`, () => muteParticipant(roomId, p.identity))}
                        disabled={busy === `${p.identity}:mute`}
                        aria-label={t("muteParticipant")}
                        title={t("muteParticipant")}
                        className="flex size-8 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
                      >
                        {busy === `${p.identity}:mute` ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Mic className="size-4" />
                        )}
                      </button>
                    ) : (
                      <MicOff className="size-4 text-red-400" aria-label={t("muted")} />
                    )}
                    <button
                      type="button"
                      onClick={() => void act(`${p.identity}:remove`, () => removeParticipant(roomId, p.identity))}
                      disabled={busy === `${p.identity}:remove`}
                      aria-label={t("removeParticipant")}
                      title={t("removeParticipant")}
                      className="flex size-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-500/20 hover:text-red-300 disabled:opacity-50"
                    >
                      {busy === `${p.identity}:remove` ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <UserX className="size-4" />
                      )}
                    </button>
                  </div>
                ) : p.isMicrophoneEnabled ? (
                  <Mic className="size-4 text-slate-400" />
                ) : (
                  <MicOff className="size-4 text-red-400" />
                )}
              </li>
            );
          })}
        </ul>

        {canManage && (
          <footer className="border-b-0 border-t border-white/10 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            <button
              type="button"
              onClick={endForAll}
              disabled={busy === "end"}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600/90 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-60"
            >
              {busy === "end" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PhoneOff className="size-4" />
              )}
              {t("endForAll")}
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}
