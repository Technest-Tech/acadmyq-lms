"use client";

import {
  academyDay,
  academyDayStartIso,
  academyFormat,
  academyNow,
  academyToday,
} from "@/lib/academy-clock";
import {
  AlarmClock,
  ArrowLeft,
  BadgeDollarSign,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  FileWarning,
  GraduationCap,
  NotebookPen,
  NotebookText,
  Sun,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { StatusBadge } from "@/components/attendance/status-badge";
import { KpiCard, ListCard, ListRow, PastelTile, type CentreTone } from "@/components/dashboard/centre-kit";
import { MyLessonsToday } from "@/components/dashboard/my-lessons-today";
import { SubscriptionBanner } from "@/components/dashboard/subscription-banner";
import { MyQualityPanel } from "@/components/quality/my-quality-panel";
import { LessonReportBody, reportAnswers, reportPlainText, reportText } from "@/components/reports/lesson-report-body";
import { Modal } from "@/components/ui/modal";
import { PageHero } from "@/components/ui/page-hero";
import {
  getCalendar,
  getOverdueSessions,
  listLessonReports,
  listMyPayouts,
  listStudents,
  type CalendarSession,
  type LessonReportLogRow,
  type ReportField,
} from "@/lib/api";
import { useCapability } from "@/lib/capabilities";
import { attendedGroupLessons, groupLessonsAsSessions } from "@/lib/group-calendar";
import { getGroupLessonsSummary } from "@/lib/groups-api";
import { formatMoney, formatNumber } from "@/lib/money";
import { numeralLocale } from "@/lib/numerals";
import { cn } from "@/lib/utils";

const DELIVERED = new Set(["ATTENDED", "FREE"]);
const UPCOMING_DAYS = 7;

/** "YYYY-MM-DD" `days` after an academy day (through UTC noon, so no clock change skips a date). */
function addDays(day: string, days: number): string {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + days, 12));
  return d.toISOString().slice(0, 10);
}

/**
 * The teacher's home screen. Teachers used to get the owner's dashboard with the money cut out: a
 * row of academy numbers, a trials card and a list of quick actions that repeated the sidebar —
 * and nowhere to find what they had written (Ahmed, 2026-11-17). This one is built around their
 * day, in the order they need it:
 *
 *  1. What is late — lessons never marked, reports owed this month, group sheets still open.
 *  2. Today's lessons with the Enter button (MyLessonsToday, unchanged).
 *  3. Four numbers of their own month: lessons taught, reports written, students, earnings.
 *  4. Their latest reports (open in place) beside what is coming in the next seven days.
 *  5. The quality panel, when they have one.
 *
 * Used for a TEACHER in every academy that is not a centre (DashboardHome), classic or modern look:
 * it is drawn from the shared tokens, so it takes the academy's own colours.
 */
export function TeacherDashboard() {
  const t = useTranslations("dashboard.teacher");
  const tDash = useTranslations("dashboard");
  const locale = useLocale();
  const { session, can } = useAuth();
  const groupsOn = useCapability("groups") && can("group.read");
  const studentReportsOn = useCapability("student_reports") && can("student_report.submit");

  const [overdue, setOverdue] = useState<number | null>(null);
  const [groupOwed, setGroupOwed] = useState(0);
  const [lessons, setLessons] = useState<CalendarSession[] | null>(null);
  const [month, setMonth] = useState<{ written: number; missing: number } | null>(null);
  const [recent, setRecent] = useState<LessonReportLogRow[] | null>(null);
  const [fields, setFields] = useState<ReportField[]>([]);
  const [students, setStudents] = useState<number | null>(null);
  const [earnings, setEarnings] = useState<{ amount: number; currency: string | null } | null>(null);
  const [opened, setOpened] = useState<LessonReportLogRow | null>(null);

  const today = academyToday();
  const monthFirst = `${today.slice(0, 8)}01`;

  const load = useCallback(() => {
    getOverdueSessions()
      .then((r) => setOverdue(r.count))
      .catch(() => setOverdue(0));
    if (groupsOn) {
      getGroupLessonsSummary()
        .then((r) => setGroupOwed(r.owed ?? 0))
        .catch(() => setGroupOwed(0));
    }
    // One window covers the month so far and the week ahead (it may run into next month).
    const to = addDays(today, UPCOMING_DAYS);
    getCalendar({ from: monthFirst, to })
      .then((r) => setLessons([...r.sessions, ...groupLessonsAsSessions(attendedGroupLessons(r.group_lessons ?? []))]))
      .catch(() => setLessons([]));
    // This month's two counts ride on a one-row page.
    listLessonReports({ pageSize: 1, filter: { from: academyDayStartIso(monthFirst) } })
      .then((r) => setMonth(r.counts))
      .catch(() => setMonth({ written: 0, missing: 0 }));
    listLessonReports({ pageSize: 4 })
      .then((r) => {
        setRecent(r.rows);
        setFields(r.fields);
      })
      .catch(() => setRecent([]));
    if (can("student.read")) {
      listStudents({ pageSize: 1 })
        .then((r) => setStudents(r.total))
        .catch(() => setStudents(null));
    }
    if (can("payout.read_own")) {
      const [yr, mo] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
      listMyPayouts({ pageSize: 50, sort: "-period" })
        .then((r) => {
          const current = r.rows.find((p) => p.period_year === yr && p.period_month === mo);
          setEarnings({ amount: current?.total_minor ?? 0, currency: current?.currency ?? r.rows[0]?.currency ?? null });
        })
        .catch(() => setEarnings({ amount: 0, currency: null }));
    }
  }, [can, groupsOn, today, monthFirst]);

  useEffect(() => {
    load();
  }, [load]);

  // ── The month so far ──
  const taught = useMemo(() => {
    const rows = (lessons ?? []).filter((s) => DELIVERED.has(s.status) && academyDay(s.scheduled_at_utc).slice(0, 7) === today.slice(0, 7));
    return { count: rows.length, minutes: rows.reduce((sum, s) => sum + s.duration_minutes, 0) };
  }, [lessons, today]);

  // ── What is coming: still scheduled, starting from now, the next seven days ──
  const upcoming = useMemo(() => {
    const now = academyNow().getTime();
    return (lessons ?? [])
      .filter((s) => s.status === "SCHEDULED" && new Date(s.scheduled_at_utc).getTime() > now && !s.trial)
      .sort((a, b) => a.scheduled_at_utc.localeCompare(b.scheduled_at_utc))
      .slice(0, 6);
  }, [lessons]);

  const dayTimeFmt = useMemo(
    () => academyFormat(numeralLocale(locale), { weekday: "short", hour: "numeric", minute: "2-digit" }),
    [locale],
  );
  const dateFmt = useMemo(
    () => academyFormat(numeralLocale(locale), { weekday: "long", day: "numeric", month: "long" }),
    [locale],
  );
  const shortDateFmt = useMemo(() => academyFormat(numeralLocale(locale), { day: "numeric", month: "short" }), [locale]);

  const greeting = (() => {
    const h = Number(academyFormat("en-GB", { hour: "2-digit", hourCycle: "h23" }).format(academyNow()));
    if (h < 12) return tDash("greeting.morning");
    if (h < 17) return tDash("greeting.afternoon");
    return tDash("greeting.evening");
  })();
  const firstName = session?.user.fullName?.split(" ")[0] ?? "";

  // ── What is late ──
  const alerts: { key: string; Icon: LucideIcon; tone: "rose" | "amber"; text: string; href: string }[] = [];
  if ((overdue ?? 0) > 0) {
    alerts.push({ key: "overdue", Icon: AlarmClock, tone: "rose", text: t("alerts.overdue", { count: overdue ?? 0, n: formatNumber(overdue ?? 0, locale) }), href: "/attendance?view=overdue" });
  }
  if ((month?.missing ?? 0) > 0) {
    alerts.push({ key: "reports", Icon: FileWarning, tone: "amber", text: t("alerts.reports", { count: month?.missing ?? 0, n: formatNumber(month?.missing ?? 0, locale) }), href: "/lesson-reports?tab=missing&period=month" });
  }
  if (groupOwed > 0) {
    alerts.push({ key: "sheets", Icon: UsersRound, tone: "amber", text: t("alerts.sheets", { count: groupOwed, n: formatNumber(groupOwed, locale) }), href: "/groups/lessons" });
  }

  const hours = Math.floor(taught.minutes / 60);
  const mins = taught.minutes % 60;
  const money = (minor: number, currency: string | null) =>
    formatMoney({ amount: minor, currency: currency ?? session?.academy?.defaultCurrency ?? "EGP" }, locale, { trimZeroDecimals: true });

  const kpis: { key: string; Icon: LucideIcon; tone: CentreTone; label: string; value: number | null; display?: string; note?: string; href?: string }[] = [
    {
      key: "taught",
      Icon: ClipboardCheck,
      tone: "emerald",
      label: t("kpi.taught"),
      value: lessons === null ? null : taught.count,
      note: lessons === null ? undefined : t("kpi.taughtHours", { hours: formatNumber(hours, locale), minutes: formatNumber(mins, locale) }),
      href: "/attendance",
    },
    {
      key: "reports",
      Icon: NotebookText,
      tone: "violet",
      label: t("kpi.reports"),
      value: month === null ? null : month.written,
      note: month === null ? undefined : month.missing > 0 ? t("kpi.reportsMissing", { count: formatNumber(month.missing, locale) }) : t("kpi.reportsAllDone"),
      href: "/lesson-reports",
    },
  ];
  if (can("student.read")) {
    kpis.push({ key: "students", Icon: GraduationCap, tone: "sky", label: t("kpi.students"), value: students, href: "/students" });
  }
  if (can("payout.read_own")) {
    kpis.push({
      key: "earnings",
      Icon: BadgeDollarSign,
      tone: "amber",
      label: t("kpi.earnings"),
      value: earnings === null ? null : earnings.amount,
      display: earnings === null ? undefined : money(earnings.amount, earnings.currency),
      href: "/payroll",
    });
  }

  const links: { key: string; Icon: LucideIcon; href: string; label: string; show: boolean }[] = [
    { key: "attendance", Icon: ClipboardCheck, href: "/attendance", label: t("links.attendance"), show: can("session.read") },
    { key: "reports", Icon: NotebookText, href: "/lesson-reports", label: t("links.reports"), show: can("session.read") },
    { key: "students", Icon: GraduationCap, href: "/students", label: t("links.students"), show: can("student.read") },
    { key: "calendar", Icon: CalendarDays, href: "/calendar", label: t("links.calendar"), show: can("schedule.read") },
    { key: "monthly", Icon: NotebookPen, href: "/student-reports", label: t("links.monthly"), show: studentReportsOn },
    { key: "payroll", Icon: Wallet, href: "/payroll", label: t("links.payroll"), show: can("payout.read_own") },
  ];

  return (
    <div className="space-y-4 pb-4 sm:space-y-5" data-testid="teacher-dashboard">
      <PageHero
        icon={Sun}
        latticeId="teacher-dashboard-lattice"
        title={`${t("greeting", { greeting, name: firstName })} 👋`}
        subtitle={dateFmt.format(academyNow())}
        actions={
          <Link
            href="/lesson-reports"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/25 bg-white/15 px-4 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/25"
            data-testid="hero-reports"
          >
            <NotebookText className="size-4" aria-hidden />
            {t("links.reports")}
          </Link>
        }
      />

      <SubscriptionBanner />

      {/* ── What is late: only when something is ── */}
      {alerts.length > 0 && (
        <div className={cn("grid gap-2", alerts.length > 1 && "sm:grid-cols-2", alerts.length > 2 && "lg:grid-cols-3")} data-testid="teacher-alerts">
          {alerts.map((a) => (
            <Link
              key={a.key}
              href={a.href}
              data-testid={`teacher-alert-${a.key}`}
              className={cn(
                "group flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-sm font-semibold transition-colors",
                a.tone === "rose"
                  ? "border-rose-300 bg-rose-50 text-rose-900 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-100"
                  : "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100",
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-xl text-white",
                  a.tone === "rose" ? "bg-rose-600" : "bg-amber-500",
                )}
              >
                <a.Icon className="size-4.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">{a.text}</span>
              <ArrowLeft className="size-4 shrink-0 transition-transform group-hover:-translate-x-0.5 ltr:rotate-180" aria-hidden />
            </Link>
          ))}
        </div>
      )}

      {/* ── Today, with the Enter button ── */}
      <MyLessonsToday groups={groupsOn} />

      {/* ── The month, in four numbers ── */}
      <section className={cn("grid grid-cols-2 gap-3 sm:gap-4", kpis.length >= 4 ? "xl:grid-cols-4" : kpis.length === 3 && "xl:grid-cols-3")}>
        {kpis.map(({ key, ...kpi }) => (
          <KpiCard key={key} {...kpi} loading={kpi.value === null && kpi.display === undefined} locale={locale} />
        ))}
      </section>

      {/* ── What they wrote, and what is coming ── */}
      <section className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
        <ListCard
          Icon={NotebookText}
          title={t("recent.title")}
          footerHref="/lesson-reports"
          footerLabel={t("recent.all")}
          empty={recent !== null && recent.length === 0 ? t("recent.empty") : undefined}
          testId="teacher-recent-reports"
        >
          {recent === null
            ? [1, 2, 3].map((k) => <div key={k} className="bg-muted h-14 animate-pulse rounded-xl" />)
            : recent.map((r) => {
                const answers = reportAnswers(r.report_values, fields);
                const text = reportText(r.report_values);
                const preview = text ? reportPlainText(text) : answers.map((a) => a.value).join(" · ");
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setOpened(r)}
                    className="hover:bg-muted/60 flex w-full items-center gap-3 rounded-xl p-1.5 text-start transition-colors"
                    data-testid="teacher-recent-report"
                  >
                    <PastelTile Icon={NotebookText} tone="violet" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-bold">{r.student_name ?? "—"}</span>
                        <span className="text-muted-foreground shrink-0 text-xs">{shortDateFmt.format(new Date(r.scheduled_at_utc))}</span>
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">{preview}</span>
                    </span>
                  </button>
                );
              })}
        </ListCard>

        <ListCard
          Icon={CalendarClock}
          title={t("upcoming.title")}
          footerHref={can("schedule.read") ? "/calendar" : "/attendance"}
          footerLabel={t("upcoming.all")}
          empty={lessons !== null && upcoming.length === 0 ? t("upcoming.empty") : undefined}
          testId="teacher-upcoming"
        >
          {lessons === null
            ? [1, 2, 3].map((k) => <div key={k} className="bg-muted h-14 animate-pulse rounded-xl" />)
            : upcoming.map((s) => (
                <ListRow
                  key={s.id}
                  tile={<PastelTile Icon={s.group ? UsersRound : CalendarDays} tone={s.group ? "amber" : "sky"} />}
                  title={s.student_name ?? "—"}
                  sub={`${dayTimeFmt.format(new Date(s.scheduled_at_utc))} · ${t("minutes", { count: formatNumber(s.duration_minutes, locale) })}`}
                  end={academyDay(s.scheduled_at_utc) === today ? <StatusBadge status={s.status} /> : undefined}
                />
              ))}
        </ListCard>
      </section>

      {/* A quality report or a deduction changes what this teacher earns: explained where they look every day. */}
      {can("teacher_quality.read_own") && <MyQualityPanel />}

      {/* ── Everywhere a teacher goes, one tap away ── */}
      <nav className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label={t("links.title")}>
        {links
          .filter((l) => l.show)
          .map((l) => (
            <Link
              key={l.key}
              href={l.href}
              data-testid={`teacher-link-${l.key}`}
              className="bg-card hover:border-primary/40 hover:bg-muted/40 flex items-center gap-2.5 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors"
            >
              <l.Icon className="text-primary size-4.5 shrink-0" aria-hidden />
              <span className="truncate">{l.label}</span>
            </Link>
          ))}
      </nav>

      <Modal
        open={opened !== null}
        onClose={() => setOpened(null)}
        title={opened?.student_name ?? t("recent.title")}
        description={opened ? dateFmt.format(new Date(opened.scheduled_at_utc)) : undefined}
        size="lg"
      >
        {opened && (
          <div className="space-y-4">
            <LessonReportBody values={opened.report_values} fields={fields} />
            <Link
              href={`/lesson-reports?student=${opened.student_id}`}
              className="text-primary inline-flex items-center gap-1 text-sm font-semibold hover:underline"
            >
              {t("recent.studentHistory", { name: opened.student_name ?? "" })}
              <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden />
            </Link>
          </div>
        )}
      </Modal>
    </div>
  );
}
