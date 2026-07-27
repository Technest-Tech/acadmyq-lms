// Shape-of-a-course arithmetic for the LMS learner site (docs/lms/09). The catalogue, the sales
// page, the player and "my learning" all describe the SAME course — how long it runs, how much of
// it is video, how far the learner got — so the counting lives here once instead of four times.
//
// Everything is pure and locale-agnostic; the words around the numbers come from next-intl in
// components/learn/course-bits.tsx.

import type { LearnLesson, LearnProgress, LearnSection } from "@/lib/learn-api";

/** Flattens the outline in reading order — the order the player advances through. */
export function lessonsOf(sections: LearnSection[]): LearnLesson[] {
  return sections.flatMap((s) => s.lessons);
}

export interface CourseStats {
  sections: number;
  lessons: number;
  /** Total runtime in seconds. 0 when no lesson carries a duration (authoring is optional). */
  duration: number;
  /** How many lessons the duration was summed from — 0 means "don't show a runtime at all". */
  timed: number;
  previews: number;
  videos: number;
  quizzes: number;
  readings: number;
  /** PDFs and other attachments — "downloadable resources" in the includes list. */
  downloads: number;
}

export function courseStats(sections: LearnSection[]): CourseStats {
  const lessons = lessonsOf(sections);
  const by = (test: (l: LearnLesson) => boolean) => lessons.filter(test).length;

  return {
    sections: sections.length,
    lessons: lessons.length,
    duration: sumDuration(lessons),
    timed: by((l) => (l.duration_seconds ?? 0) > 0),
    previews: by((l) => l.is_preview),
    videos: by((l) => l.type === "VIDEO_UPLOAD" || l.type === "YOUTUBE"),
    quizzes: by((l) => l.type === "QUIZ"),
    readings: by((l) => l.type === "TEXT"),
    downloads: by((l) => l.type === "PDF"),
  };
}

export function sumDuration(lessons: LearnLesson[]): number {
  return lessons.reduce((total, l) => total + (l.duration_seconds ?? 0), 0);
}

/** Seconds → whole hours / minutes / seconds, for a formatter to put words around. */
export function splitDuration(seconds: number): { h: number; m: number; s: number } {
  const total = Math.max(0, Math.round(seconds));
  return {
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

/** Ratio 0–1 of completed lessons, guarding the empty course (which is 0%, not NaN). */
export function completionRatio(done: number, total: number): number {
  return total > 0 ? Math.min(1, done / total) : 0;
}

export function completedCount(
  lessons: LearnLesson[],
  progress: Record<string, LearnProgress | undefined>,
): number {
  return lessons.filter((l) => progress[l.id]?.status === "COMPLETED").length;
}

/**
 * Where the learner should land when they press "continue": the first lesson they haven't finished,
 * falling back to the first lesson (a finished course reopens at the top rather than nowhere).
 */
export function resumeLesson(
  lessons: LearnLesson[],
  progress: Record<string, LearnProgress | undefined>,
): LearnLesson | undefined {
  return lessons.find((l) => progress[l.id]?.status !== "COMPLETED") ?? lessons[0];
}

/** "August 2026" — the "last updated" line every course marketplace carries. */
export function formatMonthYear(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date);
}

/** Published within the last 45 days — earns the catalogue's "New" ribbon. */
export function isRecent(iso: string | null | undefined, days = 45): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() < days * 86_400_000;
}
