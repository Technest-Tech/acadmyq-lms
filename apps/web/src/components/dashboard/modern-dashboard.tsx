"use client";

import {
  BadgeDollarSign,
  CalendarDays,
  CheckCircle2,
  Clock,
  FlaskConical,
  GraduationCap,
  PieChart,
  Plus,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { FollowControl, type FollowInfo } from "@/components/attendance/follow-control";
import { useAuth } from "@/components/auth-provider";
import {
  centrePanelClass,
  DeltaChip,
  DistributionRing,
  KpiCard,
  ListCard,
  ListRow,
  monthFormatter,
  PanelTitle,
  PastelTile,
  TrendChart,
  type CentreTone,
  type RingSlice,
} from "@/components/dashboard/centre-kit";
import { MyLessonsToday } from "@/components/dashboard/my-lessons-today";
import { SubscriptionBanner } from "@/components/dashboard/subscription-banner";
import { MyQualityPanel } from "@/components/quality/my-quality-panel";
import { CoursesHeroArt } from "@/components/courses-art";
import { QuranHeroArt } from "@/components/quran-art";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  getCalendar,
  getInvoiceSummary,
  getPendingAttendance,
  getProfitSummary,
  listMyPayouts,
  listStudents,
  listTeachers,
  listTrials,
  type CalendarSession,
  type InvoiceSummary,
  type PendingSession,
  type ProfitSummary,
} from "@/lib/api";
import { useCapability } from "@/lib/capabilities";
import { groupLessonsAsSessions, attendedGroupLessons } from "@/lib/group-calendar";
import { getGroupLessonsSummary } from "@/lib/groups-api";
import { formatMoney, formatNumber } from "@/lib/money";
import { numeralLocale } from "@/lib/numerals";
import { formatRelativeTime } from "@/lib/time";
import { bookedTrialsAsLessons, mergeWeekTrials, type WeekTrial } from "@/lib/week-trials";

/** The viewer's own calendar day (academy-dashboard.tsx `isoDate`: never `toISOString`). */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentWeek(): { from: string; to: string } {
  const today = new Date();
  const dow = today.getDay();
  const mon = new Date(today);
  mon.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: isoDate(mon), to: isoDate(sun) };
}

function lastSixMonths(): { year: number; month: number }[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
}

const DONE = new Set(["ATTENDED", "ABSENT_EXCUSED", "ABSENT_UNEXCUSED"]);
const CANCELLED = new Set(["CANCELLED_BY_TEACHER", "CANCELLED_BY_STUDENT"]);

interface Kpi {
  key: string;
  Icon: LucideIcon;
  tone: CentreTone;
  label: string;
  value: number | null;
  display?: string;
  chip?: ReactNode;
  note?: string;
  loading: boolean;
  href?: string;
}

/**
 * The Quran academy's home screen in the modern look (`modern_look`, switched on per client): the
 * same design as the centre's dashboard, in the academy's own navy and gold, with only what someone
 * opens the panel for. A banner with the mushaf and the mosque (`QuranHeroArt`), up to four numbers
 * (people, today's lessons, what is owed), the week's lessons and the money as a ring and a chart,
 * then the two worklists: attendance still to record and this week's trials.
 *
 * What the classic dashboard also carried and this one leaves to the screen that owns it: the plan's
 * usage rings, the invoice breakdown and collection gauge, the average bill, salaries and net profit
 * (Payroll / Financial statistics), the hours of the month, the quick-action tiles that repeated the
 * sidebar, and the red overdue-lessons banner (Ahmed's call: the lessons stay on /attendance's own
 * tab and in the pending list below). A classic academy never sees this component: `DashboardHome` picks it on the switch.
 */
export function ModernDashboard() {
  const t = useTranslations("dashboard.modern");
  const tDash = useTranslations("dashboard");
  const locale = useLocale();
  const router = useRouter();
  const { session, can } = useAuth();

  const isTeacher = session?.role === "TEACHER";
  const groupsOn = useCapability("groups") && can("group.read");
  const accountingOn = useCapability("accounting");
  const trialsOn = useCapability("trials") && can("trial.read");
  // Opt-in, so strict: no capability list means the Quran picture.
  const coursesArt = session?.capabilities?.includes("courses_art") ?? false;
  const readsLessons = can("schedule.read") || can("session.read");
  const marksLessons = can("session.mark_attendance") || can("session.read");

  const [studentsTotal, setStudentsTotal] = useState<number | null>(null);
  const [teachersTotal, setTeachersTotal] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingSession[] | null>(null);
  const [groupOwed, setGroupOwed] = useState(0);
  const [invoices, setInvoices] = useState<InvoiceSummary | null>(null);
  const [week, setWeek] = useState<CalendarSession[] | null>(null);
  const [trialIds, setTrialIds] = useState<Set<string>>(new Set());
  const [bookedTrials, setBookedTrials] = useState<WeekTrial[]>([]);
  const [revenue, setRevenue] = useState<(ProfitSummary | null)[] | null>(null);
  const [earnings, setEarnings] = useState<{ amount: number; currency: string | null } | null>(null);
  const [followed, setFollowed] = useState<Record<string, FollowInfo>>({});
  const [followError, setFollowError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = currentWeek();
    const months = lastSixMonths();
    const now = new Date();
    // Everything at once; a card whose call fails just stays empty.
    await Promise.allSettled([
      can("student.read") ? listStudents({ pageSize: 1 }).then((r) => setStudentsTotal(r.total)) : Promise.resolve(),
      can("teacher.read") && !isTeacher ? listTeachers({ pageSize: 1 }).then((r) => setTeachersTotal(r.total)) : Promise.resolve(),
      marksLessons
        ? getPendingAttendance()
            .then((r) => setPending(r.sessions))
            .catch(() => setPending([]))
        : Promise.resolve().then(() => setPending([])),
      groupsOn ? getGroupLessonsSummary().then((r) => setGroupOwed(r.owed ?? 0)) : Promise.resolve(),
      can("invoice.read") && !isTeacher ? getInvoiceSummary().then(setInvoices) : Promise.resolve(),
      readsLessons
        ? getCalendar({ from, to })
            .then((r) => setWeek([...r.sessions, ...groupLessonsAsSessions(attendedGroupLessons(r.group_lessons ?? []))]))
            .catch(() => setWeek([]))
        : Promise.resolve(),
      // Both trial statuses: a learner is TRIAL_BOOKED the moment their trial is on the calendar.
      can("student.read") && readsLessons
        ? listStudents({ filter: { trial_any: "1" }, pageSize: 200 }).then((r) => setTrialIds(new Set(r.rows.map((s) => s.id))))
        : Promise.resolve(),
      // Trials booked on the Trials page are not lessons: the list needs them read on their own.
      trialsOn
        ? listTrials({ filter: { from, to }, pageSize: 100, sort: "scheduled" })
            .then((r) => setBookedTrials(bookedTrialsAsLessons(r.rows)))
            .catch(() => setBookedTrials([]))
        : Promise.resolve(),
      can("payout.read") && !isTeacher
        ? Promise.all(months.map((m) => getProfitSummary(m.year, m.month).catch(() => null))).then(setRevenue)
        : Promise.resolve(),
      can("payout.read_own")
        ? listMyPayouts({ pageSize: 50, sort: "-period" })
            .then((r) => {
              const current = r.rows.find((p) => p.period_year === now.getFullYear() && p.period_month === now.getMonth() + 1);
              setEarnings({ amount: current?.total_minor ?? 0, currency: current?.currency ?? r.rows[0]?.currency ?? null });
            })
            .catch(() => setEarnings({ amount: 0, currency: null }))
        : Promise.resolve(),
    ]);
    setLoading(false);
  }, [can, isTeacher, groupsOn, marksLessons, readsLessons, trialsOn]);

  useEffect(() => {
    void load();
  }, [load]);

  const currency = session?.academy?.defaultCurrency || invoices?.money[0]?.currency || "EGP";
  const money = (minor: number, cur = currency) => formatMoney({ amount: minor, currency: cur }, locale, { trimZeroDecimals: true });
  const timeOf = (iso: string) =>
    new Intl.DateTimeFormat(numeralLocale(locale), { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  // ── Today, out of the week the calendar already sent ──
  const today = useMemo(() => {
    const day = isoDate(new Date());
    return (week ?? []).filter((s) => !CANCELLED.has(s.status) && s.status !== "RESCHEDULED" && isoDate(new Date(s.scheduled_at_utc)) === day);
  }, [week]);
  const todayDone = today.filter((s) => DONE.has(s.status)).length;
  const pendingCount = (pending?.length ?? 0) + groupOwed;

  // ── The week as a ring: what happened to each lesson ──
  const weekSlices: RingSlice[] = useMemo(() => {
    const rows = (week ?? []).filter((s) => s.status !== "RESCHEDULED");
    const count = (pred: (s: CalendarSession) => boolean) => rows.filter(pred).length;
    return [
      { key: "attended", label: t("week.attended"), value: count((s) => s.status === "ATTENDED"), color: "oklch(0.6 0.15 163)" },
      { key: "absent", label: t("week.absent"), value: count((s) => s.status === "ABSENT_EXCUSED" || s.status === "ABSENT_UNEXCUSED"), color: "oklch(0.64 0.19 15)" },
      { key: "scheduled", label: t("week.scheduled"), value: count((s) => s.status === "SCHEDULED"), color: "oklch(0.7 0.13 240)" },
      { key: "cancelled", label: t("week.cancelled"), value: count((s) => CANCELLED.has(s.status)), color: "oklch(0.8 0.11 85)" },
    ];
  }, [week, t]);
  const weekTotal = weekSlices.reduce((sum, s) => sum + s.value, 0);

  // ── Six months of revenue in the academy's currency ──
  const series = useMemo(() => {
    if (revenue === null) return [];
    return lastSixMonths().map((m, i) => {
      const rows = revenue[i]?.rows ?? [];
      const row = rows.find((r) => r.currency === currency) ?? rows[0];
      return { month: `${m.year}-${String(m.month).padStart(2, "0")}`, value: row?.revenue_minor ?? 0 };
    });
  }, [revenue, currency]);
  const latest = series[series.length - 1]?.value ?? 0;
  const previous = series[series.length - 2]?.value ?? 0;
  const monthChange = previous > 0 ? Math.round(((latest - previous) / previous) * 100) : null;
  const hasRevenue = series.some((p) => p.value > 0);

  // This week's trials: a trial learner's one-off lesson (their recurring lessons are lessons), and
  // every trial booked on the Trials page.
  const trialLessons = useMemo(
    () =>
      mergeWeekTrials(
        (week ?? []).filter((s) => trialIds.has(s.student_id) && s.schedule_id === null),
        bookedTrials,
      ),
    [week, trialIds, bookedTrials],
  );

  // ── Up to four numbers, each only for someone who may read it ──
  const due = invoices?.money.find((m) => m.currency === currency) ?? invoices?.money[0] ?? null;
  const kpis: Kpi[] = [];
  if (can("student.read")) {
    kpis.push({ key: "students", Icon: GraduationCap, tone: "violet", label: t("kpi.students"), value: studentsTotal, loading, href: "/students" });
  }
  if (teachersTotal !== null || (can("teacher.read") && !isTeacher)) {
    kpis.push({ key: "teachers", Icon: Users, tone: "sky", label: t("kpi.teachers"), value: teachersTotal, loading, href: "/teachers" });
  }
  if (readsLessons) {
    kpis.push({
      key: "today",
      Icon: CalendarDays,
      tone: "amber",
      label: t("kpi.today"),
      value: week === null ? null : today.length,
      note: today.length > 0 ? t("kpi.todayDone", { done: formatNumber(todayDone, locale), total: formatNumber(today.length, locale) }) : undefined,
      chip:
        pendingCount > 0 ? (
          <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
            {t("kpi.unmarked", { count: formatNumber(pendingCount, locale) })}
          </span>
        ) : undefined,
      loading,
      href: "/attendance",
    });
  }
  if (due !== null || (can("invoice.read") && !isTeacher)) {
    kpis.push({
      key: "due",
      Icon: Wallet,
      tone: "rose",
      label: t("kpi.due"),
      value: due === null ? null : due.due_minor,
      display: due === null ? undefined : money(due.due_minor, due.currency),
      note: invoices && invoices.counts.OPEN > 0 ? t("kpi.openBills", { count: invoices.counts.OPEN }) : undefined,
      loading,
      href: accountingOn ? "/accounting/arrears" : "/invoices",
    });
  }
  if (can("payout.read_own") && isTeacher) {
    kpis.push({
      key: "earnings",
      Icon: BadgeDollarSign,
      tone: "emerald",
      label: t("kpi.earnings"),
      value: earnings === null ? null : earnings.amount,
      display: earnings === null ? undefined : money(earnings.amount, earnings.currency ?? currency),
      loading,
      href: "/payroll",
    });
  }

  const addOptions: { key: string; label: string; href: string; Icon: LucideIcon }[] = [];
  if (can("student.create")) addOptions.push({ key: "student", label: t("hero.addStudent"), href: "/students", Icon: GraduationCap });
  if (trialsOn && can("trial.manage")) addOptions.push({ key: "trial", label: t("hero.addTrial"), href: "/trials", Icon: FlaskConical });
  if (groupsOn && can("group.manage")) addOptions.push({ key: "group", label: t("hero.addGroup"), href: "/groups", Icon: UsersRound });
  if (can("invoice.mark_paid")) {
    addOptions.push({ key: "collect", label: t("hero.collect"), href: accountingOn ? "/accounting" : "/invoices", Icon: Wallet });
  }

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return tDash("greeting.morning");
    if (h < 17) return tDash("greeting.afternoon");
    return tDash("greeting.evening");
  })();
  const firstName = session?.user.fullName?.split(" ")[0] ?? "";

  const showWeek = readsLessons && !isTeacher;
  const showRevenue = revenue !== null || (can("payout.read") && !isTeacher);
  const showTrials = can("student.read") && readsLessons;

  return (
    <div className="space-y-4 sm:space-y-5" data-testid="modern-dashboard">
      <SubscriptionBanner />

      {/* ── The opening banner: the centre's layout, with the mushaf, the mosque and the lantern ── */}
      <section className="centre-hero relative overflow-hidden rounded-[1.25rem] px-5 py-5 sm:px-8 sm:py-7" data-testid="modern-hero">
        {/* An academy teaching courses and curricula, not the Quran, gets its own picture (`courses_art`). */}
        {coursesArt ? (
          <CoursesHeroArt className="pointer-events-none absolute end-4 bottom-0 hidden h-[92%] max-w-[46%] lg:block" />
        ) : (
          <QuranHeroArt className="pointer-events-none absolute end-4 bottom-0 hidden h-[92%] max-w-[46%] lg:block" />
        )}
        <div className="relative max-w-xl">
          <h1 className="text-2xl leading-tight font-extrabold tracking-tight break-words sm:text-[2rem]">
            {t("hero.greeting", { greeting, name: firstName })} <span aria-hidden>👋</span>
          </h1>
          <p className="centre-hero__sub mt-1.5 text-sm sm:text-base">{t("hero.subtitle")}</p>
          {(addOptions.length > 0 || can("schedule.read")) && (
            <div className="mt-4 flex flex-wrap items-center gap-2.5 sm:mt-5">
              {addOptions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <Button size="lg" data-testid="hero-add" className="px-5">
                      <Plus className="size-5" aria-hidden />
                      {t("hero.addNew")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {addOptions.map(({ key, label, href, Icon }) => (
                      <DropdownMenuItem key={key} onClick={() => router.push(href)} closeOnClick>
                        <Icon aria-hidden />
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {can("schedule.read") && (
                <Link
                  href="/calendar"
                  className="bg-card text-foreground hover:bg-muted focus-visible:ring-ring/50 hidden h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold shadow-sm transition-colors outline-none focus-visible:ring-2 sm:inline-flex"
                >
                  <CalendarDays className="size-5" aria-hidden />
                  {t("hero.calendar")}
                </Link>
              )}
            </div>
          )}
        </div>
      </section>
      {/* The teacher's own day, with the Enter button their punctuality is measured by. */}
      {isTeacher && <MyLessonsToday groups={groupsOn} />}

      {kpis.length > 0 && (
        <section className={"grid grid-cols-2 gap-3 sm:gap-4 " + (kpis.length >= 4 ? "xl:grid-cols-4" : kpis.length === 3 ? "xl:grid-cols-3" : "")}>
          {kpis.map(({ key, ...kpi }) => (
            <KpiCard key={key} {...kpi} locale={locale} />
          ))}
        </section>
      )}

      {/* ── The week and the money. A phone reads the money first. ── */}
      {(showWeek || showRevenue) && (
        <section className={"grid grid-cols-1 gap-3 sm:gap-4" + (showWeek && showRevenue ? " lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]" : "")}>
          {showWeek && (
            <div className={centrePanelClass + " order-2 flex flex-col p-4 sm:p-5 lg:order-1"} data-testid="week-ring">
              <PanelTitle
                Icon={PieChart}
                title={t("week.title")}
                end={
                  <Link href="/calendar" className="text-muted-foreground hover:text-foreground text-xs font-semibold transition-colors">
                    {tDash("week.viewCalendar")}
                  </Link>
                }
              />
              {week === null ? (
                <div className="bg-muted mt-4 h-44 animate-pulse rounded-xl" />
              ) : weekTotal === 0 ? (
                <p className="text-muted-foreground py-14 text-center text-sm">{t("week.empty")}</p>
              ) : (
                <DistributionRing slices={weekSlices} total={weekTotal} unit={t("week.unit")} locale={locale} />
              )}
            </div>
          )}

          {showRevenue && (
            <div className={centrePanelClass + " order-1 min-w-0 p-4 sm:p-5 lg:order-2"} data-testid="revenue-trend">
              <PanelTitle
                Icon={BadgeDollarSign}
                title={t("revenue.title")}
                end={<span className="text-muted-foreground text-xs font-semibold">{t("revenue.period")}</span>}
              />
              {revenue === null ? (
                <div className="bg-muted mt-4 h-60 animate-pulse rounded-xl" />
              ) : !hasRevenue ? (
                <p className="text-muted-foreground py-20 text-center text-sm">{t("revenue.empty")}</p>
              ) : (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="text-2xl font-extrabold tracking-tight tabular-nums sm:text-[1.75rem]" data-testid="revenue-latest">
                      {money(latest)}
                    </p>
                    <DeltaChip value={monthChange} />
                    <span className="text-muted-foreground text-xs">{t("revenue.thisMonth")}</span>
                  </div>
                  <TrendChart
                    points={series}
                    format={(v) => money(v)}
                    unitsPerAxisStep={100}
                    monthLabel={monthFormatter(locale, true)}
                    shortMonthLabel={monthFormatter(locale, false)}
                    label={t("revenue.title")}
                  />
                </>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── The two worklists ── */}
      {(marksLessons || showTrials) && (
        <section className={"grid grid-cols-1 gap-3 sm:gap-4" + (marksLessons && showTrials ? " lg:grid-cols-2" : "")}>
          {marksLessons && (
            <ListCard
              Icon={Clock}
              title={tDash("pending.title")}
              footerHref="/attendance"
              footerLabel={tDash("pending.viewAll")}
              testId="pending-list"
            >
              {followError && (
                <p className="text-destructive px-1.5 text-xs" role="alert">
                  {followError}
                </p>
              )}
              {pending === null ? (
                [1, 2, 3].map((k) => <div key={k} className="bg-muted h-14 animate-pulse rounded-xl" />)
              ) : pendingCount === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <CheckCircle2 className="size-9 text-emerald-500" aria-hidden />
                  <p className="text-sm font-bold">{tDash("pending.allClear")}</p>
                  <p className="text-muted-foreground text-xs">{tDash("pending.noSessions")}</p>
                </div>
              ) : (
                <>
                  {groupOwed > 0 && (
                    <ListRow
                      href="/groups/lessons"
                      tile={<PastelTile Icon={UsersRound} tone="amber" />}
                      title={tDash("pending.groupSheets", { count: groupOwed })}
                    />
                  )}
                  {pending.slice(0, 5).map((s) => (
                    <ListRow
                      key={s.id}
                      href="/attendance"
                      tile={<PastelTile Icon={Clock} tone="amber" />}
                      title={s.student_name ?? "—"}
                      sub={[s.teacher_name, `${timeOf(s.scheduled_at_utc)} · ${formatRelativeTime(s.scheduled_at_utc, locale)}`]
                        .filter(Boolean)
                        .join(" · ")}
                      end={
                        // "Following" lives here too: a supervisor lands on the dashboard from the
                        // "lesson starting now" alert, so the click must not need another page.
                        <FollowControl
                          sessionId={s.id}
                          followed={
                            followed[s.id] ??
                            (s.followed_at ? { followed_at: s.followed_at, followed_by_name: s.followed_by_name ?? null } : null)
                          }
                          canFollow={can("session.follow")}
                          onFollowed={(info) => setFollowed((m) => ({ ...m, [s.id]: info }))}
                          onError={setFollowError}
                        />
                      }
                    />
                  ))}
                </>
              )}
            </ListCard>
          )}

          {showTrials && (
            <ListCard
              Icon={FlaskConical}
              title={tDash("trials.title")}
              footerHref={trialsOn ? "/trials" : "/students?tab=trials"}
              footerLabel={tDash("trials.viewAll")}
              empty={week !== null && trialLessons.length === 0 ? tDash("trials.noTrials") : undefined}
              testId="trials-list"
            >
              {week === null
                ? [1, 2].map((k) => <div key={k} className="bg-muted h-14 animate-pulse rounded-xl" />)
                : trialLessons.slice(0, 6).map((s) => {
                    const at = new Date(s.scheduled_at_utc);
                    const day = at.toLocaleDateString(numeralLocale(locale), { weekday: "short" });
                    const state =
                      s.status === "ATTENDED"
                        ? { text: t("trials.attended"), cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" }
                        : s.status === "SCHEDULED"
                          ? { text: t("trials.upcoming"), cls: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" }
                          : { text: t("trials.missed"), cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" };
                    return (
                      <ListRow
                        key={s.id}
                        tile={<PastelTile Icon={FlaskConical} tone="sky" />}
                        title={s.student_name ?? "—"}
                        sub={`${s.teacher_name ?? "—"} · ${day} ${timeOf(s.scheduled_at_utc)}`}
                        end={<span className={"shrink-0 rounded-full px-2 py-0.5 text-xs font-bold " + state.cls}>{state.text}</span>}
                      />
                    );
                  })}
            </ListCard>
          )}
        </section>
      )}

      {/* A quality report or a deduction changes what this teacher earns: explained where they look every day. */}
      {isTeacher && can("teacher_quality.read_own") && <MyQualityPanel />}
    </div>
  );
}
