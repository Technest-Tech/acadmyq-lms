import { Suspense } from "react";
import { SubscriptionsScreen } from "./screen";

/**
 * The centre's subscriptions route (docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md). One page,
 * four views (`?view=open|due|finished|outside`), each its own sidebar row. Behind `entitled:centre`
 * on the server; the screen is permission-gated client-side (package.read) the way the packages
 * screen is, since the two share their permission codes.
 *
 * Suspense because the screen reads its search params — `?view=`, and `?open=<studentId>`, the deep
 * link a student's profile uses to open the sell form with that student chosen.
 */
export default function SubscriptionsPage() {
  return (
    <Suspense>
      <SubscriptionsScreen />
    </Suspense>
  );
}
