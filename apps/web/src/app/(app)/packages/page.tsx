import { PackagesScreen } from "./screen";

/**
 * Lesson Packages route (docs/lesson-packages) — the hour-based billing mode. Same authenticated
 * shell as the rest of the app; the screen is permission-gated client-side (package.read) and the
 * API enforces it for real with a Gate::authorize on every endpoint.
 */
export default function PackagesPage() {
  return <PackagesScreen />;
}
