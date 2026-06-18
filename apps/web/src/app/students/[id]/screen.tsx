"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { StudentProfile } from "@/components/students/student-profile";

/**
 * Client gate for the student profile screen: rendered only when the session grants
 * `student.read`. Teachers are redirected back to the students list — they have a
 * limited sessions-only view accessible from that page instead.
 */
export function StudentProfileScreen({ studentId }: { studentId: string }) {
  const t = useTranslations("students");
  const { can, session } = useAuth();

  if (!can("student.read")) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }

  if (session?.role === "TEACHER") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <p className="text-sm text-muted-foreground">{t("profile.notFound")}</p>
        <Link
          href="/students"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("profile.back")}
        </Link>
      </div>
    );
  }

  return <StudentProfile studentId={studentId} />;
}
