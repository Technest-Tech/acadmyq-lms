import type { AccountSummary, ClientDetail, ModuleCode, ModuleSubscription } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { numeralLocale } from "@/lib/numerals";
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

/**
 * What a client pays, in words, from its account: "EGP 1,000 / month", "EGP 10,200 / year (15% off)".
 * Empty when it has no recurring line — the caller shows the agreement's name or a dash.
 */
export function agreementPrice(
  account: Pick<AccountSummary, "recurring"> | null | undefined,
  locale: string,
  per: (interval: NonNullable<AccountSummary["recurring"]>["interval"]) => string,
): string {
  const r = account?.recurring;
  if (!r) return "";
  return `${formatMoney({ amount: r.amount_minor, currency: r.currency }, locale, { trimZeroDecimals: true })} / ${per(r.interval)}`;
}

/** The recurring price normalised to a month (for sorting by revenue). */
export function monthlyOf(account: Pick<AccountSummary, "recurring"> | null | undefined): number {
  const r = account?.recurring;
  if (!r) return 0;
  const months = { MONTHLY: 1, QUARTERLY: 3, SEMI_ANNUAL: 6, YEARLY: 12 }[r.interval] ?? 1;
  return r.amount_minor / months;
}

/** What a module's clock needs — the client read's subscription and the roster's chip both carry it. */
export type ModuleClock = Pick<
  ModuleSubscription,
  "module" | "is_trial" | "trial_end" | "current_period_end"
> & { status: string };

/**
 * How urgent a clock is: an overdue renewal or an ended trial is critical, a trial in its last three
 * days or a renewal inside the week wants a look, anything further off is just a date.
 */
export function clockTone(clock: UpcomingDate): "crit" | "warn" | "neutral" {
  if (clock.days < 0) return "crit";
  if (clock.trial ? clock.days <= 3 : clock.days <= 7) return "warn";
  return "neutral";
}

/**
 * Modules no longer sold (the video platform was archived on 2026-10-20). A client that still holds
 * one keeps seeing it, so it can be paused or ended; nobody can enable it anew.
 */
export const RETIRED_MODULES: readonly ModuleCode[] = ["VIDEO"];

/**
 * The module rows a client page lists: what its type may hold (minus a retired module it does not
 * hold), then anything it holds beyond its type — a hand-sold module must never be invisible.
 */
export function moduleSlots(allowed: readonly ModuleCode[], held: readonly ModuleCode[]): ModuleCode[] {
  const slots = allowed.filter((code) => !RETIRED_MODULES.includes(code) || held.includes(code));
  return [...slots, ...held.filter((code) => !slots.includes(code))];
}

/** Nobody signing in for this long is the earliest sign a client is drifting away. */
export const INACTIVE_AFTER_DAYS = 14;

/** Whole days since a moment (0 today), or null without one. */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/**
 * Is the client drifting? Nobody signed in for INACTIVE_AFTER_DAYS — or nobody ever, once it has
 * had three days to start. A client created yesterday is not "inactive", it is new.
 */
export function isInactive(lastLoginAt: string | null | undefined, createdAt: string): boolean {
  const since = daysSince(lastLoginAt);
  if (since === null) return (daysSince(createdAt) ?? 0) >= 3;
  return since >= INACTIVE_AFTER_DAYS;
}

export interface UpcomingDate {
  module: ModuleCode;
  date: string;
  days: number;
  /** A trial's end, as opposed to a paid period's renewal. */
  trial: boolean;
}

/**
 * The soonest clock on the client: a live module's trial end, or the next payment its account
 * owes (late or not) — whichever comes first. The paid clock is the BOOK's (Accounts, 2026-11-08):
 * module periods are no longer rolled or billed, so they are never read for a renewal date. A
 * paying client with no agreement has no paid clock (Accounts → Dues lists it instead).
 */
export function nextUpcoming(
  modules: readonly ModuleClock[],
  account?: Pick<AccountSummary, "next_due_on"> | null,
): UpcomingDate | null {
  let best: UpcomingDate | null = null;
  for (const m of modules) {
    if (m.status !== "ACTIVE" || !m.is_trial) continue;
    const days = daysUntil(m.trial_end);
    if (m.trial_end === null || days === null) continue;
    if (best === null || days < best.days) {
      best = { module: m.module, date: m.trial_end, days, trial: true };
    }
  }
  const due = account?.next_due_on ?? null;
  const dueDays = daysUntil(due);
  if (due !== null && dueDays !== null && (best === null || dueDays < best.days)) {
    const primary = modules.find((m) => m.status === "ACTIVE" && !m.is_trial) ?? modules[0];
    best = { module: primary?.module ?? "MANAGEMENT", date: due, days: dueDays, trial: false };
  }
  return best;
}

/** `overrides` arrives as jsonb — an object from the directory read, a string from a write. */
export function decodeOverrides(raw: ModuleSubscription["overrides"]): {
  disabled: string[];
  /** Opt-in features switched ON for this client (FeatureCatalog::OPT_IN_CAPABILITIES). */
  enabled: string[];
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
  const obj = (parsed ?? {}) as { disabled?: unknown; enabled?: unknown; limits?: unknown };

  return {
    disabled: Array.isArray(obj.disabled) ? obj.disabled.map(String) : [],
    enabled: Array.isArray(obj.enabled) ? obj.enabled.map(String) : [],
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
  // The workspace's digits, like every other number on the page.
  return new Date(iso).toLocaleDateString(numeralLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export type ClientRecord = ClientDetail["client"];

/**
 * The sections of the client page; `?tab=` on the URL names one so links can land on it.
 *
 *   overview      what needs a decision, is it being used, the facts for a call
 *   subscription  what it holds (modules, trials) and pays — its account in the book
 *   features      the per-client switches, grouped by job, opt-in extras first
 *   connections   WhatsApp, the payment gateway, the domains
 *   settings      identity, owner login, danger zone
 */
export type ClientTab = "overview" | "subscription" | "features" | "connections" | "settings";

/** The eight-tab page's names, so a bookmark or an old link still lands in the right place. */
export const LEGACY_CLIENT_TABS: Record<string, ClientTab> = {
  modules: "subscription",
  billing: "subscription",
  payments: "connections",
  whatsapp: "connections",
  video: "connections",
};

export function clientTabHref(clientId: string, tab: ClientTab): string {
  return tab === "overview"
    ? `/admin/clients/${clientId}`
    : `/admin/clients/${clientId}?tab=${tab}`;
}
