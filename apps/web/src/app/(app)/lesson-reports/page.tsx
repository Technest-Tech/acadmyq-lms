import { LessonReportsScreen } from "./screen";

/**
 * سجل التقارير — every private lesson's report, for the teacher who wrote them and for the office.
 * Gated client-side by session.read; GET /api/session-reports enforces it and scopes a teacher.
 */
export default function LessonReportsPage() {
  return <LessonReportsScreen />;
}
