"use client";

import {
  Activity,
  AlarmClock,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  Crown,
  Database,
  GraduationCap,
  Hourglass,
  Layers,
  MoreVertical,
  PieChart,
  Plus,
  Receipt,
  Repeat,
  Sparkles,
  UserPlus,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CentreHeroArt } from "@/components/centre-art";
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
  PeriodMenu,
  TrendChart,
  type CentreTone,
  type RingSlice,
} from "@/components/dashboard/centre-kit";
import { MyLessonsToday } from "@/components/dashboard/my-lessons-today";
import { SubscriptionBanner } from "@/components/dashboard/subscription-banner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getAccountingOverview, type AccountingOverview } from "@/lib/accounting-api";
import { getTrialSummary, type TrialSummary } from "@/lib/api";
import { useCapability } from "@/lib/capabilities";
import {
  getCentreDashboard,
  getCentreTrend,
  type CentreActivity,
  type CentreDashboard as CentreNumbers,
  type CentreTrend,
  type TrendMonths,
} from "@/lib/centre-dashboard-api";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatRelativeTime } from "@/lib/time";

const PERIODS: readonly TrendMonths[] = [3, 6, 12];

/** A group's tile in the list: the reference's three strong colours, in turn. */
const GROUP_TILES = [
  "bg-gradient-to-br from-indigo-900 to-indigo-600",
  "bg-gradient-to-br from-fuchsia-500 to-violet-600",
  "bg-gradient-to-br from-sky-500 to-blue-700",
] as const;

const ACTIVITY_LOOK: Record<CentreActivity["type"], { Icon: typeof Users; tone: CentreTone }> = {
  student: { Icon: UserPlus, tone: "emerald" },
  group: { Icon: UsersRound, tone: "violet" },
  subscription: { Icon: Layers, tone: "sky" },
  receipt: { Icon: Receipt, tone: "amber" },
};

/**
 * The learning centre's home screen (`SessionAcademy.profile === "CENTRE"`): an opening banner, four
 * numbers, money and people as a chart and a ring, then three short lists, each with a door to the
 * screen that owns it.
 *
 * Every figure is real and comes from the screen that owns it: the centre numbers and comparisons
 * from /dashboard/centre, the months from /dashboard/centre/trend, what families owe from the
 * accounting overview, the placements from the trials board. A Quran academy never sees this
 * component: `DashboardHome` picks it on the profile alone.
 */
export function CentreDashboard() {
  const t = useTranslations("dashboard.centre");
  const tTerm = useTranslations("courseTerm");
  const locale = useLocale();
  const router = useRouter();
  const { session, can } = useAuth();

  const isTeacher = session?.role === "TEACHER";
  const groupsOn = useCapability("groups") && can("group.read");
  const accountingOn = useCapability("accounting") && can("invoice.read");
  const trialsOn = useCapability("trials") && can("trial.read");
  // The numbers need a reader of classes; a teacher's home is their own day (MyLessonsToday).
  const showNumbers = !isTeacher && (can("group.read") || can("session.read"));

  const [numbers, setNumbers] = useState<CentreNumbers | null>(null);
  const [money, setMoney] = useState<AccountingOverview | null>(null);
  const [trials, setTrials] = useState<TrialSummary | null>(null);
  const [trend, setTrend] = useState<CentreTrend | null>(null);
  const [trendFailed, setTrendFailed] = useState(false);
  const [months, setMonths] = useState<TrendMonths>(6);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    // Everything at once; a card whose call fails just stays empty.
    await Promise.allSettled([
      showNumbers ? getCentreDashboard().then(setNumbers) : Promise.resolve(),
      showNumbers && accountingOn ? getAccountingOverview(month).then(setMoney) : Promise.resolve(),
      showNumbers && trialsOn ? getTrialSummary().then(setTrials) : Promise.resolve(),
    ]);
    setLoading(false);
  }, [showNumbers, accountingOn, trialsOn]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!showNumbers) return;
    let cancelled = false;
    setTrendFailed(false);
    getCentreTrend(months)
      .then((next) => {
        if (!cancelled) setTrend(next);
      })
      .catch(() => {
        if (!cancelled) {
          setTrend(null);
          setTrendFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [showNumbers, months]);

  const currency = session?.academy?.defaultCurrency || trend?.collected?.[0]?.currency || "EGP";
  const owed = money?.owed.find((r) => r.currency === currency) ?? money?.owed[0] ?? null;

  const unmarked = (numbers?.today.group_unmarked ?? 0) + (numbers?.today.private_unmarked ?? 0);
  const rate = numbers?.week.attendance_rate ?? null;
  const students = numbers?.students ?? null;

  const firstName = session?.user.fullName?.split(" ")[0] ?? "";

  // ── The chart: money for someone on receipts who may read it, otherwise the lessons held ──
  // Until the months arrive, the permission decides, so the card's title does not change under the reader.
  const showMoney = accountingOn && trend?.collected !== null;
  const series = useMemo(() => {
    if (trend === null) return [];
    if (showMoney) {
      const row = trend.collected?.find((r) => r.currency === currency) ?? trend.collected?.[0];
      return trend.months.map((month) => ({
        month,
        value: row?.by_month.find((m) => m.month === month)?.amount_minor ?? 0,
      }));
    }
    return trend.lessons.map((l) => ({ month: l.month, value: l.count }));
  }, [trend, showMoney, currency]);

  const latest = series[series.length - 1]?.value ?? 0;
  const previous = series[series.length - 2]?.value ?? 0;
  const monthChange = previous > 0 ? Math.round(((latest - previous) / previous) * 100) : null;
  const hasData = series.some((p) => p.value > 0);
  const moneyText = (minor: number) => formatMoney({ amount: minor, currency }, locale, { trimZeroDecimals: true });
  const chartText = (value: number) => (showMoney ? moneyText(value) : formatNumber(value, locale));

  const slices: RingSlice[] = students
    ? [
        { key: "active", label: t("distribution.active"), value: students.active, color: "oklch(0.5 0.21 292)" },
        { key: "inactive", label: t("distribution.inactive"), value: students.inactive, color: "oklch(0.65 0.17 245)" },
        { key: "trial", label: t("distribution.trial"), value: students.trial, color: "oklch(0.72 0.17 155)" },
        { key: "new", label: t("distribution.new"), value: students.new_recent, color: "oklch(0.8 0.16 80)" },
      ]
    : [];

  // ── What needs following up: the first four that apply to this client ──
  const followUps: { key: string; Icon: typeof Users; tone: CentreTone; label: string; count: number; unit: string; href: string }[] = [];
  if (numbers) {
    followUps.push({
      key: "ending",
      Icon: Hourglass,
      tone: numbers.subscriptions.ending_soon > 0 ? "amber" : "violet",
      label: t("followUp.endingSoon"),
      count: numbers.subscriptions.ending_soon,
      unit: t("followUp.subscriber"),
      href: "/packages/due",
    });
    if (groupsOn) {
      followUps.push({
        key: "terms",
        Icon: Repeat,
        tone: (numbers.groups.ending_soon ?? 0) > 0 ? "amber" : "sky",
        label: tTerm("dashboard.endingSoon"),
        count: numbers.groups.ending_soon ?? 0,
        unit: t("followUp.course"),
        href: "/groups?ending_soon=1",
      });
    }
    if (accountingOn && money !== null) {
      followUps.push({
        key: "arrears",
        Icon: AlarmClock,
        tone: "rose",
        label: t("followUp.arrears"),
        count: owed?.payers ?? 0,
        unit: t("followUp.family"),
        href: "/accounting/arrears",
      });
    }
    if (trialsOn && trials !== null) {
      followUps.push({
        key: "trials",
        Icon: Sparkles,
        tone: (trials.needs_decision ?? 0) > 0 ? "rose" : "slate",
        label: t("followUp.trials"),
        count: trials.needs_decision ?? 0,
        unit: t("followUp.student"),
        href: "/trials",
      });
    }
    if (groupsOn) {
      followUps.push({
        key: "seats",
        Icon: Users,
        tone: "emerald",
        label: t("followUp.freeSeats"),
        count: numbers.groups.free_seats,
        unit: t("followUp.seat"),
        href: "/groups",
      });
    }
  }

  const addOptions: { key: string; label: string; href: string; Icon: typeof Users }[] = [];
  if (can("student.create")) addOptions.push({ key: "student", label: t("hero.addStudent"), href: "/students", Icon: GraduationCap });
  if (groupsOn && can("group.manage")) addOptions.push({ key: "group", label: t("hero.addGroup"), href: "/groups", Icon: UsersRound });
  if (accountingOn && can("invoice.mark_paid")) addOptions.push({ key: "collect", label: t("hero.collect"), href: "/accounting", Icon: Wallet });

  const activityText = (row: CentreActivity): string => {
    if (row.type === "receipt" && row.amount_minor !== null && row.currency !== null) {
      return t("activity.receipt", { amount: formatMoney({ amount: row.amount_minor, currency: row.currency }, locale, { trimZeroDecimals: true }) });
    }
    return t(`activity.${row.type}`);
  };

  const groupsList = numbers?.latest_groups ?? [];
  const activity = numbers?.activity ?? [];

  return (
    <div className="space-y-4 sm:space-y-5" data-testid="centre-dashboard">
      <SubscriptionBanner />

      {/* ── The opening banner ── */}
      <section className="centre-hero relative overflow-hidden rounded-[1.25rem] px-5 py-5 sm:px-8 sm:py-7" data-testid="centre-hero">
        <CentreHeroArt className="pointer-events-none absolute end-4 bottom-0 hidden h-[92%] max-w-[46%] lg:block" />
        <div className="relative max-w-xl">
          <h1 className="text-2xl leading-tight font-extrabold tracking-tight break-words sm:text-[2rem]">
            {t("hero.greeting", { name: firstName })} <span aria-hidden>👋</span>
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
                  {t("hero.timetable")}
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      {isTeacher && <MyLessonsToday groups={groupsOn} />}

      {showNumbers && (
        <>
          {/* ── Four numbers: two across on a phone, four on a desk ── */}
          <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <KpiCard
              Icon={Users}
              tone="emerald"
              label={t("kpi.students")}
              value={students?.total ?? null}
              chip={<DeltaChip value={students?.delta_pct} />}
              note={students?.delta_pct !== null && students?.delta_pct !== undefined ? t("kpi.vsLastMonth") : undefined}
              loading={loading}
              href="/students"
              locale={locale}
            />
            <KpiCard
              Icon={CalendarDays}
              tone="sky"
              label={t("kpi.todayClasses")}
              value={numbers ? numbers.today.group_lessons + numbers.today.private_lessons : null}
              chip={
                numbers && unmarked > 0 ? (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                    {t("kpi.unmarked", { count: unmarked })}
                  </span>
                ) : undefined
              }
              note={rate !== null ? t("kpi.attendanceWeek", { rate: formatNumber(Math.round(rate * 100), locale) }) : undefined}
              loading={loading}
              href="/attendance"
              locale={locale}
            />
            <KpiCard
              Icon={UsersRound}
              tone="pink"
              label={t("kpi.groups")}
              value={numbers?.groups.running ?? null}
              chip={<DeltaChip value={numbers?.groups.delta_pct} />}
              note={numbers?.groups.delta_pct !== null && numbers?.groups.delta_pct !== undefined ? t("kpi.vsLastMonth") : undefined}
              loading={loading}
              href="/groups"
              locale={locale}
            />
            <KpiCard
              Icon={Layers}
              tone="violet"
              label={t("kpi.subscriptions")}
              value={numbers?.subscriptions.open ?? null}
              chip={<DeltaChip value={numbers?.subscriptions.delta_pct} />}
              note={numbers?.subscriptions.delta_pct !== null && numbers?.subscriptions.delta_pct !== undefined ? t("kpi.vsLastMonth") : undefined}
              loading={loading}
              href="/packages"
              locale={locale}
            />
          </section>

          {/* ── People and money. A phone reads the money first. ── */}
          <section className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            {students !== null && (
              <div className={centrePanelClass + " order-2 flex flex-col p-4 sm:p-5 lg:order-1"}>
                <PanelTitle Icon={PieChart} title={t("distribution.title")} />
                {students.total === 0 ? (
                  <p className="text-muted-foreground py-14 text-center text-sm">{t("distribution.empty")}</p>
                ) : (
                  <DistributionRing slices={slices} total={students.total} unit={t("distribution.unit")} locale={locale} />
                )}
              </div>
            )}

            <div className={centrePanelClass + " order-1 min-w-0 p-4 sm:p-5 lg:order-2" + (students === null && !loading ? " lg:col-span-2" : "")}>
              <PanelTitle
                Icon={showMoney ? Database : BookOpen}
                title={showMoney ? t("trend.collected") : t("trend.lessons")}
                end={
                  <PeriodMenu
                    value={months}
                    options={PERIODS}
                    label={(m) => t("trend.period", { months: m })}
                    onChange={setMonths}
                  />
                }
              />
              {trend === null && !trendFailed ? (
                <div className="bg-muted mt-4 h-60 animate-pulse rounded-xl" />
              ) : !hasData ? (
                <p className="text-muted-foreground py-20 text-center text-sm">{showMoney ? t("trend.emptyMoney") : t("trend.emptyLessons")}</p>
              ) : (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="text-2xl font-extrabold tracking-tight tabular-nums sm:text-[1.75rem]" data-testid="trend-latest">
                      {chartText(latest)}
                    </p>
                    <DeltaChip value={monthChange} />
                    {showMoney && owed && owed.due_minor > 0 && (
                      <Link href="/accounting/arrears" className="text-muted-foreground hover:text-foreground ms-auto text-xs font-medium transition-colors">
                        {t("trend.owed", { amount: moneyText(owed.due_minor) })}
                      </Link>
                    )}
                  </div>
                  <TrendChart
                    points={series}
                    format={chartText}
                    unitsPerAxisStep={showMoney ? 100 : 1}
                    monthLabel={monthFormatter(locale, true)}
                    shortMonthLabel={monthFormatter(locale, false)}
                    label={showMoney ? t("trend.collected") : t("trend.lessons")}
                  />
                </>
              )}
            </div>
          </section>

          {/* ── Three lists ── */}
          <section className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-3">
            {groupsOn && (
              <ListCard
                Icon={UsersRound}
                title={t("groups.title")}
                footerHref="/groups"
                footerLabel={t("groups.manage")}
                empty={!loading && groupsList.length === 0 ? t("groups.empty") : undefined}
                testId="latest-groups"
              >
                {groupsList.map((g, i) => (
                  <ListRow
                    key={g.id}
                    href={`/groups/${g.id}`}
                    tile={
                      <span className={"flex size-11 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold text-white " + GROUP_TILES[i % GROUP_TILES.length]} aria-hidden>
                        {g.name.trim().slice(0, 2).toUpperCase()}
                      </span>
                    }
                    title={g.name}
                    sub={t("groups.members", { count: g.members })}
                    end={
                      <DropdownMenu>
                        <DropdownMenuTrigger>
                          <button
                            type="button"
                            aria-label={t("groups.more", { name: g.name })}
                            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 rounded-lg p-1.5 transition-colors outline-none focus-visible:ring-2"
                          >
                            <MoreVertical className="size-4" aria-hidden />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => router.push(`/groups/${g.id}`)} closeOnClick>
                            <UsersRound aria-hidden />
                            {t("groups.open")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => router.push("/attendance")} closeOnClick>
                            <ClipboardCheck aria-hidden />
                            {t("groups.lessons")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    }
                  />
                ))}
              </ListCard>
            )}

            <ListCard
              Icon={Crown}
              title={t("followUp.title")}
              footerHref="/packages/due"
              footerLabel={t("followUp.manage")}
              testId="follow-ups"
            >
              {followUps.slice(0, 4).map((row) => (
                <ListRow
                  key={row.key}
                  href={row.href}
                  tile={<PastelTile Icon={row.Icon} tone={row.tone} />}
                  title={row.label}
                  end={
                    <span className="text-muted-foreground shrink-0 pe-1 text-xs whitespace-nowrap">
                      <span className="text-foreground text-sm font-extrabold tabular-nums">{formatNumber(row.count, locale)}</span> {row.unit}
                    </span>
                  }
                />
              ))}
            </ListCard>

            <ListCard
              Icon={Activity}
              title={t("activity.title")}
              footerHref={can("audit.read") ? "/audit" : undefined}
              footerLabel={t("activity.all")}
              empty={!loading && activity.length === 0 ? t("activity.empty") : undefined}
              testId="activity"
            >
              {activity.map((row, i) => {
                const look = ACTIVITY_LOOK[row.type];
                return (
                  <ListRow
                    key={`${row.type}-${row.at}-${i}`}
                    tile={<PastelTile Icon={look.Icon} tone={look.tone} />}
                    title={activityText(row)}
                    sub={[row.name, formatRelativeTime(row.at, locale)].filter(Boolean).join(" · ")}
                  />
                );
              })}
            </ListCard>
          </section>
        </>
      )}
    </div>
  );
}
