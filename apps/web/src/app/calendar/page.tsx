import { CalendarScreen } from "@/app/calendar/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

/**
 * The Calendar route (Sprint 5). Same authenticated shell as the rest of the app; the screen is
 * permission-gated client-side (session.read) and the API enforces it — a Teacher only ever
 * sees their own sessions.
 */
export default function CalendarPage() {
  return (
    <AuthProvider>
      <AppShell>
        <CalendarScreen />
      </AppShell>
    </AuthProvider>
  );
}
