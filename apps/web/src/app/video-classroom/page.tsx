import { VideoClassroomScreen } from "@/app/video-classroom/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

/**
 * Video Classroom route (docs/video-platform, Phase 2). The management surface for the
 * self-hosted LiveKit rooms + recordings — the live call itself runs in the Flutter client.
 * Permission-gated client-side (room.read) and plan-gated server-side (entitled:video.conferencing).
 */
export default function VideoClassroomPage() {
  return (
    <AuthProvider>
      <AppShell>
        <VideoClassroomScreen />
      </AppShell>
    </AuthProvider>
  );
}
