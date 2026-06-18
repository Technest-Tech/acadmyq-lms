import { NotificationsScreen } from "@/app/notifications/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

/**
 * Notifications route. Two tabs — cancellation approvals ("Classes") and overdue-report
 * alerts ("Reports") — rendered role-aware for both owners and teachers. Gated client-side
 * by notification.read; every endpoint enforces it for real with Gate::authorize.
 */
export default function NotificationsPage() {
  return (
    <AuthProvider>
      <AppShell>
        <NotificationsScreen />
      </AppShell>
    </AuthProvider>
  );
}
