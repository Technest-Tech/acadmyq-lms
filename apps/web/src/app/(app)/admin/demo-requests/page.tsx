import { DemoRequestsScreen } from "./screen";

/**
 * Super Admin → demo requests: the inbox behind the public form on the marketing site. Platform
 * scoped (`platform.manage`), and the `demo_requests` RLS policies re-assert SUPER_ADMIN on the
 * database side, so a missing capability returns nothing rather than someone else's prospects.
 */
export default function AdminDemoRequestsPage() {
  return <DemoRequestsScreen />;
}
