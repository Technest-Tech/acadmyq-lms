import { redirect } from "next/navigation";

/**
 * /admin/staff-departments retired (R3, docs/superadmin-modules/04-CLIENT-FIRST-REDESIGN §3): the
 * catalog lives in Platform Settings → Staff departments now. Redirect keeps old links working.
 */
export default function StaffDepartmentsPage() {
  redirect("/admin/settings");
}
