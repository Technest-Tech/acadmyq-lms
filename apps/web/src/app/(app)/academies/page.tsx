import { redirect } from "next/navigation";

/**
 * /academies retired (R2, docs/superadmin-modules/04-CLIENT-FIRST-REDESIGN §3): the roster and the
 * in-place detail view moved to /admin/clients (+ real /admin/clients/[id] pages). This redirect
 * keeps old links/bookmarks working through the transition; R4 removes the leftover screens.
 */
export default function AcademiesPage() {
  redirect("/admin/clients");
}
