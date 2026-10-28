"use client";

import { ExternalLink, FileText, Printer, Users, Wallet } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MethodBadge, Tile, dayLabel, todayLocal } from "@/components/accounting/accounting-ui";
import { CollectModal, type CollectTarget } from "@/components/accounting/collect-modal";
import { PayerPicker } from "@/components/accounting/payer-picker";
import { ReceiptDetailModal } from "@/components/accounting/receipt-detail-modal";
import { useAuth } from "@/components/auth-provider";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { PageHero } from "@/components/ui/page-hero";
import { getStatement, type Statement } from "@/lib/accounting-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

function sixMonthsBack(): string {
  const [y = 1970, m = 1] = todayLocal().split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - 5, 1));
  return d.toISOString().slice(0, 10);
}

/** Who the statement is for — a guardian, or a student for an academy that bills per student. */
export type StatementTarget = { guardian_id?: string | null; student_id?: string | null };

/** The statement page's URL for a payer — the printable form, opened from the modal. */
export function statementHref(target: StatementTarget): string {
  return target.guardian_id ? `/accounting/statement?guardian_id=${target.guardian_id}` : `/accounting/statement?student_id=${target.student_id ?? ""}`;
}

/** Loads a payer's statement for a window; the page and the modal share it. */
function useStatement(target: StatementTarget | null, from: string, to: string) {
  const t = useTranslations("accounting");
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const payer = useMemo(
    () => (target ? { guardian_id: target.guardian_id ?? null, student_id: target.guardian_id ? null : (target.student_id ?? null) } : null),
    [target],
  );

  const load = useCallback(async () => {
    if (!payer) return;
    try {
      setData(await getStatement(payer, from, to));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("statement.loadFailed")));
    }
  }, [payer, from, to, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, load, payer };
}

/**
 * A family's statement of account (كشف حساب, docs/groups/01-ACCOUNTING.md) as a page: the balance
 * brought forward, then every charge and every receipt in the window, oldest first, with a running
 * balance — and where the account stands today. Printable on its own (no sidebar, no controls).
 * Not in the sidebar: the statement is an ACTION on a family (from Arrears, the Overview, the
 * family card), and this page is its printable form.
 */
export function AccountingStatementScreen() {
  const t = useTranslations("accounting");
  const router = useRouter();
  const search = useSearchParams();
  const { can } = useAuth();
  const guardianId = search.get("guardian_id");
  const studentId = search.get("student_id");
  const target = useMemo<StatementTarget | null>(() => (guardianId || studentId ? { guardian_id: guardianId, student_id: studentId } : null), [guardianId, studentId]);

  const [from, setFrom] = useState(sixMonthsBack);
  const [to, setTo] = useState(todayLocal);
  const [picking, setPicking] = useState(target === null);
  const [collect, setCollect] = useState<CollectTarget | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const { data, error, load, payer } = useStatement(target, from, to);

  // Printing this page prints the statement alone (globals.css: body.print-isolate).
  useEffect(() => {
    document.body.classList.add("print-isolate");
    return () => document.body.classList.remove("print-isolate");
  }, []);

  return (
    <div className="space-y-5" data-testid="accounting-statement">
      <div data-print-hide>
        <PageHero
          icon={FileText}
          title={t("statement.title")}
          subtitle={t("statement.subtitle")}
          latticeId="accounting-statement-hero"
          actions={
            <Button type="button" variant="secondary" className="gap-1.5" onClick={() => setPicking(true)}>
              <Users className="size-4" aria-hidden />
              {target ? t("statement.change") : t("statement.pick")}
            </Button>
          }
        />
      </div>

      {target && (
        <div className="bg-card flex flex-wrap items-end justify-between gap-2 rounded-2xl border p-3 shadow-sm" data-print-hide>
          <RangeFields from={from} to={to} onFrom={setFrom} onTo={setTo} />
          <div className="flex gap-2">
            {can("invoice.mark_paid") && payer && data && data.balance.some((b) => b.due_minor > 0) && (
              <Button type="button" className="gap-1.5" onClick={() => setCollect(payer)}>
                <Wallet className="size-4" aria-hidden />
                {t("sheet.collect")}
              </Button>
            )}
            <Button type="button" variant="outline" className="gap-1.5" onClick={() => window.print()} disabled={!data}>
              <Printer className="size-4" aria-hidden />
              {t("statement.print")}
            </Button>
          </div>
        </div>
      )}

      {error && <AlertBanner variant="error" message={error} />}

      {!target && !picking && <p className="text-muted-foreground rounded-2xl border border-dashed bg-card/60 p-10 text-center text-sm">{t("statement.none")}</p>}

      {data && <StatementSheet data={data} onOpenReceipt={setReceiptId} />}

      <PayerPicker
        open={picking}
        title={t("statement.pickTitle")}
        hint={t("statement.pickHint")}
        onClose={() => setPicking(false)}
        onPick={(id) => {
          setPicking(false);
          router.replace(`/accounting/statement?student_id=${id}`);
        }}
      />
      <CollectModal open={collect !== null} target={collect} onClose={() => setCollect(null)} onRecorded={() => void load()} />
      <ReceiptDetailModal receiptId={receiptId} onClose={() => setReceiptId(null)} onChanged={() => void load()} />
    </div>
  );
}

/**
 * The statement in a modal, opened from a family's row (Arrears, the Overview's debtors) so nobody
 * leaves the list they are working through. Collecting hands the payer back to the caller, which
 * owns the Collect screen — one modal at a time. "Open to print" is the page.
 */
export function StatementModal({ target, onClose, onCollect }: { target: StatementTarget | null; onClose: () => void; onCollect?: (target: CollectTarget) => void }) {
  const t = useTranslations("accounting");
  const [from, setFrom] = useState(sixMonthsBack);
  const [to, setTo] = useState(todayLocal);
  const { data, error, payer } = useStatement(target, from, to);
  const owes = data?.balance.some((b) => b.due_minor > 0) ?? false;

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={t("statement.title")}
      size="xl"
      footer={
        <>
          {target && (
            <a href={statementHref(target)} target="_blank" rel="noopener noreferrer" className="hover:bg-muted inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium">
              <ExternalLink className="size-4" aria-hidden />
              {t("arrears.openPrint")}
            </a>
          )}
          {onCollect && payer && owes && (
            <Button type="button" className="gap-1.5" onClick={() => onCollect(payer)} data-testid="statement-collect">
              <Wallet className="size-4" aria-hidden />
              {t("sheet.collect")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <RangeFields from={from} to={to} onFrom={setFrom} onTo={setTo} />
        {error && <AlertBanner variant="error" message={error} />}
        {!data && !error && <p className="text-muted-foreground py-8 text-center text-sm">{t("detail.loading")}</p>}
        {data && <StatementSheet data={data} />}
      </div>
    </Modal>
  );
}

function RangeFields({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  const t = useTranslations("accounting");
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="text-muted-foreground text-xs">
        {t("register.from")}
        <input type="date" className={cn(fieldClass, "mt-1")} value={from} max={to} onChange={(e) => e.target.value && onFrom(e.target.value)} />
      </label>
      <label className="text-muted-foreground text-xs">
        {t("register.to")}
        <input type="date" className={cn(fieldClass, "mt-1")} value={to} min={from} onChange={(e) => e.target.value && onTo(e.target.value)} />
      </label>
    </div>
  );
}

/** The sheet itself — the printable article. A receipt row opens the receipt when the host allows it. */
export function StatementSheet({ data, onOpenReceipt }: { data: Statement; onOpenReceipt?: (id: string) => void }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);

  return (
    <article className="space-y-5 bg-card rounded-2xl border p-4 shadow-sm sm:p-6" data-print-area data-testid="statement-sheet">
      <header className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">{t("statement.heading")}</p>
          <h2 className="text-xl font-bold break-words">{data.payer.name ?? "—"}</h2>
          {data.students.length > 0 && <p className="text-muted-foreground text-sm break-words">{data.students.join("، ")}</p>}
          {data.payer.phone && (
            <p className="text-muted-foreground text-xs" dir="ltr">
              {data.payer.phone}
            </p>
          )}
        </div>
        <div className="text-sm sm:text-end">
          <p className="text-muted-foreground text-xs">{t("statement.period")}</p>
          <p className="font-medium">
            {dayLabel(data.from, locale)} — {dayLabel(data.to, locale)}
          </p>
        </div>
      </header>

      {data.balance.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {data.balance.map((b) => (
            <Tile
              key={b.currency}
              label={b.balance_minor > 0 ? t("statement.owesNow") : t("statement.settledNow")}
              value={money(Math.abs(b.balance_minor), b.currency)}
              tone={b.balance_minor > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}
              hint={b.credit_minor > 0 ? t("collect.holds", { amount: money(b.credit_minor, b.currency) }) : undefined}
            />
          ))}
        </div>
      )}

      {data.currencies.length === 0 && <p className="text-muted-foreground py-6 text-center text-sm">{t("statement.empty")}</p>}

      {data.currencies.map((cur) => (
        <section key={cur.currency} className="space-y-3" data-testid={`statement-${cur.currency}`}>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Summary label={t("statement.opening")} value={money(cur.opening_minor, cur.currency)} />
            <Summary label={t("statement.charges")} value={money(cur.charges_minor, cur.currency)} />
            <Summary label={t("statement.receipts")} value={money(cur.receipts_minor, cur.currency)} tone="text-emerald-700 dark:text-emerald-300" />
            <Summary label={t("statement.closing")} value={money(cur.closing_minor, cur.currency)} tone={cur.closing_minor > 0 ? "text-rose-600 dark:text-rose-400" : undefined} strong />
          </div>

          <div className="bg-card overflow-x-auto rounded-xl border shadow-sm">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/70 text-muted-foreground border-b text-xs font-semibold">
                <tr>
                  <th className="p-2.5 text-start font-medium">{t("statement.col.date")}</th>
                  <th className="p-2.5 text-start font-medium">{t("statement.col.item")}</th>
                  <th className="p-2.5 text-end font-medium">{t("statement.col.debit")}</th>
                  <th className="p-2.5 text-end font-medium">{t("statement.col.credit")}</th>
                  <th className="p-2.5 text-end font-medium">{t("statement.col.balance")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr className="bg-muted/20">
                  <td className="p-2.5 whitespace-nowrap">{dayLabel(data.from, locale)}</td>
                  <td className="p-2.5 font-medium">{t("statement.broughtForward")}</td>
                  <td className="p-2.5" />
                  <td className="p-2.5" />
                  <td className="p-2.5 text-end font-semibold tabular-nums">{money(cur.opening_minor, cur.currency)}</td>
                </tr>
                {cur.entries.map((e) => (
                  <tr key={`${e.kind}-${e.id}`} className={e.kind === "RECEIPT" ? "bg-emerald-500/5" : undefined}>
                    <td className="p-2.5 whitespace-nowrap">{dayLabel(e.date, locale)}</td>
                    <td className="p-2.5">
                      {e.kind === "RECEIPT" ? (
                        onOpenReceipt ? (
                          <button type="button" className="flex flex-wrap items-center gap-2 text-start hover:underline" onClick={() => onOpenReceipt(e.id)}>
                            <span className="font-medium">{t("statement.receiptNo", { number: e.description })}</span>
                            {e.method && <MethodBadge method={e.method} />}
                          </button>
                        ) : (
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{t("statement.receiptNo", { number: e.description })}</span>
                            {e.method && <MethodBadge method={e.method} />}
                          </span>
                        )
                      ) : e.kind === "REFUND" ? (
                        <span className="font-medium text-amber-700 dark:text-amber-300" data-testid="statement-refund">
                          {t("statement.refundNo", { number: e.description })}
                        </span>
                      ) : (
                        <>
                          <span className="font-medium break-words">{e.description}</span>
                          {(e.discount_minor ?? 0) > 0 && e.list_amount_minor != null && (
                            <span className="block text-xs text-violet-700 dark:text-violet-300" data-testid="statement-discount">
                              {t("statement.discounted", { amount: money(e.discount_minor ?? 0, e.currency), list: money(e.list_amount_minor, e.currency), label: e.discount_label ?? "" })}
                            </span>
                          )}
                          <span className="text-muted-foreground block text-xs">
                            {[e.student_name, e.group_name].filter(Boolean).join(" · ")}
                            {(e.paid_minor ?? 0) >= e.debit_minor ? (
                              <span className="ms-1.5 text-emerald-700 dark:text-emerald-300">· {t("state.PAID")}</span>
                            ) : (e.paid_minor ?? 0) > 0 ? (
                              <span className="ms-1.5 text-amber-700 dark:text-amber-300">· {t("state.PARTIAL")}</span>
                            ) : null}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="p-2.5 text-end tabular-nums">{e.debit_minor > 0 ? money(e.debit_minor, e.currency) : ""}</td>
                    <td className="p-2.5 text-end text-emerald-700 tabular-nums dark:text-emerald-300">{e.credit_minor > 0 ? money(e.credit_minor, e.currency) : ""}</td>
                    <td className={cn("p-2.5 text-end font-semibold tabular-nums", e.balance_minor > 0 ? "text-foreground" : "text-emerald-700 dark:text-emerald-300")}>
                      {money(e.balance_minor, e.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground text-xs">{t("statement.balanceNote")}</p>
        </section>
      ))}
    </article>
  );
}

function Summary({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-2.5", strong && "bg-muted/40")}>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={cn("font-semibold break-words tabular-nums", strong && "text-base font-bold", tone)}>{value}</p>
    </div>
  );
}
