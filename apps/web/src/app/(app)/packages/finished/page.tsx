import { Suspense } from "react";
import { PackagesScreen } from "../screen";

/**
 * Finished packages — blocks that ran out or were closed, with the ones still to follow up first.
 * Its own sidebar item, carrying the red badge; `/packages` is the open half of the same screen.
 *
 * Suspense for the same reason as `/packages`: the screen reads its search params.
 */
export default function FinishedPackagesPage() {
  return (
    <Suspense>
      <PackagesScreen view="finished" />
    </Suspense>
  );
}
