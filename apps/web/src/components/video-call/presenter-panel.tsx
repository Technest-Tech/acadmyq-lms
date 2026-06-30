"use client";

import { useEffect } from "react";
import { useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Minus } from "lucide-react";
import { useTranslations } from "next-intl";
import { ControlBar } from "./control-bar";
import { gridDims } from "./pip-layout";
import { PipTile } from "./pip-window";
import { WhiteboardPanel } from "./whiteboard-panel";
import { useWhiteboard } from "./whiteboard-context";

/** Electron drag regions — let the user move the frameless floating panel by its header. No-op in a
 * browser (presenter mode is desktop-only anyway). */
const DRAG = { WebkitAppRegion: "drag" } as unknown as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as unknown as React.CSSProperties;

/**
 * The modern, Zoom-style floating presenter panel shown in the desktop app's small content-protected
 * window while the teacher screen-shares. A single clean card: a draggable header (live status +
 * collapse), a live participant grid, and a compact control bar. The shared screen itself is on the
 * teacher's display; this panel is just the people + controls. Desktop-only; never in a browser.
 */
export function PresenterShell({
  onCollapse,
  canManage,
  participantCount,
  onToggleParticipants,
  onToggleSettings,
}: {
  onCollapse: () => void;
  canManage: boolean;
  participantCount: number;
  onToggleParticipants: () => void;
  onToggleSettings: () => void;
}) {
  const t = useTranslations("videoCall");
  const { open: boardOpen } = useWhiteboard();
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  const { cols } = gridDims(Math.max(cameras.length, 1));

  // Opening the shared whiteboard while presenting switches everyone to the board; grow the floating
  // window to a comfortable size so the teacher can actually draw, and shrink back when it closes.
  useEffect(() => {
    window.academiqDesktop?.setPresenterBoard?.(boardOpen);
  }, [boardOpen]);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-b from-slate-800 to-slate-900">
      {/* Drag header */}
      <div
        style={DRAG}
        className="flex h-9 shrink-0 items-center justify-between gap-2 px-3 pt-1.5"
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-white/90">
          <span className="size-2 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
          {boardOpen ? t("whiteboard") : t("sharingNow")}
        </span>
        <button
          type="button"
          style={NO_DRAG}
          onClick={onCollapse}
          aria-label={t("collapsePanel")}
          title={t("collapsePanel")}
          className="flex size-7 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <Minus className="size-4" />
        </button>
      </div>

      {/* Whiteboard (when the host opens it) or the live participant grid */}
      {boardOpen ? (
        <div className="min-h-0 flex-1">
          <WhiteboardPanel />
        </div>
      ) : (
        <div className="min-h-0 flex-1 px-2">
          <div
            className="grid h-full min-h-0 gap-1.5"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "1fr" }}
          >
            {cameras.map((c) => (
              <PipTile key={`${c.participant.identity}:${c.source}`} trackRef={c} />
            ))}
          </div>
        </div>
      )}

      {/* Control bar */}
      <div className="shrink-0 px-2 pb-2 pt-1.5">
        <ControlBar
          onToggleParticipants={onToggleParticipants}
          onToggleSettings={onToggleSettings}
          participantCount={participantCount}
          canManage={canManage}
          presenter
        />
      </div>
    </div>
  );
}
