import { StudentReportsScreen } from "./screen";

/**
 * Student Reports route (teacher-facing). A teacher picks one of their students, writes a
 * monthly progress report, and submits it for the admin to review on the Notifications page.
 * Gated client-side by student_report.submit; every endpoint enforces it with Gate::authorize.
 */
export default function StudentReportsPage() {
  return <StudentReportsScreen />;
}
