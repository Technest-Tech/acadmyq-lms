import { PayrollScreen } from "./screen";

/**
 * Payroll route (Sprint 8). Same authenticated shell as the rest of the app. The screen
 * renders the owner view (all teachers' payouts + profit summary + finalize) when the session
 * grants payout.read, and the teacher self-view (own statements only) when it grants
 * payout.read_own — the API enforces both for real with Gate::authorize on every endpoint.
 */
export default function PayrollPage() {
  return <PayrollScreen />;
}
