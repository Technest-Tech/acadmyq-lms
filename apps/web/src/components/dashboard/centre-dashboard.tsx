"use client";

import {
  AlarmClock,
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  Hourglass,
  Layers,
  Receipt,
  RefreshCw,
  Repeat,
  Sparkles,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AttendanceRing, CentreAction, CentreSectionTitle, CentreStat, CollectionsChart } from "@/components/dashboard/centre-kit";
import { MyLessonsToday } from "@/components/dashboard/my-lessons-today";
import { SubscriptionBanner } from "@/components/dashboard/subscription-banner";
import { getAccountingOverview, type AccountingOverview } from "@/lib/accounting-api";
import { getProfitSummary, getTrialSummary, type ProfitSummaryRow, type TrialSummary } from "@/lib/api";
import { useCapability } from "@/lib/capabilities";
import { getCentreDashboard, type CentreDashboard as CentreNumbers } from "@/lib/centre-dashboard-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The learning centre's home screen (`SessionAcademy.profile === "CENTRE"`): what a centre's
 * manager looks for first — today's classes and the sheets still owed, the week's attendance, the
 * groups running and the seats left, the subscriptions about to run out — then the month's money.
 *
 * Every figure comes from the screen that owns it: the centre numbers from /dashboard/centre, the
 * money from the accounting overview (only for a client on receipts), the salaries from the profit
 * summary, the placements from the trials board. Each card links to that screen. A Quran academy
 * never sees this component: `DashboardHome` picks it on the profile alone.
 */
export function CentreDashboard() {
  const t = useTranslations("dashboard.centre");
  const tTerm = useTranslations("courseTerm");
  const tDash = useTranslations("dashboard");
  const locale = useLocale();
  const { session, can } = useAuth();

  const isTeacher = session?.role === "TEACHER";
  const groupsOn = useCapability("groups") && can("group.read");
  const accountingOn = useCapability("accounting") && can("invoice.read");
  const payrollOn = useCapability("payroll") && can("payout.read");
  const trialsOn = useCapability("trials") && can("trial.read");
  // The numbers need a reader of classes; a teacher's home is their own day (MyLessonsToday).
  const showNumbers = !isTeacher && (can("group.read") || can("session.read"));

  const [numbers, setNumbers] = useState<CentreNumbers | null>(null);
  const [money, setMoney] = useState<AccountingOverview | null>(null);
  const [profit, setProfit] = useState<ProfitSummaryRow[] | null>(null);
  const [trials, setTrials] = useState<TrialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      // Everything at once; a card whose call fails just stays empty.
      await Promise.allSettled([
        showNumbers ? getCentreDashboard().then(setNumbers) : Promise.resolve(),
        showNumbers && accountingOn ? getAccountingOverview(month).then(setMoney) : Promise.resolve(),
        showNumbers && payrollOn ? getProfitSummary(now.getFullYear(), now.getMonth() + 1).then((p) => setProfit(p.rows)) : Promise.resolve(),
        showNumbers && trialsOn ? getTrialSummary().then(setTrials) : Promise.resolve(),
      ]);
      setLoading(false);
      setRefreshing(false);
    },
    [showNumbers, accountingOn, payrollOn, trialsOn],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const currency = session?.academy?.defaultCurrency || money?.collected[0]?.currency || profit?.[0]?.currency || "EGP";
  const collected = money?.collected.find((r) => r.currency === currency) ?? money?.collected[0] ?? null;
  const owed = money?.owed.find((r) => r.currency === currency) ?? money?.owed[0] ?? null;
  const salaries = profit?.find((r) => r.currency === currency) ?? profit?.[0] ?? null;

  const hour = new Date().getHours();
  const greeting = tDash(hour < 12 ? "greeting.morning" : hour < 17 ? "greeting.afternoon" : "greeting.evening");
  const dateLabel = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  const unmarked = (numbers?.today.group_unmarked ?? 0) + (numbers?.today.private_unmarked ?? 0);
  const rate = numbers?.week.attendance_rate ?? null;

  // `money` null means the overview could not be read: the card says "—", never a false zero.
  const moneyOf = (amount: number | undefined, cur: string | undefined) =>
    money === null ? null : { amount: amount ?? 0, currency: cur ?? currency };

  return (
    <div className="space-y-6" data-testid="centre-dashboard">
      {/* A title line, not a banner: the first screen belongs to today's numbers. */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight break-words sm:text-2xl">
            {greeting}, {session?.user.fullName?.split(" ")[0] ?? "—"} 👋
          </h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {dateLabel} · {t("subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="bg-card text-muted-foreground hover:text-foreground flex size-9 shrink-0 items-center justify-center rounded-xl border shadow-sm transition-colors disabled:opacity-60"
          title="Refresh"
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
        </button>
      </header>

      <SubscriptionBanner />

      {isTeacher && <MyLessonsToday groups={groupsOn} />}

      {showNumbers && (
        <>
          {/* ── Today ── */}
          <section className="space-y-3">
            <CentreSectionTitle title={t("sections.today")} desc={t("sections.todayDesc")} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <CentreStat
                Icon={CalendarDays}
                tone="violet"
                label={t("kpi.todayClasses")}
                value={numbers ? numbers.today.group_lessons + numbers.today.private_lessons : null}
                sub={numbers ? t("kpi.todayClassesSub", { groups: numbers.today.group_lessons, privateCount: numbers.today.private_lessons }) : undefined}
                loading={loading}
                href={groupsOn ? "/groups/lessons" : "/attendance"}
                locale={locale}
              />
              <CentreStat
                Icon={AlarmClock}
                tone={unmarked > 0 ? "amber" : "emerald"}
                label={t("kpi.unmarked")}
                value={numbers ? unmarked : null}
                sub={numbers ? (unmarked > 0 ? t("kpi.unmarkedSub") : t("kpi.unmarkedClear")) : undefined}
                loading={loading}
                alert={unmarked > 0}
                href={groupsOn ? "/groups/lessons" : "/attendance?view=overdue"}
                locale={locale}
              />
              <CentreStat
                Icon={ClipboardCheck}
                tone="sky"
                label={t("kpi.attendanceRate")}
                value={rate === null ? null : Math.round(rate * 100)}
                sub={
                  numbers
                    ? rate === null
                      ? t("kpi.attendanceRateEmpty")
                      : t("kpi.attendanceRateSub", { present: numbers.week.present, absent: numbers.week.absent })
                    : undefined
                }
                progress={rate === null ? undefined : Math.round(rate * 100)}
                loading={loading}
                href="/groups/reports"
                locale={locale}
              />
              <CentreStat
                Icon={Layers}
                tone="indigo"
                label={t("kpi.runningGroups")}
                value={numbers?.groups.running ?? null}
                sub={numbers ? t("kpi.runningGroupsSub", { members: numbers.groups.members }) : undefined}
                loading={loading}
                href="/groups"
                locale={locale}
              />
            </div>
          </section>

          {/* ── The month's collections, the week's sheets ── */}
          {(accountingOn || groupsOn) && !loading && (
            <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {accountingOn && money !== null && (
                <CollectionsChart
                  days={collected?.by_day ?? []}
                  today={money.today}
                  currency={collected?.currency ?? currency}
                  locale={locale}
                  title={t("chart.title")}
                  sub={t("chart.sub")}
                  empty={t("chart.empty")}
                  href="/accounting"
                />
              )}
              {groupsOn && numbers && (
                <AttendanceRing
                  rate={rate}
                  title={t("chart.attendanceTitle")}
                  presentLabel={t("chart.present", { n: numbers.week.present })}
                  absentLabel={t("chart.absent", { n: numbers.week.absent })}
                  empty={t("kpi.attendanceRateEmpty")}
                  locale={locale}
                  wide={!accountingOn || money === null}
                />
              )}
            </section>
          )}

          {/* ── What is coming up ── */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <CentreStat
              Icon={Users}
              tone="violet"
              label={t("kpi.freeSeats")}
              value={numbers?.groups.free_seats ?? null}
              sub={t("kpi.freeSeatsSub")}
              loading={loading}
              href="/groups/students"
              locale={locale}
            />
            <CentreStat
              Icon={Hourglass}
              tone={numbers && numbers.subscriptions.ending_soon > 0 ? "amber" : "slate"}
              label={t("kpi.endingSoon")}
              value={numbers?.subscriptions.ending_soon ?? null}
              sub={numbers ? t("kpi.endingSoonSub", { days: numbers.subscriptions.ending_soon_days }) : undefined}
              loading={loading}
              href="/packages/due"
              locale={locale}
            />
            {/* Course terms about to end (docs/centre-profile, Phase 2 §2); the sub line adds who is waiting for a seat. */}
            {groupsOn && (
              <CentreStat
                Icon={Repeat}
                tone={numbers && (numbers.groups.ending_soon ?? 0) > 0 ? "amber" : "slate"}
                label={tTerm("dashboard.endingSoon")}
                value={numbers?.groups.ending_soon ?? null}
                sub={numbers ? tTerm("dashboard.endingSoonSub", { days: 14, waiting: numbers.groups.waiting ?? 0 }) : undefined}
                loading={loading}
                alert={(numbers?.groups.ending_soon ?? 0) > 0}
                href="/groups?ending_soon=1"
                locale={locale}
              />
            )}
            {trialsOn && (
              <CentreStat
                Icon={Sparkles}
                tone={trials && (trials.needs_decision ?? 0) > 0 ? "rose" : "slate"}
                label={t("kpi.trials")}
                value={trials?.needs_decision ?? null}
                sub={t("kpi.trialsSub")}
                loading={loading}
                alert={(trials?.needs_decision ?? 0) > 0}
                href="/trials"
                locale={locale}
              />
            )}
          </section>

          {/* ── Money ── */}
          {(accountingOn || payrollOn) && (
            <section className="space-y-3">
              <CentreSectionTitle title={t("sections.money")} desc={t("sections.moneyDesc")} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {accountingOn && (
                  <>
                    <CentreStat
                      Icon={Receipt}
                      tone="emerald"
                      label={t("kpi.collected")}
                      money={moneyOf(collected?.amount_minor, collected?.currency)}
                      sub={money ? t("kpi.collectedSub", { count: collected?.count ?? 0 }) : undefined}
                      loading={loading}
                      href="/accounting"
                      locale={locale}
                    />
                    <CentreStat
                      Icon={AlarmClock}
                      tone={owed && owed.overdue_minor > 0 ? "rose" : "amber"}
                      label={t("kpi.outstanding")}
                      money={moneyOf(owed?.due_minor, owed?.currency)}
                      sub={
                        money
                          ? t("kpi.outstandingSub", {
                              overdue: formatMoney({ amount: owed?.overdue_minor ?? 0, currency: owed?.currency ?? currency }, locale),
                            })
                          : undefined
                      }
                      loading={loading}
                      alert={(owed?.overdue_minor ?? 0) > 0}
                      href="/accounting/arrears"
                      locale={locale}
                    />
                  </>
                )}
                {payrollOn && (
                  <CentreStat
                    Icon={Wallet}
                    tone="sky"
                    label={t("kpi.salaries")}
                    money={profit === null ? null : { amount: salaries?.payouts_minor ?? 0, currency: salaries?.currency ?? currency }}
                    sub={t("kpi.salariesSub")}
                    loading={loading}
                    href="/payroll"
                    locale={locale}
                  />
                )}
              </div>
            </section>
          )}

          {/* ── Quick actions ── */}
          <section className="space-y-3">
            <CentreSectionTitle title={t("sections.actions")} desc={t("sections.actionsDesc")} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {groupsOn && <CentreAction href="/groups/lessons" Icon={ClipboardCheck} tone="violet" label={t("actions.groups")} desc={t("actions.groupsDesc")} badge={numbers?.today.group_unmarked} />}
              {can("schedule.read") && <CentreAction href="/calendar" Icon={CalendarDays} tone="sky" label={t("actions.timetable")} desc={t("actions.timetableDesc")} />}
              {accountingOn && <CentreAction href="/accounting" Icon={Receipt} tone="emerald" label={t("actions.collect")} desc={t("actions.collectDesc")} />}
              {accountingOn && <CentreAction href="/accounting/arrears" Icon={AlarmClock} tone="rose" label={t("actions.arrears")} desc={t("actions.arrearsDesc")} badge={owed?.payers} />}
              {can("student.create") && <CentreAction href="/students" Icon={UserPlus} tone="indigo" label={t("actions.addStudent")} desc={t("actions.addStudentDesc")} />}
              {payrollOn && <CentreAction href="/payroll" Icon={BarChart3} tone="slate" label={t("actions.payroll")} desc={t("actions.payrollDesc")} />}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
