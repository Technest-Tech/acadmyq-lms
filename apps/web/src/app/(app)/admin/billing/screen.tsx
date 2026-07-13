"use client";

import {
  Building2,
  CreditCard,
  Hourglass,
  ImageIcon,
  ReceiptText,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ModuleChips, MODULE_STYLE } from "@/components/clients/module-chips";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  TRIAL: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  SUSPENDED: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
};

/** Whole days from now until an ISO date (negative once past), or null when unset. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function StatCard({
  icon: Icon,
  label,
  value,
  gradient,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  gradient: string;
}) {
  return (
    <div className="bg-card relative flex items-center gap-3.5 overflow-hidden rounded-2xl border p-4 shadow-sm ring-1 ring-foreground/[0.04]">
      <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm", gradient)}>
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none tracking-tight tabular-nums">{value}</p>
        <p className="text-muted-foreground mt-1 truncate text-xs font-medium">{label}</p>
      </div>
    </div>
  );
}

/**
 * The money page (R3, 04-CLIENT-FIRST-REDESIGN §3): MRR split BY MODULE, the payment-proof review
 * inbox (the ONE writer for proof decisions), and the per-client dues table. Subscription
 * lifecycle buttons are gone from here — rows deep-link to the client page, whose Subscriptions
 * card is the one writer for trial/plan/module state.
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
    <div className="space-y-6">
      {/* Hero */}
      <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex items-center gap-3.5">
          <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
            <CreditCard className="size-5.5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("combinedTitle")}</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">{t("combinedSubtitle")}</p>
          </div>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}
      {notice && <AlertBanner variant="success" message={notice} />}

      {/* MRR by currency, split by module (R3) */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="text-muted-foreground size-4" aria-hidden />
          {t("mrrHeading")}
        </h2>
        {mrr === null ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="bg-card h-32 animate-pulse rounded-2xl border shadow-sm" aria-hidden />
            ))}
          </div>
        ) : mrr.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noRevenue")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {mrr.map(([currency, bucket]) => (
              <div
                key={currency}
                className="from-primary/[0.06] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]"
                data-mrr={currency}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-muted-foreground text-xs font-medium">
                    {t("mrr")} · {currency}
                  </span>
                  <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
                    <TrendingUp className="size-4" aria-hidden />
                  </div>
                </div>
                <span className="text-2xl font-bold tracking-tight tabular-nums">
                  {formatMoney({ amount: bucket.total, currency }, locale)}
                </span>
                <span className="text-muted-foreground text-[11px]">{t("perMonth")}</span>
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

      {/* Subscription KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon={Building2} label={ts("kpi.academies")} value={formatNumber(rows?.length ?? 0, locale)} gradient="bg-gradient-to-br from-blue-500 to-indigo-600" />
        <StatCard icon={Hourglass} label={ts("kpi.trials")} value={formatNumber(trialCount, locale)} gradient="bg-gradient-to-br from-amber-500 to-orange-600" />
        <StatCard icon={Wallet} label={ts("kpi.outstanding")} value={formatNumber(outstandingCount, locale)} gradient="bg-gradient-to-br from-rose-500 to-pink-600" />
        <StatCard icon={ReceiptText} label={ts("kpi.proofs")} value={formatNumber(proofs.length, locale)} gradient="bg-gradient-to-br from-violet-500 to-purple-600" />
      </div>

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
                className="bg-card flex flex-col gap-2 rounded-2xl border p-4 shadow-sm ring-1 ring-foreground/[0.04]"
                data-proof={p.submission_id}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{p.academy_name}</span>
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

      {/* Academy subscriptions */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Building2 className="text-muted-foreground size-4" aria-hidden />
          {ts("table.title")}
        </h2>
        <div className="bg-card overflow-x-auto rounded-2xl border shadow-sm ring-1 ring-foreground/[0.04]">
          <table className="w-full text-sm" data-testid="billing-table">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2.5 text-start">{ts("col.academy")}</th>
                <th className="px-3 py-2.5 text-start">{tc("table.modules")}</th>
                <th className="px-3 py-2.5 text-start">{ts("col.status")}</th>
                <th className="px-3 py-2.5 text-start">{ts("col.renewal")}</th>
                <th className="px-3 py-2.5 text-end">{ts("col.cost")}</th>
                <th className="px-3 py-2.5 text-end">{ts("col.outstanding")}</th>
                <th className="px-3 py-2.5 text-end" aria-hidden />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows === null ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-3 py-3">
                      <div className="bg-muted h-5 animate-pulse rounded" aria-hidden />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-muted-foreground px-3 py-10 text-center">{ts("none")}</td>
                </tr>
              ) : (
                rows.map((r) => {
                  // Trial academies count down to trial_end; paid ones to the next renewal.
                  const renewIso = r.is_trial ? r.trial_end : r.current_period_end;
                  const renewDays = daysUntil(renewIso);
                  const trialDays = r.is_trial ? renewDays : null;
                  return (
                    <tr key={r.academy_id} data-academy={r.academy_id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 font-medium">
                        <Link
                          href={`/admin/clients/${r.academy_id}`}
                          className="hover:text-primary hover:underline"
                        >
                          {r.academy_name}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <ModuleChips modules={modulesByClient.get(r.academy_id) ?? []} />
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[r.academy_status] ?? "bg-muted")}>
                          {r.is_trial && <Hourglass className="size-3" aria-hidden />}
                          {r.is_trial
                            ? trialDays !== null && trialDays > 0
                              ? ts("trialDaysLeft", { days: trialDays })
                              : ts("trialExpired")
                            : ts(`status.${r.academy_status}`)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col">
                          <span className="tabular-nums">{fmtDate(renewIso)}</span>
                          {renewDays !== null && (
                            <span
                              className={cn(
                                "text-[11px]",
                                renewDays <= 0
                                  ? "text-rose-600"
                                  : renewDays <= 3
                                    ? "text-amber-600"
                                    : "text-muted-foreground",
                              )}
                            >
                              {renewDays > 0 ? ts("daysLeft", { days: renewDays }) : ts("expired")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-end font-semibold tabular-nums">
                        {formatMoney({ amount: r.total_cost_minor, currency: r.currency }, locale)}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        {r.outstanding_minor > 0 ? (
                          <span className="font-semibold text-rose-600">
                            {formatMoney({ amount: r.outstanding_minor, currency: r.currency }, locale)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      {/* One writer per fact (R3): trial/plan/suspend live on the client page. */}
                      <td className="px-3 py-2 text-end">
                        <Link
                          href={`/admin/clients/${r.academy_id}`}
                          className="text-primary text-xs font-semibold whitespace-nowrap hover:underline"
                          data-testid={`open-${r.academy_id}`}
                        >
                          {tc("open")}
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
