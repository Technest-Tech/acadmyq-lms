"use client";

import { BookOpen, PlayCircle } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { learnCatalog, type LearnCourseCard } from "@/lib/learn-api";
import { useLearn } from "../learn-provider";

export default function MePage() {
  const t = useTranslations("learn");
  const { academy, learner, enrolled, loading, isEnrolled, requireAuth } = useLearn();
  const [courses, setCourses] = useState<LearnCourseCard[] | null>(null);

  useEffect(() => {
    if (learner) learnCatalog(academy).then((r) => setCourses(r.courses)).catch(() => setCourses([]));
  }, [academy, learner]);

  if (loading) return <p className="text-muted-foreground py-16 text-center text-sm">…</p>;

  if (!learner) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <p className="text-muted-foreground text-sm">{t("me.signInNeeded")}</p>
        <Button onClick={() => requireAuth()}>{t("auth.signIn")}</Button>
      </div>
    );
  }

  const myCourses = (courses ?? []).filter((c) => isEnrolled(c.id));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("me.title", { name: learner.full_name })}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{learner.email}</p>
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold">{t("me.myCourses")}</h2>
        {courses === null ? (
          <p className="text-muted-foreground text-sm">…</p>
        ) : enrolled.size === 0 ? (
          <div className="text-muted-foreground rounded-xl border border-dashed py-12 text-center text-sm">
            {t("me.none")}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {myCourses.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl border p-3">
                <span className="bg-muted flex size-12 shrink-0 items-center justify-center rounded-lg">
                  <BookOpen className="size-5 opacity-60" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.title}</p>
                  <p className="text-muted-foreground text-xs">{t("catalog.lessons", { count: c.lesson_count })}</p>
                </div>
                <Link href={`/learn/${academy}/watch/${c.slug}`}>
                  <Button size="sm" variant="outline">
                    <PlayCircle /> {t("course.continue")}
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
