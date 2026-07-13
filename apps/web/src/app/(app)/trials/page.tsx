import { TrialsScreen } from "./screen";

/**
 * Free Trials route (Free-Trials module). Same authenticated shell as the rest of the app;
 * the screen is permission-gated client-side (trial.read) and the API enforces it for real
 * with a Gate::authorize on every endpoint. Owner-only.
 */
export default function TrialsPage() {
  return <TrialsScreen />;
}
