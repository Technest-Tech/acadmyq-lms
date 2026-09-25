"use client";

import { DoorOpen, ExternalLink, FileText, Link2Off, Loader2, UserCheck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { StatusChip, type ChipTone } from "@/components/admin/status-chip";
import { TableCard, Td, Th, TR_HEAD } from "@/components/admin/table";
import { StatusBadge } from "@/components/attendance/status-badge";
import { AlertBanner } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  getTeacherInsightLessons,
  type InsightJoinBucket,
  type InsightLesson,
  type InsightReportBucket,
  type InsightTeacher,
  type TeacherInsightLessons,
  type TeacherInsightsParams,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  attendanceSegments,
  fmtRate,
  joinSegments,
  rateText,
  reportSegments,
  ScoreRing,
  SplitBar,
  SplitLegend,
  TIER_CHIP,
  tierOf,
  useDuration,
  type Segment,
} from "./insight-ui";

/**
 * One teacher's row, opened: the three clocks side by side, then every lesson behind them with
 * when Enter was pressed and when the report came in — filterable down to the lessons that cost
 * the teacher their numbers.
 */

type Filter = "all" | "lateEntry" | "missedEntry" | "lateReport" | "missingReport" | "absent";

const JOIN_TONE: Record<InsightJoinBucket, ChipTone> = {
  on_time: "good",
  late: "warn",
  missed: "crit",
  pending: "info",
  not_tracked: "neutral",
};

const REPORT_TONE: Record<InsightReportBucket, ChipTone> = {
  on_time: "good",
  late: "warn",
  missing: "crit",
  pending: "info",
  not_needed: "neutral",
};

const MATCH: Record<Exclude<Filter, "all">, (l: InsightLesson) => boolean> = {
  lateEntry: (l) => l.join_bucket === "late",
  missedEntry: (l) => l.join_bucket === "missed",
  lateReport: (l) => l.report_bucket === "late",
  missingReport: (l) => l.report_bucket === "missing",
  absent: (l) => l.status === "CANCELLED_BY_TEACHER",
};

export function TeacherInsightDetail({
  teacher,
  params,
  onClose,
}: {
  teacher: InsightTeacher;
  params: TeacherInsightsParams;
  onClose: () => void;
}) {
  const t = useTranslations("teacherInsights");
  const locale = useLocale();
  const dur = useDuration();

  const [data, setData] = useState<TeacherInsightLessons | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const { from, to, late_minutes, report_minutes } = params;
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    getTeacherInsightLessons(teacher.id, { from, to, late_minutes, report_minutes })
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : t("loadError")));
    return () => {
      live = false;
    };
  }, [teacher.id, from, to, late_minutes, report_minutes, t]);

  const lessons = useMemo(() => data?.lessons ?? [], [data]);
  const shown = filter === "all" ? lessons : lessons.filter(MATCH[filter]);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(MATCH) as Exclude<Filter, "all">[]).map((k) => [k, lessons.filter(MATCH[k]).length]),
      ) as Record<Exclude<Filter, "all">, number>,
    [lessons],
  );

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
    [locale],
  );
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }), [locale]);
  const dayTimeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
    [locale],
  );

  const tier = tierOf(teacher.score);
  const a = teacher.attendance;
  const showedUp = a.attended + a.free + a.student_absent;

  return (
    <Modal open onClose={onClose} title={teacher.name} description={t("detail.subtitle")} size="xl" closeLabel={t("detail.close")}>
      <div className="space-y-5" data-testid="insight-detail">
        {/* ── Headline ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-4">
          <ScoreRing score={teacher.score} size={64} stroke={5} />
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-xs font-medium">{t("detail.score")}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {tier ? <StatusChip tone={TIER_CHIP[tier]}>{t(`tier.${tier}`)}</StatusChip> : <span className="text-muted-foreground text-xs">{t("detail.noScore")}</span>}
              {!teacher.has_meeting_url && (
                <StatusChip tone="warn" icon={Link2Off}>
                  {t("chips.noLink")}
                </StatusChip>
              )}
            </div>
          </div>
          <Link
            href={`/teachers/${teacher.id}`}
            className="text-primary inline-flex items-center gap-1 text-xs font-semibold hover:underline"
            data-testid="insight-profile-link"
          >
            {t("detail.profile")}
            <ExternalLink className="size-3" aria-hidden />
          </Link>
        </div>

        {/* ── The three clocks ───────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Block
            icon={DoorOpen}
            title={t("detail.enter")}
            rate={teacher.join.on_time_rate}
            segments={joinSegments(teacher, t)}
            facts={[
              [t("detail.avgAfterStart"), dur(teacher.join.avg_delay_minutes)],
              [t("detail.avgWhenLate"), dur(teacher.join.avg_late_minutes)],
              [t("detail.enteredAtAll"), fmtRate(teacher.join.entered_rate)],
            ]}
            empty={teacher.join.measured === 0 ? (teacher.has_meeting_url ? t("detail.noneYet") : t("detail.noLinkHint")) : null}
          />
          <Block
            icon={FileText}
            title={t("detail.reports")}
            rate={teacher.reports.on_time_rate}
            segments={reportSegments(teacher, t)}
            facts={[
              [t("detail.avgAfterEnd"), dur(teacher.reports.avg_delay_minutes)],
              [t("detail.filedAtAll"), fmtRate(teacher.reports.filed_rate)],
              [t("detail.pending"), String(teacher.reports.pending)],
            ]}
            empty={teacher.reports.due === 0 ? t("detail.noneYet") : null}
          />
          <Block
            icon={UserCheck}
            title={t("detail.attendance")}
            rate={a.teacher_attendance_rate}
            segments={attendanceSegments(teacher, t)}
            facts={[
              [t("detail.taughtOf", { n: showedUp + a.teacher_absent }), String(showedUp)],
              [t("detail.absenceRate"), fmtRate(a.teacher_absence_rate)],
              [t("detail.studentAttendance"), fmtRate(a.student_attendance_rate)],
            ]}
            empty={a.lessons === 0 ? t("detail.noneYet") : null}
          />
        </div>

        {/* ── The lessons behind the numbers ─────────────────────────────── */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold">
              {t("detail.log")}
              {data && <span className="text-muted-foreground ms-2 text-xs font-normal tabular-nums">{shown.length}</span>}
            </h3>
            <div className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-lg border p-0.5" role="group" aria-label={t("detail.log")}>
              {(["all", "lateEntry", "missedEntry", "lateReport", "missingReport", "absent"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                  data-testid={`insight-filter-${f}`}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`detail.filter.${f}`)}
                  {f !== "all" && data && <span className="ms-1 tabular-nums opacity-70">{counts[f]}</span>}
                </button>
              ))}
            </div>
          </div>

          {error && <AlertBanner variant="error" message={error} />}
          {data?.truncated && <AlertBanner variant="info" message={t("detail.truncated", { n: lessons.length })} />}

          {!data && !error ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("detail.loading")}
            </div>
          ) : data && shown.length === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-8 text-center text-sm">
              {filter === "all" ? t("detail.empty") : t("detail.emptyFilter")}
            </p>
          ) : (
            <>
              <ul className="space-y-2 sm:hidden" data-testid="insight-lesson-cards">
                {shown.map((l) => (
                  <li key={l.id} className="bg-card rounded-xl p-3 text-xs ring-1 ring-foreground/[0.06]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold tabular-nums">{dateFmt.format(new Date(l.scheduled_at_utc))}</span>
                      <StatusBadge status={l.status} />
                    </div>
                    <p className="text-muted-foreground mt-0.5">{l.student_name ?? "—"} · {t("detail.minutesShort", { n: l.duration_minutes })}</p>
                    <div className="mt-2 space-y-1.5">
                      <JoinCell lesson={l} timeFmt={timeFmt} />
                      <ReportCell lesson={l} timeFmt={dayTimeFmt} />
                    </div>
                  </li>
                ))}
              </ul>
              <TableCard className="hidden sm:block" testId="insight-lessons">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={TR_HEAD}>
                      <Th>{t("detail.col.lesson")}</Th>
                      <Th>{t("detail.col.student")}</Th>
                      <Th>{t("detail.col.status")}</Th>
                      <Th>{t("detail.col.entered")}</Th>
                      <Th>{t("detail.col.report")}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {shown.map((l) => (
                      <tr key={l.id} data-testid="insight-lesson" data-join={l.join_bucket} data-report={l.report_bucket}>
                        <Td className="whitespace-nowrap tabular-nums">
                          {dateFmt.format(new Date(l.scheduled_at_utc))}
                          <span className="text-muted-foreground ms-1 text-xs">· {t("detail.minutesShort", { n: l.duration_minutes })}</span>
                        </Td>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}

function Block({
  icon: Icon,
  title,
  rate,
  segments,
  facts,
  empty,
}: {
  icon: LucideIcon;
  title: string;
  rate: number | null;
  segments: Segment[];
  facts: [string, string][];
  empty: string | null;
}) {
  return (
    <div className="bg-muted/30 flex min-w-0 flex-col rounded-xl border p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-semibold">{title}</span>
        <Icon className="text-muted-foreground/70 size-4" aria-hidden />
      </div>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", rateText(rate))} dir="ltr">
        {fmtRate(rate)}
      </p>
      {empty ? (
        <p className="text-muted-foreground mt-1 text-xs">{empty}</p>
      ) : (
        <>
          <SplitBar className="mt-2" segments={segments} />
          <SplitLegend className="mt-2" segments={segments} />
          <dl className="mt-3 space-y-1 border-t pt-2.5 text-xs">
            {facts.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}

function JoinCell({ lesson: l, timeFmt }: { lesson: InsightLesson; timeFmt: Intl.DateTimeFormat }) {
  const t = useTranslations("teacherInsights");
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
      {/* A teacher who dropped and came back pressed more than once — the first press counts. */}
      {l.presses > 1 && (
        <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
          ×{l.presses}
        </span>
      )}
    </span>
  );
}

function ReportCell({ lesson: l, timeFmt }: { lesson: InsightLesson; timeFmt: Intl.DateTimeFormat }) {
  const t = useTranslations("teacherInsights");
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
