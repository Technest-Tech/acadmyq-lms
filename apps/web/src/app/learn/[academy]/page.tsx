"use client";

import { BookOpen, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { learnCatalog, type LearnCourseCard } from "@/lib/learn-api";
import { useLearn } from "./learn-provider";

export default function CatalogPage() {
  const t = useTranslations("learn");
  const { academy, isEnrolled } = useLearn();
  const [courses, setCourses] = useState<LearnCourseCard[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    learnCatalog(academy)
      .then((r) => setCourses(r.courses))
      .catch(() => setError(true));
  }, [academy]);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("catalog.title")}</h1>
        <p className="text-muted-foreground">{t("catalog.subtitle")}</p>
      </div>

      {error ? (
        <p className="text-muted-foreground py-16 text-center text-sm">{t("errors.generic")}</p>
      ) : courses === null ? (
        <p className="text-muted-foreground py-16 text-center text-sm">…</p>
      ) : courses.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed py-16 text-center text-sm">
          {t("catalog.empty")}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <Link
              key={c.id}
              href={`/learn/${academy}/c/${c.slug}`}
              className="group hover:border-primary/40 flex flex-col overflow-hidden rounded-xl border transition-colors"
            >
              <div className="bg-muted flex aspect-video items-center justify-center">
                {c.cover_image_path ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.cover_image_path} alt={c.title} className="h-full w-full object-cover" />
                ) : (
                  <BookOpen className="size-10 opacity-30" />
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-tight">{c.title}</h3>
                  {isEnrolled(c.id) && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />}
                </div>
                {c.subtitle && <p className="text-muted-foreground text-sm">{c.subtitle}</p>}
                <p className="text-muted-foreground mt-auto pt-2 text-xs">
                  {t("catalog.lessons", { count: c.lesson_count })}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
