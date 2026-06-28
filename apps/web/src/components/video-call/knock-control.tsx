"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Hand, X } from "lucide-react";
import { decideKnock, listKnocks, type PendingKnock } from "@/lib/api";

/** How often the host re-polls the pending-knock queue. */
const POLL_MS = 3000;

/**
 * A short two-tone chime played when a NEW knocker arrives, synthesised with the Web Audio API so it
 * needs no asset. Best-effort: if the browser blocks audio (autoplay policy, no AudioContext) the
 * visual panel is the fallback. The shared context is created lazily on the first ping.
 */
function useKnockChime() {
  const ctxRef = useRef<AudioContext | null>(null);
  return useCallback(() => {
    try {
      const Ctx =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = (ctxRef.current ??= new Ctx());
      if (ctx.state === "suspended") void ctx.resume();
      const t0 = ctx.currentTime;
      [880, 1318.5].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const start = t0 + i * 0.16;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.18);
      });
    } catch {
      // audio unavailable — the panel is the fallback
    }
  }, []);
}

/**
 * The host's waiting-room queue (docs/video-platform/08-ROOM-ACCESS §13.8). A prominent floating
 * notification that polls `listKnocks` (authenticated by the manage credential = the room's
 * host_token) and lets the host admit/deny each knocker — with a chime + pulse the moment someone
 * new knocks, so a busy teacher never misses a waiting student. Pure REST — needs no LiveKit context,
 * so it mounts safely beside the in-call surface. Renders nothing while the queue is empty.
 */
export function KnockControl({ manageToken }: { manageToken: string }) {
  const t = useTranslations("videoCall");
  const [knocks, setKnocks] = useState<PendingKnock[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const chime = useKnockChime();

  const refresh = useCallback(async () => {
    try {
      const res = await listKnocks(manageToken);
      // Chime + pulse whenever an id we haven't seen before shows up (a fresh knocker).
      const hasNew = res.knocks.some((k) => !seenIds.current.has(k.id));
      seenIds.current = new Set(res.knocks.map((k) => k.id));
      if (hasNew) chime();
      setKnocks(res.knocks);
    } catch {
      // transient — keep the last known queue
    }
  }, [manageToken, chime]);

  useEffect(() => {
    let active = true;
    void refresh();
    const id = setInterval(() => {
      if (active) void refresh();
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [refresh]);

  const decide = useCallback(
    async (id: string, decision: "admit" | "deny") => {
      setBusyId(id);
      setKnocks((cur) => cur.filter((k) => k.id !== id)); // optimistic drop
      try {
        await decideKnock(manageToken, id, decision);
      } catch {
        void refresh(); // restore the queue if the decision failed
      } finally {
        setBusyId(null);
      }
    },
    [manageToken, refresh],
  );

  const admitAll = useCallback(() => {
    const ids = knocks.map((k) => k.id);
    setKnocks([]); // optimistic clear
    void Promise.allSettled(ids.map((id) => decideKnock(manageToken, id, "admit"))).then(() => refresh());
  }, [knocks, manageToken, refresh]);

  if (knocks.length === 0) return null;

  return (
    <div
      data-testid="knock-control"
      className="animate-in slide-in-from-bottom-4 fade-in fixed bottom-24 end-4 z-50 w-80 max-w-[calc(100vw-2rem)] duration-300"
    >
      <div className="overflow-hidden rounded-2xl bg-slate-900/95 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-white/10 bg-emerald-500/10 px-4 py-3">
          <span className="relative grid size-8 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-300">
            <Hand className="size-4" />
            <span className="absolute -end-0.5 -top-0.5 size-2.5 animate-pulse rounded-full bg-emerald-400 ring-2 ring-slate-900" />
          </span>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">
            {t("knockQueueTitle", { count: knocks.length })}
          </p>
          {knocks.length > 1 && (
            <button
              type="button"
              onClick={admitAll}
              className="shrink-0 rounded-lg bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-emerald-400"
            >
              {t("admitAll")}
            </button>
          )}
        </div>

        {/* Queue */}
        <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto p-2">
          {knocks.map((k) => (
            <li
              key={k.id}
              data-testid="knock-row"
              className="flex items-center gap-2.5 rounded-xl bg-white/5 p-2 ring-1 ring-white/5"
            >
              <span
                className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-400/30 to-emerald-600/30 text-sm font-semibold uppercase text-emerald-100"
                aria-hidden
              >
                {k.displayName.trim().charAt(0) || "?"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{k.displayName}</p>
                <p className="truncate text-xs text-white/50">{t("knockWantsToJoin")}</p>
              </div>
              <button
                type="button"
                aria-label={t("admit")}
                title={t("admit")}
                disabled={busyId === k.id}
                onClick={() => decide(k.id, "admit")}
                className="flex size-9 items-center justify-center rounded-lg bg-emerald-500 text-white transition hover:bg-emerald-400 disabled:opacity-50"
              >
                <Check className="size-4" />
              </button>
              <button
                type="button"
                aria-label={t("deny")}
                title={t("deny")}
                disabled={busyId === k.id}
                onClick={() => decide(k.id, "deny")}
                className="flex size-9 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-rose-500/80 disabled:opacity-50"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
