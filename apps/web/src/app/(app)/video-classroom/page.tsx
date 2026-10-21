import { VideoClassroomScreen } from "./screen";

/**
 * Video Classroom route (archive/video-platform/docs, Phase 2). The management surface for the
 * self-hosted LiveKit rooms + recordings — the live call itself runs in the Flutter client.
 * Permission-gated client-side (room.read) and plan-gated server-side (entitled:video.conferencing).
 */
export default function VideoClassroomPage() {
  return <VideoClassroomScreen />;
}
