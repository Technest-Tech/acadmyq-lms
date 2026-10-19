import { redirect } from "next/navigation";

/**
 * Roles moved into Team & permissions (/staff, second tab) — one page for the people who sign in
 * and the roles they sign in as. Redirect keeps old links and bookmarks working.
 */
export default function AcademyRolesPage() {
  redirect("/staff?tab=roles");
}
