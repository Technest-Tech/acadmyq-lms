import type { ClientDetail, ModuleCode, ModuleSubscription } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { daysUntil } from "@/lib/time";

/**
 * The read-only arithmetic behind the client page's header, KPI strip and overview. Pure
 * functions over the `getClient` payload — nothing here writes, and nothing here decides
 * anything the Modules card (the one writer) has not already decided.
 */

/** Subdomain rules — mirror of the API's validation and the routing middleware's reserved list. */
export const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "mail",
  "static",
  "assets",
  "cdn",
]);

/** The CANONICAL root: `NEXT_PUBLIC_ROOT_DOMAIN` may list several (see middleware.ts), and a link
 *  handed to a client has to name exactly one — the first. */
const CLIENT_ROOT_DOMAIN =
  process.env.NEXT_PUBLIC_ROOT_DOMAIN?.split(",")[0]?.trim();
/** `http` for local development, `https` in prod — mirror of the API's LMS_SITE_SCHEME. */
const CLIENT_SCHEME =
  process.env.NEXT_PUBLIC_ROOT_SCHEME === "http" ? "http" : "https";

/**
 * The address a subdomain handle resolves to, or null when the handle is empty/invalid. With no
 * root domain configured (subdomain routing off) the only address that resolves is the in-app
 * course-site path, so that is what comes back rather than a link that would not open.
 */
export function subdomainUrl(handle: string | null | undefined): string | null {
  const sub = (handle ?? "").trim();
  if (sub === "" || !SUBDOMAIN_RE.test(sub) || RESERVED_SUBDOMAINS.has(sub))
    return null;
  return CLIENT_ROOT_DOMAIN
    ? `${CLIENT_SCHEME}://${sub}.${CLIENT_ROOT_DOMAIN}`
    : `/learn/${sub}`;
}

/** "bright-steps.acadmyq.com" — the address without its scheme, for a meta line. */
export function displayHost(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/** Up to two initials for the logo placeholder — works for Arabic names as well as Latin. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();
}

export interface RevenueBucket {
  interval: "MONTHLY" | "YEARLY";
  currency: string;
  amount: number;
}

/**
 * What the client is billed per currency AND interval — a yearly deal must never be added to a
 * monthly one as if they were the same number (the roster learned this the hard way).
 */
export function revenueBuckets(modules: ModuleSubscription[]): RevenueBucket[] {
  const buckets = new Map<string, RevenueBucket>();
  for (const m of modules) {
    if (m.status !== "ACTIVE" || m.is_trial) continue;
    const key = `${m.billing_interval}|${m.currency}`;
    const bucket = buckets.get(key) ?? {
      interval: m.billing_interval,
      currency: m.currency,
      amount: 0,
    };
    bucket.amount += m.total_cost_minor;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) =>
    a.interval === b.interval
      ? a.currency.localeCompare(b.currency)
      : a.interval === "MONTHLY"
        ? -1
        : 1,
  );
}

/** "EGP 999/mo + EGP 12,000/yr", or "" when nothing is billed. */
export function revenueLabel(
  buckets: RevenueBucket[],
  locale: string,
  suffix: (interval: "MONTHLY" | "YEARLY") => string,
): string {
  return buckets
    .map(
      (b) =>
        formatMoney({ amount: b.amount, currency: b.currency }, locale) +
        suffix(b.interval),
    )
    .join(" + ");
}

export interface UpcomingDate {
  module: ModuleCode;
  date: string;
  days: number;
  /** A trial's end, as opposed to a paid period's renewal. */
  trial: boolean;
}

/**
 * The soonest clock on the client: a trial's end or a paid period's renewal, whichever comes
 * first across its live modules. Paused modules have no clock.
 */
export function nextUpcoming(
  modules: ModuleSubscription[],
): UpcomingDate | null {
  let best: UpcomingDate | null = null;
  for (const m of modules) {
    if (m.status !== "ACTIVE") continue;
    const date = m.is_trial ? m.trial_end : m.current_period_end;
    const days = daysUntil(date);
    if (date === null || days === null) continue;
    if (best === null || days < best.days) {
      best = { module: m.module, date, days, trial: m.is_trial };
    }
  }
  return best;
}

/** `overrides` arrives as jsonb — an object from the directory read, a string from a write. */
export function decodeOverrides(raw: ModuleSubscription["overrides"]): {
  disabled: string[];
  limits: Record<string, number>;
} {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const obj = (parsed ?? {}) as { disabled?: unknown; limits?: unknown };

  return {
    disabled: Array.isArray(obj.disabled) ? obj.disabled.map(String) : [],
    limits:
      obj.limits !== null && typeof obj.limits === "object"
        ? Object.fromEntries(
            Object.entries(obj.limits as Record<string, unknown>).map(
              ([k, v]) => [k, Number(v)],
            ),
          )
        : {},
  };
}

/** How many features are switched off across every live module. */
export function featuresOffCount(modules: ModuleSubscription[]): number {
  return modules.reduce(
    (n, m) => n + decodeOverrides(m.overrides).disabled.length,
    0,
  );
}

/** Short locale date — "Mar 4, 2026" / "٤ مارس ٢٠٢٦". */
export function fmtDate(
  iso: string | null | undefined,
  locale: string,
): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale === "ar" ? "ar" : locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export type ClientRecord = ClientDetail["client"];

/** The sections of the client page; `?tab=` on the URL names one so links can land on it. */
export type ClientTab =
  | "overview"
  | "modules"
  | "billing"
  | "payments"
  | "whatsapp"
  | "video"
  | "settings";

export function clientTabHref(clientId: string, tab: ClientTab): string {
  return tab === "overview"
    ? `/admin/clients/${clientId}`
    : `/admin/clients/${clientId}?tab=${tab}`;
}
