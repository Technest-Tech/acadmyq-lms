import { redirect } from "next/navigation";

/**
 * /admin/roles retired (R3, docs/superadmin-modules/04-CLIENT-FIRST-REDESIGN §3): the role
 * permissions matrix lives in Platform Settings → Roles now. Redirect keeps old links working.
 */
export default function RoleEditorPage() {
  redirect("/admin/settings");
}
