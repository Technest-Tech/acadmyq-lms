"use client";

import { CallStage } from "./call-stage";
import { WhiteboardPanel } from "./whiteboard-panel";
import { useWhiteboard } from "./whiteboard-context";

/**
 * The main flex area of the call: the video stage normally, or the shared whiteboard when the host
 * opens it. (While the desktop teacher screen-shares, InCall renders the floating presenter panel
 * instead of this.) Swapping rather than overlaying keeps the layout responsive on any phone, and
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
