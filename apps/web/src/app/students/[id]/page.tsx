import { StudentProfileScreen } from "@/app/students/[id]/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

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

  return (
    <AuthProvider>
      <AppShell>
        <StudentProfileScreen studentId={id} />
      </AppShell>
    </AuthProvider>
  );
}
