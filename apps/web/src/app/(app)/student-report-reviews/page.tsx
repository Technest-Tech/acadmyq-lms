import { StudentReportReviewsScreen } from "./screen";

/**
 * Student Report Reviews route (admin-facing). The owner/support reviews the monthly progress
 * reports teachers submit — approving or rejecting each one. Gated client-side by
 * student_report.review; every endpoint enforces it for real with Gate::authorize.
 */
export default function StudentReportReviewsPage() {
  return <StudentReportReviewsScreen />;
}
