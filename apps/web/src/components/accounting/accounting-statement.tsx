"use client";

import { FileText, Printer, Users, Wallet } from "lucide-react";
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
import { PageHero } from "@/components/ui/page-hero";
import { getStatement, type Statement } from "@/lib/accounting-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

function sixMonthsBack(): string {
  const [y = 1970, m = 1] = todayLocal().split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - 5, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * A family's statement of account (كشف حساب, docs/groups/01-ACCOUNTING.md): the balance brought
 * forward, then every charge and every receipt in the window, oldest first, with a running
 * balance — and where the account stands today. Printable on its own (no sidebar, no controls),
 * and the account can be collected from right here.
 */
export function AccountingStatementScreen() {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const router = useRouter();
  const search = useSearchParams();
  const { can } = useAuth();
  const guardianId = search.get("guardian_id");
  const studentId = search.get("student_id");
  const hasPayer = Boolean(guardianId || studentId);

  const [from, setFrom] = useState(sixMonthsBack);
  const [to, setTo] = useState(todayLocal);
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(!hasPayer);
  const [collect, setCollect] = useState<CollectTarget | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  const payer = useMemo(() => ({ guardian_id: guardianId, student_id: guardianId ? null : studentId }), [guardianId, studentId]);

  const load = useCallback(async () => {
    if (!hasPayer) return;
    try {
      setData(await getStatement(payer, from, to));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("statement.loadFailed")));
    }
  }, [hasPayer, payer, from, to, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Printing this page prints the statement alone (globals.css: body.print-isolate).
  useEffect(() => {
    document.body.classList.add("print-isolate");
    return () => document.body.classList.remove("print-isolate");
  }, []);

  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);

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
              {hasPayer ? t("statement.change") : t("statement.pick")}
            </Button>
          }
        />
      </div>

      {hasPayer && (
        <div className="flex flex-wrap items-end justify-between gap-2" data-print-hide>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-muted-foreground text-xs">
              {t("register.from")}
              <input type="date" className={cn(fieldClass, "mt-1")} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            </label>
            <label className="text-muted-foreground text-xs">
              {t("register.to")}
              <input type="date" className={cn(fieldClass, "mt-1")} value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
            </label>
          </div>
          <div className="flex gap-2">
            {can("invoice.mark_paid") && data && data.balance.some((b) => b.due_minor > 0) && (
              <Button type="button" className="gap-1.5" onClick={() => setCollect({ guardian_id: payer.guardian_id, student_id: payer.student_id })}>
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

      {!hasPayer && !picking && <p className="text-muted-foreground rounded-2xl border border-dashed p-10 text-center text-sm">{t("statement.none")}</p>}

      {data && (
        <article className="space-y-5 rounded-2xl border p-4 sm:p-6" data-print-area data-testid="statement-sheet">
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

              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/50 text-muted-foreground text-xs">
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
                            <button type="button" className="flex flex-wrap items-center gap-2 text-start hover:underline" onClick={() => setReceiptId(e.id)}>
                              <span className="font-medium">{t("statement.receiptNo", { number: e.description })}</span>
                              {e.method && <MethodBadge method={e.method} />}
                            </button>
                          ) : (
                            <>
                              <span className="font-medium break-words">{e.description}</span>
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
      )}

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

function Summary({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-2.5", strong && "bg-muted/40")}>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={cn("font-semibold break-words tabular-nums", strong && "text-base font-bold", tone)}>{value}</p>
    </div>
  );
}
