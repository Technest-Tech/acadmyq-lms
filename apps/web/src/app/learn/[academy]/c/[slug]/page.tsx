"use client";

import { ChevronLeft, Lock, PlayCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { learnCourse, type LearnCourseDetail } from "@/lib/learn-api";
import { LessonContent } from "../../lesson-content";
import { useLearn } from "../../learn-provider";

export default function CourseDetailPage() {
  const t = useTranslations("learn");
  const { academy, isEnrolled, openRedeem } = useLearn();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [data, setData] = useState<LearnCourseDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [openPreview, setOpenPreview] = useState<string | null>(null);

  useEffect(() => {
    learnCourse(academy, slug)
      .then(setData)
      .catch(() => setNotFound(true));
  }, [academy, slug]);

  if (notFound) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground text-sm">{t("course.notFound")}</p>
        <Link href={`/learn/${academy}`}>
          <Button variant="outline" className="mt-4">
            <ChevronLeft /> {t("course.back")}
          </Button>
        </Link>
      </div>
    );
  }
  if (!data) return <p className="text-muted-foreground py-16 text-center text-sm">…</p>;

  const enrolled = isEnrolled(data.course.id);

  return (
    <div className="space-y-8">
      <Link
        href={`/learn/${academy}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" /> {t("course.back")}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <h1 className="text-2xl font-bold sm:text-3xl">{data.course.title}</h1>
          {data.course.subtitle && <p className="text-muted-foreground">{data.course.subtitle}</p>}
          {data.course.description && (
            <p className="whitespace-pre-wrap pt-2 text-sm leading-relaxed">{data.course.description}</p>
          )}
        </div>
        <div className="w-full shrink-0 sm:w-64">
          {enrolled ? (
            <Link href={`/learn/${academy}/watch/${slug}`}>
              <Button className="w-full">
                <PlayCircle /> {t("course.continue")}
              </Button>
            </Link>
          ) : (
            <Button className="w-full" onClick={openRedeem}>
              {t("course.enroll")}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="font-semibold">{t("course.curriculum")}</h2>
        {data.sections.map((section) => (
          <div key={section.id} className="rounded-xl border">
            <div className="border-b p-3 font-medium">{section.title}</div>
            <ul className="divide-y">
              {section.lessons.map((lesson) => {
                const playable = lesson.is_preview || enrolled;
                const canExpand = lesson.is_preview; // detail only ships preview content
                return (
                  <li key={lesson.id}>
                    <div className="flex items-center gap-3 p-3 text-sm">
                      {playable ? (
                        <PlayCircle className="text-primary size-4 shrink-0" />
                      ) : (
                        <Lock className="size-4 shrink-0 opacity-40" />
                      )}
                      <span className="flex-1">{lesson.title}</span>
                      {lesson.is_preview && (
                        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                          {t("course.preview")}
                        </span>
                      )}
                      {canExpand && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setOpenPreview((p) => (p === lesson.id ? null : lesson.id))}
                        >
                          {openPreview === lesson.id ? t("course.hide") : t("course.watch")}
                        </Button>
                      )}
                    </div>
                    {openPreview === lesson.id && (
                      <div className="p-3 pt-0">
                        <LessonContent lesson={lesson} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
