"use client";

import { ArrowRight, CheckCircle2, Layers, PlayCircle, Sparkles, Timer, Users } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useLearn } from "@/components/learn/context";
import {
  CourseThumb,
  Meta,
  Pill,
  ProgressBar,
  useFormatDuration,
} from "@/components/learn/course-bits";
import { useCoursePrice, useLevelLabel } from "@/components/learn/storefront";
import type { LearnCourseCard } from "@/lib/learn-api";
import { isRecent } from "@/lib/learn-format";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * How a course is advertised (docs/lms/09) — one card, used by the home page's featured strip, the
 * catalogue (grid AND list) and the sales page's "more courses" rail, so a course looks identical
 * everywhere and a client only ever tunes it in one place.
 *
 * Every fact on it is real: lesson count, runtime, free previews, enrolled students. Nothing is
 * invented — there is no rating on this platform, so the card never pretends there is one.
 */

/** The shared facts row — lessons, runtime, sections — beneath a course's title. */
function CourseMeta({ course, className }: { course: LearnCourseCard; className?: string }) {
  const t = useTranslations("learn");
  const duration = useFormatDuration()(course.duration_seconds);

  return (
    <div
      className={cn(
        "text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs",
        className,
      )}
    >
      <Meta icon={PlayCircle}>{t("catalog.lessons", { count: course.lesson_count })}</Meta>
      {duration && <Meta icon={Timer}>{duration}</Meta>}
      {(course.section_count ?? 0) > 1 && (
        <Meta icon={Layers}>{t("course.sections", { count: course.section_count ?? 0 })}</Meta>
      )}
    </div>
  );
}

/** The price headline, or the free badge. Shared so the two card shapes never drift apart. */
function CoursePrice({ course, className }: { course: LearnCourseCard; className?: string }) {
  const t = useTranslations("learn");
  const price = useCoursePrice();

  if (course.is_free) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 font-bold text-emerald-600",
          className ?? "text-base",
        )}
      >
        <Sparkles className="size-4" aria-hidden />
        {t("catalog.free")}
      </span>
    );
  }
  return (
    <span className={cn("font-bold tracking-tight tabular-nums", className ?? "text-base")}>
      {price(course)}
    </span>
  );
}

/**
 * Level and topic, when the client has set them. Two facts, no more: a card carrying six chips
 * stops being scannable, and everything here is real or absent — the catalogue never labels a
 * course "Beginner" because nobody said otherwise.
 */
function CourseTags({ course }: { course: LearnCourseCard }) {
  const levelLabel = useLevelLabel();
  const level = levelLabel(course.level);
  const category = course.category?.trim();
  if (!level && !category) return null;

  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {category && (
        <li
          dir="auto"
          className="text-primary rounded-full bg-[var(--brand-soft)] px-2.5 py-0.5 text-[11px] font-semibold"
        >
          {category}
        </li>
      )}
      {level && (
        <li className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
          {level}
        </li>
      )}
    </ul>
  );
}

/** Cover ribbons: brand-new, already unlocked, has free previews. */
function CourseRibbons({ course, enrolled }: { course: LearnCourseCard; enrolled: boolean }) {
  const t = useTranslations("learn");

  return (
    <>
      <span className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
        {isRecent(course.published_at) && !enrolled ? (
          <Pill className="bg-primary text-primary-foreground shadow-sm">{t("catalog.new")}</Pill>
        ) : (
          <span />
        )}
        {enrolled && (
          <Pill className="bg-background/95 text-primary shadow-sm backdrop-blur">
            <CheckCircle2 className="size-3.5" aria-hidden />
            {t("catalog.enrolled")}
          </Pill>
        )}
      </span>

      {(course.preview_count ?? 0) > 0 && !enrolled && (
        <span className="absolute bottom-3 start-3">
          <Pill className="bg-background/95 text-foreground shadow-sm backdrop-blur">
            <PlayCircle className="text-primary size-3.5" aria-hidden />
            {t("course.previewCount", { count: course.preview_count ?? 0 })}
          </Pill>
        </span>
      )}
    </>
  );
}

export function CourseCard({
  course,
  /** 0–100 when the caller knows how far the learner got (my learning); omitted elsewhere. */
  progress,
}: {
  course: LearnCourseCard;
  progress?: number;
}) {
  const t = useTranslations("learn");
  const { academy, isEnrolled } = useLearn();
  const enrolled = isEnrolled(course.id);
  const href = enrolled
    ? `/learn/${academy}/watch/${course.slug}`
    : `/learn/${academy}/c/${course.slug}`;

  return (
    <Link
      href={href}
      className="group bg-card hover:border-primary/40 focus-visible:ring-ring/60 focus-visible:ring-offset-background flex flex-col overflow-hidden rounded-2xl border transition-[transform,border-color,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none motion-safe:hover:-translate-y-1 hover:shadow-lg"
    >
      {/* 16:9, cropped to fill, for every course. One ratio is what makes a row of cards line up
          whatever shape the client uploaded, and `object-cover` beats letterboxing here because a
          course cover is artwork, not a diagram. */}
      <CourseThumb
        src={course.cover_image_path}
        alt={t("catalog.coverAlt", { title: course.title })}
        className="aspect-video shrink-0 [&>img]:transition-transform [&>img]:duration-500 motion-safe:group-hover:[&>img]:scale-[1.06]"
        iconClassName="size-10"
      >
        <CourseRibbons course={course} enrolled={enrolled} />
      </CourseThumb>

      <div className="flex flex-1 flex-col gap-2.5 p-5">
        <CourseTags course={course} />
        {/* `break-words` is load-bearing: an Arabic title with an unbroken Latin product name in it
            ("مشروع Template Four — Sidebar") overflows the card without it. */}
        {/* `dir="auto"` on every piece of the client's own text. The paragraph direction here
            is the VISITOR's language, but a course title is the academy's — an Arabic title on a
            page a visitor is reading in English otherwise reorders its Latin words. */}
        <h3
          dir="auto"
          className="group-hover:text-primary line-clamp-2 leading-snug font-semibold break-words transition-colors"
        >
          {course.title}
        </h3>
        {course.subtitle && (
          <p
            dir="auto"
            className="text-muted-foreground line-clamp-2 text-sm leading-relaxed break-words"
          >
            {course.subtitle}
          </p>
        )}

        <CourseMeta course={course} className="pt-0.5" />

        {(course.learner_count ?? 0) >= 5 && (
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
            <Users className="size-3.5 opacity-70" aria-hidden />
            {t("catalog.students", { count: course.learner_count ?? 0 })}
          </span>
        )}

        <div className="mt-auto space-y-3 pt-3">
          {progress !== undefined && (
            <div className="space-y-1.5">
              <ProgressBar value={progress} />
              <p className="text-muted-foreground text-xs tabular-nums">
                {t("me.percentComplete", { pct: Math.round(progress) })}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            {enrolled ? (
              <span className="text-primary inline-flex items-center gap-1.5 text-sm font-semibold">
                <CheckCircle2 className="size-4" aria-hidden />
                {t("catalog.enrolled")}
              </span>
            ) : (
              <CoursePrice course={course} className="text-lg" />
            )}
            <span className="text-primary inline-flex items-center gap-1 text-xs font-semibold">
              {enrolled ? t("course.continue") : t("catalog.view")}
              <ArrowRight
                className="size-3.5 transition-transform group-hover:translate-x-0.5 rtl:rotate-180"
                aria-hidden
              />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

/**
 * The catalogue's list shape — the same facts, laid out wide. Scanning twenty courses by title is
 * faster in a list than in a grid, which is exactly why every marketplace offers both.
 */
export function CourseRow({ course }: { course: LearnCourseCard }) {
  const t = useTranslations("learn");
  const locale = useLocale();
  const { academy, isEnrolled } = useLearn();
  const enrolled = isEnrolled(course.id);
  const href = enrolled
    ? `/learn/${academy}/watch/${course.slug}`
    : `/learn/${academy}/c/${course.slug}`;

  return (
    <Link
      href={href}
      className="group bg-card hover:border-primary/40 focus-visible:ring-ring/60 focus-visible:ring-offset-background flex gap-4 rounded-2xl border p-4 transition-[border-color,box-shadow] hover:shadow-md focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:gap-5 sm:p-5"
    >
      <CourseThumb
        src={course.cover_image_path}
        alt={t("catalog.coverAlt", { title: course.title })}
        className="aspect-video w-28 shrink-0 rounded-xl sm:w-44"
        iconClassName="size-7"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <CourseTags course={course} />
        <div className="flex items-start gap-2">
          <h3
            dir="auto"
            className="group-hover:text-primary line-clamp-2 min-w-0 flex-1 leading-snug font-semibold break-words transition-colors"
          >
            {course.title}
          </h3>
          {enrolled && (
            <Pill className="text-primary hidden shrink-0 bg-[var(--brand-soft)] sm:inline-flex">
              <CheckCircle2 className="size-3.5" aria-hidden />
              {t("catalog.enrolled")}
            </Pill>
          )}
        </div>

        {course.subtitle && (
          <p
            dir="auto"
            className="text-muted-foreground line-clamp-2 text-sm leading-relaxed break-words"
          >
            {course.subtitle}
          </p>
        )}

        <CourseMeta course={course} className="mt-auto pt-1.5" />

        <div className="flex items-center gap-3 pt-1 sm:hidden">
          <CoursePrice course={course} className="text-sm" />
        </div>
      </div>

      <div className="hidden shrink-0 flex-col items-end justify-between gap-3 sm:flex">
        <CoursePrice course={course} className="text-lg" />
        {(course.learner_count ?? 0) >= 5 && (
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
            <Users className="size-3.5 opacity-70" aria-hidden />
            {formatNumber(course.learner_count ?? 0, locale)}
          </span>
        )}
        <span className="border-border group-hover:border-primary/60 group-hover:text-primary inline-flex h-9 items-center gap-1.5 rounded-xl border px-3.5 text-xs font-semibold transition-colors">
          {enrolled ? t("course.continue") : t("catalog.view")}
          <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
        </span>
      </div>
    </Link>
  );
}

export function CourseGrid({
  courses,
  className,
}: {
  courses: LearnCourseCard[];
  className?: string;
}) {
  return (
    <div className={cn("grid gap-5 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {courses.map((course) => (
        <CourseCard key={course.id} course={course} />
      ))}
    </div>
  );
}

export function CourseList({
  courses,
  className,
}: {
  courses: LearnCourseCard[];
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)}>
      {courses.map((course) => (
        <CourseRow key={course.id} course={course} />
      ))}
    </div>
  );
}

/**
 * The card skeleton. Its box matches the real card's — same ratio, same padding, same row heights —
 * so when the catalogue lands the content appears INSIDE the shape rather than resizing it. The
 * shimmer is brand-tinted rather than grey, and holds still for anyone who asked for less motion.
 */
export function CourseGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bg-card overflow-hidden rounded-2xl border">
          <div className="aspect-video bg-[var(--brand-soft)] motion-safe:animate-pulse" />
          <div className="space-y-2.5 p-5">
            <SkeletonBar className="h-4 w-3/4" />
            <SkeletonBar className="h-4 w-1/2" />
            <SkeletonBar className="h-3 w-full" />
            <SkeletonBar className="h-3 w-1/3" />
            <div className="flex items-center justify-between pt-6">
              <SkeletonBar className="h-5 w-20" />
              <SkeletonBar className="h-3 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonBar({ className }: { className?: string }) {
  return (
    <div className={cn("bg-muted rounded motion-safe:animate-pulse", className)} />
  );
}

export function CourseListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-4" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="bg-card flex gap-4 rounded-2xl border p-4 sm:gap-5 sm:p-5"
        >
          <div className="aspect-video w-28 shrink-0 rounded-xl bg-[var(--brand-soft)] motion-safe:animate-pulse sm:w-44" />
          <div className="flex-1 space-y-2.5 py-1">
            <SkeletonBar className="h-4 w-2/3" />
            <SkeletonBar className="h-3 w-full" />
            <SkeletonBar className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
