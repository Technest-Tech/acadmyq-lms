import { TeacherWorkspaceSkeleton } from "@/components/teachers/teacher-workspace";

/**
 * Shown the instant a teacher row is clicked, while Next fetches this segment — without it the
 * list simply froze for as long as the navigation took, with nothing on screen to say why.
 */
export default function TeacherWorkspaceLoading() {
  return <TeacherWorkspaceSkeleton />;
}
