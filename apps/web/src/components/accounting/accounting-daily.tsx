"use client";

import { CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { METHOD_SWATCH, MethodBar, Tile, todayLocal } from "@/components/accounting/accounting-ui";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { PageHero } from "@/components/ui/page-hero";
import { RECEIPT_METHODS, getDailyCollections, type DailyCollections, type ReceiptMethod } from "@/lib/accounting-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

function daysBack(n: number): string {
  const [y = 1970, m = 1, d = 1] = todayLocal().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

function weekday(date: string, locale: string): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Collections day by day (التحصيل اليومي, docs/groups/01-ACCOUNTING.md): what came in each day, by
 * payment method and by who received it — the figures a day's cash is counted against. Voided
 * receipts are left out of the money and counted apart, so a correction is visible, not hidden.
 */
export function AccountingDailyScreen() {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [from, setFrom] = useState(() => daysBack(13));
  const [to, setTo] = useState(todayLocal);
  const [collector, setCollector] = useState("");
  const [data, setData] = useState<DailyCollections | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getDailyCollections({ from, to, collector_id: collector || undefined }));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("daily.loadFailed")));
    }
  }, [from, to, collector, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);
  // Only the methods actually used in the window get a column.
  const methods = useMemo<ReceiptMethod[]>(
    () => RECEIPT_METHODS.filter((m) => (data?.totals ?? []).some((tot) => (tot.by_method[m] ?? 0) > 0)),
    [data],
  );

  return (
    <div className="space-y-5" data-testid="accounting-daily">
      <PageHero icon={CalendarDays} title={t("daily.title")} subtitle={t("daily.subtitle")} latticeId="accounting-daily-hero" />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:w-[36rem]">
        <label className="text-muted-foreground text-xs">
          {t("register.from")}
          <input type="date" className={cn(fieldClass, "mt-1")} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="text-muted-foreground text-xs">
          {t("register.to")}
          <input type="date" className={cn(fieldClass, "mt-1")} value={to} min={from} max={todayLocal()} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <label className="text-muted-foreground text-xs">
          {t("register.collector")}
          <select className={cn(fieldClass, "mt-1")} value={collector} onChange={(e) => setCollector(e.target.value)}>
            <option value="">{t("register.everyone")}</option>
            {(data?.collectors ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {data?.totals.map((tot) => (
        <div key={tot.currency} className="grid grid-cols-1 gap-3 lg:grid-cols-4" data-testid={`daily-totals-${tot.currency}`}>
          <Tile
            label={t("daily.total")}
            value={money(tot.amount_minor, tot.currency)}
            tone="text-emerald-600 dark:text-emerald-400"
            hint={t("register.receiptsCount", { count: tot.count })}
          />
          <div className="rounded-xl border p-3 lg:col-span-3">
            <p className="text-muted-foreground mb-2 text-xs">{t("register.byMethod")}</p>
            <MethodBar byMethod={tot.by_method} currency={tot.currency} locale={locale} />
          </div>
        </div>
      ))}

      {data && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[640px] text-sm" data-testid="daily-table">
            <thead className="bg-muted/50 text-muted-foreground text-xs">
              <tr>
                <th className="p-3 text-start font-medium">{t("daily.col.day")}</th>
                <th className="p-3 text-end font-medium">{t("daily.col.total")}</th>
                <th className="p-3 text-end font-medium">{t("daily.col.count")}</th>
                {methods.map((m) => (
                  <th key={m} className="p-3 text-end font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn("size-2 rounded-sm", METHOD_SWATCH[m])} aria-hidden />
                      {t(`method.${m}`)}
                    </span>
                  </th>
                ))}
                <th className="p-3 text-start font-medium">{t("daily.col.collectors")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.days.map((d) => {
                const empty = d.currencies.length === 0;
                return (
                  <tr key={d.date} className={cn(empty && "text-muted-foreground")}>
                    <td className="p-3 whitespace-nowrap">
                      {weekday(d.date, locale)}
                      {d.voided > 0 && <span className="ms-2 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:text-rose-300">{t("daily.voided", { count: d.voided })}</span>}
                    </td>
                    {empty ? (
                      <td className="p-3 text-end" colSpan={2 + methods.length + 1}>
                        —
                      </td>
                    ) : (
                      <>
                        <td className="p-3 text-end font-semibold tabular-nums">
                          {d.currencies.map((c) => (
                            <span key={c.currency} className="block">
                              {money(c.amount_minor, c.currency)}
                            </span>
                          ))}
                        </td>
                        <td className="p-3 text-end tabular-nums">{d.currencies.reduce((s, c) => s + c.count, 0)}</td>
                        {methods.map((m) => (
                          <td key={m} className="p-3 text-end tabular-nums">
                            {d.currencies.map((c) => (
                              <span key={c.currency} className="block">
                                {(c.by_method[m] ?? 0) > 0 ? money(c.by_method[m] ?? 0, c.currency) : "—"}
                              </span>
                            ))}
                          </td>
                        ))}
                        <td className="p-3 text-xs">
                          {d.currencies.flatMap((c) =>
                            c.by_collector.map((p) => (
                              <span key={`${c.currency}-${p.id ?? p.source}`} className="block whitespace-nowrap">
                                {p.name ?? t(`source.${p.source as "MANUAL" | "GATEWAY" | "MIGRATED"}`)}: <span className="font-semibold tabular-nums">{money(p.amount_minor, c.currency)}</span>
                              </span>
                            )),
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
