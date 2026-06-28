import type { Metadata } from "next";
import { CallExperience } from "@/components/video-call/call-experience";

/**
 * Readable per-academy guest link — `/r/{academy}/{room}` (docs/video-platform/08-ROOM-ACCESS §3).
 * The short, memorable slug form of the guest link (the token form lives at `/r/{token}`). Same
 * chrome-free call surface; resolved server-side from the academy subdomain + room slug. Never indexed.
 *
 * NOTE: the first segment is declared as `[token]` (NOT `[academy]`) on purpose — Next.js App Router
 * forbids two different slug names at the same dynamic position, and `/r/{token}` already owns `[token]`
 * here. We simply read it as the academy subdomain. (Renaming it back to `[academy]` reintroduces the
 * "different slug names for the same dynamic path" build error that crashes the dev server.)
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nosnippet: true },
};

interface PageProps {
  params: { token: string; room: string };
}

export default function RoomSlugJoinPage({ params }: PageProps) {
  return <CallExperience academy={params.token} room={params.room} />;
}
