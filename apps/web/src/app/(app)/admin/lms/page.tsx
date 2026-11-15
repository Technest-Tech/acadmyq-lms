import { redirect } from "next/navigation";

/**
 * /admin/lms retired (2026-11-15): the course platform is a module a CLIENT holds, so its numbers
 * and controls live on that client's page (the "Course platform" tab) and the roster is the
 * clients roster. The redirect keeps old links and bookmarks working.
 */
export default function RetiredPage() {
  redirect("/admin/clients");
}
