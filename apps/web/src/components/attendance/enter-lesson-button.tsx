"use client";

import type { SessionStatus } from "@academiq/contracts";
import { Video } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { enterSession } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * How many minutes before the start the Enter button opens. Mirrors the API's
 * SessionJoinController::OPENS_MINUTES_BEFORE_START, which refuses a press outside the window.
 */
export const JOIN_OPENS_MINUTES_BEFORE = 10;

/** A lesson that is not going to happen has no room to enter. */
const CLOSED = new Set<SessionStatus>([
  "CANCELLED_BY_TEACHER",
  "CANCELLED_BY_STUDENT",
  "RESCHEDULED",
]);

export type EnterState = "closed" | "early" | "open" | "ended";

interface LessonTiming {
  scheduled_at_utc: string;
  duration_minutes: number;
  status: SessionStatus;
}

/** Where a lesson stands against its Enter window at `now` (epoch ms). */
export function enterState(lesson: LessonTiming, now: number): EnterState {
  if (CLOSED.has(lesson.status)) return "closed";
  const start = new Date(lesson.scheduled_at_utc).getTime();
  const opens = start - JOIN_OPENS_MINUTES_BEFORE * 60_000;
  const ends = start + lesson.duration_minutes * 60_000;
  if (now < opens) return "early";
  if (now > ends) return "ended";
  return "open";
}

/**
 * The current time, re-read every `intervalMs` — so a row's Enter button lights up by itself when
 * the lesson opens, without anyone reloading the page.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * The teacher's Enter button on a lesson. Greyed out (showing when it opens) until
 * {@link JOIN_OPENS_MINUTES_BEFORE} minutes before the start, live until the lesson ends, gone after.
 *
 * It is a real link to the teacher's room, opened by the click itself — a popup blocker never
 * stands between the teacher and their class — and the same click tells the API, which stamps the
 * press with its own clock for the punctuality statistics. Recording is best-effort: a failed
 * record must never keep a teacher out of a lesson.
 */
export function EnterLessonButton({
  lesson,
  meetingUrl,
  now,
  onEntered,
  earlyHorizonMinutes,
  className,
}: {
  lesson: LessonTiming & { id: string };
  meetingUrl: string | null | undefined;
  now: number;
  onEntered?: (joinedAt: string) => void;
  /**
   * Hide the greyed-out state for lessons that open further ahead than this. A week or month of
   * rows each saying "Opens 09:50" is noise; the dashboard's one-day list leaves it unset.
   */
  earlyHorizonMinutes?: number;
  className?: string;
}) {
  const t = useTranslations("attendance.enter");
  const locale = useLocale();
  const state = enterState(lesson, now);

  if (state === "closed" || state === "ended") return null;
  if (
    state === "early" &&
    earlyHorizonMinutes !== undefined &&
    new Date(lesson.scheduled_at_utc).getTime() - JOIN_OPENS_MINUTES_BEFORE * 60_000 - now >
      earlyHorizonMinutes * 60_000
  ) {
    return null;
  }

  if (!meetingUrl) {
    return (
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled
        title={t("noLink")}
        data-testid="row-enter-no-link"
        className={cn("gap-1.5", className)}
      >
        <Video className="size-3.5" aria-hidden />
        {t("action")}
      </Button>
    );
  }

  if (state === "early") {
    const opensAt = new Date(
      new Date(lesson.scheduled_at_utc).getTime() - JOIN_OPENS_MINUTES_BEFORE * 60_000,
    );
    const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(opensAt);
    return (
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled
        title={t("hint", { minutes: JOIN_OPENS_MINUTES_BEFORE })}
        data-testid="row-enter-early"
        className={cn("gap-1.5", className)}
      >
        <Video className="size-3.5" aria-hidden />
        {t("opensAt", { time })}
      </Button>
    );
  }

  return (
    <a
      href={meetingUrl}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="row-enter"
      title={t("liveHint")}
      className={cn(
        buttonVariants({ size: "xs" }),
        "gap-1.5 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700",
        className,
      )}
      onClick={(e) => {
        // Rows open the lesson on click; entering the room must not also do that.
        e.stopPropagation();
        void enterSession(lesson.id)
          .then((res) => onEntered?.(res.first_joined_at))
          .catch(() => {});
      }}
    >
      <span className="relative flex size-1.5" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
        <span className="relative inline-flex size-1.5 rounded-full bg-white" />
      </span>
      {t("action")}
    </a>
  );
}

/** "Entered 16:02" — when the lesson's teacher first pressed Enter, for anyone reading the row. */
export function TeacherEnteredChip({
  at,
  timeFmt,
}: {
  at: string;
  timeFmt: Intl.DateTimeFormat;
}) {
  const t = useTranslations("attendance.enter");
  return (
    <span
      data-testid="teacher-entered"
      title={t("enteredHint")}
      className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    >
      <Video className="size-2.5" aria-hidden />
      {t("entered", { time: timeFmt.format(new Date(at)) })}
    </span>
  );
}
