import { Suspense } from "react";
import { PackagesScreen } from "./screen";

/**
 * Lesson Packages route (docs/lesson-packages) — the hour-based billing mode. Same authenticated
 * shell as the rest of the app; the screen is permission-gated client-side (package.read) and the
 * API enforces it for real with a Gate::authorize on every endpoint.
 *
 * Wrapped in Suspense because the screen reads `?open=<studentId>` — the deep link a student's
 * profile uses to bring the owner straight to the "open a package" form with that student chosen.
 */
export default function PackagesPage() {
  return (
    <Suspense>
      <PackagesScreen />
    </Suspense>
  );
}
