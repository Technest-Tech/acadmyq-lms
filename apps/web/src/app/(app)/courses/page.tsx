import { redirect } from "next/navigation";

/** The course platform moved to its own /lms workspace (docs/lms). Keep old links working. */
export default function CoursesPage() {
  redirect("/lms/courses");
}
