"use client";

import { CallStage } from "./call-stage";
import { WhiteboardPanel } from "./whiteboard-panel";
import { useWhiteboard } from "./whiteboard-context";

/**
 * The main flex area of the call: the video stage normally, the shared whiteboard when the host opens
 * it. Swapping (rather than overlaying a fixed card) keeps the layout responsive on any phone — the
 * board fills exactly the space above the always-visible control bar with no magic offsets — and
 * unmounting the stage drops its video subscriptions while the class is on the board (a mobile-data win).
 */
export function CallMain({
  roomTitle,
  suppressRecording,
}: {
  roomTitle: string;
  suppressRecording: boolean;
}) {
  const { open } = useWhiteboard();
  return open ? (
    <WhiteboardPanel />
  ) : (
    <CallStage roomTitle={roomTitle} suppressRecording={suppressRecording} />
  );
}
