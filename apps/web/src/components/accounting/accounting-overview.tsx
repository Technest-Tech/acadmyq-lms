"use client";

import { AlarmClock, ArrowLeft, BarChart3, Calculator, CalendarCheck, CreditCard, Hourglass, PiggyBank, Receipt, UserCheck, Vault, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { StatementModal, type StatementTarget } from "@/components/accounting/accounting-statement";
import { AgingBar, MethodBadge, MethodBar, RateBar, Tile, dayLabel, pct, todayLocal } from "@/components/accounting/accounting-ui";
import { CollectModal, type CollectTarget } from "@/components/accounting/collect-modal";
import { ReceiptDetailModal } from "@/components/accounting/receipt-detail-modal";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { PageHero } from "@/components/ui/page-hero";
import { getAccountingOverview, getTreasury, type AccountingOverview, type TreasuryState } from "@/lib/accounting-api";
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
  const router = useRouter();
  const [month, setMonth] = useState(() => todayLocal().slice(0, 7));
  const [data, setData] = useState<AccountingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [statement, setStatement] = useState<StatementTarget | null>(null);
  const [collect, setCollect] = useState<CollectTarget | null>(null);
  const [treasury, setTreasury] = useState<TreasuryState | null>(null);

  // Where the money is right now — once the treasury is set up (no accounts ⇒ nothing shown).
  useEffect(() => {
    getTreasury()
      .then(setTreasury)
      .catch(() => setTreasury(null));
  }, []);

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

      {treasury && treasury.accounts.some((a) => a.is_active) && (
        <section className="bg-card rounded-2xl border p-4 shadow-sm" data-testid="overview-treasury">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 ring-1 ring-emerald-500/25 dark:text-emerald-400">
                <Vault className="size-3.5" aria-hidden />
              </span>
              {t("overview.treasuryNow")}
            </h3>
            <Link href="/accounting/treasury" className="text-primary text-xs font-medium hover:underline">
              {t("overview.openTreasury")}
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {treasury.accounts
              .filter((a) => a.is_active)
              .map((a) => (
                <Link key={a.id} href="/accounting/treasury" className="bg-muted/30 hover:bg-muted/60 rounded-xl border p-3 transition-colors">
                  <p className="text-muted-foreground truncate text-xs">{a.name}</p>
                  <p className={cn("mt-1 text-lg font-bold break-words tabular-nums", a.balance_minor < 0 && "text-rose-600 dark:text-rose-400")}>
                    {money(a.balance_minor, a.currency)}
                  </p>
                </Link>
              ))}
            {treasury.month.currencies.map((m) => (
              <div key={m.currency} className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-muted-foreground text-xs">{t("treasury.monthOut")}</p>
                <p className="mt-1 text-lg font-bold tabular-nums">{money(m.out_minor, m.currency)}</p>
                <p className={cn("text-xs font-semibold", m.net_minor < 0 ? "text-rose-600" : "text-emerald-700 dark:text-emerald-300")}>
                  {t("treasury.monthNet")}: {money(m.net_minor, m.currency)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {data && currencies.length === 0 && (
        <p className="text-muted-foreground rounded-2xl border border-dashed bg-card/60 p-10 text-center text-sm">{t("overview.empty")}</p>
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
                  label={t("overview.collectedMonth")} icon={Wallet} accent="emerald"
                  value={money(col?.amount_minor ?? 0, c)}
                  tone="text-emerald-600 dark:text-emerald-400"
                  hint={t("register.receiptsCount", { count: col?.count ?? 0 })}
                  testId="kpi-collected"
                />
                {isThisMonth && <Tile label={t("overview.collectedToday")} icon={CalendarCheck} accent="sky" value={money(col?.today_minor ?? 0, c)} />}
                <Tile
                  label={t("overview.owed")} icon={AlarmClock} accent="rose"
                  value={money(owed?.due_minor ?? 0, c)}
                  tone={(owed?.due_minor ?? 0) > 0 ? "text-rose-600 dark:text-rose-400" : undefined}
                  hint={t("overview.payers", { count: owed?.payers ?? 0 })}
                  testId="kpi-owed"
                />
                <Tile
                  label={t("overview.overdue")} icon={Hourglass} accent="amber"
                  value={money(owed?.overdue_minor ?? 0, c)}
                  tone={(owed?.overdue_minor ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
                  hint={t("overview.overdueHint")}
                />
                <Tile label={t("overview.credit")} icon={PiggyBank} accent="violet" value={money(credit, c)} hint={t("overview.creditHint")} />
              </div>

              {billed && (
                <div className="from-primary/[0.08] via-card to-card bg-card rounded-2xl border bg-gradient-to-br p-4 shadow-sm sm:p-5">
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
                <div className="bg-card rounded-2xl border p-4 shadow-sm lg:col-span-3">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><span className="flex size-7 items-center justify-center rounded-lg ring-1 bg-emerald-500/12 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400"><BarChart3 className="size-3.5" aria-hidden /></span>{t("overview.byDay")}</h3>
                  <DailyBars days={col?.by_day ?? []} currency={c} locale={locale} />
                </div>
                <div className="space-y-4 bg-card rounded-2xl border p-4 shadow-sm lg:col-span-2">
                  <div>
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><span className="flex size-7 items-center justify-center rounded-lg ring-1 bg-sky-500/12 text-sky-600 ring-sky-500/25 dark:text-sky-400"><CreditCard className="size-3.5" aria-hidden /></span>{t("register.byMethod")}</h3>
                    <MethodBar byMethod={col?.by_method ?? {}} currency={c} locale={locale} />
                  </div>
                  {(col?.by_collector.length ?? 0) > 0 && (
                    <div>
                      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="flex size-7 items-center justify-center rounded-lg ring-1 bg-violet-500/12 text-violet-600 ring-violet-500/25 dark:text-violet-400"><UserCheck className="size-3.5" aria-hidden /></span>{t("overview.byCollector")}</h3>
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
                <div className="bg-card rounded-2xl border p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold"><span className="flex size-7 items-center justify-center rounded-lg ring-1 bg-amber-500/12 text-amber-600 ring-amber-500/25 dark:text-amber-400"><Hourglass className="size-3.5" aria-hidden /></span>{t("overview.aging")}</h3>
                    <Link href="/accounting/arrears" className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline">
                      {t("overview.allArrears")}
                      <ArrowLeft className="size-3.5 ltr:rotate-180" aria-hidden />
                    </Link>
                  </div>
                  <AgingBar amounts={owed} currency={c} locale={locale} onSelect={(b) => router.push(`/accounting/arrears?bucket=${b}`)} />
                </div>
              )}
            </section>
          );
        })}

      {data && (data.top_debtors.length > 0 || data.recent_receipts.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="bg-card rounded-2xl border p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><span className="flex size-7 items-center justify-center rounded-lg ring-1 bg-rose-500/12 text-rose-600 ring-rose-500/25 dark:text-rose-400"><AlarmClock className="size-3.5" aria-hidden /></span>{t("overview.topDebtors")}</h3>
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
                        <button
                          type="button"
                          onClick={() => setStatement(p.kind === "GUARDIAN" ? { guardian_id: p.id } : { student_id: p.id })}
                          className="font-medium break-words text-start hover:underline"
                          data-testid={`overview-debtor-${p.id}`}
                        >
                          {p.name ?? "—"}
                        </button>
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

          <section className="bg-card rounded-2xl border p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><span className="flex size-7 items-center justify-center rounded-lg ring-1 bg-emerald-500/12 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400"><Receipt className="size-3.5" aria-hidden /></span>{t("overview.latest")}</h3>
              <Link href="/accounting/treasury?tab=receipts" className="text-primary text-xs font-medium hover:underline">
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

      <StatementModal
        target={statement}
        onClose={() => setStatement(null)}
        onCollect={(target) => {
          setStatement(null);
          setCollect(target);
        }}
      />
      <CollectModal open={collect !== null} target={collect} onClose={() => setCollect(null)} onRecorded={() => void load()} />
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
