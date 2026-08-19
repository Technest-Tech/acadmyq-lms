"use client";

import {
  Building2,
  CalendarClock,
  CreditCard,
  GraduationCap,
  History,
  RefreshCw,
  UserCheck,
  UserCog,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatTile } from "@/components/admin/stat-tile";
import { StatusChip } from "@/components/admin/status-chip";
import {
  TONE_AVATAR,
  TONE_ICON,
  auditTone,
  humanizeAction,
} from "@/components/audit/audit-action-style";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

// ── Subscription "ending soon" row (deep-links to the client page) ───────────

function EndingSoonRow({
  item,
  t,
}: {
  item: AdminEndingSoon;
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
    <Link
      href={`/admin/clients/${item.academy_id}`}
      className="hover:bg-muted/50 -mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors"
    >
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
            {t(item.kind === "trial" ? "kindTrial" : "kindRenewal")}
          </p>
        </div>
      </div>
      <StatusChip tone={urgent ? "crit" : "neutral"}>{when}</StatusChip>
    </Link>
  );
}

// ── Pending payment-proof row (deep-links to the client page) ────────────────

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
    <Link
      href={`/admin/clients/${proof.academy_id}`}
      className="hover:bg-muted/50 -mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors"
    >
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
    </Link>
  );
}

/**
 * Super-Admin platform dashboard (superadmin-reorg): the same single read as before, rendered
 * on the shared admin kit — AdminPageHeader + StatTile rows (people counts, then the four
 * money/queue tiles that deep-link into /admin/billing), status + plan-distribution cards,
 * the ending-soon and proof queues (each row now deep-links to its client page), and the
 * recent-activity feed. Gated by academy.read (server Gate is the real control; UX only).
 */
export function AdminDashboardScreen() {
  const t = useTranslations("adminDashboard");
  const tc = useTranslations("clients");
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
    <div className="space-y-5">
      <AdminPageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={load}
            disabled={refreshing}
            aria-label={t("refresh")}
          >
            <RefreshCw
              className={cn("size-4", refreshing && "animate-spin")}
              aria-hidden
            />
          </Button>
        }
      />

      {error && <AlertBanner variant="error" message={t("loadError")} />}

      {/* People & clients */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={Building2}
          label={t("kpiAcademies")}
          value={academies ? formatNumber(academies.total, locale) : "—"}
          sub={academies ? t("recentSignups", { count: academies.recent }) : undefined}
          href="/admin/clients"
          loading={loading}
        />
        <StatTile
          icon={GraduationCap}
          label={t("kpiStudents")}
          value={stats ? formatNumber(stats.people.students, locale) : "—"}
          loading={loading}
        />
        <StatTile
          icon={UserCog}
          label={t("kpiTeachers")}
          value={stats ? formatNumber(stats.people.teachers, locale) : "—"}
          loading={loading}
        />
        <StatTile
          icon={UserCheck}
          label={t("kpiGuardians")}
          value={stats ? formatNumber(stats.people.guardians, locale) : "—"}
          loading={loading}
        />
      </div>

      {/* Money & review queues — each tile opens the money page */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={Wallet}
          label={t("mrr")}
          value={moneyList(mrr, locale)}
          sub={t("mrrSub")}
          href="/admin/billing"
          loading={loading}
        />
        <StatTile
          icon={CreditCard}
          label={t("outstanding")}
          value={
            outstanding && outstanding.totals.length > 0
              ? moneyList(outstanding.totals, locale)
              : formatMoney({ amount: 0, currency: "EGP" }, locale)
          }
          sub={t("outstandingSub", { count: outstanding?.academies ?? 0 })}
          subTone={outstanding && outstanding.academies > 0 ? "crit" : "neutral"}
          href="/admin/billing"
          loading={loading}
        />
        <StatTile
          icon={CreditCard}
          label={t("pendingReviews")}
          value={formatNumber(subs?.pendingProofs.count ?? 0, locale)}
          sub={t("pendingReviewsSub")}
          subTone={(subs?.pendingProofs.count ?? 0) > 0 ? "warn" : "neutral"}
          href="/admin/billing"
          loading={loading}
        />
        <StatTile
          icon={CalendarClock}
          label={t("endingSoon")}
          value={formatNumber(subs?.endingSoonCount ?? 0, locale)}
          sub={t("endingSoonSub", { days: 14 })}
          href="/admin/billing"
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Status breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>{t("statusBreakdown")}</CardTitle>
            <CardAction>
              <Link
                href="/admin/clients"
                className="text-primary text-xs font-medium hover:underline"
              >
                {t("manageAcademies")}
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        {/* Module distribution — who holds what (05-MODULES-NOT-PACKAGES §2) */}
        <Card>
          <CardHeader>
            <CardTitle>{t("moduleDistribution")}</CardTitle>
            <CardAction>
              <Link
                href="/admin/plans"
                className="text-primary text-xs font-medium hover:underline"
              >
                {t("managePlans")}
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
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
            ) : stats && stats.module_distribution.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {t("noModules")}
              </p>
            ) : (
              <div className="space-y-2">
                {stats?.module_distribution.map((m) => (
                  <div
                    key={m.module}
                    className="bg-muted/30 flex items-center justify-between rounded-lg px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2.5">
                      <StatusChip tone="accent">{tc(`modules.${m.module}`)}</StatusChip>
                      {m.trial_count > 0 && (
                        <span className="text-muted-foreground text-xs">
                          {t("onTrial", { count: m.trial_count })}
                        </span>
                      )}
                    </div>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {t("moduleClients", { count: m.client_count })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Subscriptions ending soon */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="text-muted-foreground size-4" aria-hidden />
              {t("endingSoonTitle")}
            </CardTitle>
            <CardAction>
              <Link
                href="/admin/billing"
                className="text-primary text-xs font-medium hover:underline"
              >
                {t("manageBilling")}
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
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
                  <EndingSoonRow key={item.academy_id} item={item} t={t} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment-proof review queue */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="text-muted-foreground size-4" aria-hidden />
              {t("paymentsTitle")}
            </CardTitle>
            <CardAction>
              <Link
                href="/admin/billing"
                className="text-primary text-xs font-medium hover:underline"
              >
                {t("reviewQueue")}
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="text-muted-foreground size-4" aria-hidden />
            {t("recentActivity")}
          </CardTitle>
          <CardAction>
            <Link
              href="/audit"
              className="text-primary text-xs font-medium hover:underline"
            >
              {t("viewAllActivity")}
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}
