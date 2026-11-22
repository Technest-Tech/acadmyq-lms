"use client";

import { useTranslations } from "next-intl";
import { rateBetween, type FxTable, type MoneyTotal } from "@/lib/dashboard-money";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The currencies behind a money card's one total, spelled out (Ahmed, 11-22: "the currency breakdown
 * has to be there, clear and nice"). A bar split by each currency's share of the total, then one line
 * per currency: its code in its own colour, the real amount, and what it is worth in the card's
 * currency at today's rate. Shown on every screen size; a figure is never cut short.
 *
 * Renders nothing for a single currency: the card's figure already IS that currency.
 */

interface Tone {
  bar: string;
  pill: string;
}

// The same currency wears the same colour on every card. Literal class names, so Tailwind keeps them.
const TONES: Record<string, Tone> = {
  EGP: { bar: "bg-emerald-500", pill: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  USD: { bar: "bg-sky-500", pill: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" },
  SAR: { bar: "bg-amber-500", pill: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  GBP: { bar: "bg-violet-500", pill: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300" },
  EUR: { bar: "bg-indigo-500", pill: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300" },
  AED: { bar: "bg-rose-500", pill: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300" },
  KWD: { bar: "bg-teal-500", pill: "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300" },
  CAD: { bar: "bg-pink-500", pill: "bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300" },
  QAR: { bar: "bg-orange-500", pill: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300" },
};
const SPARE: Tone[] = [
  { bar: "bg-lime-500", pill: "bg-lime-100 text-lime-800 dark:bg-lime-500/15 dark:text-lime-300" },
  { bar: "bg-cyan-500", pill: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300" },
  { bar: "bg-fuchsia-500", pill: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300" },
  { bar: "bg-slate-500", pill: "bg-slate-200 text-slate-800 dark:bg-slate-500/20 dark:text-slate-200" },
];

export function currencyTone(code: string): Tone {
  const known = TONES[code];
  if (known) return known;
  const hash = [...code].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return SPARE[hash % SPARE.length]!;
}

export function CurrencyBreakdown({
  total,
  fx,
  locale,
  className,
}: {
  total: MoneyTotal;
  fx: FxTable | null;
  locale: string;
  className?: string;
}) {
  const t = useTranslations("dashboard.finance");
  if (total.parts.length < 2) return null;

  const fmt = (minor: number, currency: string) => formatMoney({ amount: minor, currency }, locale, { trimZeroDecimals: true });
  const rows = total.parts.map((p) => {
    const rate = rateBetween(p.currency, total.currency, fx);
    return { ...p, worth: rate === null ? null : Math.round(p.minor * rate) };
  });
  const whole = rows.reduce((sum, r) => sum + Math.max(r.worth ?? 0, 0), 0);

  return (
    <div className={cn("space-y-2", className)} data-testid="currency-breakdown">
      {whole > 0 && (
        <div className="bg-muted flex h-2 w-full gap-px overflow-hidden rounded-full" aria-hidden>
          {rows.map((r) =>
            r.worth !== null && r.worth > 0 ? (
              <span key={r.currency} className={cn("h-full", currencyTone(r.currency).bar)} style={{ width: `${(r.worth / whole) * 100}%` }} />
            ) : null,
          )}
        </div>
      )}
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.currency} className="flex flex-wrap items-center gap-x-2 gap-y-0.5" data-testid={`currency-row-${r.currency}`}>
            <span className={cn("inline-flex min-w-[2.75rem] justify-center rounded-md px-1.5 py-0.5 text-[0.6875rem] font-extrabold tracking-wide", currencyTone(r.currency).pill)}>
              {r.currency}
            </span>
            <span className="text-foreground text-sm font-bold break-words tabular-nums">{fmt(r.minor, r.currency)}</span>
            {r.currency !== total.currency && (
              <span className="text-muted-foreground ms-auto text-xs break-words tabular-nums">
                {r.worth === null ? t("noRateShort") : `≈ ${fmt(r.worth, total.currency)}`}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-[0.6875rem] leading-snug">
        {total.minor === null ? t("noRateAll") : t("todayRate", { currency: total.currency })}
      </p>
    </div>
  );
}
