"use client";

import {
  BadgeDollarSign,
  BookOpen,
  Building2,
  CalendarClock,
  CreditCard,
  GraduationCap,
  History,
  Layers,
  MessageCircle,
  PieChart,
  Plus,
  RefreshCw,
  School,
  Video,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TONE_AVATAR, TONE_ICON, auditTone, humanizeAction } from "@/components/audit/audit-action-style";
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
import { PlatformHeroArt } from "@/components/platform-art";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { accountHref } from "@/components/finance/account-format";
import {
  getAdminDashboard,
  getDues,
  getFinanceOverview,
  type AdminDashboard,
  type DuesPayload,
  type FinanceOverview,
  type ModuleCode,
  type PaymentProof,
} from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

const METHOD_LABEL: Record<PaymentProof["method"], string> = {
  INSTAPAY: "InstaPay",
  VODAFONE_CASH: "Vodafone Cash",
};

const MODULE_LOOK: Record<ModuleCode, { Icon: LucideIcon; tone: CentreTone }> = {
  MANAGEMENT: { Icon: School, tone: "violet" },
  VIDEO: { Icon: Video, tone: "sky" },
  WHATSAPP: { Icon: MessageCircle, tone: "emerald" },
  LMS: { Icon: BookOpen, tone: "amber" },
};

function lastSixMonths(): string[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

/** A money clock on the home's "coming up" list: a trial ending, or a payment due or late. */
interface UpcomingItem {
  key: string;
  href: string;
  name: string;
  kind: "trial" | "payment";
  days_left: number;
}

/**
 * The platform Super Admin's home, in the modern look the rest of the panel wears (app-shell
 * `platformView`): the same design as a modern academy's dashboard, in its navy and gold. A banner
 * with the platform drawing and the two things the owner starts from (a new client, Accounts), four
 * numbers (clients, students, recurring revenue, what is owed), the clients by status as a ring
 * beside six months of income, then the worklists: payments and trials coming up, payment proofs
 * to review, the latest activity and who holds which module. Every money figure is the accounts
 * book's (Accounts → Dues), the same numbers the Accounts section shows.
 * Gated by academy.read (the server Gate is the real control; UX only).
 */
export function AdminDashboardScreen() {
  const t = useTranslations("adminDashboard");
  const tm = useTranslations("adminDashboard.modern");
  const tc = useTranslations("clients");
  const tDash = useTranslations("dashboard");
  const locale = useLocale();
  const router = useRouter();
  const { session, can } = useAuth();
  const readsFinance = can("platform.manage");

  const [data, setData] = useState<AdminDashboard | null>(null);
  const [finance, setFinance] = useState<FinanceOverview | null>(null);
  const [dues, setDues] = useState<DuesPayload | null>(null);
  const [financeDone, setFinanceDone] = useState(false);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setError(false);
    setRefreshing(true);
    // The income chart is the Finance book's: if that read fails the card says so and the rest stands.
    void Promise.allSettled([
      getAdminDashboard()
        .then(setData)
        .catch(() => setError(true)),
      readsFinance
        ? getFinanceOverview()
            .then(setFinance)
            .catch(() => setFinance(null))
            .finally(() => setFinanceDone(true))
        : Promise.resolve(),
      readsFinance ? getDues().then(setDues).catch(() => setDues(null)) : Promise.resolve(),
    ]).finally(() => setRefreshing(false));
  }, [readsFinance]);

  useEffect(() => {
    load();
  }, [load]);

  const money = (minor: number, currency: string) =>
    formatMoney({ amount: minor, currency }, locale, { trimZeroDecimals: true });

  // ── Six months of the owner's income, in the currency most of it came in ──
  const incomeCurrency = useMemo(
    () => [...(finance?.totals ?? [])].sort((a, b) => b.total_minor - a.total_minor)[0]?.currency ?? "EGP",
    [finance],
  );
  const series = useMemo(
    () =>
      lastSixMonths().map((month) => ({
        month,
        value: finance?.monthly.find((r) => r.month === month && r.currency === incomeCurrency)?.amount_minor ?? 0,
      })),
    [finance, incomeCurrency],
  );

  if (!can("academy.read")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const stats = data?.stats ?? null;
  const loading = stats === null && !error;
  const academies = stats?.academies;
  const proofs = dues?.proofs ?? [];
  const proofCount = proofs.length;
  // The book's totals, the currency with the most money first.
  const totals = [...(dues?.totals ?? [])].sort((a, b) => b.mrr_minor + b.outstanding_minor - (a.mrr_minor + a.outstanding_minor));
  const leadCurrency = totals[0]?.currency ?? "EGP";
  const lateClients = new Set((dues?.late ?? []).map((d) => d.client_id)).size;
  const endingSoon: UpcomingItem[] = [
    ...(dues?.trials ?? []).map((tr) => ({
      key: `trial-${tr.academy_id}`,
      href: `/admin/clients/${tr.academy_id}?tab=subscription`,
      name: tr.name,
      kind: "trial" as const,
      days_left: tr.days,
    })),
    ...[...(dues?.late ?? []), ...(dues?.week ?? [])].map((d) => ({
      key: `due-${d.id}`,
      href: accountHref({ id: d.client_id, academy_id: d.academy_id }),
      name: d.academy_name ?? d.client_name,
      kind: "payment" as const,
      days_left: -d.days_late,
    })),
  ]
    .filter((item, i, all) => all.findIndex((x) => x.href === item.href && x.kind === item.kind) === i)
    .sort((a, b) => a.days_left - b.days_left)
    .slice(0, 6);
  const duesLoading = readsFinance && dues === null && !error;

  const statusSlices: RingSlice[] = [
    { key: "active", label: t("kpiActive"), value: academies?.active ?? 0, color: "oklch(0.6 0.15 163)" },
    { key: "trial", label: t("kpiTrial"), value: academies?.trial ?? 0, color: "oklch(0.8 0.11 85)" },
    { key: "suspended", label: t("kpiSuspended"), value: academies?.suspended ?? 0, color: "oklch(0.64 0.19 15)" },
  ];
  const statusTotal = statusSlices.reduce((sum, s) => sum + s.value, 0);

  const latest = series[series.length - 1]?.value ?? 0;
  const previous = series[series.length - 2]?.value ?? 0;
  const monthChange = previous > 0 ? Math.round(((latest - previous) / previous) * 100) : null;
  const hasIncome = series.some((p) => p.value > 0);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return tDash("greeting.morning");
    if (h < 17) return tDash("greeting.afternoon");
    return tDash("greeting.evening");
  })();
  const firstName = session?.user.fullName?.split(" ")[0] ?? "";

  const whenEnds = (item: UpcomingItem) =>
    item.days_left < 0
      ? tm("ends.overdueBy", { count: -item.days_left, n: formatNumber(-item.days_left, locale) })
      : item.days_left === 0
        ? t("endsToday")
        : tm("ends.inDays", { count: item.days_left, n: formatNumber(item.days_left, locale) });

  const skeleton = (count: number) =>
    Array.from({ length: count }, (_, k) => <div key={k} className="bg-muted h-14 animate-pulse rounded-xl" aria-hidden />);

  return (
    <div className="space-y-4 sm:space-y-5" data-testid="admin-dashboard">
      {/* ── The opening banner ── */}
      <section className="centre-hero relative overflow-hidden rounded-[1.25rem] px-5 py-5 sm:px-8 sm:py-7" data-testid="admin-hero">
        <PlatformHeroArt className="pointer-events-none absolute end-4 bottom-0 hidden h-[92%] max-w-[46%] lg:block" />
        <div className="relative max-w-xl">
          <h1 className="text-2xl leading-tight font-extrabold tracking-tight break-words sm:text-[2rem]">
            {tm("hero.greeting", { greeting, name: firstName })} <span aria-hidden>👋</span>
          </h1>
          <p className="centre-hero__sub mt-1.5 text-sm sm:text-base">{tm("hero.subtitle")}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2.5 sm:mt-5">
            {can("academy.create") && (
              <Button size="lg" className="px-5" onClick={() => router.push("/admin/clients/new")} data-testid="hero-new-client">
                <Plus className="size-5" aria-hidden />
                {tm("hero.newClient")}
              </Button>
            )}
            {readsFinance && (
              <Link
                href="/admin/accounts"
                className="bg-card text-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold shadow-sm transition-colors outline-none focus-visible:ring-2"
              >
                <CreditCard className="size-5" aria-hidden />
                {tm("hero.billing")}
              </Link>
            )}
            <button
              type="button"
              onClick={load}
              disabled={refreshing}
              aria-label={t("refresh")}
              className="bg-card text-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex size-11 items-center justify-center rounded-xl shadow-sm transition-colors outline-none focus-visible:ring-2 disabled:opacity-60"
            >
              <RefreshCw className={cn("size-5", refreshing && "animate-spin")} aria-hidden />
            </button>
          </div>
        </div>
      </section>

      {error && <AlertBanner variant="error" message={t("loadError")} />}

      {/* ── Four numbers ── */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiCard
          Icon={Building2}
          tone="violet"
          label={tm("kpi.clients")}
          value={academies?.total ?? null}
          chip={
            academies && academies.recent > 0 ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                {tm("kpi.newClients", { count: formatNumber(academies.recent, locale) })}
              </span>
            ) : undefined
          }
          loading={loading}
          href="/admin/clients"
          locale={locale}
        />
        <KpiCard
          Icon={GraduationCap}
          tone="sky"
          label={tm("kpi.students")}
          value={stats?.people.students ?? null}
          note={stats ? tm("kpi.teachers", { count: stats.people.teachers, n: formatNumber(stats.people.teachers, locale) }) : undefined}
          loading={loading}
          locale={locale}
        />
        <KpiCard
          Icon={Wallet}
          tone="emerald"
          label={tm("kpi.mrr")}
          value={dues ? (totals[0]?.mrr_minor ?? 0) : null}
          display={dues ? money(totals[0]?.mrr_minor ?? 0, leadCurrency) : undefined}
          note={
            totals.filter((x) => x.mrr_minor > 0).length > 1
              ? tm("kpi.mrrOther", { rest: totals.slice(1).filter((x) => x.mrr_minor > 0).map((m) => money(m.mrr_minor, m.currency)).join(" · ") })
              : t("mrrSub")
          }
          loading={loading || duesLoading}
          href="/admin/accounts"
          locale={locale}
        />
        <KpiCard
          Icon={BadgeDollarSign}
          tone="rose"
          label={tm("kpi.outstanding")}
          value={dues ? (totals[0]?.overdue_minor ?? 0) : null}
          display={dues ? money(totals[0]?.overdue_minor ?? 0, leadCurrency) : undefined}
          note={dues ? tm("kpi.owing", { count: lateClients, n: formatNumber(lateClients, locale) }) : undefined}
          chip={
            proofCount > 0 ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                {tm("kpi.reviews", { count: proofCount, n: formatNumber(proofCount, locale) })}
              </span>
            ) : undefined
          }
          loading={loading || duesLoading}
          href="/admin/accounts"
          locale={locale}
        />
      </section>

      {/* ── Who is on the books, and what came in. A phone reads the money first. ── */}
      <section className={cn("grid grid-cols-1 gap-3 sm:gap-4", readsFinance && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]")}>
        <div className={cn(centrePanelClass, "order-2 flex flex-col p-4 sm:p-5 lg:order-1")} data-testid="status-ring">
          <PanelTitle
            Icon={PieChart}
            title={tm("status.title")}
            end={
              <Link href="/admin/clients" className="text-muted-foreground hover:text-foreground text-xs font-semibold transition-colors">
                {t("manageAcademies")}
              </Link>
            }
          />
          {loading ? (
            <div className="bg-muted mt-4 h-44 animate-pulse rounded-xl" />
          ) : statusTotal === 0 ? (
            <p className="text-muted-foreground py-14 text-center text-sm">{tm("status.empty")}</p>
          ) : (
            <DistributionRing slices={statusSlices} total={statusTotal} unit={tm("status.unit")} locale={locale} />
          )}
        </div>

        {readsFinance && (
          <div className={cn(centrePanelClass, "order-1 min-w-0 p-4 sm:p-5 lg:order-2")} data-testid="income-trend">
            <PanelTitle
              Icon={Wallet}
              title={tm("income.title")}
              end={
                <Link href="/admin/accounts/payments" className="text-muted-foreground hover:text-foreground text-xs font-semibold transition-colors">
                  {tm("income.open")}
                </Link>
              }
            />
            {!financeDone ? (
              <div className="bg-muted mt-4 h-60 animate-pulse rounded-xl" />
            ) : !hasIncome ? (
              <p className="text-muted-foreground py-20 text-center text-sm">{tm("income.empty")}</p>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="text-2xl font-extrabold tracking-tight tabular-nums sm:text-[1.75rem]" data-testid="income-latest">
                    {money(latest, incomeCurrency)}
                  </p>
                  <DeltaChip value={monthChange} />
                  <span className="text-muted-foreground text-xs">{tm("income.thisMonth")}</span>
                </div>
                <TrendChart
                  points={series}
                  format={(v) => money(v, incomeCurrency)}
                  unitsPerAxisStep={100}
                  monthLabel={monthFormatter(locale, true)}
                  shortMonthLabel={monthFormatter(locale, false)}
                  label={tm("income.title")}
                />
              </>
            )}
          </div>
        )}
      </section>

      {/* ── The two queues ── */}
      <section className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
        <ListCard
          Icon={CalendarClock}
          title={t("endingSoonTitle")}
          footerHref="/admin/accounts"
          footerLabel={t("manageBilling")}
          empty={!loading && !duesLoading && endingSoon.length === 0 ? t("noEndingSoon") : undefined}
          testId="ending-soon"
        >
          {loading || duesLoading
            ? skeleton(3)
            : endingSoon.map((item) => {
                const urgent = item.days_left <= 3;
                return (
                  <ListRow
                    key={item.key}
                    href={item.href}
                    tile={<PastelTile Icon={CalendarClock} tone={item.kind === "trial" ? "amber" : "sky"} />}
                    title={item.name}
                    sub={t(item.kind === "trial" ? "kindTrial" : "kindRenewal")}
                    end={
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold",
                          urgent
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {whenEnds(item)}
                      </span>
                    }
                  />
                );
              })}
        </ListCard>

        <ListCard
          Icon={CreditCard}
          title={t("paymentsTitle")}
          footerHref="/admin/accounts"
          footerLabel={t("reviewQueue")}
          empty={!loading && !duesLoading && proofs.length === 0 ? t("noPayments") : undefined}
          testId="proof-queue"
        >
          {loading || duesLoading
            ? skeleton(3)
            : proofs.map((proof) => (
                <ListRow
                  key={proof.id}
                  href={accountHref({ id: proof.client_id, academy_id: proof.academy_id })}
                  tile={<PastelTile Icon={CreditCard} tone="emerald" />}
                  title={proof.academy_name ?? proof.client_name}
                  sub={`${METHOD_LABEL[proof.method]} · ${formatRelativeTime(proof.created_at, locale)}`}
                  end={
                    proof.amount_minor ? (
                      <span className="shrink-0 text-sm font-extrabold text-emerald-600 tabular-nums dark:text-emerald-400" dir="ltr">
                        {money(proof.amount_minor, proof.currency)}
                      </span>
                    ) : undefined
                  }
                />
              ))}
        </ListCard>
      </section>

      {/* ── What happened lately, and who holds what ── */}
      <section className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ListCard
          Icon={History}
          title={t("recentActivity")}
          footerHref="/audit"
          footerLabel={t("viewAllActivity")}
          empty={!loading && data !== null && data.recentActivity.length === 0 ? t("noActivity") : undefined}
          testId="recent-activity"
        >
          {loading
            ? skeleton(4)
            : (data?.recentActivity ?? []).map((e) => {
                const tone = auditTone(e.action);
                const Icon = TONE_ICON[tone];
                return (
                  <ListRow
                    key={e.id}
                    tile={
                      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", TONE_AVATAR[tone])} aria-hidden>
                        <Icon className="size-5" />
                      </span>
                    }
                    title={humanizeAction(e.action)}
                    sub={[e.actor_name ?? t("systemActor"), e.academy_name].filter(Boolean).join(" · ")}
                    end={
                      <time className="text-muted-foreground shrink-0 text-xs tabular-nums">{formatRelativeTime(e.created_at, locale)}</time>
                    }
                  />
                );
              })}
        </ListCard>

        <ListCard
          Icon={Layers}
          title={t("moduleDistribution")}
          footerHref="/admin/accounts/settings"
          footerLabel={tm("modules.plans")}
          empty={!loading && stats !== null && stats.module_distribution.length === 0 ? t("noModules") : undefined}
          testId="module-distribution"
        >
          {loading
            ? skeleton(3)
            : (stats?.module_distribution ?? []).map((m) => {
                const look = MODULE_LOOK[m.module] ?? { Icon: Layers, tone: "slate" as const };
                return (
                  <ListRow
                    key={m.module}
                    tile={<PastelTile Icon={look.Icon} tone={look.tone} />}
                    title={tc(`modules.${m.module}`)}
                    sub={m.trial_count > 0 ? t("onTrial", { count: formatNumber(m.trial_count, locale) }) : undefined}
                    end={
                      <span className="text-foreground/80 shrink-0 text-sm font-bold tabular-nums">
                        {t("moduleClients", { count: formatNumber(m.client_count, locale) })}
                      </span>
                    }
                  />
                );
              })}
        </ListCard>
      </section>
    </div>
  );
}
