import { redirect } from "next/navigation";

/** Group collections moved into a tab (docs/groups/01-ACCOUNTING.md); the old address still lands there. */
export default function Page() {
  redirect("/accounting/reports?tab=groups");
}
