import { StudentReportReviewsScreen } from "@/app/student-report-reviews/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

/**
 * Student Report Reviews route (admin-facing). The owner/support reviews the monthly progress
 * reports teachers submit — approving or rejecting each one. Gated client-side by
 * student_report.review; every endpoint enforces it for real with Gate::authorize.
 */
export default function StudentReportReviewsPage() {
  return (
    <AuthProvider>
      <AppShell>
        <StudentReportReviewsScreen />
      </AppShell>
    </AuthProvider>
  );
}
