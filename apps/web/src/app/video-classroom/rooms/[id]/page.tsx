import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { RoomLogsScreen } from "./screen";

/**
 * Per-room access-log route (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING §15). A dedicated page
 * showing who accessed the room, when, for how long, plus every audited action — all timestamped.
 * Permission-gated client-side (room.read) and plan-gated server-side (entitled:video.conferencing).
 */
export default function RoomLogsPage({ params }: { params: { id: string } }) {
  return (
    <AuthProvider>
      <AppShell>
        <RoomLogsScreen roomId={params.id} />
      </AppShell>
    </AuthProvider>
  );
}
