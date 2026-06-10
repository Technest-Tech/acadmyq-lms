import { StudentsScreen } from "@/app/students/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

/**
 * The Students route (Sprint 4). Same authenticated shell as the rest of the app; the screen
 * is permission-gated client-side (student.read) and the API enforces it for real.
 */
export default function StudentsPage() {
  return (
    <AuthProvider>
      <AppShell>
        <StudentsScreen />
      </AppShell>
    </AuthProvider>
  );
}
