import { redirect } from "next/navigation";

/**
 * /admin/lms/{id} retired (2026-11-15): a client's course-platform numbers, caps and moderation
 * are the "Course platform" tab of its client page. The redirect keeps old links working.
 */
export default async function RetiredPage({
  params,
}: {
  params: Promise<{ academyId: string }>;
}) {
  const { academyId } = await params;
  redirect(`/admin/clients/${academyId}?tab=lms`);
}
