"use client";

import { useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { gridDims } from "./pip-layout";
import { PipTile } from "./pip-window";

/**
 * The compact presenter layout shown in the desktop app's small floating panel while the teacher
 * screen-shares (see `usePresenterMode`). It fills the area above the always-visible control bar with
 * a live grid of every participant's camera (reusing `PipTile` — same live `<video>` tiles + host
 * mute/remove controls as the PiP window). The teacher's shared screen itself is on their desktop, so
 * the panel only needs the people + the controls below it. Desktop-only; never rendered in a browser.
 */
export function PresenterPanel() {
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  const { cols } = gridDims(Math.max(cameras.length, 1));

  return (
    <div className="min-h-0 flex-1 bg-slate-900 p-1.5">
      <div
        className="grid h-full min-h-0 gap-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "1fr" }}
      >
        {cameras.map((c) => (
          <PipTile key={`${c.participant.identity}:${c.source}`} trackRef={c} />
        ))}
      </div>
    </div>
  );
}
