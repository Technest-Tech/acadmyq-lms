import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/money";

/**
 * Money across currencies for the home screens' cards.
 *
 * An academy bills in more than one currency (a family abroad pays in dollars, another in pounds,
 * the teachers are paid in Egyptian pounds). The dashboards used to read ONE currency's slice and
 * show it as the whole: the classic one took the first row the server sent, which is ordered by the
 * raw sum, so Egyptian pounds (the biggest raw numbers) always won; the modern and centre ones took
 * the academy's currency and, when there was no row in it, printed another currency's figure under
 * the academy's symbol. Profit was worked out per currency, so dollars in minus pounds out read as a
 * dollar profit and a pound loss.
 *
 * Here every card is ONE total in the academy's own currency (Settings → academy currency), converted
 * at today's rate, with the real amounts per currency kept underneath. A single currency is shown as
 * it is, never converted. Several currencies and no rates: there is no honest single figure, so the
 * card lists each currency on its own.
 */

export interface CurrencyAmount {
  currency: string;
  minor: number;
}

/** How many units of `home` one unit of each other currency buys (the server's `to_home`). */
export interface FxTable {
  home: string;
  toHome: Record<string, number>;
}

export interface MoneyTotal {
  /** The currency the headline figure is in. */
  currency: string;
  /** The headline figure, or null when several currencies cannot be added up (no rates). */
  minor: number | null;
  /** True when other currencies were converted into `currency` to reach the figure. */
  converted: boolean;
  /** The real amounts behind it, one per currency, biggest first (by converted value when known). */
  parts: CurrencyAmount[];
  /** Currencies with no rate, left out of `minor`. */
  missing: string[];
}

interface RatesPayload {
  home: string;
  available: boolean;
  rates: { currency: string; to_home: number }[];
}

/** GET /api/dashboard/exchange-rates — today's rates, null when the source is unreachable. */
export async function getDashboardRates(): Promise<FxTable | null> {
  const r = await apiFetch<RatesPayload>("/api/dashboard/exchange-rates");
  if (!r.available || r.rates.length === 0) return null;
  const toHome: Record<string, number> = {};
  for (const rate of r.rates) toHome[rate.currency.toUpperCase()] = rate.to_home;
  return { home: r.home.toUpperCase(), toHome };
}

/** Units of `to` that one unit of `from` buys, through the table's home currency; null when unknown. */
export function rateBetween(from: string, to: string, fx: FxTable | null): number | null {
  if (from === to) return 1;
  if (fx === null) return null;
  const f = from === fx.home ? 1 : fx.toHome[from];
  const t = to === fx.home ? 1 : fx.toHome[to];
  if (!f || !t) return null;
  return f / t;
}

/** Add amounts of one currency together and drop the zeros. */
function merge(amounts: CurrencyAmount[]): CurrencyAmount[] {
  const by = new Map<string, number>();
  for (const a of amounts) {
    if (!a.currency || !a.minor) continue;
    const cur = a.currency.toUpperCase();
    by.set(cur, (by.get(cur) ?? 0) + a.minor);
  }
  return [...by.entries()].map(([currency, minor]) => ({ currency, minor }));
}

/**
 * One figure for a set of per-currency amounts.
 *
 * - nothing → zero in `target`;
 * - one currency → that amount in that currency, as it is (a dollar-only academy reads dollars);
 * - several → converted into `target`; with no rates at all, `minor` is null.
 */
export function totalIn(amounts: CurrencyAmount[], target: string, fx: FxTable | null): MoneyTotal {
  const parts = merge(amounts);
  if (parts.length === 0) return { currency: target, minor: 0, converted: false, parts: [], missing: [] };
  if (parts.length === 1) {
    const only = parts[0]!;
    return { currency: only.currency, minor: only.minor, converted: false, parts, missing: [] };
  }
  // No rates at all: the academy's own slice alone would be the old wrong figure again.
  if (fx === null) {
    return { currency: target, minor: null, converted: true, parts, missing: parts.filter((p) => p.currency !== target).map((p) => p.currency) };
  }
  let minor = 0;
  let any = false;
  const missing: string[] = [];
  const valued = parts.map((p) => {
    const rate = rateBetween(p.currency, target, fx);
    if (rate === null) {
      missing.push(p.currency);
      return { p, v: null as number | null };
    }
    any = true;
    const v = Math.round(p.minor * rate);
    minor += v;
    return { p, v };
  });
  valued.sort((a, b) => Math.abs(b.v ?? 0) - Math.abs(a.v ?? 0));
  return {
    currency: target,
    minor: any ? minor : null,
    converted: true,
    parts: valued.map((x) => x.p),
    missing,
  };
}

/**
 * Several series of per-currency amounts in ONE currency, so they can be compared or subtracted
 * (revenue against salaries, month against month). Picks the one currency every amount is in when
 * there is only one, otherwise converts into `target`; returns null when that cannot be done.
 */
export function commonCurrency(all: CurrencyAmount[], target: string, fx: FxTable | null): string | null {
  const currencies = new Set(merge(all).map((a) => a.currency));
  if (currencies.size === 0) return target;
  if (currencies.size === 1) return [...currencies][0]!;
  // Several currencies: only rates can bring them together (one without a rate is left out).
  return fx === null ? null : target;
}

/** A per-currency set as one number in `currency` (amounts with no rate are left out). */
export function sumAs(amounts: CurrencyAmount[], currency: string, fx: FxTable | null): number {
  let minor = 0;
  for (const a of amounts) {
    if (!a.minor) continue;
    const rate = rateBetween(a.currency.toUpperCase(), currency, fx);
    if (rate !== null) minor += Math.round(a.minor * rate);
  }
  return minor;
}

/** "$1,200 · £300 · 5,000 ج.م" — the real amounts under a converted card. */
export function partsText(parts: CurrencyAmount[], locale: string): string {
  return parts.map((p) => formatMoney({ amount: p.minor, currency: p.currency }, locale, { trimZeroDecimals: true })).join(" · ");
}

/**
 * The academy's currency for the cards: what the owner set in Settings, else the currency most of
 * the money is in, else Egyptian pounds.
 */
export function academyCurrency(setting: string | null | undefined, amounts: CurrencyAmount[] = []): string {
  if (setting && setting.trim().length === 3) return setting.trim().toUpperCase();
  const parts = merge(amounts).sort((a, b) => Math.abs(b.minor) - Math.abs(a.minor));
  return parts[0]?.currency ?? "EGP";
}

/**
 * Today's rates, fetched only once the cards hold more than one currency (a one-currency academy
 * never calls). `pending` is true while they are needed and still on their way, so a card can keep
 * its skeleton rather than flash a per-currency list first.
 */
export function useDashboardRates(currencies: string[]): { fx: FxTable | null; pending: boolean } {
  const key = useMemo(() => [...new Set(currencies.filter(Boolean).map((c) => c.toUpperCase()))].sort().join(","), [currencies]);
  const needed = key.includes(",");
  const [fx, setFx] = useState<FxTable | null>(null);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!needed || settled) return;
    let cancelled = false;
    getDashboardRates()
      .then((r) => {
        if (!cancelled) setFx(r);
      })
      .catch(() => {
        if (!cancelled) setFx(null);
      })
      .finally(() => {
        if (!cancelled) setSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [needed, settled]);
  return { fx, pending: needed && !settled };
}
