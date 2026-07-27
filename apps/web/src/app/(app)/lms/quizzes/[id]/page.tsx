import { QuizResultsScreen } from "@/components/courses/quiz-results";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LmsQuizResultsPage({ params }: PageProps) {
  const { id } = await params;
  return <QuizResultsScreen quizId={id} />;
}
