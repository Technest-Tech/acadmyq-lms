"use client";

import {
  AlarmClock,
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  Hourglass,
  Layers,
  LayoutDashboard,
  Receipt,
  RefreshCw,
  Sparkles,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ActionCard, SectionTitle, StatCard } from "@/components/dashboard/academy-dashboard";
import { MyLessonsToday } from "@/components/dashboard/my-lessons-today";
import { SubscriptionBanner } from "@/components/dashboard/subscription-banner";
import { PageHero } from "@/components/ui/page-hero";
import { getAccountingOverview, type AccountingOverview } from "@/lib/accounting-api";
import { getProfitSummary, getTrialSummary, type ProfitSummaryRow, type TrialSummary } from "@/lib/api";
import { useCapability } from "@/lib/capabilities";
import { getCentreDashboard, type CentreDashboard as CentreNumbers } from "@/lib/centre-dashboard-api";
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

  return (
    <div className="space-y-6" data-testid="centre-dashboard">
      <PageHero
        icon={LayoutDashboard}
        latticeId="centre-hero"
        title={`${greeting}, ${session?.user.fullName?.split(" ")[0] ?? "—"} 👋`}
        subtitle={`${dateLabel} · ${t("subtitle")}`}
        actions={
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/25 bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/25 disabled:opacity-60"
            title="Refresh"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </button>
        }
      />

      <SubscriptionBanner />

      {isTeacher && <MyLessonsToday groups={groupsOn} />}

      {showNumbers && (
        <>
          {/* ── Today ── */}
          <section className="space-y-3">
            <SectionTitle Icon={CalendarDays} color="emerald" title={t("sections.today")} desc={t("sections.todayDesc")} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                Icon={CalendarDays}
                color="emerald"
                label={t("kpi.todayClasses")}
                value={numbers ? numbers.today.group_lessons + numbers.today.private_lessons : null}
                sub={numbers ? t("kpi.todayClassesSub", { groups: numbers.today.group_lessons, privateCount: numbers.today.private_lessons }) : undefined}
                loading={loading}
                href={groupsOn ? "/groups/lessons" : "/attendance"}
                locale={locale}
              />
              <StatCard
                Icon={AlarmClock}
                color={unmarked > 0 ? "amber" : "teal"}
                label={t("kpi.unmarked")}
                value={numbers ? unmarked : null}
                sub={numbers ? (unmarked > 0 ? t("kpi.unmarkedSub") : t("kpi.unmarkedClear")) : undefined}
                loading={loading}
                alert={unmarked > 0}
                href={groupsOn ? "/groups/lessons" : "/attendance?view=overdue"}
                locale={locale}
              />
              <StatCard
                Icon={ClipboardCheck}
                color="sky"
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
              <StatCard
                Icon={Layers}
                color="indigo"
                label={t("kpi.runningGroups")}
                value={numbers?.groups.running ?? null}
                sub={numbers ? t("kpi.runningGroupsSub", { members: numbers.groups.members }) : undefined}
                loading={loading}
                href="/groups"
                locale={locale}
              />
              <StatCard
                Icon={Users}
                color="violet"
                label={t("kpi.freeSeats")}
                value={numbers?.groups.free_seats ?? null}
                sub={t("kpi.freeSeatsSub")}
                loading={loading}
                href="/groups/students"
                locale={locale}
              />
              <StatCard
                Icon={Hourglass}
                color={numbers && numbers.subscriptions.ending_soon > 0 ? "orange" : "cyan"}
                label={t("kpi.endingSoon")}
                value={numbers?.subscriptions.ending_soon ?? null}
                sub={numbers ? t("kpi.endingSoonSub", { days: numbers.subscriptions.ending_soon_days }) : undefined}
                loading={loading}
                href="/packages/due"
                locale={locale}
              />
              {trialsOn && (
                <StatCard
                  Icon={Sparkles}
                  color={trials && (trials.needs_decision ?? 0) > 0 ? "rose" : "fuchsia"}
                  label={t("kpi.trials")}
                  value={trials?.needs_decision ?? null}
                  sub={t("kpi.trialsSub")}
                  loading={loading}
                  alert={(trials?.needs_decision ?? 0) > 0}
                  href="/trials"
                  locale={locale}
                />
              )}
            </div>
          </section>

          {/* ── Money ── */}
          {(accountingOn || payrollOn) && (
            <section className="space-y-3">
              <SectionTitle Icon={Wallet} color="gold" title={t("sections.money")} desc={t("sections.moneyDesc")} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {accountingOn && (
                  <>
                    <StatCard
                      Icon={Receipt}
                      color="emerald"
                      label={t("kpi.collected")}
                      value={null}
                      isMoney={!loading}
                      moneyAmount={collected?.amount_minor ?? 0}
                      moneyCurrency={collected?.currency ?? currency}
                      sub={money ? t("kpi.collectedSub", { count: collected?.count ?? 0 }) : undefined}
                      loading={loading}
                      href="/accounting"
                      locale={locale}
                    />
                    <StatCard
                      Icon={AlarmClock}
                      color={owed && owed.overdue_minor > 0 ? "rose" : "amber"}
                      label={t("kpi.outstanding")}
                      value={null}
                      isMoney={!loading}
                      moneyAmount={owed?.due_minor ?? 0}
                      moneyCurrency={owed?.currency ?? currency}
                      sub={
                        money
                          ? t("kpi.outstandingSub", {
                              overdue: new Intl.NumberFormat(locale, { style: "currency", currency: owed?.currency ?? currency, maximumFractionDigits: 0 }).format(
                                (owed?.overdue_minor ?? 0) / 100,
                              ),
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
                  <StatCard
                    Icon={Wallet}
                    color="blue"
                    label={t("kpi.salaries")}
                    value={null}
                    isMoney={!loading}
                    moneyAmount={salaries?.payouts_minor ?? 0}
                    moneyCurrency={salaries?.currency ?? currency}
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
            <SectionTitle Icon={Sparkles} color="gold" title={t("sections.actions")} desc={t("sections.actionsDesc")} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {groupsOn && <Action href="/groups/lessons" Icon={ClipboardCheck} color="emerald" label={t("actions.groups")} desc={t("actions.groupsDesc")} badge={numbers?.today.group_unmarked} />}
              {can("schedule.read") && <Action href="/calendar" Icon={CalendarDays} color="sky" label={t("actions.timetable")} desc={t("actions.timetableDesc")} />}
              {accountingOn && <Action href="/accounting" Icon={Receipt} color="gold" label={t("actions.collect")} desc={t("actions.collectDesc")} />}
              {accountingOn && <Action href="/accounting/arrears" Icon={AlarmClock} color="rose" label={t("actions.arrears")} desc={t("actions.arrearsDesc")} badge={owed?.payers} />}
              {can("student.create") && <Action href="/students" Icon={UserPlus} color="violet" label={t("actions.addStudent")} desc={t("actions.addStudentDesc")} />}
              {payrollOn && <Action href="/payroll" Icon={BarChart3} color="blue" label={t("actions.payroll")} desc={t("actions.payrollDesc")} />}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Action(props: { href: string; Icon: LucideIcon; color: string; label: string; desc: string; badge?: number }) {
  return <ActionCard {...props} />;
}
