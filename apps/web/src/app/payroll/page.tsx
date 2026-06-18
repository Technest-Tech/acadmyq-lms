import { PayrollScreen } from "@/app/payroll/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

/**
 * Payroll route (Sprint 8). Same authenticated shell as the rest of the app. The screen
 * renders the owner view (all teachers' payouts + profit summary + finalize) when the session
 * grants payout.read, and the teacher self-view (own statements only) when it grants
 * payout.read_own — the API enforces both for real with Gate::authorize on every endpoint.
 */
export default function PayrollPage() {
  return (
    <AuthProvider>
      <AppShell>
        <PayrollScreen />
      </AppShell>
    </AuthProvider>
  );
}
