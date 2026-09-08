"use client";

import { useLocale, useTranslations } from "next-intl";
import { useLearn } from "@/components/learn/context";
import type { LearnCourseCard, LearnCourseDetail } from "@/lib/learn-api";
import { formatMoney } from "@/lib/money";

/**
 * What this particular storefront can actually DO, and the copy that follows from it (docs/lms/09).
 *
 * One template serves a Qur'an teacher who sells nothing online and hands out access codes by hand,
 * and a training company running full checkout with free taster courses. Both need the same pages to
 * read as though they were written for them — which means the buttons, the headline FAQ and the
 * price all have to follow the client's real configuration rather than a hard-coded story about
 * access codes.
 *
 * Everything here derives from `commerce` (real rows, resolved server-side with the site document)
 * and from the course row itself. Nothing invents a channel that is not open: a button that leads
 * nowhere is worse than no button at all.
 */

// ── prices ────────────────────────────────────────────────────────────────────

/**
 * A price as a SHOP writes it: "400 ج.م", not "400.00 ج.م". The trailing zeros belong on an
 * invoice, where a column of figures has to line up; on a storefront they just make the number
 * look longer than it is. A real fractional price keeps its decimals (see lib/money.ts).
 */
export function useCoursePrice(): (course: {
  price_minor: number;
  currency: string;
}) => string {
  const locale = useLocale();
  return (course) =>
    formatMoney(
      { amount: course.price_minor, currency: course.currency },
      locale,
      { trimZeroDecimals: true },
    );
}

// ── enrolment channels ────────────────────────────────────────────────────────

export type CourseAction =
  | "continue" // already enrolled — the only thing left to do is learn
  | "free" // free course: one click, no money, no code
  | "buy" // priced, checkout open, a live receiving account exists
  | "pay" // an order is already open and waiting for the transfer/receipt
  | "review" // the receipt is in, the client is checking it
  | "redeem" // priced, no checkout: an access code is the way in
  | "unavailable"; // no door is open — say so plainly rather than fake a button

/**
 * The ONE primary action a course offers right now, and whether an access code is still worth
 * offering alongside it. Both the sales page's enrol card and the sticky mobile bar read this, so
 * the two can never disagree about what the button says.
 *
 * `order` is the learner's open order for this course, when they have one — the payment work
 * (docs/lms/10) owns the flow; this only decides which of its states the button should point at.
 */
export function courseAction(
  course: Pick<
    LearnCourseCard,
    "is_free" | "sells_online" | "code_enabled" | "checkout_enabled"
  >,
  enrolled: boolean,
  order?: { status: string } | null,
): CourseAction {
  if (enrolled) return "continue";
  if (course.is_free) return "free";
  if (order?.status === "UNDER_REVIEW") return "review";
  if (order?.status === "AWAITING_PAYMENT") return "pay";
  if (course.sells_online === true) return "buy";
  // An older API build sends neither flag; codes were the only door before checkout existed, so
  // absence has to mean "codes on" or such a deployment would lose its only way in.
  if (course.code_enabled !== false) return "redeem";
  return "unavailable";
}

/** Is redeeming a code worth offering as the SECONDARY action next to `action`? */
export function offersCode(
  course: Pick<LearnCourseCard, "code_enabled">,
  action: CourseAction,
): boolean {
  return course.code_enabled !== false && (action === "buy" || action === "pay");
}

/**
 * The home page's calls to action, in priority order, adapted to what the client actually offers.
 *
 * The rule that matters: an access code stops being the headline the moment there is a better way
 * in. On a site with checkout or a free course, "browse" leads and the code becomes a quiet text
 * link — on a code-only site it is the whole business and stays a real button.
 */
export function useHeroCta(): {
  primaryLabel: string;
  primaryHref: string | null;
  /** Set when the primary action is a dialog rather than a link (redeem). */
  primaryAction: "redeem" | null;
  secondary:
    | { kind: "free"; label: string; href: string }
    | { kind: "contact"; label: string; href: string }
    | null;
  /** Offer the code as a small link under the buttons rather than as a button. */
  codeLink: boolean;
} {
  const t = useTranslations("learn");
  const { academy, site, commerce } = useLearn();
  const base = `/learn/${academy}`;
  const choice = site.hero.primary_cta;
  const label = site.hero.cta_label?.trim() ?? "";

  // The client's explicit choice always wins — they may want the code, or the contact page, in
  // front. "browse" is the default, and the one the adaptive rules below apply to.
  if (choice === "redeem" && commerce.codes) {
    return {
      primaryLabel: label || t("redeem.cta"),
      primaryHref: null,
      primaryAction: "redeem",
      secondary: { kind: "free", label: t("hero.browse"), href: `${base}/courses` },
      codeLink: false,
    };
  }
  if (choice === "contact" && site.pages.contact) {
    return {
      primaryLabel: label || t("nav.contact"),
      primaryHref: `${base}/contact`,
      primaryAction: null,
      secondary: { kind: "free", label: t("hero.browse"), href: `${base}/courses` },
      codeLink: commerce.codes,
    };
  }

  return {
    primaryLabel: label || t("hero.browse"),
    primaryHref: `${base}/courses`,
    primaryAction: null,
    secondary: commerce.free_course
      ? {
          kind: "free",
          label: t("hero.startFree"),
          href: `${base}/c/${commerce.free_course.slug}`,
        }
      : site.pages.contact && commerce.codes === false
        ? { kind: "contact", label: t("nav.contact"), href: `${base}/contact` }
        : null,
    codeLink: commerce.codes,
  };
}

/** The closing CTA band's default button: browse when there is a catalogue door, else the code. */
export function useClosingCtaLabel(): string {
  const t = useTranslations("learn");
  const { commerce } = useLearn();
  const codeOnly = commerce.codes && !commerce.checkout && !commerce.free;

  return codeOnly
    ? t("defaults.cta.buttonRedeem")
    : t("defaults.cta.button");
}

// ── FAQ ───────────────────────────────────────────────────────────────────────

/**
 * The starter FAQ a client gets before they write their own — assembled from a translated pool
 * according to what this site actually supports.
 *
 * This is the difference between a template and a brochure: a site with checkout must not answer
 * "how do I get an access code?" as its first question, and a site that sells nothing online must
 * not promise a checkout page that does not exist. Both would be worse than saying nothing.
 */
export function useDefaultFaq(): { q: string; a: string }[] {
  const t = useTranslations("learn");
  const { commerce, siteName } = useLearn();

  const pool = t.raw("defaults.faq.pool") as Record<
    string,
    { q: string; a: string }
  >;
  const keys: string[] = [];

  if (commerce.checkout) keys.push("buy", "payment");
  if (commerce.free) keys.push("free");
  if (commerce.codes) {
    // With checkout open, a code is a secondary door and only "how do I use one" is worth asking;
    // without it, "how do I get one" is the single most important question on the site.
    if (!commerce.checkout) keys.push("codeGet");
    keys.push("code");
  }
  keys.push("start", "duration", "devices", "certificate", "preview");
  if (commerce.checkout) keys.push("refund");
  keys.push("account", "support");

  return keys
    .map((key) => pool[key])
    .filter((entry) => entry !== undefined)
    .map((entry) => ({
      q: entry.q,
      // Only two answers name the academy, but interpolating unconditionally keeps the pool free
      // of "which entries take a parameter" bookkeeping.
      a: entry.a.replace("{name}", siteName),
    }));
}

// ── course facts ──────────────────────────────────────────────────────────────

/** The level chip's label, or null when the client hasn't set one — never a guess. */
export function useLevelLabel(): (
  level: LearnCourseCard["level"],
) => string | null {
  const t = useTranslations("learn");
  return (level) => (level ? t(`catalog.level.${level}`) : null);
}

/** Areas of expertise are one comma-separated field in the editor; chips on the site. */
export function splitExpertise(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,،]/)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .slice(0, 6);
}

/** The sales lists a course carries, already filtered to the ones worth a section. */
export function salesBlocks(
  course: LearnCourseDetail["course"],
): { key: "outcomes" | "audience" | "requirements"; items: string[] }[] {
  return (["outcomes", "audience", "requirements"] as const)
    .map((key) => ({ key, items: course[key] ?? [] }))
    .filter((block) => block.items.length > 0);
}
