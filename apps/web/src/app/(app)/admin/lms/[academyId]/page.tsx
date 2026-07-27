import { AdminLmsAcademyScreen } from "./screen";

/**
 * Super Admin per-client LMS page (docs/lms): the client's course-platform statistics plus the
 * LMS-only controls — capacity caps, the public site handle, course moderation and learner
 * blocking. Module subscription lifecycle stays on the client page (R4, one writer per fact).
 */
export default async function AdminLmsAcademyPage({
  params,
}: {
  params: Promise<{ academyId: string }>;
}) {
  const { academyId } = await params;

  return <AdminLmsAcademyScreen academyId={academyId} />;
}
