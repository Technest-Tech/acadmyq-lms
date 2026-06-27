import type { Metadata } from "next";
import { CallExperience } from "@/components/video-call/call-experience";

/**
 * Readable per-academy guest link — `/r/{academy}/{room}` (docs/video-platform/08-ROOM-ACCESS §3).
 * The short, memorable slug form of the guest link (the token form lives at `/r/{token}`). Same
 * chrome-free call surface; resolved server-side from the academy subdomain + room slug. Never indexed.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nosnippet: true },
};

interface PageProps {
  params: { academy: string; room: string };
}

export default function RoomSlugJoinPage({ params }: PageProps) {
  return <CallExperience academy={params.academy} room={params.room} />;
}
