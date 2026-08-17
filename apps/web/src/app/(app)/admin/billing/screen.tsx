"use client";

import {
  Building2,
  Hourglass,
  ImageIcon,
  ReceiptText,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatTile } from "@/components/admin/stat-tile";
import { StatusChip, SUBSCRIPTION_TONE } from "@/components/admin/status-chip";
import { Td, Th, TR_HEAD } from "@/components/admin/table";
import { useAuth } from "@/components/auth-provider";
import { ModuleChips, MODULE_STYLE } from "@/components/clients/module-chips";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ApiError,
  fetchPaymentScreenshot,
  getSubscriptionsOverview,
  listClients,
  MODULE_CODES,
  reviewPaymentSubmission,
  type ClientDirectoryEntry,
  type ModuleCode,
  type PendingProof,
  type SubscriptionOverviewRow,
} from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Whole days from now until an ISO date (negative once past), or null when unset. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

/**
 * The money page (R3, 04-CLIENT-FIRST-REDESIGN §3; restyled in superadmin-reorg on the shared
 * admin kit): MRR split BY MODULE, the payment-proof review inbox (the ONE writer for proof
 * decisions), and the per-client dues table. Subscription lifecycle buttons are gone from
 * here — rows deep-link to the client page, whose Subscriptions card is the one writer for
 * trial/plan/module state.
 */
export function BillingScreen() {
  const t = useTranslations("billing");
  const ts = useTranslations("adminSubscriptions");
  const tc = useTranslations("clients");
  const locale = useLocale();
  const { can } = useAuth();

  const [clients, setClients] = useState<ClientDirectoryEntry[] | null>(null);
  const [rows, setRows] = useState<SubscriptionOverviewRow[] | null>(null);
  const [proofs, setProofs] = useState<PendingProof[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [directory, subs] = await Promise.all([
        listClients(),
        getSubscriptionsOverview(),
      ]);
      setClients(directory.clients);
      setRows(subs.academies);
      setProofs(subs.pending_proofs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("loadError"));
    }
  }, [t]);

  /** Per-currency MRR with its per-module split, from ACTIVE (non-trial) module subs. */
  const mrr = useMemo(() => {
    if (clients === null) return null;
    const byCurrency = new Map<string, { total: number; byModule: Map<ModuleCode, number> }>();
    for (const client of clients) {
      for (const m of client.modules) {
        if (m.status !== "ACTIVE" || m.is_trial) continue;
        const bucket = byCurrency.get(m.currency) ?? { total: 0, byModule: new Map() };
        bucket.total += m.total_cost_minor;
        bucket.byModule.set(m.module, (bucket.byModule.get(m.module) ?? 0) + m.total_cost_minor);
        byCurrency.set(m.currency, bucket);
      }
    }
    return [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [clients]);

  const modulesByClient = useMemo(
    () => new Map((clients ?? []).map((c) => [c.id, c.modules])),
    [clients],
  );

  useEffect(() => {
    if (can("academy_billing.manage")) void load();
  }, [load, can]);

  if (!can("academy_billing.manage")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  async function act(fn: () => Promise<unknown>, ok: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      await load();
      setNotice(ok);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function viewShot(p: PendingProof) {
    try {
      window.open(await fetchPaymentScreenshot(p.academy_id, p.submission_id), "_blank", "noopener");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  const trialCount = rows?.filter((r) => r.is_trial).length ?? 0;
  const outstandingCount = rows?.filter((r) => r.outstanding_count > 0).length ?? 0;

  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(locale === "ar" ? "ar" : locale, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : ts("noDate");

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t("combinedTitle")} subtitle={t("combinedSubtitle")} />

      {error && <AlertBanner variant="error" message={error} />}
      {notice && <AlertBanner variant="success" message={notice} />}

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={Building2}
          label={ts("kpi.academies")}
          value={formatNumber(rows?.length ?? 0, locale)}
          loading={rows === null}
        />
        <StatTile
          icon={Hourglass}
          label={ts("kpi.trials")}
          value={formatNumber(trialCount, locale)}
          loading={rows === null}
        />
        <StatTile
          icon={Wallet}
          label={ts("kpi.outstanding")}
          value={formatNumber(outstandingCount, locale)}
          subTone={outstandingCount > 0 ? "crit" : "neutral"}
          loading={rows === null}
        />
        <StatTile
          icon={ReceiptText}
          label={ts("kpi.proofs")}
          value={formatNumber(proofs.length, locale)}
          subTone={proofs.length > 0 ? "warn" : "neutral"}
          loading={rows === null}
        />
      </div>

      {/* MRR by currency, split by module (R3) */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="text-muted-foreground size-4" aria-hidden />
          {t("mrrHeading")}
        </h2>
        {mrr === null ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="bg-card h-32 animate-pulse rounded-xl shadow-sm ring-1 ring-foreground/[0.06]" aria-hidden />
            ))}
          </div>
        ) : mrr.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noRevenue")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {mrr.map(([currency, bucket]) => (
              <div
                key={currency}
                className="bg-card rounded-xl p-4 shadow-sm ring-1 ring-foreground/[0.06]"
                data-mrr={currency}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-muted-foreground text-xs font-medium">
                    {t("mrr")} · {currency}
                  </span>
                  <span className="text-muted-foreground text-[11px]">{t("perMonth")}</span>
                </div>
                <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums" dir="ltr">
                  {formatMoney({ amount: bucket.total, currency }, locale)}
                </p>
                <div className="mt-3 space-y-1 border-t pt-2.5">
                  {MODULE_CODES.map((code) => {
                    const amount = bucket.byModule.get(code) ?? 0;
                    return (
                      <div key={code} className="flex items-center justify-between text-xs" data-mrr-module={code}>
                        <span className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "inline-flex size-4 items-center justify-center rounded text-[9px] font-bold ring-1",
                              MODULE_STYLE[code].on,
                            )}
                            aria-hidden
                          >
                            {MODULE_STYLE[code].label}
                          </span>
                          <span className="text-muted-foreground">{tc(`modules.${code}`)}</span>
                        </span>
                        <span className={cn("tabular-nums", amount === 0 && "text-muted-foreground/50")}>
                          {amount === 0 ? "—" : formatMoney({ amount, currency }, locale)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Pending payment-proof queue */}
      {proofs.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <ReceiptText className="text-muted-foreground size-4" aria-hidden />
            {ts("proofs.title")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {proofs.map((p) => (
              <div
                key={p.submission_id}
                className="bg-card flex flex-col gap-2 rounded-xl p-4 shadow-sm ring-1 ring-foreground/[0.06]"
                data-proof={p.submission_id}
              >
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/admin/clients/${p.academy_id}`}
                    className="hover:text-primary truncate font-medium hover:underline"
                  >
                    {p.academy_name}
                  </Link>
                  <span className="text-primary font-bold tabular-nums" dir="ltr">
                    {formatMoney({ amount: p.bill_total_minor, currency: p.currency }, locale)}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {p.method} · {p.period_start} → {p.period_end}
                </p>
                <div className="mt-1 flex items-center gap-1.5">
                  <Button type="button" size="xs" variant="outline" onClick={() => void viewShot(p)}>
                    <ImageIcon className="size-3" aria-hidden />
                    {ts("proofs.view")}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    disabled={busy}
                    onClick={() => void act(() => reviewPaymentSubmission(p.academy_id, p.submission_id, "approve"), ts("proofs.approved"))}
                    data-testid={`approve-${p.submission_id}`}
                  >
                    {ts("proofs.approve")}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void act(() => reviewPaymentSubmission(p.academy_id, p.submission_id, "reject"), ts("proofs.rejected"))}
                  >
                    {ts("proofs.reject")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Per-client dues table */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="text-muted-foreground size-4" aria-hidden />
            {ts("table.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="billing-table">
              <thead>
                <tr className={TR_HEAD}>
                  <Th>{ts("col.academy")}</Th>
                  <Th>{tc("table.modules")}</Th>
                  <Th>{ts("col.status")}</Th>
                  <Th>{ts("col.renewal")}</Th>
                  <Th className="text-end">{ts("col.cost")}</Th>
                  <Th className="text-end">{ts("col.outstanding")}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows === null ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>
                      <Td colSpan={7}>
                        <div className="bg-muted h-5 animate-pulse rounded" aria-hidden />
                      </Td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <Td colSpan={7} className="text-muted-foreground py-10 text-center">
                      {ts("none")}
                    </Td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    // Trial academies count down to trial_end; paid ones to the next renewal.
                    const renewIso = r.is_trial ? r.trial_end : r.current_period_end;
                    const renewDays = daysUntil(renewIso);
                    const trialDays = r.is_trial ? renewDays : null;
                    return (
                      <tr key={r.academy_id} data-academy={r.academy_id} className="hover:bg-muted/30 transition-colors">
                        <Td className="font-medium">
                          <Link
                            href={`/admin/clients/${r.academy_id}`}
                            className="hover:text-primary hover:underline"
                          >
                            {r.academy_name}
                          </Link>
                        </Td>
                        <Td>
                          <ModuleChips modules={modulesByClient.get(r.academy_id) ?? []} />
                        </Td>
                        <Td>
                          <StatusChip
                            tone={r.is_trial ? "warn" : SUBSCRIPTION_TONE[r.academy_status] ?? "neutral"}
                            icon={r.is_trial ? Hourglass : undefined}
                          >
                            {r.is_trial
                              ? trialDays !== null && trialDays > 0
                                ? ts("trialDaysLeft", { days: trialDays })
                                : ts("trialExpired")
                              : ts(`status.${r.academy_status}`)}
                          </StatusChip>
                        </Td>
                        <Td>
                          <div className="flex flex-col">
                            <span className="tabular-nums">{fmtDate(renewIso)}</span>
                            {renewDays !== null && (
                              <span
                                className={cn(
                                  "text-[11px]",
                                  renewDays <= 0
                                    ? "text-rose-600 dark:text-rose-400"
                                    : renewDays <= 3
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-muted-foreground",
                                )}
                              >
                                {renewDays > 0 ? ts("daysLeft", { days: renewDays }) : ts("expired")}
                              </span>
                            )}
                          </div>
                        </Td>
                        <Td className="text-end font-semibold tabular-nums">
                          {formatMoney({ amount: r.total_cost_minor, currency: r.currency }, locale)}
                        </Td>
                        <Td className="text-end tabular-nums">
                          {r.outstanding_minor > 0 ? (
                            <span className="font-semibold text-rose-600 dark:text-rose-400">
                              {formatMoney({ amount: r.outstanding_minor, currency: r.currency }, locale)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </Td>
                        {/* One writer per fact (R3): trial/plan/suspend live on the client page. */}
                        <Td className="text-end">
                          <Link
                            href={`/admin/clients/${r.academy_id}`}
                            className="text-primary text-xs font-semibold whitespace-nowrap hover:underline"
                            data-testid={`open-${r.academy_id}`}
                          >
                            {tc("open")}
                          </Link>
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
