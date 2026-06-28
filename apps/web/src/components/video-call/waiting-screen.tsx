"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { ApiError, isAdmitted, pollKnock, type JoinRoomResponse } from "@/lib/api";
import { BrandBackdrop } from "./brand-backdrop";

/** How often the waiting guest re-checks whether a host has admitted them. */
const POLL_MS = 3000;

/**
 * The guest "knocking" view (docs/video-platform/08-ROOM-ACCESS §13.8). A guest who joined a
 * `waiting_room` room landed here instead of a token; they short-poll `pollKnock` until a host
 * admits (→ onAdmitted with the minted credential), denies, or the knock times out. Calm by design —
 * a quiet spinner, the room name, and a cancel affordance — never a token until admitted.
 */
export function WaitingScreen({
  knockToken,
  roomTitle,
  onAdmitted,
  onDenied,
  onExpired,
  onCancel,
}: {
  knockToken: string;
  roomTitle?: string;
  onAdmitted: (creds: JoinRoomResponse) => void;
  onDenied: () => void;
  onExpired: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("videoCall");
  // Keep the latest callbacks without re-arming the poll loop each render.
  const cbs = useRef({ onAdmitted, onDenied, onExpired });
  cbs.current = { onAdmitted, onDenied, onExpired };

  useEffect(() => {
    let active = true;
    let busy = false;

    async function tick() {
      if (busy || !active) return;
      busy = true;
      try {
        const p = await pollKnock(knockToken);
        if (!active) return;
        if (isAdmitted(p)) cbs.current.onAdmitted(p);
        else if (p.state === "denied") cbs.current.onDenied();
        else if (p.state === "expired") cbs.current.onExpired();
        // "knocking" → keep waiting
      } catch (e) {
        // A vanished knock (404) is terminal; transient errors just retry on the next tick.
        if (active && e instanceof ApiError && e.status === 404) cbs.current.onExpired();
      } finally {
        busy = false;
      }
    }

    void tick(); // check immediately, then on an interval
    const id = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [knockToken]);

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center p-4 text-white">
      <BrandBackdrop />
      <div
        data-testid="waiting-screen"
        className="relative w-full max-w-sm rounded-3xl bg-white/[0.03] p-6 text-center ring-1 ring-white/10 backdrop-blur-sm"
      >
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30">
          <Loader2 className="size-6 animate-spin" />
        </div>
        <h1 className="text-lg font-semibold text-white">{t("knockWaitTitle")}</h1>
        <p className="mt-2 text-sm text-slate-400">{t("knockWaitSubtitle")}</p>
        {roomTitle && (
          <p className="mt-3 text-sm font-medium text-emerald-300">{roomTitle}</p>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="mt-6 w-full rounded-xl bg-white/5 py-3 font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/10"
        >
          {t("knockWaitCancel")}
        </button>
      </div>
    </div>
  );
}
