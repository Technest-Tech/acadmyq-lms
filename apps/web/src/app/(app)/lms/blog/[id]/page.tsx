import { BlogPostEditor } from "@/components/courses/blog-post-editor";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BlogPostEditorPage({ params }: PageProps) {
  const { id } = await params;
  return <BlogPostEditor postId={id} />;
}
