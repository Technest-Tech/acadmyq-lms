import { redirect } from "next/navigation";

/**
 * Finished packages was dropped (Ahmed 2026-11-22): what a finished package still owes is on Due,
 * and what was paid is on Due's Paid tab. A student still taught after their block ran out shows
 * on Open packages. Old links and bookmarks land on Due.
 */
export default function FinishedPackagesPage() {
  redirect("/packages/due");
}
