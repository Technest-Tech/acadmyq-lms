import { TeacherDetailScreen } from "@/app/teachers/[id]/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

/** The dedicated teacher workspace route — profile, calendar, salary & reports. */
export default function TeacherDetailRoute() {
  return (
    <AuthProvider>
      <AppShell>
        <TeacherDetailScreen />
      </AppShell>
    </AuthProvider>
  );
}
