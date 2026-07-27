import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

/** Moved into the /lms workspace (docs/lms). */
export default async function CourseEditorPage({ params }: PageProps) {
  const { id } = await params;
  redirect(`/lms/courses/${id}`);
}
