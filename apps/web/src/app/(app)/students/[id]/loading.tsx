import { StudentProfileSkeleton } from "@/components/students/student-profile";

/**
 * Shown the instant a student row is clicked, while Next fetches this segment. Without it the
 * list simply froze for as long as the navigation took and the user had no signal that anything
 * was happening — the profile's own skeleton only appears once this segment has already loaded.
 */
export default function StudentProfileLoading() {
  return <StudentProfileSkeleton />;
}
