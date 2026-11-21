"use client";

import { ArrowRight, ClipboardCheck, ExternalLink, Loader2, Pencil, ShieldAlert, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { StatusChip, type ChipTone } from "@/components/admin/status-chip";
import { TableCard, Td, Th, TR_HEAD } from "@/components/admin/table";
import { StatusBadge } from "@/components/attendance/status-badge";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  deleteConductNote,
  deleteLessonVisit,
  getTeacherPerformanceDetail,
  type ConductKind,
  type ConductNote,
  type LessonVisit,
  type PerformanceJoinBucket,
  type PerformanceLesson,
  type PerformancePart,
  type PerformanceReportBucket,
  type PerformanceTeacher,
  type TeacherPerformanceDetail as Detail,
} from "@/lib/api";
import { academyTimeZone } from "@/lib/academy-clock";
import { numeralLocale } from "@/lib/numerals";
import { cn } from "@/lib/utils";
import { NoteForm } from "./note-form";
import {
  dayLabel,
  fmtScore,
  Meter,
  monthLabel,
  PART_ICON,
  ScoreRing,
  scoreText,
  TIER_CHIP,
  tierOf,
  useDuration,
} from "./performance-ui";
import { VisitForm } from "./visit-form";

/**
 * One teacher's month, opened: the total and the four parts it is made of, the months before it,
 * and behind them the three lists the numbers come from — the lessons (when the teacher entered,
 * when the report came in), the supervisor's lesson visits, and the conduct notes.
 *
 * Recording a visit or a note swaps the body for the form and back, so the supervisor never loses
 * the teacher they were looking at.
 */

export type DetailView =
  | { kind: "main" }
  | { kind: "visit"; visit?: LessonVisit; lessonId?: string }
  | { kind: "note"; note?: ConductNote; lessonId?: string; preset?: ConductKind };

type Tab = "lessons" | "visits" | "notes";
type LessonFilter = "all" | "lateEntry" | "missedEntry" | "lateReport" | "missingReport" | "trial" | "cancelled";

const JOIN_TONE: Record<PerformanceJoinBucket, ChipTone> = {
  on_time: "good",
  late: "warn",
  missed: "crit",
  pending: "info",
  not_tracked: "neutral",
};

const REPORT_TONE: Record<PerformanceReportBucket, ChipTone> = {
  on_time: "good",
  late: "warn",
  missing: "crit",
  pending: "info",
  not_needed: "neutral",
};

const KIND_TONE: Record<ConductKind, ChipTone> = {
  ABSENCE: "crit",
  APOLOGY: "warn",
  VIOLATION: "info",
};

const MATCH: Record<Exclude<LessonFilter, "all">, (l: PerformanceLesson) => boolean> = {
  lateEntry: (l) => l.join_bucket === "late",
  missedEntry: (l) => l.join_bucket === "missed",
  lateReport: (l) => l.report_bucket === "late",
  missingReport: (l) => l.report_bucket === "missing",
  trial: (l) => l.is_trial,
  cancelled: (l) => l.status === "CANCELLED_BY_TEACHER",
};

export function TeacherPerformanceDetail({
  teacher,
  month,
  initialView = { kind: "main" },
  onClose,
  onChanged,
}: {
  teacher: PerformanceTeacher;
  month: string;
  initialView?: DetailView;
  onClose: () => void;
  /** A visit or note was saved or deleted — the page's own numbers are stale. */
  onChanged: () => void;
}) {
  const t = useTranslations("teacherPerformance");
  const locale = useLocale();

  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [view, setView] = useState<DetailView>(initialView);
  const [tab, setTab] = useState<Tab>("lessons");

  useEffect(() => {
    let live = true;
    setError(null);
    getTeacherPerformanceDetail(teacher.id, month)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : t("loadError")));
    return () => {
      live = false;
    };
  }, [teacher.id, month, version, t]);

  const saved = () => {
    setVersion((v) => v + 1);
    setView({ kind: "main" });
    // Land on the list the new record was added to.
    if (view.kind !== "main") setTab(view.kind === "visit" ? "visits" : "notes");
    onChanged();
  };

  const description =
    view.kind === "visit"
      ? t(view.visit ? "visit.editTitle" : "visit.title")
      : view.kind === "note"
        ? t(view.note ? "note.editTitle" : "note.title")
        : t("detail.subtitle", { month: monthLabel(month, locale) });

  return (
    <Modal open onClose={onClose} title={teacher.name} description={description} size="xl" closeLabel={t("close")}>
      <div data-testid="performance-detail">
        {error && <AlertBanner variant="error" message={error} />}
        {!data && !error && (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("detail.loading")}
          </div>
        )}

        {data && view.kind !== "main" && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setView({ kind: "main" })}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-semibold"
              data-testid="detail-back"
            >
              <ArrowRight className="size-3.5 ltr:rotate-180" aria-hidden />
              {t("detail.back")}
            </button>
            {view.kind === "visit" ? (
              <VisitForm
                teacherId={teacher.id}
                settings={data.settings}
                lessons={data.lessons}
                visit={view.visit}
                presetLessonId={view.lessonId}
                onSaved={saved}
                onCancel={() => setView({ kind: "main" })}
              />
            ) : (
              <NoteForm
                teacherId={teacher.id}
                settings={data.settings}
                lessons={data.lessons}
                note={view.note}
                presetLessonId={view.lessonId}
                presetKind={view.preset}
                onSaved={saved}
                onCancel={() => setView({ kind: "main" })}
              />
            )}
          </div>
        )}

        {data && view.kind === "main" && (
          <Main data={data} month={month} tab={tab} onTab={setTab} onView={setView} onDeleted={saved} />
        )}
      </div>
    </Modal>
  );
}

function Main({
  data,
  month,
  tab,
  onTab,
  onView,
  onDeleted,
}: {
  data: Detail;
  month: string;
  tab: Tab;
  onTab: (tab: Tab) => void;
  onView: (view: DetailView) => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("teacherPerformance");
  const locale = useLocale();
  const te = data.teacher;
  const tier = tierOf(te.total);
  const canManage = data.can.manage;

  return (
    <div className="space-y-5">
      {/* ── The month's total ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4">
        <ScoreRing score={te.total} size={68} stroke={6} />
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-xs font-medium">{t("detail.total", { month: monthLabel(month, locale) })}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {tier ? (
              <StatusChip tone={TIER_CHIP[tier]}>{t(`tier.${tier}`)}</StatusChip>
            ) : (
              <span className="text-muted-foreground text-xs">{t("detail.noTotal")}</span>
            )}
            <span className="text-muted-foreground text-xs">{t("lessonsCount", { n: te.lessons.total })}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <>
              <Button size="sm" onClick={() => onView({ kind: "visit" })} data-testid="detail-add-visit">
                <ClipboardCheck aria-hidden />
                {t("actions.visit")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => onView({ kind: "note" })} data-testid="detail-add-note">
                <ShieldAlert aria-hidden />
                {t("actions.note")}
              </Button>
            </>
          )}
          <Link
            href={`/teachers/${te.id}`}
            className="text-primary inline-flex items-center gap-1 text-xs font-semibold hover:underline"
            data-testid="detail-profile-link"
          >
            {t("detail.profile")}
            <ExternalLink className="size-3" aria-hidden />
          </Link>
        </div>
      </div>

      {/* ── What the total is made of ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="detail-parts">
        <PartBlock
          part="quality"
          score={te.quality.score}
          weight={data.settings.weights.quality}
          empty={t("detail.quality.none")}
          facts={[[t("detail.quality.visits"), t("detail.quality.visitsOf", { n: te.quality.visits, target: te.quality.target })]]}
        />
        <PartBlock
          part="reports"
          score={te.reports.score}
          weight={data.settings.weights.reports}
          empty={t("detail.reports.none")}
          facts={[
            [t("bucket.onTime"), String(te.reports.on_time)],
            [t("bucket.late"), String(te.reports.late)],
            [t("bucket.missing"), String(te.reports.missing)],
            ...(te.reports.trial_due > 0
              ? [[t("detail.reports.trials"), t("detail.reports.trialsOf", { n: te.reports.trial_on_time, due: te.reports.trial_due })] as [string, string]]
              : []),
          ]}
        />
        <PartBlock
          part="entry"
          score={te.entry.score}
          weight={data.settings.weights.entry}
          empty={te.has_meeting_url ? t("detail.entry.none") : t("detail.entry.noLink")}
          facts={[
            [t("bucket.onTime"), String(te.entry.on_time)],
            [t("bucket.late"), String(te.entry.late)],
            [t("bucket.missed"), String(te.entry.missed)],
          ]}
        />
        <PartBlock
          part="conduct"
          score={te.conduct.score}
          weight={data.settings.weights.conduct}
          empty={t("detail.conduct.none")}
          facts={[
            [t("note.kinds.ABSENCE"), String(te.conduct.absences)],
            [t("note.kinds.APOLOGY"), String(te.conduct.apologies)],
            [t("note.kinds.VIOLATION"), String(te.conduct.violations)],
          ]}
        />
      </div>

      {te.conduct.unclassified > 0 && (
        <button
          type="button"
          onClick={() => onTab("lessons")}
          className="flex w-full items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-start text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
          data-testid="detail-unclassified"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("detail.unclassified", { n: te.conduct.unclassified })}
        </button>
      )}

      <Trend data={data} />

      {/* ── The three lists behind the numbers ────────────────────────────── */}
      <section className="space-y-3">
        <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-lg border p-0.5" role="tablist" aria-label={t("detail.lists")}>
          {(
            [
              ["lessons", data.lessons.length],
              ["visits", data.visits.length],
              ["notes", data.notes.length],
            ] as const
          ).map(([key, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => onTab(key)}
              data-testid={`detail-tab-${key}`}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:px-4",
                tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`detail.tab.${key}`)}
              <span className="ms-1.5 tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>

        {tab === "lessons" && <Lessons data={data} canManage={canManage} onView={onView} />}
        {tab === "visits" && <Visits data={data} canManage={canManage} onView={onView} onDeleted={onDeleted} />}
        {tab === "notes" && <Notes data={data} canManage={canManage} onView={onView} onDeleted={onDeleted} />}
      </section>
    </div>
  );
}

function PartBlock({
  part,
  score,
  weight,
  facts,
  empty,
}: {
  part: PerformancePart;
  score: number | null;
  weight: number;
  facts: [string, string][];
  /** Why this part has no score this month. */
  empty: string;
}) {
  const t = useTranslations("teacherPerformance");
  const Icon = PART_ICON[part];
  return (
    <div className="bg-muted/30 flex min-w-0 flex-col rounded-xl border p-3.5" data-testid={`detail-part-${part}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
          <Icon className="text-muted-foreground/80 size-4 shrink-0" aria-hidden />
          <span className="truncate">{t(`part.${part}`)}</span>
        </span>
        <span className="bg-background text-muted-foreground shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
          {t("detail.weight", { n: weight })}
        </span>
      </div>
      <p className={cn("mt-2 text-2xl font-bold tabular-nums", scoreText(score))} dir="ltr">
        {fmtScore(score)}
      </p>
      <Meter score={score} className="mt-1.5" />
      {score === null ? (
        <p className="text-muted-foreground mt-2.5 text-xs leading-relaxed">{empty}</p>
      ) : (
        <dl className="mt-3 space-y-1 border-t pt-2.5 text-xs">
          {facts.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** The total of this month and the five before it, as bars — read from the same records, never stored. */
function Trend({ data }: { data: Detail }) {
  const t = useTranslations("teacherPerformance");
  const locale = useLocale();
  if (data.trend.every((p) => p.total === null)) return null;

  return (
    <section className="rounded-xl border p-3.5" data-testid="detail-trend">
      <h3 className="text-muted-foreground text-xs font-semibold">{t("detail.trend")}</h3>
      <ol className="mt-3 grid grid-cols-6 items-end gap-2">
        {data.trend.map((p) => {
          const tier = tierOf(p.total);
          return (
            <li key={p.month} className="flex min-w-0 flex-col items-center gap-1" data-testid={`trend-${p.month}`}>
              <span className={cn("text-xs font-bold tabular-nums", scoreText(p.total))}>{fmtScore(p.total)}</span>
              <span className="bg-muted flex h-16 w-full max-w-10 items-end overflow-hidden rounded-md" aria-hidden>
                {p.total !== null && tier && (
                  <span
                    className={cn(
                      "w-full rounded-md",
                      tier === "excellent" ? "bg-emerald-500" : tier === "good" ? "bg-primary" : tier === "fair" ? "bg-amber-500" : "bg-rose-500",
                      p.month !== data.month && "opacity-50",
                    )}
                    style={{ height: `${Math.max(4, p.total)}%` }}
                  />
                )}
              </span>
              <span className={cn("truncate text-[11px]", p.month === data.month ? "font-semibold" : "text-muted-foreground")}>
                {monthLabel(p.month, locale, "short")}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ── Lessons ─────────────────────────────────────────────────────────────────

function Lessons({ data, canManage, onView }: { data: Detail; canManage: boolean; onView: (view: DetailView) => void }) {
  const t = useTranslations("teacherPerformance");
  const locale = useLocale();
  const [filter, setFilter] = useState<LessonFilter>("all");

  const lessons = data.lessons;
  const shown = filter === "all" ? lessons : lessons.filter(MATCH[filter]);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(MATCH) as Exclude<LessonFilter, "all">[]).map((k) => [k, lessons.filter(MATCH[k]).length]),
      ) as Record<Exclude<LessonFilter, "all">, number>,
    [lessons],
  );

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(numeralLocale(locale), {
        weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: academyTimeZone(),
      }),
    [locale],
  );
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(numeralLocale(locale), { hour: "2-digit", minute: "2-digit", timeZone: academyTimeZone() }),
    [locale],
  );
  const dayTimeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(numeralLocale(locale), {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: academyTimeZone(),
      }),
    [locale],
  );

  // The phone cards and the table both render; `scope` keeps their test ids apart.
  const actions = (l: PerformanceLesson, scope = ""): ReactNode => {
    if (!canManage) return null;
    if (l.status === "CANCELLED_BY_TEACHER") {
      return l.noted ? (
        <span className="text-muted-foreground text-xs">{t("detail.lesson.noted")}</span>
      ) : (
        <span className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="outline" onClick={() => onView({ kind: "note", lessonId: l.id, preset: "ABSENCE" })} data-testid={`${scope}lesson-absence-${l.id}`}>
            {t("note.kinds.ABSENCE")}
          </Button>
          <Button size="xs" variant="outline" onClick={() => onView({ kind: "note", lessonId: l.id, preset: "APOLOGY" })} data-testid={`${scope}lesson-apology-${l.id}`}>
            {t("note.kinds.APOLOGY")}
          </Button>
        </span>
      );
    }
    if (l.status.startsWith("CANCELLED")) return null;
    return (
      <Button size="xs" variant="ghost" onClick={() => onView({ kind: "visit", lessonId: l.id })} data-testid={`${scope}lesson-visit-${l.id}`}>
        <ClipboardCheck aria-hidden />
        {t("detail.lesson.rate")}
      </Button>
    );
  };

  const title = (l: PerformanceLesson) => (
    <>
      {dateFmt.format(new Date(l.scheduled_at_utc))}
      <span className="text-muted-foreground ms-1 text-xs">· {t("detail.lesson.minutes", { n: l.duration_minutes })}</span>
      {l.is_trial && (
        <StatusChip tone="warn" className="ms-1.5">
          {t("detail.lesson.trial")}
        </StatusChip>
      )}
    </>
  );

  return (
    <div className="space-y-2">
      <div className="no-scrollbar flex max-w-full gap-1 overflow-x-auto" role="group" aria-label={t("detail.tab.lessons")}>
        {(["all", "lateEntry", "missedEntry", "lateReport", "missingReport", "trial", "cancelled"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            data-testid={`lesson-filter-${f}`}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              filter === f ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`detail.filter.${f}`)}
            {f !== "all" && <span className="ms-1 tabular-nums opacity-70">{counts[f]}</span>}
          </button>
        ))}
      </div>

      {data.truncated && <AlertBanner variant="info" message={t("detail.truncated", { n: lessons.length })} />}

      {shown.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-8 text-center text-sm">
          {filter === "all" ? t("detail.lesson.empty") : t("detail.lesson.emptyFilter")}
        </p>
      ) : (
        <>
          <ul className="space-y-2 sm:hidden" data-testid="lesson-cards">
            {shown.map((l) => (
              <li key={l.id} className="bg-card rounded-xl p-3 text-xs ring-1 ring-foreground/[0.06]">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold tabular-nums">{title(l)}</span>
                  <StatusBadge status={l.status} />
                </div>
                <p className="text-muted-foreground mt-0.5">{l.student_name ?? "—"}</p>
                <div className="mt-2 space-y-1.5">
                  <JoinCell lesson={l} timeFmt={timeFmt} />
                  <ReportCell lesson={l} timeFmt={dayTimeFmt} />
                </div>
                <div className="mt-2">{actions(l, "card-")}</div>
              </li>
            ))}
          </ul>
          <TableCard className="hidden sm:block" testId="lesson-table">
            <table className="w-full text-sm">
              <thead>
                <tr className={TR_HEAD}>
                  <Th>{t("detail.col.lesson")}</Th>
                  <Th>{t("detail.col.student")}</Th>
                  <Th>{t("detail.col.status")}</Th>
                  <Th>{t("detail.col.entered")}</Th>
                  <Th>{t("detail.col.report")}</Th>
                  {canManage && <Th />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map((l) => (
                  <tr key={l.id} data-testid="lesson-row" data-join={l.join_bucket} data-report={l.report_bucket}>
                    <Td className="whitespace-nowrap tabular-nums">{title(l)}</Td>
                    <Td className="font-medium">{l.student_name ?? "—"}</Td>
                    <Td>
                      <StatusBadge status={l.status} />
                    </Td>
                    <Td>
                      <JoinCell lesson={l} timeFmt={timeFmt} />
                    </Td>
                    <Td>
                      <ReportCell lesson={l} timeFmt={dayTimeFmt} />
                    </Td>
                    {canManage && <Td className="text-end">{actions(l)}</Td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        </>
      )}
    </div>
  );
}

function JoinCell({ lesson: l, timeFmt }: { lesson: PerformanceLesson; timeFmt: Intl.DateTimeFormat }) {
  const t = useTranslations("teacherPerformance");
  const d = l.join_delay_minutes;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusChip tone={JOIN_TONE[l.join_bucket]} dot>
        {t(`detail.join.${l.join_bucket}`)}
      </StatusChip>
      {l.first_joined_at && d !== null && (
        <span className="text-muted-foreground text-xs">
          {timeFmt.format(new Date(l.first_joined_at))}
          {" · "}
          {d > 0 ? t("detail.afterStart", { n: d }) : d < 0 ? t("detail.beforeStart", { n: -d }) : t("detail.atStart")}
        </span>
      )}
    </span>
  );
}

function ReportCell({ lesson: l, timeFmt }: { lesson: PerformanceLesson; timeFmt: Intl.DateTimeFormat }) {
  const t = useTranslations("teacherPerformance");
  const dur = useDuration();
  const d = l.report_delay_minutes;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusChip tone={REPORT_TONE[l.report_bucket]} dot>
        {t(`detail.report.${l.report_bucket}`)}
      </StatusChip>
      {l.reported_at && d !== null && (
        <span className="text-muted-foreground text-xs">
          {timeFmt.format(new Date(l.reported_at))}
          {" · "}
          {d > 0 ? t("detail.afterEnd", { v: dur(d) }) : t("detail.beforeEnd")}
        </span>
      )}
    </span>
  );
}

// ── Lesson visits ───────────────────────────────────────────────────────────

function Visits({
  data,
  canManage,
  onView,
  onDeleted,
}: {
  data: Detail;
  canManage: boolean;
  onView: (view: DetailView) => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("teacherPerformance");
  const locale = useLocale();

  if (data.visits.length === 0) {
    return (
      <Empty
        text={t("detail.visit.empty")}
        action={canManage ? { label: t("actions.visit"), onClick: () => onView({ kind: "visit" }) } : undefined}
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="visit-list">
      {data.visits.map((v) => (
        <li key={v.id} className="bg-card flex flex-col rounded-2xl border shadow-sm" data-testid={`visit-${v.id}`}>
          <div className="flex items-center gap-3 px-4 pt-4">
            <ScoreRing score={v.score} size={44} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">{dayLabel(v.visited_on, locale)}</p>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {v.lesson_student ? t("detail.visit.lessonWith", { name: v.lesson_student }) : t("detail.visit.noLesson")}
              </p>
            </div>
          </div>
          <dl className="divide-border/60 divide-y px-4 py-1.5 text-xs">
            {v.items.map((item) => (
              <div key={item.criterion_id} className="flex items-center justify-between gap-3 py-2">
                <dt className="text-muted-foreground min-w-0">{item.name}</dt>
                <dd className="flex shrink-0 items-center gap-0.5" aria-label={t("visit.ratingAria", { n: item.rating })}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className={cn("size-3.5", n <= item.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")}
                      aria-hidden
                    />
                  ))}
                </dd>
              </div>
            ))}
          </dl>
          {(v.strengths || v.improvements) && (
            <div className="space-y-2 px-4 pb-3 text-xs leading-relaxed">
              {v.strengths && (
                <p>
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">{t("visit.strengths")}: </span>
                  {v.strengths}
                </p>
              )}
              {v.improvements && (
                <p>
                  <span className="font-semibold text-amber-700 dark:text-amber-400">{t("visit.improvements")}: </span>
                  {v.improvements}
                </p>
              )}
            </div>
          )}
          <RecordFooter
            author={v.author_name}
            canManage={canManage}
            onEdit={() => onView({ kind: "visit", visit: v })}
            onDelete={() => deleteLessonVisit(v.id)}
            onDeleted={onDeleted}
            testId={`visit-${v.id}`}
          />
        </li>
      ))}
    </ul>
  );
}

// ── Conduct notes ───────────────────────────────────────────────────────────

function Notes({
  data,
  canManage,
  onView,
  onDeleted,
}: {
  data: Detail;
  canManage: boolean;
  onView: (view: DetailView) => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("teacherPerformance");
  const locale = useLocale();

  if (data.notes.length === 0) {
    return (
      <Empty
        text={t("detail.note.empty")}
        action={canManage ? { label: t("actions.note"), onClick: () => onView({ kind: "note" }) } : undefined}
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="note-list">
      {data.notes.map((n) => (
        <li key={n.id} className="bg-card flex flex-col rounded-2xl border shadow-sm" data-testid={`note-${n.id}`}>
          <div className="flex items-start justify-between gap-3 px-4 pt-4">
            <div className="min-w-0">
              <StatusChip tone={KIND_TONE[n.kind]}>{t(`note.kinds.${n.kind}`)}</StatusChip>
              <p className="mt-1.5 text-sm font-semibold leading-tight">{dayLabel(n.occurred_on, locale)}</p>
              {n.lesson_student && (
                <p className="text-muted-foreground mt-0.5 truncate text-xs">{t("detail.visit.lessonWith", { name: n.lesson_student })}</p>
              )}
            </div>
            <span className={cn("shrink-0 text-sm font-bold tabular-nums", n.points > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
              {n.points > 0 ? t("note.costs", { n: n.points }) : t("note.costsNothing")}
            </span>
          </div>
          <div className="space-y-1 px-4 py-3 text-xs leading-relaxed">
            {n.rule && (
              <p>
                <span className="text-muted-foreground">{t("note.rule")}: </span>
                <span className="font-semibold">{n.rule}</span>
              </p>
            )}
            {n.note ? <p>{n.note}</p> : !n.rule && <p className="text-muted-foreground">{t("detail.note.noDetails")}</p>}
          </div>
          <RecordFooter
            author={n.author_name}
            canManage={canManage}
            onEdit={() => onView({ kind: "note", note: n })}
            onDelete={() => deleteConductNote(n.id)}
            onDeleted={onDeleted}
            testId={`note-${n.id}`}
          />
        </li>
      ))}
    </ul>
  );
}

/** Who wrote it, and — in two presses, never a browser dialog — edit or delete. */
function RecordFooter({
  author,
  canManage,
  onEdit,
  onDelete,
  onDeleted,
  testId,
}: {
  author: string | null;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => Promise<unknown>;
  onDeleted: () => void;
  testId: string;
}) {
  const t = useTranslations("teacherPerformance");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="bg-muted/25 mt-auto flex flex-wrap items-center justify-between gap-2 rounded-b-2xl border-t px-4 py-2.5">
      <span className={cn("min-w-0 truncate text-xs", failed ? "font-semibold text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
        {failed ? t("detail.deleteError") : author ? t("detail.by", { name: author }) : ""}
      </span>
      {canManage &&
        (confirming ? (
          <span className="flex items-center gap-1.5">
            <Button size="xs" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              {t("detail.keep")}
            </Button>
            <Button
              size="xs"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setFailed(false);
                onDelete()
                  .then(onDeleted)
                  .catch(() => {
                    setFailed(true);
                    setBusy(false);
                    setConfirming(false);
                  });
              }}
              data-testid={`${testId}-confirm-delete`}
            >
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {t("detail.confirmDelete")}
            </Button>
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <Button size="xs" variant="ghost" onClick={onEdit} data-testid={`${testId}-edit`}>
              <Pencil aria-hidden />
              {t("detail.edit")}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setConfirming(true)} data-testid={`${testId}-delete`}>
              <Trash2 aria-hidden />
              {t("detail.delete")}
            </Button>
          </span>
        ))}
    </div>
  );
}

function Empty({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="rounded-xl border border-dashed px-4 py-8 text-center">
      <p className="text-muted-foreground text-sm">{text}</p>
      {action && (
        <Button size="sm" variant="outline" className="mt-3" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
