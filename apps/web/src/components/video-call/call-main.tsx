"use client";

import { CallStage } from "./call-stage";
import { PresenterPanel } from "./presenter-panel";
import { WhiteboardPanel } from "./whiteboard-panel";
import { useWhiteboard } from "./whiteboard-context";

/**
 * The main flex area of the call: the video stage normally, the shared whiteboard when the host opens
 * it, or — in the desktop app while screen-sharing — the compact presenter panel (participants grid)
 * that fills the small floating window above the control bar. Swapping (rather than overlaying a fixed
 * card) keeps the layout responsive on any phone — the board fills exactly the space above the
 * always-visible control bar with no magic offsets — and unmounting the stage drops its video
 * subscriptions while the class is on the board or the presenter panel (a mobile-data win).
 */
export function CallMain({
  roomTitle,
  suppressRecording,
  presenter,
}: {
  roomTitle: string;
  suppressRecording: boolean;
  /** Desktop-only: the host is screen-sharing → show the compact participants panel. */
  presenter: boolean;
}) {
  const { open } = useWhiteboard();
  if (presenter) return <PresenterPanel />;
  return open ? (
    <WhiteboardPanel />
  ) : (
    <CallStage roomTitle={roomTitle} suppressRecording={suppressRecording} />
  );
}
