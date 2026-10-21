"use client";

import { ArrowLeft, Calculator, Receipt } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { MethodBadge, MethodBar, RateBar, Tile, dayLabel, pct, todayLocal } from "@/components/accounting/accounting-ui";
import { ReceiptDetailModal } from "@/components/accounting/receipt-detail-modal";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { PageHero } from "@/components/ui/page-hero";
import { AGE_BUCKETS, getAccountingOverview, type AccountingOverview } from "@/lib/accounting-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The Accounting section's front page (docs/groups/01-ACCOUNTING.md): the month at a glance. What
 * came in (today, this month, by day, by method, by who took it), how much of the month's billing is
 * paid, what is owed and how old it is, the credit families hold, the biggest debtors and the latest
 * receipts — each a door into its own page.
 */
export function AccountingOverviewScreen() {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [month, setMonth] = useState(() => todayLocal().slice(0, 7));
  const [data, setData] = useState<AccountingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getAccountingOverview(month));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("overview.loadFailed")));
    }
  }, [month, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);
  const currencies = data ? [...new Set([...data.collected.map((c) => c.currency), ...data.owed.map((o) => o.currency), ...data.billed.map((b) => b.currency)])].sort() : [];

  return (
    <div className="space-y-5" data-testid="accounting-overview">
      <PageHero icon={Calculator} title={t("overview.title")} subtitle={t("overview.subtitle")} latticeId="accounting-hero" />

      <div className="flex justify-end">
        <input type="month" className={cn(fieldClass, "w-44")} value={month} max={todayLocal().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={t("sheet.month")} />
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {data && currencies.length === 0 && (
        <p className="text-muted-foreground rounded-2xl border border-dashed p-10 text-center text-sm">{t("overview.empty")}</p>
      )}

      {data &&
        currencies.map((c) => {
          const col = data.collected.find((x) => x.currency === c);
          const owed = data.owed.find((x) => x.currency === c);
          const billed = data.billed.find((x) => x.currency === c);
          const credit = data.credit.find((x) => x.currency === c)?.credit_minor ?? 0;
          const isThisMonth = month === data.today.slice(0, 7);

          return (
            <section key={c} className="space-y-4" data-testid={`overview-${c}`}>
              {currencies.length > 1 && <h2 className="text-sm font-semibold">{c}</h2>}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Tile
                  label={t("overview.collectedMonth")}
                  value={money(col?.amount_minor ?? 0, c)}
                  tone="text-emerald-600 dark:text-emerald-400"
                  hint={t("register.receiptsCount", { count: col?.count ?? 0 })}
                  testId="kpi-collected"
                />
                {isThisMonth && <Tile label={t("overview.collectedToday")} value={money(col?.today_minor ?? 0, c)} />}
                <Tile
                  label={t("overview.owed")}
                  value={money(owed?.due_minor ?? 0, c)}
                  tone={(owed?.due_minor ?? 0) > 0 ? "text-rose-600 dark:text-rose-400" : undefined}
                  hint={t("overview.payers", { count: owed?.payers ?? 0 })}
                  testId="kpi-owed"
                />
                <Tile
                  label={t("overview.overdue")}
                  value={money(owed?.overdue_minor ?? 0, c)}
                  tone={(owed?.overdue_minor ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
                  hint={t("overview.overdueHint")}
                />
                <Tile label={t("overview.credit")} value={money(credit, c)} hint={t("overview.creditHint")} />
              </div>

              {billed && (
                <div className="rounded-2xl border p-4">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <p className="text-muted-foreground text-xs">{t("overview.monthRate")}</p>
                      <p className="text-3xl font-bold tabular-nums">{pct(billed.rate)}</p>
                    </div>
                    <p className="text-muted-foreground text-sm">
                      {t("overview.billedPaid", { paid: money(billed.paid_minor, c), billed: money(billed.billed_minor, c) })}
                    </p>
                  </div>
                  <div className="mt-3">
                    <RateBar rate={billed.rate} />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                <div className="rounded-2xl border p-4 lg:col-span-3">
                  <h3 className="mb-3 text-sm font-semibold">{t("overview.byDay")}</h3>
                  <DailyBars days={col?.by_day ?? []} currency={c} locale={locale} />
                </div>
                <div className="space-y-4 rounded-2xl border p-4 lg:col-span-2">
                  <div>
                    <h3 className="mb-3 text-sm font-semibold">{t("register.byMethod")}</h3>
                    <MethodBar byMethod={col?.by_method ?? {}} currency={c} locale={locale} />
                  </div>
                  {(col?.by_collector.length ?? 0) > 0 && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold">{t("overview.byCollector")}</h3>
                      <ul className="divide-y text-sm">
                        {col!.by_collector.map((p) => (
                          <li key={p.id ?? p.source} className="flex items-center justify-between gap-2 py-1.5">
                            <span className="min-w-0 truncate">{p.name ?? t(`source.${p.source as "MANUAL" | "GATEWAY" | "MIGRATED"}`)}</span>
                            <span className="shrink-0 font-semibold tabular-nums">
                              {money(p.amount_minor, c)} <span className="text-muted-foreground text-xs font-normal">· {p.count}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {owed && owed.due_minor > 0 && (
                <div className="rounded-2xl border p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{t("overview.aging")}</h3>
                    <Link href="/accounting/arrears" className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline">
                      {t("overview.allArrears")}
                      <ArrowLeft className="size-3.5 ltr:rotate-180" aria-hidden />
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    {AGE_BUCKETS.map((b) => (
                      <Link
                        key={b}
                        href={`/accounting/arrears?bucket=${b}`}
                        className={cn(
                          "rounded-xl border p-3 transition-colors hover:bg-muted/40",
                          b === "d90_plus" && owed[b] > 0 && "border-rose-500/40 bg-rose-500/5",
                          b === "d61_90" && owed[b] > 0 && "border-amber-500/40 bg-amber-500/5",
                        )}
                      >
                        <p className="text-muted-foreground text-xs">{t(`bucket.${b}`)}</p>
                        <p className="mt-1 font-bold break-words tabular-nums">{money(owed[b], c)}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })}

      {data && (data.top_debtors.length > 0 || data.recent_receipts.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("overview.topDebtors")}</h3>
              <Link href="/accounting/arrears" className="text-primary text-xs font-medium hover:underline">
                {t("overview.allArrears")}
              </Link>
            </div>
            {data.top_debtors.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-sm">{t("overview.noDebtors")}</p>
            ) : (
              <ul className="divide-y" data-testid="overview-debtors">
                {data.top_debtors.map((p) => (
                  <li key={`${p.kind}-${p.id}`} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      {p.id ? (
                        <Link href={`/accounting/statement?${p.kind === "GUARDIAN" ? "guardian_id" : "student_id"}=${p.id}`} className="font-medium break-words hover:underline">
                          {p.name ?? "—"}
                        </Link>
                      ) : (
                        <span className="font-medium">{p.name ?? "—"}</span>
                      )}
                      <p className="text-muted-foreground text-xs break-words">{p.students.join("، ")}</p>
                    </div>
                    <div className="shrink-0 text-end">
                      {p.balances.map((b) => (
                        <p key={b.currency} className="font-semibold text-rose-600 tabular-nums dark:text-rose-400">
                          {money(b.due_minor, b.currency)}
                        </p>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("overview.latest")}</h3>
              <Link href="/receipts" className="text-primary text-xs font-medium hover:underline">
                {t("overview.allReceipts")}
              </Link>
            </div>
            <ul className="divide-y">
              {data.recent_receipts.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setReceiptId(r.id)} className={cn("hover:bg-muted/40 flex w-full items-center justify-between gap-3 rounded-lg px-1 py-2 text-start", r.voided && "opacity-50")}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.payer_name ?? "—"}</span>
                      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <Receipt className="size-3" aria-hidden />
                        <span className="font-mono" dir="ltr">
                          {r.number}
                        </span>
                        · {dayLabel(r.received_on, locale)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <MethodBadge method={r.method} />
                      <span className={cn("font-semibold tabular-nums", r.voided && "line-through")}>{money(r.amount_minor, r.currency)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <ReceiptDetailModal receiptId={receiptId} onClose={() => setReceiptId(null)} onChanged={() => void load()} />
    </div>
  );
}

/**
 * Money in per day of the month: one thin column per day (≤ 24 px, 4 px rounded top, square on the
 * shared baseline), the readout of the hovered / focused day above, the busiest day as the scale.
 * The full table is the Daily collections page.
 */
function DailyBars({ days, currency, locale }: { days: { date: string; amount_minor: number }[]; currency: string; locale: string }) {
  const t = useTranslations("accounting");
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...days.map((d) => d.amount_minor));
  const shown = hover !== null ? days[hover] : null;

  if (max === 0) {
    return <p className="text-muted-foreground py-10 text-center text-sm">{t("overview.nothingCollected")}</p>;
  }

  return (
    <div>
      <p className="text-muted-foreground mb-2 h-5 text-xs tabular-nums" aria-live="polite">
        {shown ? `${dayLabel(shown.date, locale)} — ${formatMoney({ amount: shown.amount_minor, currency }, locale)}` : t("overview.hoverHint")}
      </p>
      <div className="flex h-36 items-end gap-0.5 border-b" role="img" aria-label={t("overview.byDay")} dir="ltr">
        {days.map((d, i) => (
          <button
            key={d.date}
            type="button"
            className="group flex h-full max-w-6 flex-1 items-end justify-center outline-none"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            aria-label={`${d.date}: ${formatMoney({ amount: d.amount_minor, currency }, locale)}`}
          >
            <span
              className={cn(
                "w-full rounded-t-[4px] transition-colors",
                d.amount_minor > 0 ? (hover === i ? "bg-primary" : "bg-primary/70") : "bg-transparent",
              )}
              style={{ height: d.amount_minor > 0 ? `${Math.max(3, (d.amount_minor / max) * 100)}%` : 0 }}
            />
          </button>
        ))}
      </div>
      <div className="text-muted-foreground mt-1 flex justify-between text-[10px] tabular-nums" dir="ltr">
        <span>{days[0]?.date.slice(8)}</span>
        <span>{days[Math.floor(days.length / 2)]?.date.slice(8)}</span>
        <span>{days[days.length - 1]?.date.slice(8)}</span>
      </div>
    </div>
  );
}
