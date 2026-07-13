import { AdminVideoAcademyScreen } from "./screen";

/**
 * Super Admin per-academy video oversight (Tier 2, monitoring-only since R4): usage stats, the
 * room list, and per-room access logs — subscription/tier/trial controls live on the client page.
 * Gated client-side (platform.manage) and server-side (the SECURITY DEFINER readers re-assert SUPER_ADMIN).
 */
export default async function AdminVideoAcademyPage({
  params,
}: {
  params: Promise<{ academyId: string }>;
}) {
  const { academyId } = await params;

  return <AdminVideoAcademyScreen academyId={academyId} />;
}
