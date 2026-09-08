"use client";

import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Coins,
  Plus,
  ReceiptText,
  RefreshCw,
  Repeat,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatTile } from "@/components/admin/stat-tile";
import { StatusChip } from "@/components/admin/status-chip";
import {
  DealFormModal,
  type DealFormPreset,
} from "@/components/finance/deal-form-modal";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import {
  daysBetween,
  dueTone,
  formatDay,
  formatMonth,
  money,
} from "@/components/finance/finance-format";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getFinanceOverview,
  type FinanceOverview,
  type FinanceTotals,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";

/**
 * The owner's income at a glance: money in (month / year / all time), money owed (outstanding,
 * overdue, next 30 days), the subscription run-rate, then the two lists that drive the day —
 * what is due next and what just came in — and this year's split by service and by month.
 *
 * Everything is per currency; the ledger never converts, so a USD job and an EGP subscription
 * each get their own tile row rather than a made-up total.
 */
export function FinanceOverviewScreen() {
  const t = useTranslations("finance");
  const locale = useLocale();
  const router = useRouter();
  const [data, setData] = useState<FinanceOverview | null>(null);
  const [error, setError] = useState(false);
  const [modal, setModal] = useState<DealFormPreset | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      setData(await getFinanceOverview());
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals: FinanceTotals[] = useMemo(() => {
    if (!data) return [];
    if (data.totals.length > 0) return data.totals;
    // An empty book still gets a row of zeros — a blank screen reads as broken.
    return [
      {
        currency: "EGP",
        month_minor: 0,
        year_minor: 0,
        total_minor: 0,
        outstanding_minor: 0,
        overdue_minor: 0,
        upcoming_minor: 0,
        mrr_minor: 0,
        subscriptions: 0,
      },
    ];
  }, [data]);

  const today = data?.today ?? "";

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <Button variant="outline" onClick={() => setModal("income")}>
              <Coins data-icon="inline-start" />
              {t("actions.recordIncome")}
            </Button>
            <Button onClick={() => setModal("deal")}>
              <Plus data-icon="inline-start" />
              {t("actions.newDeal")}
            </Button>
          </>
        }
      />
      <FinanceTabs />

      {error ? (
        <EmptyState
          icon={AlertTriangle}
          message={t("overview.error")}
          action={
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw data-icon="inline-start" />
              {t("common.retry")}
            </Button>
          }
        />
      ) : null}

      {/* ── Money tiles, one row per currency ────────────────────────────── */}
      {totals.map((row) => (
        <section key={row.currency} className="space-y-2">
          {totals.length > 1 ? (
            <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {row.currency}
            </h2>
          ) : null}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <StatTile
              label={t("overview.thisMonth")}
              value={money(row.month_minor, row.currency, locale)}
              loading={data === null}
              testId="finance-tile-month"
            />
            <StatTile
              label={t("overview.thisYear")}
              value={money(row.year_minor, row.currency, locale)}
              loading={data === null}
            />
            <StatTile
              label={t("overview.allTime")}
              value={money(row.total_minor, row.currency, locale)}
              loading={data === null}
            />
            <StatTile
              label={t("overview.outstanding")}
              value={money(row.outstanding_minor, row.currency, locale)}
              sub={
                row.overdue_minor > 0
                  ? t("overview.overdue", {
                      amount: money(row.overdue_minor, row.currency, locale),
                    })
                  : undefined
              }
              subTone="crit"
              loading={data === null}
              href="/admin/finance/deals?status=ACTIVE"
            />
            <StatTile
              label={t("overview.upcoming")}
              value={money(row.upcoming_minor, row.currency, locale)}
              loading={data === null}
            />
            <StatTile
              label={t("overview.mrr")}
              value={money(row.mrr_minor, row.currency, locale)}
              sub={t("overview.subscriptionsCount", {
                count: row.subscriptions,
              })}
              loading={data === null}
              href="/admin/finance/deals?kind=SUBSCRIPTION&status=ACTIVE"
            />
          </div>
        </section>
      ))}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t("overview.clients")}
          value={formatNumber(data?.counts.clients ?? 0, locale)}
          icon={Building2}
          href="/admin/finance/clients"
          loading={data === null}
        />
        <StatTile
          label={t("overview.activeDeals")}
          value={formatNumber(data?.counts.active_deals ?? 0, locale)}
          icon={ReceiptText}
          href="/admin/finance/deals?status=ACTIVE"
          loading={data === null}
        />
        <StatTile
          label={t("overview.activeSubscriptions")}
          value={formatNumber(data?.counts.active_subscriptions ?? 0, locale)}
          icon={Repeat}
          href="/admin/finance/deals?kind=SUBSCRIPTION&status=ACTIVE"
          loading={data === null}
        />
        <StatTile
          label={t("overview.overdueDeals")}
          value={formatNumber(data?.counts.overdue_deals ?? 0, locale)}
          icon={AlertTriangle}
          href="/admin/finance/deals?overdue=1"
          loading={data === null}
          sub={
            (data?.counts.overdue_deals ?? 0) > 0
              ? t("overview.overdue", { amount: "" }).trim()
              : undefined
          }
          subTone="crit"
        />
      </div>

      {/* ── Upcoming dues + recent payments ─────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarClock
                className="text-muted-foreground size-4"
                aria-hidden
              />
              {t("overview.upcomingTitle")}
            </CardTitle>
            <CardAction>
              <Link
                href="/admin/finance/deals?status=ACTIVE"
                className="text-primary text-xs font-medium"
              >
                {t("overview.viewAll")}
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {data && data.upcoming.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("overview.upcomingEmpty")}
              </p>
            ) : (
              <ul className="divide-y" data-testid="finance-upcoming">
                {(data?.upcoming ?? []).map((due) => {
                  const days = today ? daysBetween(today, due.due_on) : 0;
                  return (
                    <li key={due.id}>
                      <Link
                        href={`/admin/finance/deals/${due.deal_id}`}
                        className="hover:bg-muted/40 -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {due.client_name}
                          </p>
                          <p className="text-muted-foreground truncate text-xs">
                            {due.title} · {t(`service.${due.service}`)}
                          </p>
                        </div>
                        <div className="shrink-0 text-end">
                          <p
                            className="text-sm font-semibold tabular-nums"
                            dir="ltr"
                          >
                            {money(due.remaining_minor, due.currency, locale)}
                          </p>
                          <StatusChip tone={dueTone(due.due_on, today)} dot>
                            {due.overdue
                              ? t("common.daysAgo", { count: Math.abs(days) })
                              : t("common.inDays", { count: days })}
                            {" · "}
                            {formatDay(due.due_on, locale)}
                          </StatusChip>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Coins className="text-muted-foreground size-4" aria-hidden />
              {t("overview.recentTitle")}
            </CardTitle>
            <CardAction>
              <Link
                href="/admin/finance/payments"
                className="text-primary text-xs font-medium"
              >
                {t("overview.viewAll")}
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {data && data.recent_payments.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("overview.recentEmpty")}
              </p>
            ) : (
              <ul className="divide-y" data-testid="finance-recent">
                {(data?.recent_payments ?? []).map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/admin/finance/deals/${p.deal_id}`}
                      className="hover:bg-muted/40 -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {p.client_name}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {p.deal_title} · {t(`method.${p.method}`)}
                        </p>
                      </div>
                      <div className="shrink-0 text-end">
                        <p
                          className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
                          dir="ltr"
                        >
                          +{money(p.amount_minor, p.currency, locale)}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {formatDay(p.paid_on, locale)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Statistics: by service, by month ─────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {t("overview.byServiceTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data && data.by_service.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("overview.byServiceEmpty")}
              </p>
            ) : (
              <ul className="space-y-2.5">
                {(data?.by_service ?? []).map((row) => {
                  const max = Math.max(
                    ...(data?.by_service ?? [])
                      .filter((r) => r.currency === row.currency)
                      .map((r) => r.amount_minor),
                    1,
                  );
                  return (
                    <li key={`${row.service}-${row.currency}`}>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate">
                          {t(`service.${row.service}`)}
                        </span>
                        <span className="font-semibold tabular-nums" dir="ltr">
                          {money(row.amount_minor, row.currency, locale)}
                        </span>
                      </div>
                      <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                        <div
                          className="bg-primary h-full rounded-full"
                          style={{
                            width: `${Math.max(3, (row.amount_minor / max) * 100)}%`,
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {t("overview.monthlyTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data && data.monthly.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("overview.monthlyEmpty")}
              </p>
            ) : (
              <MonthlyBars rows={data?.monthly ?? []} locale={locale} />
            )}
          </CardContent>
        </Card>
      </div>

      <DealFormModal
        open={modal !== null}
        preset={modal ?? "deal"}
        onClose={() => setModal(null)}
        onSaved={(payload) => {
          setModal(null);
          router.push(`/admin/finance/deals/${payload.deal.id}`);
        }}
      />
    </div>
  );
}

/** One bar chart per currency: the last twelve months, empty months included. */
function MonthlyBars({
  rows,
  locale,
}: {
  rows: FinanceOverview["monthly"];
  locale: string;
}) {
  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
  }, []);
  const currencies = useMemo(
    () => Array.from(new Set(rows.map((r) => r.currency))).sort(),
    [rows],
  );

  return (
    <div className="space-y-5">
      {currencies.map((currency) => {
        const byMonth = new Map(
          rows
            .filter((r) => r.currency === currency)
            .map((r) => [r.month, r.amount_minor]),
        );
        const max = Math.max(...months.map((m) => byMonth.get(m) ?? 0), 1);
        return (
          <div key={currency}>
            {currencies.length > 1 ? (
              <p className="text-muted-foreground mb-1 text-xs font-semibold">
                {currency}
              </p>
            ) : null}
            <div className="flex h-32 items-end gap-1.5" dir="ltr">
              {months.map((m) => {
                const v = byMonth.get(m) ?? 0;
                return (
                  <div
                    key={m}
                    className="group flex h-full flex-1 flex-col justify-end"
                    title={`${formatMonth(m, locale)}: ${money(v, currency, locale)}`}
                  >
                    <div
                      className="bg-primary/80 group-hover:bg-primary w-full rounded-t-sm transition-colors"
                      style={{
                        height: `${v > 0 ? Math.max(4, (v / max) * 100) : 2}%`,
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div
              className="text-muted-foreground mt-1 flex gap-1.5 text-[10px]"
              dir="ltr"
            >
              {months.map((m) => (
                <span key={m} className="flex-1 truncate text-center">
                  {formatMonth(m, locale).replace(/\s?\d{4}$/, "")}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
