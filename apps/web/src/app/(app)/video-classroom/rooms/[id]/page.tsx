import { RoomLogsScreen } from "./screen";

/**
 * Per-room access-log route (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING §15). A dedicated page
 * showing who accessed the room, when, for how long, plus every audited action — all timestamped.
 * Permission-gated client-side (room.read) and plan-gated server-side (entitled:video.conferencing).
 */
export default async function RoomLogsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <RoomLogsScreen roomId={id} />;
}
