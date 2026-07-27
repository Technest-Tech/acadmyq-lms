import { CourseEditor } from "@/components/courses/course-editor";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CourseEditorPage({ params }: PageProps) {
  const { id } = await params;
  return <CourseEditor courseId={id} />;
}
