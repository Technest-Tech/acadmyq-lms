import { redirect } from "next/navigation";

/**
 * /admin/plans (module default prices) retired: Billing, subscriptions and the finance book became ONE section on 2026-11-08 — Super Admin →
 * Accounts. The redirect keeps old links and bookmarks working.
 */
export default function RetiredPage() {
  redirect("/admin/accounts/settings");
}
