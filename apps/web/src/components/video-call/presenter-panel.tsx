"use client";

import { useEffect } from "react";
import { useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Minus } from "lucide-react";
import { useTranslations } from "next-intl";
import { ChatPanel } from "./chat-panel";
import { useChatPanel } from "./chat-context";
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
 * The modern, Zoom-style floating presenter card shown in the desktop app's small content-protected
 * window while the teacher screen-shares. The shared screen itself is on the teacher's display; this
 * card is just the people + tools + controls, laid out in clean, separated sections:
 *
 *   ┌ header (drag · live status · collapse) ────────────────┐
 *   │ main pane (video grid OR whiteboard) │ chat side pane   │
 *   └ control strip (compact bar) ───────────────────────────┘
 *
 * Opening the whiteboard or chat grows the window (setPresenterExpanded) so each has real room; the
 * chat is DOCKED as its own side section (not the full-window drawer, which looked broken over the
 * tiny panel). Everything lives in this one window because it's the only one with BOTH the LiveKit
 * connection and content-protection — a separate OS window can't have both. Desktop-only.
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
  const { isOpen: chatOpen } = useChatPanel();
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  const { cols } = gridDims(Math.max(cameras.length, 1));

  // Opening the whiteboard or chat while presenting needs a comfortable window; grow it and shrink
  // back when both close, so neither section is crammed into the compact panel.
  const expanded = boardOpen || chatOpen;
  useEffect(() => {
    window.academiqDesktop?.setPresenterExpanded?.(expanded);
  }, [expanded]);

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

      {/* Content row: the main pane (whiteboard or video grid) + an optional docked chat section.
          The main pane is a flex COLUMN so WhiteboardPanel's own `flex-1 min-h-0` fills it — the same
          structure CallMain uses in normal mode (a block parent collapses the board to zero height). */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col">
          {boardOpen ? (
            <WhiteboardPanel />
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
        </div>

        {chatOpen && (
          <div className="flex min-h-0 w-[19rem] shrink-0 flex-col border-s border-white/10">
            <ChatPanel embedded />
          </div>
        )}
      </div>

      {/* Control strip — kept in its own section and hugged into a centered pill so it never spreads. */}
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
