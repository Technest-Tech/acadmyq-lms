import { AdminSupportScreen } from "./screen";

/**
 * Super Admin → Client requests: every client's problems and change requests in one inbox — review,
 * accept or decline, reply, or log work done for a client. Gated client-side (platform.manage) and
 * server-side (every /api/admin/support route).
 */
export default function AdminSupportPage() {
  return <AdminSupportScreen />;
}
