import { StudentProfileScreen } from "./screen";

/**
 * The student profile route. Same authenticated shell as the rest of the app; the screen is
 * permission-gated client-side (student.read) and the API enforces it for real. A Teacher's
 * access is additionally row-scoped to their own students server-side.
 */
export default async function StudentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <StudentProfileScreen studentId={id} />;
}
