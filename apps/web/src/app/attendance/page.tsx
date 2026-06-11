import { AttendanceScreen } from "@/app/attendance/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

/**
 * The Attendance route (Sprint 6). Same authenticated shell as the rest of the app; the screen is
 * permission-gated client-side (session.read) and the API enforces capability + teacher scoping.
 */
export default function AttendancePage() {
  return (
    <AuthProvider>
      <AppShell>
        <AttendanceScreen />
      </AppShell>
    </AuthProvider>
  );
}
