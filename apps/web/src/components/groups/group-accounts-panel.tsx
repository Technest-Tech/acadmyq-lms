"use client";

import { Receipt, Search, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MethodBadge, StateChip, Tile, dayLabel } from "@/components/accounting/accounting-ui";
import { CollectModal, type CollectTarget } from "@/components/accounting/collect-modal";
import { ReceiptDetailModal } from "@/components/accounting/receipt-detail-modal";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass, todayIn } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getGroupAccounts, type GroupAccountRow, type GroupAccounts } from "@/lib/accounting-api";
import type { GroupDetail } from "@/lib/groups-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Filter = "ALL" | "UNPAID" | "PARTIAL" | "PAID";

/**
 * A group's collection sheet (حسابات المجموعة, docs/groups/01-ACCOUNTING.md) for an academy on
 * receipts. The month at a glance — expected, collected, what is left, older arrears, the collection
 * rate, what actually came in, and (payroll readers) the teacher's cost and the net — then one row
 * per student, unpaid first: what the month charged, what is paid, what is left, what is still owed
 * from before, their last receipt, and a Collect button that opens the payer's account with this
 * group's open charges already ticked.
 */
export function GroupAccountsPanel({ group }: { group: GroupDetail }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [month, setMonth] = useState(() => todayIn(group.timezone).slice(0, 7));
  const [data, setData] = useState<GroupAccounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [q, setQ] = useState("");
  const [collect, setCollect] = useState<CollectTarget | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getGroupAccounts(group.id, month));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("sheet.loadFailed")));
    }
  }, [group.id, month, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const fmt = (minor: number, currency: string) => formatMoney({ amount: minor, currency: currency || group.pricing?.currency || "EGP" }, locale);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: 0, UNPAID: 0, PARTIAL: 0, PAID: 0 };
    for (const r of data?.rows ?? []) {
      c.ALL++;
      if (r.state === "UNPAID" || r.state === "PARTIAL" || r.state === "PAID") c[r.state]++;
    }
    return c;
  }, [data]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.rows ?? []).filter(
      (r) =>
        (filter === "ALL" || r.state === filter) &&
        (term === "" || r.student_name.toLowerCase().includes(term) || (r.payer.name ?? "").toLowerCase().includes(term)),
    );
  }, [data, filter, q]);

  function openCollect(r: GroupAccountRow) {
    setCollect({
      guardian_id: r.payer.kind === "GUARDIAN" ? r.payer.id : null,
      student_id: r.payer.kind === "STUDENT" ? r.payer.id : r.payer.kind === "GUARDIAN" ? null : r.student_id,
      line_ids: r.open_line_ids,
    });
  }

  const canCollect = data?.can_collect ?? false;

  return (
    <div className="space-y-4" data-testid="group-accounts">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {data?.group.price_minor != null && data.group.currency
            ? t(`sheet.rule.${data.group.billing_mode}`, { price: fmt(data.group.price_minor, data.group.currency) })
            : t("sheet.noPrice")}
        </p>
        <input
          type="month"
          className={cn(fieldClass, "w-44")}
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          aria-label={t("sheet.month")}
          data-testid="accounts-month"
        />
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {data &&
        data.totals.map((tot) => {
          const rate = tot.rate === null ? null : Math.round(tot.rate * 100);
          return (
            <section key={tot.currency} className="space-y-3" data-testid={`accounts-totals-${tot.currency}`}>
              <div className="rounded-2xl border p-4">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-muted-foreground text-xs">{t("sheet.collectionRate")}</p>
                    <p className="text-3xl font-bold tabular-nums">{rate === null ? "—" : `${rate}%`}</p>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {t("sheet.counts", { paid: tot.paid, partial: tot.partial, unpaid: tot.unpaid })}
                  </p>
                </div>
                <div className="bg-muted mt-3 h-2.5 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rate ?? 0}>
                  <div
                    className={cn("h-full rounded-full transition-all", (rate ?? 0) >= 90 ? "bg-emerald-500" : (rate ?? 0) >= 60 ? "bg-amber-500" : "bg-rose-500")}
                    style={{ width: `${Math.min(100, rate ?? 0)}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Tile label={t("sheet.expected")} value={fmt(tot.expected_minor, tot.currency)} />
                <Tile label={t("sheet.collected")} value={fmt(tot.collected_minor, tot.currency)} tone="text-emerald-600 dark:text-emerald-400" />
                <Tile label={t("sheet.remaining")} value={fmt(tot.remaining_minor, tot.currency)} tone={tot.remaining_minor > 0 ? "text-rose-600 dark:text-rose-400" : undefined} />
                <Tile
                  label={t("sheet.arrears")}
                  value={fmt(tot.arrears_minor, tot.currency)}
                  tone={tot.arrears_minor > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
                  hint={t("sheet.arrearsHint")}
                />
                <Tile label={t("sheet.receivedInMonth")} value={fmt(tot.received_in_month_minor, tot.currency)} hint={t("sheet.receivedHint")} />
                {data.sees_teacher_cost && tot.teacher_cost_minor !== null && (
                  <>
                    <Tile label={t("sheet.teacherCost")} value={fmt(tot.teacher_cost_minor, tot.currency)} />
                    {tot.net_minor !== null && (
                      <Tile
                        label={t("sheet.net")}
                        value={fmt(tot.net_minor, tot.currency)}
                        tone={tot.net_minor < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}
                        hint={t("sheet.netHint")}
                      />
                    )}
                  </>
                )}
              </div>
            </section>
          );
        })}

      {data && data.rows.length === 0 && (
        <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">{t("sheet.empty")}</p>
      )}

      {data && data.rows.length > 0 && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="no-scrollbar flex gap-1 overflow-x-auto" role="tablist">
              {(["ALL", "UNPAID", "PARTIAL", "PAID"] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                    filter === f ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                  data-testid={`accounts-filter-${f}`}
                >
                  {t(`sheet.filter.${f}`)} <span className="tabular-nums opacity-70">{counts[f]}</span>
                </button>
              ))}
            </div>
            <div className="relative sm:w-64">
              <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
              <input className={cn(fieldClass, "ps-9")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("sheet.search")} />
            </div>
          </div>

          {/* Desktop: a table. Phone: one card per student. */}
          <div className="hidden overflow-x-auto rounded-xl border md:block">
            <table className="w-full text-sm" data-testid="accounts-table">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="p-3 text-start font-medium">{t("sheet.col.student")}</th>
                  <th className="p-3 text-end font-medium">{t("sheet.col.due")}</th>
                  <th className="p-3 text-end font-medium">{t("sheet.col.paid")}</th>
                  <th className="p-3 text-end font-medium">{t("sheet.col.remaining")}</th>
                  <th className="p-3 text-end font-medium">{t("sheet.col.arrears")}</th>
                  <th className="p-3 text-start font-medium">{t("sheet.col.status")}</th>
                  <th className="p-3 text-start font-medium">{t("sheet.col.lastPayment")}</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.student_id} className="hover:bg-muted/30" data-testid={`accounts-row-${r.student_id}`}>
                    <td className="p-3">
                      <StudentCell row={r} />
                    </td>
                    <td className="p-3 text-end tabular-nums">{fmt(r.due_minor, r.currency)}</td>
                    <td className="p-3 text-end text-emerald-700 tabular-nums dark:text-emerald-300">{fmt(r.paid_minor, r.currency)}</td>
                    <td className={cn("p-3 text-end font-semibold tabular-nums", r.remaining_minor > 0 && "text-rose-600 dark:text-rose-400")}>{fmt(r.remaining_minor, r.currency)}</td>
                    <td className={cn("p-3 text-end tabular-nums", r.arrears_minor > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                      {r.arrears_minor > 0 ? fmt(r.arrears_minor, r.currency) : "—"}
                    </td>
                    <td className="p-3">
                      <StateChip state={r.state} />
                    </td>
                    <td className="p-3">
                      <LastReceipt row={r} onOpen={setReceiptId} />
                    </td>
                    <td className="p-3 text-end">
                      {canCollect && r.open_line_ids.length > 0 && (
                        <Button type="button" size="sm" className="gap-1" onClick={() => openCollect(r)} data-testid={`collect-${r.student_id}`}>
                          <Wallet className="size-3.5" aria-hidden />
                          {t("sheet.collect")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden">
            {rows.map((r) => (
              <li key={r.student_id} className="space-y-3 rounded-xl border p-3">
                <div className="flex items-start justify-between gap-2">
                  <StudentCell row={r} />
                  <StateChip state={r.state} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <Amount label={t("sheet.col.due")} value={fmt(r.due_minor, r.currency)} />
                  <Amount label={t("sheet.col.paid")} value={fmt(r.paid_minor, r.currency)} tone="text-emerald-700 dark:text-emerald-300" />
                  <Amount label={t("sheet.col.remaining")} value={fmt(r.remaining_minor, r.currency)} tone={r.remaining_minor > 0 ? "text-rose-600 dark:text-rose-400" : undefined} />
                </div>
                {r.arrears_minor > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">{t("sheet.arrearsLine", { amount: fmt(r.arrears_minor, r.currency) })}</p>}
                <div className="flex items-center justify-between gap-2">
                  <LastReceipt row={r} onOpen={setReceiptId} />
                  {canCollect && r.open_line_ids.length > 0 && (
                    <Button type="button" size="sm" className="gap-1" onClick={() => openCollect(r)}>
                      <Wallet className="size-3.5" aria-hidden />
                      {t("sheet.collect")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <CollectModal open={collect !== null} target={collect} onClose={() => setCollect(null)} onRecorded={() => void load()} />
      <ReceiptDetailModal receiptId={receiptId} onClose={() => setReceiptId(null)} onChanged={() => void load()} />
    </div>
  );
}

function StudentCell({ row }: { row: GroupAccountRow }) {
  const t = useTranslations("accounting");
  return (
    <div className="min-w-0">
      <p className="font-medium break-words">
        {row.student_name}
        {row.member_status !== "ACTIVE" && <span className="text-muted-foreground ms-1.5 text-xs font-normal">({t("sheet.left")})</span>}
      </p>
      {row.payer.kind === "GUARDIAN" && row.payer.name && <p className="text-muted-foreground text-xs break-words">{t("sheet.paidBy", { name: row.payer.name })}</p>}
    </div>
  );
}

function LastReceipt({ row, onOpen }: { row: GroupAccountRow; onOpen: (id: string) => void }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  if (!row.last_receipt) return <span className="text-muted-foreground text-xs">{t("sheet.noPayment")}</span>;
  return (
    <button type="button" onClick={() => onOpen(row.last_receipt!.id)} className="hover:bg-muted -m-1 flex flex-col items-start rounded-lg p-1 text-start">
      <span className="text-primary inline-flex items-center gap-1 font-mono text-xs font-semibold" dir="ltr">
        <Receipt className="size-3" aria-hidden />
        {row.last_receipt.number}
      </span>
      <span className="text-muted-foreground flex items-center gap-1 text-xs">
        {dayLabel(row.last_receipt.received_on, locale)}
        <MethodBadge method={row.last_receipt.method} className="px-1.5 py-0" />
      </span>
    </button>
  );
}

function Amount({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-muted/40 rounded-lg p-2">
      <p className="text-muted-foreground">{label}</p>
      <p className={cn("font-semibold break-words tabular-nums", tone)}>{value}</p>
    </div>
  );
}

