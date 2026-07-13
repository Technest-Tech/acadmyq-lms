import type { Metadata } from "next";
import { CallExperience } from "@/components/video-call/call-experience";

/**
 * Public shareable room link — `/r/{join_token}` (docs/video-platform/06-WEB-CALL-CLIENT). A
 * full-screen, chrome-free call surface: no academy panel, no AppShell. Both a logged-in teacher
 * (→ host) and an anonymous student (→ guest) open the same link to join the live call from the
 * browser. The join token is a shareable secret, so the page is never indexed.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nosnippet: true },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function RoomJoinPage({ params }: PageProps) {
  const { token } = await params;

  return <CallExperience token={token} />;
}
