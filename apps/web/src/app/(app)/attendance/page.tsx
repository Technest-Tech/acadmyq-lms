import { AttendanceScreen } from "./screen";

/**
 * The Attendance route (Sprint 6). Same authenticated shell as the rest of the app; the screen is
 * permission-gated client-side (session.read) and the API enforces capability + teacher scoping.
 */
export default function AttendancePage() {
  return <AttendanceScreen />;
}
