import type { ChipTone } from "@/components/admin/status-chip";
import type { FinanceDealStatus, FinanceInstallmentStatus } from "@/lib/api";
import { formatMoney } from "@/lib/money";

/**
 * Display helpers shared by the finance screens (Super Admin → Finance). All money arrives as
 * integer minor units per currency and is only ever FORMATTED here; the arithmetic — the
 * waterfall, rolling cycles — lives in the API's FinanceLedger and never on the client.
 */

export const DEAL_TONE: Record<FinanceDealStatus, ChipTone> = {
  ACTIVE: "good",
  COMPLETED: "info",
  CANCELLED: "neutral",
};

export const INSTALLMENT_TONE: Record<FinanceInstallmentStatus, ChipTone> = {
  PAID: "good",
  PARTIAL: "warn",
  OVERDUE: "crit",
  PENDING: "neutral",
};

export function money(minor: number, currency: string, locale: string): string {
  return formatMoney({ amount: minor, currency }, locale, {
    trimZeroDecimals: true,
  });
}

/** "EGP 12,300 · USD 50" over a currency → minor map; "—" when nothing is there. */
export function moneyMap(
  map: Record<string, number> | null | undefined,
  locale: string,
): string {
  const parts = Object.entries(map ?? {})
    .filter(([, v]) => v > 0)
    .map(([c, v]) => money(v, c, locale));

  return parts.length > 0 ? parts.join(" · ") : "—";
}

function bcp47(locale: string): string {
  return locale.startsWith("ar") && !locale.includes("-nu-")
    ? `${locale}-u-nu-arab`
    : locale;
}

/** Parse a plain "YYYY-MM-DD" as a LOCAL calendar day, so a due date never shifts by a timezone. */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);

  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function toIso(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function formatDay(
  iso: string | null | undefined,
  locale: string,
): string {
  if (!iso) return "—";

  return new Intl.DateTimeFormat(bcp47(locale), { dateStyle: "medium" }).format(
    parseDay(iso),
  );
}

/** "2026-09" → "Sep 2026". */
export function formatMonth(ym: string, locale: string): string {
  return new Intl.DateTimeFormat(bcp47(locale), {
    month: "short",
    year: "numeric",
  }).format(parseDay(`${ym}-01`));
}

export function todayIso(): string {
  return toIso(new Date());
}

/** Whole days from `from` to `to` (both "YYYY-MM-DD"); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000,
  );
}

/**
 * Add months keeping the anchor day-of-month, the way the ledger rolls subscription cycles:
 * 31 Jan + 1 → 28 Feb, + 2 → 31 Mar (no drift into "the 28th forever").
 */
export function addMonths(
  iso: string,
  months: number,
  anchorDay?: number,
): string {
  const base = parseDay(iso);
  const day = anchorDay ?? base.getDate();
  const first = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const lastDay = new Date(
    first.getFullYear(),
    first.getMonth() + 1,
    0,
  ).getDate();

  return toIso(
    new Date(first.getFullYear(), first.getMonth(), Math.min(day, lastDay)),
  );
}

/** "1,500.50" → 150050; blank or garbage → null. The one place a typed amount becomes minor units. */
export function toMinor(text: string): number | null {
  const trimmed = String(text).replace(/[,\s]/g, "");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;

  return Math.round(n * 100);
}

/** 150050 → "1500.5" — what to put back into an amount input. */
export function fromMinor(minor: number): string {
  const major = minor / 100;

  return Number.isInteger(major) ? String(major) : major.toFixed(2);
}

/** Tone for a due date: past → crit, within a week → warn, else neutral. */
export function dueTone(dueOn: string | null, today: string): ChipTone {
  if (!dueOn) return "neutral";
  const days = daysBetween(today, dueOn);
  if (days < 0) return "crit";
  if (days <= 7) return "warn";

  return "neutral";
}

/** "YYYY-MM" keys for the ledger's month filter: this month and the ones before it, newest first. */
export function recentMonths(count = 24): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  return out;
}

/**
 * The first useful sentence out of a failed request: a 422's first field error, else the API's
 * message, else the caller's fallback. Duck-typed so it never throws on an unexpected shape.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const body = (error as { body?: unknown }).body;
    const errors = (body as { errors?: unknown } | undefined)?.errors;
    if (errors && typeof errors === "object") {
      const first = Object.values(errors as Record<string, unknown>).flat()[0];
      if (typeof first === "string" && first) return first;
    }
    const message = (error as { message?: unknown }).message;
    if (
      typeof message === "string" &&
      message &&
      !message.startsWith("Request to ")
    ) {
      return message;
    }
  }

  return fallback;
}
