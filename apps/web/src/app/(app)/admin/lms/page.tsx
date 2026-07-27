import { AdminLmsScreen } from "./screen";

/**
 * Super Admin LMS oversight (docs/lms): the course-platform client roster with catalogue, learner
 * and storage usage against each client's caps, plus the platform-wide LMS activity feed. Gated
 * client-side (platform.manage) and server-side (the SECURITY DEFINER readers re-assert SUPER_ADMIN).
 */
export default function AdminLmsPage() {
  return <AdminLmsScreen />;
}
