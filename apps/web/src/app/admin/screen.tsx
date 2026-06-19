"use client";

import {
  ArrowUpRight,
  Building2,
  CalendarClock,
  CreditCard,
  GraduationCap,
  History,
  LayoutDashboard,
  RefreshCw,
  UserCheck,
  UserCog,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useState,
  type ComponentType,
} from "react";
import {
  TONE_AVATAR,
  TONE_ICON,
  auditTone,
  humanizeAction,
} from "@/components/audit/audit-action-style";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import {
  getAdminDashboard,
  type AdminDashboard,
  type AdminEndingSoon,
  type AdminMrr,
  type PendingProof,
} from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

// ── Money helpers ────────────────────────────────────────────────────────────

/** Render one-or-more currency totals as a single line ("EGP 12,300.00 · USD 50.00"). */
function moneyList(items: AdminMrr[], locale: string): string {
  const nonzero = items.filter((m) => m.amount_minor > 0);
  if (nonzero.length === 0) {
    return formatMoney(
      { amount: 0, currency: items[0]?.currency ?? "EGP" },
      locale,
    );
  }
  return nonzero
    .map((m) => formatMoney({ amount: m.amount_minor, currency: m.currency }, locale))
    .join(" · ");
}

// ── KPI card (counts) ────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  gradient,
  loading,
  locale,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number | null;
  sub?: string;
  gradient: string;
  loading: boolean;
  locale: string;
}) {
  return (
    <div className="bg-card relative flex flex-col gap-3 overflow-hidden rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm font-medium">
          {label}
        </span>
        <div
          className={cn(
            "flex size-9 items-center justify-center rounded-xl text-white shadow-sm",
            gradient,
          )}
        >
          <Icon className="size-4.5" aria-hidden />
        </div>
      </div>
      {loading ? (
        <div className="bg-muted h-8 w-16 animate-pulse rounded-md" aria-hidden />
      ) : (
        <p className="text-3xl font-bold tracking-tight tabular-nums">
          {value === null ? "—" : formatNumber(value, locale)}
        </p>
      )}
      {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
    </div>
  );
}

// ── Operational card (revenue / queues — clickable, string value) ────────────

function OpsCard({
  icon: Icon,
  label,
  value,
  sub,
  href,
  accent,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  href: string;
  accent: string;
  loading: boolean;
}) {
  return (
    <Link
      href={href}
      className="bg-card group relative flex flex-col gap-3 overflow-hidden rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04] transition-shadow hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm font-medium">
          {label}
        </span>
        <div
          className={cn(
            "flex size-9 items-center justify-center rounded-xl",
            accent,
          )}
        >
          <Icon className="size-4.5" aria-hidden />
        </div>
      </div>
      {loading ? (
        <div className="bg-muted h-8 w-24 animate-pulse rounded-md" aria-hidden />
      ) : (
        <p
          className="truncate text-2xl font-bold tracking-tight tabular-nums"
          dir="ltr"
        >
          {value}
        </p>
      )}
      <p className="text-muted-foreground flex items-center gap-1 text-xs">
        {sub}
        <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </p>
    </Link>
  );
}

// ── Status breakdown row ─────────────────────────────────────────────────────

function StatusBar({
  label,
  value,
  total,
  color,
  locale,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  locale: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">
          {formatNumber(value, locale)}
        </span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Subscription "ending soon" row ───────────────────────────────────────────

function EndingSoonRow({
  item,
  locale,
  t,
}: {
  item: AdminEndingSoon;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const overdue = item.days_left < 0;
  const today = item.days_left === 0;
  const urgent = overdue || today || item.days_left <= 3;

  const when = overdue
    ? t("overdueBy", { count: -item.days_left })
    : today
      ? t("endsToday")
      : t("inDays", { count: item.days_left });

  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            item.kind === "trial"
              ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
              : "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
          )}
          aria-hidden
        >
          <CalendarClock className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.academy_name}</p>
          <p className="text-muted-foreground truncate text-xs">
            {[
              t(item.kind === "trial" ? "kindTrial" : "kindRenewal"),
              item.plan_name,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
          urgent
            ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
            : "text-muted-foreground bg-muted",
        )}
      >
        {when}
      </span>
    </div>
  );
}

// ── Pending payment-proof row ────────────────────────────────────────────────

const METHOD_LABEL: Record<PendingProof["method"], string> = {
  INSTAPAY: "InstaPay",
  VODAFONE_CASH: "Vodafone Cash",
};

function ProofRow({
  proof,
  locale,
}: {
  proof: PendingProof;
  locale: string;
}) {
  const amount = proof.amount_minor ?? proof.bill_total_minor;
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          aria-hidden
        >
          <CreditCard className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{proof.academy_name}</p>
          <p className="text-muted-foreground truncate text-xs">
            {METHOD_LABEL[proof.method]} ·{" "}
            {formatRelativeTime(proof.created_at, locale)}
          </p>
        </div>
      </div>
      <span
        className="shrink-0 text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
        dir="ltr"
      >
        {formatMoney({ amount, currency: proof.currency }, locale)}
      </span>
    </div>
  );
}

/**
 * Super-Admin platform dashboard. A single read powers an operational command center: academy
 * counts by status, total people, plan distribution, monthly recurring revenue, the
 * subscriptions about to lapse (trials + paid renewals), the outstanding-bill and payment-proof
 * review queues, and a colour-coded recent-activity feed. Gated by academy.read (server Gate is
 * the real control; this is UX only).
 */
export function AdminDashboardScreen() {
  const t = useTranslations("adminDashboard");
  const locale = useLocale();
  const { can } = useAuth();

  const [data, setData] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setError(false);
    setRefreshing(true);
    getAdminDashboard()
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!can("academy.read")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const stats = data?.stats ?? null;
  const loading = stats === null;
  const academies = stats?.academies;
  const total = academies?.total ?? 0;

  const mrr = data?.billing.mrr ?? [];
  const subs = data?.subscriptions;
  const outstanding = subs?.outstanding;
  const endingSoon = subs?.endingSoon ?? [];
  const proofs = subs?.pendingProofs.items ?? [];

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
              <LayoutDashboard className="size-5.5" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {t("subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={refreshing}
            className="text-muted-foreground hover:bg-muted hover:text-foreground bg-card flex size-9 items-center justify-center rounded-lg border transition-colors disabled:opacity-50"
            aria-label={t("refresh")}
          >
            <RefreshCw
              className={cn("size-4", refreshing && "animate-spin")}
              aria-hidden
            />
          </button>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={t("loadError")} />}

      {/* KPI cards — people & academies */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={Building2}
          label={t("kpiAcademies")}
          value={academies?.total ?? null}
          sub={
            academies
              ? t("recentSignups", { count: academies.recent })
              : undefined
          }
          gradient="bg-gradient-to-br from-blue-500 to-indigo-600"
          loading={loading}
          locale={locale}
        />
        <KpiCard
          icon={GraduationCap}
          label={t("kpiStudents")}
          value={stats?.people.students ?? null}
          gradient="bg-gradient-to-br from-emerald-500 to-teal-600"
          loading={loading}
          locale={locale}
        />
        <KpiCard
          icon={UserCog}
          label={t("kpiTeachers")}
          value={stats?.people.teachers ?? null}
          gradient="bg-gradient-to-br from-violet-500 to-purple-600"
          loading={loading}
          locale={locale}
        />
        <KpiCard
          icon={UserCheck}
          label={t("kpiGuardians")}
          value={stats?.people.guardians ?? null}
          gradient="bg-gradient-to-br from-amber-500 to-orange-600"
          loading={loading}
          locale={locale}
        />
      </div>

      {/* Operational cards — revenue & queues */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <OpsCard
          icon={Wallet}
          label={t("mrr")}
          value={moneyList(mrr, locale)}
          sub={t("mrrSub")}
          href="/admin/billing"
          accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          loading={loading}
        />
        <OpsCard
          icon={CreditCard}
          label={t("outstanding")}
          value={
            outstanding && outstanding.totals.length > 0
              ? moneyList(outstanding.totals, locale)
              : formatMoney({ amount: 0, currency: "EGP" }, locale)
          }
          sub={t("outstandingSub", { count: outstanding?.academies ?? 0 })}
          href="/admin/billing"
          accent="bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
          loading={loading}
        />
        <OpsCard
          icon={CreditCard}
          label={t("pendingReviews")}
          value={formatNumber(subs?.pendingProofs.count ?? 0, locale)}
          sub={t("pendingReviewsSub")}
          href="/admin/billing"
          accent="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
          loading={loading}
        />
        <OpsCard
          icon={CalendarClock}
          label={t("endingSoon")}
          value={formatNumber(subs?.endingSoonCount ?? 0, locale)}
          sub={t("endingSoonSub", { days: 14 })}
          href="/admin/billing"
          accent="bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Status breakdown */}
        <section className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("statusBreakdown")}</h2>
            <Link
              href="/academies"
              className="text-primary text-xs font-medium hover:underline"
            >
              {t("manageAcademies")}
            </Link>
          </div>
          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-muted h-8 animate-pulse rounded-md"
                  aria-hidden
                />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <StatusBar
                label={t("kpiActive")}
                value={academies?.active ?? 0}
                total={total}
                color="bg-emerald-500"
                locale={locale}
              />
              <StatusBar
                label={t("kpiTrial")}
                value={academies?.trial ?? 0}
                total={total}
                color="bg-amber-500"
                locale={locale}
              />
              <StatusBar
                label={t("kpiSuspended")}
                value={academies?.suspended ?? 0}
                total={total}
                color="bg-rose-500"
                locale={locale}
              />
            </div>
          )}
        </section>

        {/* Plan distribution */}
        <section className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("planDistribution")}</h2>
            <Link
              href="/admin/plans"
              className="text-primary text-xs font-medium hover:underline"
            >
              {t("managePlans")}
            </Link>
          </div>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-muted h-9 animate-pulse rounded-md"
                  aria-hidden
                />
              ))}
            </div>
          ) : stats && stats.plan_distribution.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {t("noPlans")}
            </p>
          ) : (
            <div className="space-y-2">
              {stats?.plan_distribution.map((p) => (
                <div
                  key={p.plan_id}
                  className="bg-muted/30 flex items-center justify-between rounded-lg px-3 py-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide">
                      {p.plan_code}
                    </span>
                    <span className="text-sm font-medium">{p.plan_name}</span>
                  </div>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {t("planAcademies", { count: p.academy_count })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Subscriptions ending soon */}
        <section className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="text-muted-foreground size-4" aria-hidden />
              {t("endingSoonTitle")}
            </h2>
            <Link
              href="/admin/billing"
              className="text-primary text-xs font-medium hover:underline"
            >
              {t("manageBilling")}
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-muted h-12 animate-pulse rounded-lg"
                  aria-hidden
                />
              ))}
            </div>
          ) : endingSoon.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {t("noEndingSoon")}
            </p>
          ) : (
            <div className="divide-y">
              {endingSoon.map((item) => (
                <EndingSoonRow
                  key={item.academy_id}
                  item={item}
                  locale={locale}
                  t={t}
                />
              ))}
            </div>
          )}
        </section>

        {/* Payment-proof review queue */}
        <section className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <CreditCard className="text-muted-foreground size-4" aria-hidden />
              {t("paymentsTitle")}
            </h2>
            <Link
              href="/admin/billing"
              className="text-primary text-xs font-medium hover:underline"
            >
              {t("reviewQueue")}
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-muted h-12 animate-pulse rounded-lg"
                  aria-hidden
                />
              ))}
            </div>
          ) : proofs.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {t("noPayments")}
            </p>
          ) : (
            <div className="divide-y">
              {proofs.map((p) => (
                <ProofRow key={p.submission_id} proof={p} locale={locale} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Recent activity */}
      <section className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <History className="text-muted-foreground size-4" aria-hidden />
            {t("recentActivity")}
          </h2>
          <Link
            href="/audit"
            className="text-primary text-xs font-medium hover:underline"
          >
            {t("viewAllActivity")}
          </Link>
        </div>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="bg-muted h-14 animate-pulse rounded-lg"
                aria-hidden
              />
            ))}
          </div>
        ) : data && data.recentActivity.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {t("noActivity")}
          </p>
        ) : (
          <ul className="divide-y">
            {data?.recentActivity.map((e) => {
              const tone = auditTone(e.action);
              const Icon = TONE_ICON[tone];
              return (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-xl",
                        TONE_AVATAR[tone],
                      )}
                      aria-hidden
                    >
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {humanizeAction(e.action)}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {[e.actor_name ?? t("systemActor"), e.academy_name]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>
                  <time className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {formatRelativeTime(e.created_at, locale)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
