"use client";

import { CalendarClock, CalendarX2, ChevronDown, ChevronLeft, ChevronRight, GraduationCap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  addMonths,
  endUtc,
  isVoided,
  monthYearLabel,
  STATUS_CHIP,
  STATUS_RAIL,
  startOfMonth,
  timeInTz,
  todayInTz,
} from "@/components/scheduling/calendar/utils";
import { AlertBanner } from "@/components/ui/alert";
import {
  ApiError,
  type CalendarSession,
  getCalendar,
  getPackageLessons,
  type LessonPackageRow,
  listLessonPackages,
  type PackageLesson,
  type PackageLessonLog,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type Mode = { kind: "loading" } | { kind: "packages"; packages: LessonPackageRow[] } | { kind: "month" };

/**
 * The student profile's lesson log (EnglishSpirit, 2026-11-11): the current package with all its
 * lessons, no more and no less — each one numbered, with its day, time and status, like the
 * timetable's log on the schedules page. A block of 16 lists 16: what it counted, what is unmarked
 * since it started, the upcoming lessons it still pays for, and a line for the ones not on a date yet
 * (GET /packages/{id}/lessons). The lessons in its time it never counted sit apart, folded.
 *
 * Earlier packages are one pick away. A student with no package (monthly) gets the month instead.
 */
export function StudentLessonLog({ studentId }: { studentId: string }) {
  const t = useTranslations("students.lessonLog");
  const { can } = useAuth();
  const [mode, setMode] = useState<Mode>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    if (!can("package.read")) {
      setMode({ kind: "month" });
      return;
    }
    void listLessonPackages({ student_id: studentId })
      .then((res) => {
        if (!live) return;
        const packages = res.packages.filter((p) => p.status !== "CANCELLED");
        setMode(packages.length > 0 ? { kind: "packages", packages } : { kind: "month" });
      })
      // No packages module (402) or nothing to read: the month is still a lesson log.
      .catch(() => live && setMode({ kind: "month" }));
    return () => {
      live = false;
    };
  }, [studentId, can]);

  if (mode.kind === "loading") return <Spinner label={t("loading")} />;
  if (mode.kind === "month") return <MonthLog studentId={studentId} />;
  return <PackageLog packages={mode.packages} />;
}

function PackageLog({ packages }: { packages: LessonPackageRow[] }) {
  const t = useTranslations("students.lessonLog");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // The running block first (the list comes open-first, newest next).
  const [packageId, setPackageId] = useState(() => packages[0]!.id);
  const [log, setLog] = useState<PackageLessonLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const chosen = packages.find((p) => p.id === packageId) ?? packages[0]!;

  useEffect(() => {
    let live = true;
    setLog(null);
    setError(null);
    setShowOthers(false);
    void getPackageLessons(packageId)
      .then((res) => live && setLog(res))
      .catch((err) => live && setError(err instanceof ApiError ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [packageId]);

  const counts = useMemo(() => {
    const lessons = log?.lessons ?? [];
    return {
      counted: lessons.filter((l) => l.package_state === "COUNTED").length,
      unmarked: lessons.filter((l) => l.package_state === "UNMARKED").length,
      upcoming: lessons.filter((l) => l.package_state === "UPCOMING").length,
    };
  }, [log]);

  return (
    <div className="space-y-4" data-testid="student-lesson-log">
      {/* Which block, and how its lessons stand. */}
      <div className="bg-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border px-4 py-3 shadow-sm">
        {packages.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground text-xs">{t("pick")}</span>
            <select
              className="border-input bg-background rounded-lg border px-2.5 py-1.5 text-sm font-semibold"
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
              data-testid="lesson-log-package"
            >
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {packageName(p, t)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-sm font-semibold">{packageName(chosen, t)}</span>
        )}
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
            chosen.status === "ACTIVE"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "bg-muted text-muted-foreground",
          )}
        >
          {chosen.status === "ACTIVE" ? t("open") : t("finished")}
        </span>
        {log && (
          <div className="ms-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums">
            <span className="text-sm font-bold" data-testid="lesson-log-total">
              {t("total", { count: log.lessons_total })}
            </span>
            {counts.counted > 0 && <Count dot="bg-emerald-500" label={t("counted", { count: counts.counted })} />}
            {counts.unmarked > 0 && <Count dot="bg-amber-500" label={t("unmarkedCount", { count: counts.unmarked })} />}
            {counts.upcoming > 0 && <Count dot="bg-sky-500" label={t("upcomingCount", { count: counts.upcoming })} />}
            {log.unscheduled > 0 && <Count dot="bg-slate-300" label={t("unscheduledCount", { count: log.unscheduled })} />}
          </div>
        )}
      </div>

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {log === null ? (
        !error && <Spinner label={t("loading")} />
      ) : log.lessons.length === 0 && log.unscheduled === 0 ? (
        <Empty label={t("empty")} />
      ) : (
        <ol className="bg-card divide-y overflow-hidden rounded-2xl border shadow-sm" data-testid="lesson-log-list">
          {log.lessons.map((lesson, i) => (
            <LessonRow key={lesson.id} lesson={lesson} n={i + 1} tz={tz} />
          ))}
          {log.unscheduled > 0 && (
            <li
              className="text-muted-foreground flex items-center gap-3 border-dashed px-3 py-3 text-sm sm:px-4"
              data-testid="lesson-log-unscheduled"
            >
              <span className="w-10 shrink-0 text-center text-xs font-bold tabular-nums">
                {log.unscheduled === 1
                  ? log.lessons.length + 1
                  : `${log.lessons.length + 1}–${log.lessons.length + log.unscheduled}`}
              </span>
              <CalendarClock className="size-4 shrink-0" aria-hidden />
              <span>{t("unscheduled", { count: log.unscheduled })}</span>
            </li>
          )}
        </ol>
      )}

      {/* The block's time, the lessons it never took: cancelled, holidays, taken off it. */}
      {log && log.not_counted.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowOthers((v) => !v)}
            aria-expanded={showOthers}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-semibold"
            data-testid="lesson-log-not-counted-toggle"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", showOthers && "rotate-180")} aria-hidden />
            {t("notCounted", { count: log.not_counted.length })}
          </button>
          {showOthers && (
            <>
              <p className="text-muted-foreground text-[11px]">{t("notCountedHint")}</p>
              <ul className="bg-card divide-y overflow-hidden rounded-2xl border opacity-80 shadow-sm" data-testid="lesson-log-not-counted">
                {log.not_counted.map((lesson) => (
                  <LessonRow key={lesson.id} lesson={lesson} tz={tz} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A student with no package: the month's lessons, month by month. */
function MonthLog({ studentId }: { studentId: string }) {
  const t = useTranslations("students.lessonLog");
  const locale = useLocale();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [month, setMonth] = useState(() => startOfMonth(todayInTz(tz)));
  const [lessons, setLessons] = useState<CalendarSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLessons(null);
    setError(null);
    // `to` is an inclusive day: the month's last one.
    const last = new Date(`${addMonths(month, 1)}T00:00:00Z`);
    last.setUTCDate(last.getUTCDate() - 1);
    void getCalendar({ from: month, to: last.toISOString().slice(0, 10), studentId })
      .then((res) => live && setLessons(res.sessions.filter((s) => !s.trial && !s.group)))
      .catch((err) => live && setError(err instanceof ApiError ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [month, studentId]);

  return (
    <div className="space-y-4" data-testid="student-lesson-log">
      <div className="bg-card flex items-center gap-2 rounded-2xl border px-4 py-3 shadow-sm">
        <button
          type="button"
          onClick={() => setMonth((m) => addMonths(m, -1))}
          aria-label={t("prevMonth")}
          className="hover:bg-muted rounded-lg p-1.5"
        >
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
        </button>
        <span className="text-sm font-semibold" data-testid="lesson-log-month">
          {monthYearLabel(month, locale)}
        </span>
        <button
          type="button"
          onClick={() => setMonth((m) => addMonths(m, 1))}
          aria-label={t("nextMonth")}
          className="hover:bg-muted rounded-lg p-1.5"
        >
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
        </button>
        {lessons && (
          <span className="ms-auto text-sm font-bold tabular-nums">{t("total", { count: lessons.length })}</span>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{t("monthHint")}</p>

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {lessons === null ? (
        !error && <Spinner label={t("loading")} />
      ) : lessons.length === 0 ? (
        <Empty label={t("monthEmpty")} />
      ) : (
        <ol className="bg-card divide-y overflow-hidden rounded-2xl border shadow-sm" data-testid="lesson-log-list">
          {lessons.map((lesson, i) => (
            <LessonRow key={lesson.id} lesson={lesson} n={i + 1} tz={tz} />
          ))}
        </ol>
      )}
    </div>
  );
}

/** One lesson: its number on the block, day and time, teacher and length, and how it stands. */
function LessonRow({ lesson, n, tz }: { lesson: CalendarSession | PackageLesson; n?: number; tz: string }) {
  const t = useTranslations("students.lessonLog");
  const tStatus = useTranslations("scheduling");
  const locale = useLocale();
  const state = "package_state" in lesson ? lesson.package_state : null;
  // A past lesson nobody marked yet: it is not "scheduled" any more, it is waiting for a mark.
  const unmarked =
    state === "UNMARKED" || (state === null && lesson.status === "SCHEDULED" && Date.parse(lesson.scheduled_at_utc) < Date.now());
  const voided = isVoided(lesson.status);
  const day = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: tz,
  }).format(new Date(lesson.scheduled_at_utc));

  return (
    <li className="flex items-center gap-3 px-3 py-3 sm:px-4" data-testid={`lesson-log-row-${lesson.id}`} data-state={state ?? undefined}>
      {n !== undefined && (
        <span className="text-muted-foreground w-10 shrink-0 text-center text-xs font-bold tabular-nums">{n}</span>
      )}
      <span className={cn("h-10 w-1 shrink-0 rounded-full", unmarked ? "bg-amber-400" : STATUS_RAIL[lesson.status], voided && "opacity-60")} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("text-sm font-semibold", voided && "text-muted-foreground line-through")}>{day}</span>
        <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="tabular-nums" dir="ltr">
            {timeInTz(lesson.scheduled_at_utc, tz, locale)} – {timeInTz(endUtc(lesson), tz, locale)}
          </span>
          <span className="tabular-nums">{tStatus("actions.durationMin", { count: lesson.duration_minutes })}</span>
          {"planned" in lesson && lesson.planned && (
            <span className="text-muted-foreground/80 inline-flex items-center gap-1" title={t("plannedHint")} data-testid="lesson-log-planned">
              <CalendarClock className="size-3 shrink-0" aria-hidden />
              {t("planned")}
            </span>
          )}
          {lesson.teacher_name && (
            <span className="flex min-w-0 items-center gap-1">
              <GraduationCap className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{lesson.teacher_name}</span>
            </span>
          )}
        </span>
      </span>
      <span
        className={cn(
          "inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold",
          unmarked
            ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
            : STATUS_CHIP[lesson.status],
        )}
        data-testid="lesson-log-status"
      >
        {unmarked ? t("unmarked") : state === "UPCOMING" ? t("upcoming") : tStatus(`status.${lesson.status}`)}
      </span>
    </li>
  );
}

function packageName(p: LessonPackageRow, t: ReturnType<typeof useTranslations>): string {
  const subject = p.subject?.course?.trim() || p.subject?.teacher_name;
  return [t("package", { n: p.sequence_no }), p.label, subject].filter(Boolean).join(" · ");
}

function Count({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", dot)} aria-hidden />
      {label}
    </span>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="bg-card flex items-center justify-center rounded-2xl border py-14" aria-label={label}>
      <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="bg-card flex flex-col items-center justify-center gap-2 rounded-2xl border py-14 text-center shadow-sm">
      <CalendarX2 className="text-muted-foreground/60 size-8" aria-hidden />
      <p className="text-muted-foreground text-sm">{label}</p>
    </div>
  );
}
