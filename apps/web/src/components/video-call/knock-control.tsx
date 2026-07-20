"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Eye, Hand, X } from "lucide-react";
import { decideKnock, listKnocks, type PendingKnock } from "@/lib/api";
import { useKnockChime } from "./knock-chime";

/** How often the host re-polls the pending-knock queue. */
const POLL_MS = 3000;
/** While anyone is still waiting, ring again on this cadence — a single chime is easy to talk over. */
const REMIND_MS = 12000;
/** …but stop nagging eventually; past this the pulsing panel carries it on its own. */
const MAX_REMINDERS = 10;

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
  /**
   * Knocks this host has already admitted/denied. A decision and a poll can overlap — the poll that
   * was in flight when the host clicked still answers with the pre-decision queue — so without this
   * the row springs back for a poll cycle and the host clicks a second time on someone who is
   * already in the room. Ids are unique per knock (a denied guest who re-knocks gets a fresh one),
   * so entries can never suppress a legitimate new arrival, and it only ever holds one uuid per
   * decision made during this call.
   */
  const decidedIds = useRef<Set<string>>(new Set());
  /** Guards against two polls in flight at once, where the older response could land last. */
  const polling = useRef(false);
  const chime = useKnockChime();

  const refresh = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const res = await listKnocks(manageToken);
      const pending = res.knocks.filter((k) => !decidedIds.current.has(k.id));
      // Chime + pulse whenever an id we haven't seen before shows up (a fresh knocker).
      const hasNew = pending.some((k) => !seenIds.current.has(k.id));
      seenIds.current = new Set(pending.map((k) => k.id));
      if (hasNew) chime();
      setKnocks(pending);
    } catch {
      // transient — keep the last known queue
    } finally {
      polling.current = false;
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

  // Keep ringing while the queue is non-empty. Re-armed on every change to the queue, so admitting
  // one of three resets the countdown rather than chiming right on the heels of the last decision.
  useEffect(() => {
    if (knocks.length === 0) return;
    let fired = 0;
    const id = setInterval(() => {
      fired += 1;
      chime();
      if (fired >= MAX_REMINDERS) clearInterval(id);
    }, REMIND_MS);
    return () => clearInterval(id);
  }, [knocks.length, chime]);

  const decide = useCallback(
    async (id: string, decision: "admit" | "deny") => {
      setBusyId(id);
      decidedIds.current.add(id);
      setKnocks((cur) => cur.filter((k) => k.id !== id)); // optimistic drop
      try {
        await decideKnock(manageToken, id, decision);
      } catch {
        decidedIds.current.delete(id); // it never landed — let the next poll bring the row back
      } finally {
        setBusyId(null);
        void refresh(); // converge on the server's queue now rather than up to POLL_MS later
      }
    },
    [manageToken, refresh],
  );

  const admitAll = useCallback(() => {
    const ids = knocks.map((k) => k.id);
    ids.forEach((id) => decidedIds.current.add(id));
    setKnocks((cur) => cur.filter((k) => !ids.includes(k.id))); // optimistic clear
    void Promise.allSettled(ids.map((id) => decideKnock(manageToken, id, "admit"))).then((results) => {
      ids.forEach((id, i) => {
        if (results[i]?.status === "rejected") decidedIds.current.delete(id);
      });
      void refresh();
    });
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
          {knocks.map((k) => {
            const isGhost = k.role === "monitor";
            return (
            <li
              key={k.id}
              data-testid="knock-row"
              data-role={k.role ?? "guest"}
              className="flex items-center gap-2.5 rounded-xl bg-white/5 p-2 ring-1 ring-white/5"
            >
              <span
                className={
                  isGhost
                    ? "grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-400/30 to-indigo-600/30 text-indigo-100"
                    : "grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-400/30 to-emerald-600/30 text-sm font-semibold uppercase text-emerald-100"
                }
                aria-hidden
              >
                {isGhost ? <Eye className="size-4" /> : k.displayName.trim().charAt(0) || "?"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{k.displayName}</p>
                <p className="truncate text-xs text-white/50">
                  {isGhost ? t("knockWantsToObserve") : t("knockWantsToJoin")}
                </p>
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
            );
          })}
        </ul>
      </div>
    </div>
  );
}
