"use client";

import { ChevronLeft, ChevronRight, Plus, Receipt, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { METHOD_ICON, MethodBadge, Tile, dayLabel, todayLocal } from "@/components/accounting/accounting-ui";
import { CollectModal, type CollectTarget } from "@/components/accounting/collect-modal";
import { ReceiptDetailModal } from "@/components/accounting/receipt-detail-modal";
import { useAuth } from "@/components/auth-provider";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { PageHero } from "@/components/ui/page-hero";
import { RECEIPT_METHODS, getReceipts, type ReceiptFilters, type ReceiptMethod, type ReceiptRegister } from "@/lib/accounting-api";
import { listStudents } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const PER_PAGE = 50;

function monthStart(): string {
  return `${todayLocal().slice(0, 8)}01`;
}

/**
 * The receipts register (الإيصالات, docs/groups/01-ACCOUNTING.md): every payment the academy took,
 * newest first, filtered by day range, method, collector and status, with what came in per method
 * across the whole filter. A row opens the receipt (send it, open it, void it); "Record a payment"
 * picks a student and opens their family's account to collect from.
 */
export function ReceiptsRegister() {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const { can } = useAuth();

  const [filters, setFilters] = useState<ReceiptFilters>({ from: monthStart(), to: todayLocal(), status: "active", page: 1, per_page: PER_PAGE });
  const [q, setQ] = useState("");
  const [data, setData] = useState<ReceiptRegister | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [collect, setCollect] = useState<CollectTarget | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getReceipts(filters));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("register.loadFailed")));
    }
  }, [filters, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Search waits for the typing to stop.
  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => (f.q === q ? f : { ...f, q, page: 1 })), 300);
    return () => clearTimeout(id);
  }, [q]);

  const set = (patch: Partial<ReceiptFilters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const pages = data ? Math.max(1, Math.ceil(data.meta.total / data.meta.per_page)) : 1;
  const page = filters.page ?? 1;

  return (
    <div className="space-y-5">
      <PageHero
        icon={Receipt}
        title={t("register.title")}
        subtitle={t("register.subtitle")}
        latticeId="receipts-hero"
        actions={
          can("invoice.mark_paid") ? (
            <Button type="button" variant="secondary" className="gap-1.5" onClick={() => setPicking(true)} data-testid="register-record">
              <Plus className="size-4" aria-hidden />
              {t("register.record")}
            </Button>
          ) : undefined
        }
      />

      {/* Filters */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <label className="text-muted-foreground text-xs">
          {t("register.from")}
          <input type="date" className={cn(fieldClass, "mt-1")} value={filters.from ?? ""} max={filters.to} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="text-muted-foreground text-xs">
          {t("register.to")}
          <input type="date" className={cn(fieldClass, "mt-1")} value={filters.to ?? ""} min={filters.from} max={todayLocal()} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <label className="text-muted-foreground text-xs">
          {t("register.method")}
          <select className={cn(fieldClass, "mt-1")} value={filters.method ?? ""} onChange={(e) => set({ method: e.target.value as ReceiptMethod | "" })}>
            <option value="">{t("register.allMethods")}</option>
            {RECEIPT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`method.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted-foreground text-xs">
          {t("register.collector")}
          <select className={cn(fieldClass, "mt-1")} value={filters.collector_id ?? ""} onChange={(e) => set({ collector_id: e.target.value || undefined })}>
            <option value="">{t("register.everyone")}</option>
            {(data?.collectors ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted-foreground text-xs">
          {t("register.status")}
          <select className={cn(fieldClass, "mt-1")} value={filters.status ?? "active"} onChange={(e) => set({ status: e.target.value as ReceiptFilters["status"] })}>
            <option value="active">{t("register.statusActive")}</option>
            <option value="void">{t("register.statusVoid")}</option>
            <option value="all">{t("register.statusAll")}</option>
          </select>
        </label>
        <label className="text-muted-foreground text-xs">
          {t("register.search")}
          <span className="relative mt-1 block">
            <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
            <input className={cn(fieldClass, "ps-9")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("register.searchHint")} data-testid="register-search" />
          </span>
        </label>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {/* What came in, per currency and method, over the whole filter */}
      {data && data.totals.length > 0 && (
        <div className="space-y-3">
          {data.totals.map((tot) => (
            <div key={tot.currency} className="grid grid-cols-1 gap-3 lg:grid-cols-4" data-testid={`register-totals-${tot.currency}`}>
              <Tile
                label={t("register.collectedTotal")}
                value={formatMoney({ amount: tot.amount_minor, currency: tot.currency }, locale)}
                tone="text-emerald-600 dark:text-emerald-400"
                hint={t("register.receiptsCount", { count: tot.count })}
              />
              <div className="rounded-xl border p-3 lg:col-span-3">
                <p className="text-muted-foreground mb-2 text-xs">{t("register.byMethod")}</p>
                <MethodBreakdown byMethod={tot.by_method} total={tot.amount_minor} currency={tot.currency} />
              </div>
            </div>
          ))}
        </div>
      )}

      {data && data.receipts.length === 0 && (
        <p className="text-muted-foreground rounded-2xl border border-dashed p-10 text-center text-sm">{t("register.empty")}</p>
      )}

      {data && data.receipts.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-xl border md:block">
            <table className="w-full text-sm" data-testid="register-table">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="p-3 text-start font-medium">{t("register.col.number")}</th>
                  <th className="p-3 text-start font-medium">{t("register.col.date")}</th>
                  <th className="p-3 text-start font-medium">{t("register.col.payer")}</th>
                  <th className="p-3 text-start font-medium">{t("register.col.method")}</th>
                  <th className="p-3 text-end font-medium">{t("register.col.amount")}</th>
                  <th className="p-3 text-start font-medium">{t("register.col.collector")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.receipts.map((r) => (
                  <tr key={r.id} onClick={() => setReceiptId(r.id)} className={cn("hover:bg-muted/40 cursor-pointer", r.voided && "opacity-60")} data-testid={`register-row-${r.id}`}>
                    <td className="p-3">
                      <span className="font-mono text-xs font-semibold" dir="ltr">
                        {r.number}
                      </span>
                      {r.voided && <span className="ms-2 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:text-rose-300">{t("register.void")}</span>}
                    </td>
                    <td className="p-3 whitespace-nowrap">{dayLabel(r.received_on, locale)}</td>
                    <td className="p-3">
                      <p className="font-medium break-words">{r.payer_name ?? "—"}</p>
                      {r.groups.length > 0 && <p className="text-muted-foreground text-xs break-words">{r.groups.join(" · ")}</p>}
                    </td>
                    <td className="p-3">
                      <MethodBadge method={r.method} />
                    </td>
                    <td className={cn("p-3 text-end font-semibold tabular-nums", r.voided && "line-through")}>
                      {formatMoney({ amount: r.amount_minor, currency: r.currency }, locale)}
                      {!r.voided && r.allocated_minor < r.amount_minor && (
                        <p className="text-xs font-normal text-emerald-700 dark:text-emerald-300">
                          {t("register.creditPart", { amount: formatMoney({ amount: r.amount_minor - r.allocated_minor, currency: r.currency }, locale) })}
                        </p>
                      )}
                    </td>
                    <td className="text-muted-foreground p-3 text-xs">{r.received_by_name ?? t(`source.${r.source}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden">
            {data.receipts.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setReceiptId(r.id)} className={cn("w-full space-y-2 rounded-xl border p-3 text-start", r.voided && "opacity-60")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium break-words">{r.payer_name ?? "—"}</p>
                      <p className="text-muted-foreground font-mono text-xs" dir="ltr">
                        {r.number} · {r.received_on}
                      </p>
                    </div>
                    <span className={cn("shrink-0 font-semibold tabular-nums", r.voided && "line-through")}>{formatMoney({ amount: r.amount_minor, currency: r.currency }, locale)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <MethodBadge method={r.method} />
                    {r.voided && <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-300">{t("register.void")}</span>}
                    {r.groups.length > 0 && <span className="text-muted-foreground text-xs">{r.groups.join(" · ")}</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button type="button" variant="outline" size="icon" onClick={() => set({ page: page - 1 })} disabled={page <= 1} aria-label={t("register.prev")}>
                <ChevronRight className="size-4 ltr:rotate-180" aria-hidden />
              </Button>
              <span className="text-muted-foreground text-sm tabular-nums">{t("register.page", { page, pages })}</span>
              <Button type="button" variant="outline" size="icon" onClick={() => set({ page: page + 1 })} disabled={page >= pages} aria-label={t("register.next")}>
                <ChevronLeft className="size-4 ltr:rotate-180" aria-hidden />
              </Button>
            </div>
          )}
        </>
      )}

      <PayerPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(studentId) => {
          setPicking(false);
          setCollect({ student_id: studentId });
        }}
      />
      <CollectModal open={collect !== null} target={collect} onClose={() => setCollect(null)} onRecorded={() => void load()} />
      <ReceiptDetailModal receiptId={receiptId} onClose={() => setReceiptId(null)} onChanged={() => void load()} />
    </div>
  );
}

/** A horizontal bar of what came in by method, then the figures. */
function MethodBreakdown({ byMethod, total, currency }: { byMethod: Partial<Record<ReceiptMethod, number>>; total: number; currency: string }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const entries = useMemo(() => RECEIPT_METHODS.filter((m) => (byMethod[m] ?? 0) > 0).map((m) => [m, byMethod[m] ?? 0] as const), [byMethod]);
  const tones: Record<ReceiptMethod, string> = {
    CASH: "bg-emerald-500",
    INSTAPAY: "bg-violet-500",
    WALLET: "bg-rose-500",
    BANK_TRANSFER: "bg-sky-500",
    CARD: "bg-amber-500",
    OTHER: "bg-zinc-400",
  };

  return (
    <div className="space-y-2">
      <div className="bg-muted flex h-2.5 overflow-hidden rounded-full">
        {entries.map(([m, v]) => (
          <div key={m} className={tones[m]} style={{ width: `${total > 0 ? (v / total) * 100 : 0}%` }} title={t(`method.${m}`)} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {entries.map(([m, v]) => {
          const Icon = METHOD_ICON[m];
          return (
            <li key={m} className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", tones[m])} aria-hidden />
              <Icon className="text-muted-foreground size-3.5" aria-hidden />
              <span className="text-muted-foreground">{t(`method.${m}`)}</span>
              <span className="font-semibold tabular-nums">{formatMoney({ amount: v, currency }, locale)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Pick who is paying: search a student (or their parent) by name or phone — searched on the server,
 * so a big academy is never cut off at a page — and their family's account opens in Collect.
 */
function PayerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (studentId: string) => void }) {
  const t = useTranslations("accounting");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; name: string; sub: string | null }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const id = setTimeout(() => {
      void listStudents({ search: q.trim() || undefined, pageSize: 20, sort: "name" })
        .then((res) =>
          alive &&
          setRows(
            res.rows.map((s) => ({
              id: s.id,
              name: s.full_name,
              sub: !s.is_self_guardian && s.guardian_name ? t("register.pickParent", { name: s.guardian_name }) : s.whatsapp_phone,
            })),
          ),
        )
        .catch(() => alive && setRows([]))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [open, q, t]);

  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t("register.pickTitle")} description={t("register.pickHint")} size="md">
      <div className="space-y-3">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
          <input autoFocus className={cn(fieldClass, "ps-9")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("register.pickPlaceholder")} data-testid="picker-search" />
        </div>
        <ul className="max-h-80 divide-y overflow-y-auto rounded-xl border" data-testid="picker-results">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onPick(r.id)} className="hover:bg-muted/60 flex w-full flex-col items-start p-3 text-start" data-testid={`picker-${r.id}`}>
                <span className="font-medium break-words">{r.name}</span>
                {r.sub && <span className="text-muted-foreground text-xs break-words">{r.sub}</span>}
              </button>
            </li>
          ))}
          {!loading && rows.length === 0 && <li className="text-muted-foreground p-4 text-center text-sm">{t("register.pickNone")}</li>}
        </ul>
      </div>
    </Modal>
  );
}
