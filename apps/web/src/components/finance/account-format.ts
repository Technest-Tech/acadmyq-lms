import type { ChipTone } from "@/components/admin/status-chip";
import type {
  AccountPlan,
  AccountSummary,
  FinanceClientRow,
  FinanceInterval,
} from "@/lib/api";
import { money } from "./finance-format";

/**
 * Display helpers for Accounts (the agreement, its cycle, its discount). The arithmetic that
 * decides what is owed lives in the API's FinanceLedger; here a number is only ever formatted.
 */

/** Months in one cycle — the same table the API rolls cycles with. */
export const INTERVAL_MONTHS: Record<FinanceInterval, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  YEARLY: 12,
};

/** The four plans that are one recurring line, and the cycle each runs on. */
export const PLAN_INTERVAL: Partial<Record<AccountPlan, FinanceInterval>> = {
  MONTHLY: "MONTHLY",
  QUARTERLY: "QUARTERLY",
  SEMI_ANNUAL: "SEMI_ANNUAL",
  YEARLY: "YEARLY",
};

export const PLAN_TONE: Record<AccountPlan, ChipTone> = {
  MONTHLY: "info",
  QUARTERLY: "info",
  SEMI_ANNUAL: "accent",
  YEARLY: "good",
  ONE_TIME_SUPPORT: "warn",
  OUTRIGHT: "neutral",
  CUSTOM: "neutral",
};

/** Whole-percent discount of a cycle against its undiscounted price, or null without one. */
export function discountPct(
  amountMinor: number | null | undefined,
  listMinor: number | null | undefined,
): number | null {
  if (!amountMinor || !listMinor || listMinor <= amountMinor) return null;

  return Math.round((1 - amountMinor / listMinor) * 100);
}

/** The recurring facts of an account row or summary, in one shape. */
export function recurringOf(
  account: FinanceClientRow | AccountSummary,
): {
  amount: number;
  list: number | null;
  interval: FinanceInterval;
  currency: string;
} | null {
  if ("recurring" in account) {
    const r = account.recurring;
    return r
      ? {
          amount: r.amount_minor,
          list: r.list_amount_minor,
          interval: r.interval,
          currency: r.currency,
        }
      : null;
  }
  if (
    account.rec_amount_minor === null ||
    account.rec_interval === null ||
    account.rec_currency === null
  ) {
    return null;
  }

  return {
    amount: account.rec_amount_minor,
    list: account.rec_list_amount_minor,
    interval: account.rec_interval,
    currency: account.rec_currency,
  };
}

/**
 * "EGP 1,000 / month" — `per` maps an interval to its short word ("month", "6 months", "year").
 */
export function cycleLabel(
  amountMinor: number,
  currency: string,
  interval: FinanceInterval,
  locale: string,
  per: (interval: FinanceInterval) => string,
): string {
  return `${money(amountMinor, currency, locale)} / ${per(interval)}`;
}

/** Sum a currency → minor map into "EGP 3,000 · USD 50"; "" when empty. */
export function sumLabel(
  map: Record<string, number> | null | undefined,
  locale: string,
): string {
  return Object.entries(map ?? {})
    .filter(([, v]) => v > 0)
    .map(([c, v]) => money(v, c, locale))
    .join(" · ");
}

/** A WhatsApp click-to-chat link with the message typed in (manual reminder from the owner's phone). */
export function waLink(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? "").replace(/[^\d]/g, "");

  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** The public pay page for a token, on this origin. */
export function payUrlFor(token: string | null | undefined): string | null {
  if (!token) return null;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return `${origin}/a/${token}`;
}

/** Where an account lives: a platform client's money is a tab of its client page; anyone else has its own page. */
export function accountHref(account: { id: string; academy_id?: string | null }): string {
  return account.academy_id
    ? `/admin/clients/${account.academy_id}?tab=subscription`
    : `/admin/accounts/${account.id}`;
}
