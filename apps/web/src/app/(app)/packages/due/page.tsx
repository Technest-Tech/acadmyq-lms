import { Suspense } from "react";
import { PackagesScreen } from "../screen";

/**
 * Due packages — every block with money still owed on it, open or finished. The page the academy
 * opens every day: payment is up front, so a block that opened this morning and is not yet paid
 * belongs here, not on a "finished" list weeks later. Carries the red badge.
 *
 * Suspense for the same reason as `/packages`: the screen reads its search params.
 */
export default function DuePackagesPage() {
  return (
    <Suspense>
      <PackagesScreen view="due" />
    </Suspense>
  );
}
