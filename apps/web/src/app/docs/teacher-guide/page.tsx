import type { Metadata } from "next";
import { TeacherGuide } from "@/components/docs/teacher-guide";

/**
 * Public, shareable teacher onboarding guide (docs-style).
 * Standalone page — intentionally NOT wrapped in AuthProvider/AppShell, so the
 * link can be opened by anyone without signing in.
 */
export const metadata: Metadata = {
  title: "دليل المعلّم — كيفية استخدام حسابك | Academiq",
  description:
    "دليل مفصّل وبسيط للمعلّم: من تسجيل الدخول إلى كل صفحة في لوحتك وكيفية استخدامها — الحضور، التقارير، الجدول، فصل الفيديو، والرواتب.",
  openGraph: {
    title: "دليل المعلّم — كيفية استخدام حسابك",
    description:
      "دليل مفصّل وبسيط للمعلّم يشرح كل شيء خطوة بخطوة، من تسجيل الدخول حتى إعطاء الحصص وكتابة التقارير.",
    type: "article",
    images: ["/logo.png"],
  },
};

export default function TeacherGuidePage() {
  return <TeacherGuide />;
}
