import { NotificationsScreen } from "./screen";

/**
 * Notifications route. Two tabs — cancellation approvals ("Classes") and overdue-report
 * alerts ("Reports") — rendered role-aware for both owners and teachers. Gated client-side
 * by notification.read; every endpoint enforces it for real with Gate::authorize.
 */
export default function NotificationsPage() {
  return <NotificationsScreen />;
}
