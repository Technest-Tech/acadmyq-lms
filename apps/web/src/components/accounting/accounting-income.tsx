"use client";

import { BarChart3, PieChart, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel, Tile, monthLabel, todayLocal } from "@/components/accounting/accounting-ui";
import { ExportButton } from "@/components/accounting/export-button";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { PageHero } from "@/components/ui/page-hero";
import { useAcademyDefaults } from "@/lib/academy-defaults";
import { getAccountingRates, getIncomeExpenses, type AccountingRates } from "@/lib/accounting-api";
import type { SheetColumn } from "@/lib/accounting-export";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** The two series: validated categorical slots 1 and 2, stepped for dark. Fixed per series. */
const IN_SWATCH = "bg-[#2a78d6] dark:bg-[#3987e5]";
const OUT_SWATCH = "bg-[#eb6834] dark:bg-[#d95926]";

type Data = Awaited<ReturnType<typeof getIncomeExpenses>>;

/** The chip that adds every currency up in the academy's own. */
const ALL = "*";

/**
 * Income vs expenses (الإيرادات والمصروفات, docs/groups/01-ACCOUNTING.md): the year month by month —
 * money in (receipts), money out (expenses, salaries included for whoever may see pay), and what is
 * left — plus where the year's money went, by category. For whoever may see pay, the profit too: the
 * cash column only knows a salary once it left the treasury, the profit takes each month's statements.
 * With several currencies, one chip adds them up at today's rate, for reading only.
 */
export function AccountingIncomeScreen({ hero = true }: { hero?: boolean }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const thisYear = Number(todayLocal().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const home = useAcademyDefaults().currency;
  const [fx, setFx] = useState<AccountingRates | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getIncomeExpenses(year));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("income.loadFailed")));
    }
  }, [year, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const currencies = useMemo(() => [...new Set((data?.months ?? []).flatMap((m) => m.currencies.map((c) => c.currency)))].sort(), [data]);
  const several = currencies.length > 1;

  useEffect(() => {
    if (!several) return;
    getAccountingRates()
      .then(setFx)
      .catch(() => setFx(null));
  }, [several]);

  // Each currency's value in the source's home currency, whose own rate is 1 by definition.
  const toHome = useMemo(() => {
    const map = new Map<string, number>((fx?.rates ?? []).map((r) => [r.currency, r.to_home]));
    if (fx?.home) map.set(fx.home, 1);
    return map;
  }, [fx]);
  const homeRate = toHome.get(home);
  const canConvert = several && !!fx?.available && homeRate !== undefined;
  const isAll = currency === ALL && canConvert;
  const missing = isAll ? currencies.filter((c) => !toHome.has(c)) : [];
  const cur = isAll ? home : currency && currencies.includes(currency) ? currency : (currencies[0] ?? "");

  const factor = (c: string) => (isAll ? (toHome.get(c) ?? 0) / (homeRate ?? 1) : c === cur ? 1 : 0);
  const rows = (data?.months ?? []).map((m) => {
    const add = (pick: (c: (typeof m.currencies)[number]) => number | null | undefined) => Math.round(m.currencies.reduce((s, c) => s + (pick(c) ?? 0) * factor(c.currency), 0));
    return {
      month: m.month,
      in: add((c) => c.in_minor),
      out: add((c) => c.out_minor),
      net: add((c) => c.net_minor),
      earned: add((c) => c.salaries_earned_minor),
      profit: add((c) => c.profit_minor),
    };
  });
  const sum = rows.reduce((s, r) => ({ in: s.in + r.in, out: s.out + r.out, net: s.net + r.net, earned: s.earned + r.earned, profit: s.profit + r.profit }), { in: 0, out: 0, net: 0, earned: 0, profit: 0 });
  const hasProfit = (data?.months ?? []).some((m) => m.currencies.some((c) => c.profit_minor != null));
  const max = Math.max(0, ...rows.flatMap((r) => [r.in, r.out]));
  const money = (v: number) => formatMoney({ amount: v, currency: cur || "EGP" }, locale);

  type MonthRow = (typeof rows)[number];
  const sheet: SheetColumn<MonthRow>[] = [
    { header: t("income.month"), width: 14, value: (r) => r.month },
    { header: t("income.in"), kind: "money", value: (r) => r.in },
    { header: t("income.out"), kind: "money", value: (r) => r.out },
    { header: t("income.net"), kind: "money", value: (r) => r.net },
    ...(hasProfit
      ? ([
          { header: t("income.salaries"), kind: "money", value: (r) => r.earned },
          { header: t("income.profit"), kind: "money", value: (r) => r.profit },
        ] as SheetColumn<MonthRow>[])
      : []),
  ];
  const shown = hover !== null ? rows[hover] : null;
  // Where the money went is read per currency; adding it up says nothing a category would miss.
  const catCurrency = isAll ? (currencies[0] ?? "") : cur;
  const catMoney = (v: number) => formatMoney({ amount: v, currency: catCurrency || "EGP" }, locale);
  const cats = (data?.categories ?? []).filter((c) => c.currency === catCurrency);
  const catTotal = cats.reduce((s, c) => s + c.amount_minor, 0);

  return (
    <div className="space-y-5" data-testid="accounting-income">
      {hero && <PageHero icon={Scale} title={t("income.title")} subtitle={t("income.subtitle")} latticeId="accounting-income-hero" />}

      <div className="bg-card flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-3 shadow-sm">
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          {t("income.year")}
          <select className={cn(fieldClass, "w-32")} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {several && (
            <div className="no-scrollbar flex gap-1 overflow-x-auto">
              {canConvert && (
                <button type="button" onClick={() => setCurrency(ALL)} className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-semibold", isAll ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")} data-testid="income-all-currencies">
                  {t("income.allCurrencies", { currency: home })}
                </button>
              )}
              {currencies.map((c) => (
                <button key={c} type="button" onClick={() => setCurrency(c)} className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-semibold", !isAll && c === cur ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}>
                  {c}
                </button>
              ))}
            </div>
          )}
          <ExportButton name={`income-${year}-${cur}`} sheetName={t("income.title")} columns={sheet} rows={rows} count={data ? rows.length : 0} />
        </div>
      </div>

      {isAll && <AlertBanner variant="info" message={t("income.convertedHint")} />}
      {missing.length > 0 && <AlertBanner variant="info" message={t("income.missingRates", { currencies: missing.join("، ") })} />}

      {error && <AlertBanner variant="error" message={error} />}
      {data && !data.sees_salaries && <AlertBanner variant="info" message={t("income.noSalaries")} />}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Tile label={t("income.totalIn")} value={money(sum.in)} icon={TrendingUp} accent="sky" />
            <Tile label={t("income.totalOut")} value={money(sum.out)} icon={TrendingDown} accent="amber" />
            {hasProfit ? (
              <Tile
                label={t("income.totalProfit")}
                value={money(sum.profit)}
                icon={Scale}
                accent={sum.profit < 0 ? "rose" : "emerald"}
                tone={sum.profit < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}
                hint={t("income.profitHint", { net: money(sum.net) })}
              />
            ) : (
              <Tile label={t("income.totalNet")} value={money(sum.net)} icon={Scale} accent={sum.net < 0 ? "rose" : "emerald"} tone={sum.net < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"} />
            )}
          </div>

          <Panel
            title={t("income.byMonth")}
            icon={BarChart3}
            accent="sky"
            action={
              <ul className="flex gap-3 text-xs">
                <li className="flex items-center gap-1.5">
                  <span className={cn("size-2.5 rounded-sm", IN_SWATCH)} aria-hidden />
                  {t("income.in")}
                </li>
                <li className="flex items-center gap-1.5">
                  <span className={cn("size-2.5 rounded-sm", OUT_SWATCH)} aria-hidden />
                  {t("income.out")}
                </li>
              </ul>
            }
          >
            <p className="text-muted-foreground mb-2 h-5 text-xs tabular-nums" aria-live="polite">
              {shown
                ? `${monthLabel(shown.month, locale)} — ${t("income.in")} ${money(shown.in)} · ${t("income.out")} ${money(shown.out)} · ${t("income.net")} ${money(shown.net)}`
                : t("overview.hoverHint")}
            </p>
            {max === 0 ? (
              <p className="text-muted-foreground py-10 text-center text-sm">{t("income.empty")}</p>
            ) : (
              <div className="flex h-48 items-end gap-2 border-b sm:gap-3" role="img" aria-label={t("income.byMonth")} dir="ltr">
                {rows.map((r, i) => (
                  <button
                    key={r.month}
                    type="button"
                    className="flex h-full flex-1 items-end justify-center gap-0.5 outline-none"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    aria-label={`${r.month}: ${money(r.in)} / ${money(r.out)}`}
                  >
                    {[
                      [r.in, IN_SWATCH],
                      [r.out, OUT_SWATCH],
                    ].map(([v, swatch], k) => (
                      <span
                        key={k}
                        className={cn("w-full max-w-4 rounded-t-[4px] transition-opacity", swatch as string, hover !== null && hover !== i && "opacity-40")}
                        style={{ height: (v as number) > 0 ? `${Math.max(2, ((v as number) / max) * 100)}%` : 0 }}
                      />
                    ))}
                  </button>
                ))}
              </div>
            )}
            <div className="text-muted-foreground mt-1 flex gap-2 text-[10px] sm:gap-3" dir="ltr">
              {rows.map((r) => (
                <span key={r.month} className="flex-1 text-center">
                  {r.month.slice(5)}
                </span>
              ))}
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div className="bg-card overflow-x-auto rounded-xl border shadow-sm lg:col-span-3">
              <table className={cn("w-full text-sm", hasProfit ? "min-w-[640px]" : "min-w-[480px]")} data-testid="income-table">
                <thead className="bg-muted/70 text-muted-foreground border-b text-xs font-semibold">
                  <tr>
                    <th className="p-3 text-start">{t("income.month")}</th>
                    <th className="p-3 text-end">{t("income.in")}</th>
                    <th className="p-3 text-end">{t("income.out")}</th>
                    <th className="p-3 text-end">{t("income.net")}</th>
                    {hasProfit && <th className="p-3 text-end">{t("income.salaries")}</th>}
                    {hasProfit && <th className="p-3 text-end">{t("income.profit")}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.month} className={cn(r.in === 0 && r.out === 0 && r.earned === 0 && "text-muted-foreground")}>
                      <td className="p-3">{monthLabel(r.month, locale)}</td>
                      <td className="p-3 text-end tabular-nums">{r.in ? money(r.in) : "—"}</td>
                      <td className="p-3 text-end tabular-nums">{r.out ? money(r.out) : "—"}</td>
                      <td className={cn("p-3 text-end font-semibold tabular-nums", r.net < 0 ? "text-rose-600 dark:text-rose-400" : r.net > 0 && "text-emerald-700 dark:text-emerald-300")}>
                        {r.in || r.out ? money(r.net) : "—"}
                      </td>
                      {hasProfit && <td className="p-3 text-end tabular-nums">{r.earned ? money(r.earned) : "—"}</td>}
                      {hasProfit && (
                        <td className={cn("p-3 text-end font-semibold tabular-nums", r.profit < 0 ? "text-rose-600 dark:text-rose-400" : r.profit > 0 && "text-emerald-700 dark:text-emerald-300")}>
                          {r.in || r.out || r.earned ? money(r.profit) : "—"}
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr className="bg-muted/40 font-bold">
                    <td className="p-3">{t("income.year")}</td>
                    <td className="p-3 text-end tabular-nums">{money(sum.in)}</td>
                    <td className="p-3 text-end tabular-nums">{money(sum.out)}</td>
                    <td className={cn("p-3 text-end tabular-nums", sum.net < 0 && "text-rose-600 dark:text-rose-400")}>{money(sum.net)}</td>
                    {hasProfit && <td className="p-3 text-end tabular-nums">{money(sum.earned)}</td>}
                    {hasProfit && <td className={cn("p-3 text-end tabular-nums", sum.profit < 0 && "text-rose-600 dark:text-rose-400")}>{money(sum.profit)}</td>}
                  </tr>
                </tbody>
              </table>
            </div>

            <Panel title={t("income.whereItWent")} icon={PieChart} accent="amber" className="lg:col-span-2">
              {cats.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">{t("expenses.empty")}</p>
              ) : (
                <ul className="space-y-2">
                  {cats.map((c) => {
                    const share = catTotal > 0 ? Math.round((c.amount_minor / catTotal) * 100) : 0;
                    return (
                      <li key={c.name} className="text-sm">
                        <div className="flex justify-between gap-2">
                          <span className="truncate">{c.name}</span>
                          <span className="shrink-0 font-semibold tabular-nums">
                            {catMoney(c.amount_minor)} <span className="text-muted-foreground text-xs font-normal">{share}%</span>
                          </span>
                        </div>
                        <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                          <div className={cn("h-full rounded-full", OUT_SWATCH)} style={{ width: `${share}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
