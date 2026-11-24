"use client";

import {
  AlertTriangle,
  BellRing,
  CalendarCheck,
  Check,
  Copy,
  History,
  Link2,
  Loader2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useInvoiceUrl } from "@/components/invoices/use-invoice-url";
import { FAMILY_ROW, FamilyCard, owed, type DueFamily } from "@/components/packages/family-card";
import { blockMinutes } from "@/components/packages/lesson-price-fields";
import { PackageShape } from "@/components/packages/open-table";
import { actionClass, PackageActions, type PackageActionProps } from "@/components/packages/package-card";
import { PackageHistoryModal } from "@/components/packages/package-history-log";
import { createFamilyPayLink, type LessonPackageRow, type PackagePurpose } from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Why the row is owed — a block sold in lessons has no "hours used" to bill. */
export function purposeText(row: LessonPackageRow, purpose: string, t: (key: string) => string): string {
  return row.lesson_minutes && (purpose === "USAGE" || purpose === "OVERDRAFT") ? t(`purposeLessons.${purpose}`) : t(`purpose.${purpose}`);
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The payment message a parent gets, ready to paste into WhatsApp: greeting, what each child owes
 * and for which package, the total, the link, and a thank-you. One builder for the family's message
 * and a single package's, so the two always read the same.
 */
export function paymentMessage({
  name,
  rows,
  url,
  familyLink,
  t,
  locale,
}: {
  name: string;
  rows: LessonPackageRow[];
  url: string;
  familyLink: boolean;
  t: Translate;
  locale: string;
}): string {
  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);
  return [
    t("family.messageGreeting", { name }),
    t(rows.length > 1 ? "family.messageIntro" : "family.messageIntroOne"),
    "",
    ...rows.map((r) =>
      t("family.messageLine", {
        child: r.student_name,
        purpose: purposeText(r, r.purpose ?? "NEW", t),
        label: `#${r.sequence_no} ${r.label}`.trim(),
        amount: money(r.outstanding_minor, r.currency),
      }),
    ),
    "",
    t("family.messageTotal", { total: owed(rows).map((o) => money(o.amount_minor, o.currency)).join(" + ") }),
    "",
    t(familyLink ? "family.messagePayAll" : "family.messagePayOne"),
    url,
    "",
    t("family.messageThanks"),
  ].join("\n");
}

/**
 * A family's payment message and link, for its card on the Due page: with two bills or more under a
 * real family, ONE link pays them all (`/f/{token}`); with one, that bill's own link. Sent to the
 * parent's WhatsApp, or copied as a ready message.
 */
export function useFamilyPayLink(family: DueFamily, onMessageOpened: () => void) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const invoiceUrl = useInvoiceUrl();
  // Each child's running block that can be paid ahead (billed when it starts), one per child.
  const prepayable = family.rows.filter(
    (r, i, all) => r.status === "ACTIVE" && r.bill_timing === "ON_START" && all.findIndex((x) => x.student_id === r.student_id && x.status === "ACTIVE") === i,
  );
  const payable = family.rows.filter((r) => r.invoice_token !== null && r.outstanding_minor > 0);
  // Two bills or more under a real family: one link pays them all.
  const familyLink = family.guardianId !== null && payable.length > 1;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  /** The link the parent gets: the family's page, or the one bill's own page. */
  async function link(): Promise<string> {
    if (familyLink && family.guardianId !== null) return (await createFamilyPayLink(family.guardianId)).url;
    return invoiceUrl(payable[0]!.invoice_token as string);
  }

  function message(url: string): string {
    return paymentMessage({ name: family.name, rows: payable, url, familyLink, t, locale });
  }

  async function sendMessage() {
    // Opened on the click itself — a tab opened after the request returns is a blocked popup.
    const tab = window.open("", "_blank");
    setBusy(true);
    setError(false);
    try {
      const text = encodeURIComponent(message(await link()));
      const digits = (family.phone ?? "").replace(/\D+/g, "");
      const target = digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
      if (tab !== null) {
        tab.opener = null;
        tab.location.href = target;
      } else {
        window.open(target, "_blank", "noopener,noreferrer");
      }
      onMessageOpened();
    } catch {
      tab?.close();
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    setError(false);
    try {
      await navigator.clipboard.writeText(message(await link()));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(true);
    }
  }

  return { prepayable, payable, familyLink, busy, copied, error, sendMessage, copyLink };
}

/**
 * One package's own payment message, copied for pasting into WhatsApp — the same text the family's
 * message carries for that child. Null-safe: only a billed package with money owed has one.
 */
export function useRowPaymentCopy(row: LessonPackageRow, payerName: string) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const invoiceUrl = useInvoiceUrl();
  const [copied, setCopied] = useState(false);
  const copyable = row.invoice_token !== null && row.outstanding_minor > 0;

  async function copyMessage() {
    if (!copyable) return;
    const url = invoiceUrl(row.invoice_token as string);
    await navigator.clipboard.writeText(paymentMessage({ name: payerName, rows: [row], url, familyLink: false, t, locale }));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return { copyable, copied, copyMessage };
}

/** The colour a purpose wears: new money green, renewals blue, usage violet, problems amber/rose. */
export const PURPOSE_TONE: Record<PackagePurpose, string> = {
  NEW: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  RENEWAL: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  AUTO_RENEWAL: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  USAGE: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  UNBILLED: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  OVERDRAFT: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
};

/** Whole days since a timestamp — how long a debt has waited. */
export function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/** How long a debt has waited, in words, coloured by how worrying that is. */
export function WaitingChip({ createdAt }: { createdAt: string }) {
  const locale = useLocale();
  const days = daysSince(createdAt);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-px text-[11px] font-semibold whitespace-nowrap",
        days <= 2
          ? "bg-sky-500/12 text-sky-700 dark:text-sky-300"
          : days <= 7
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
            : "bg-rose-500/12 text-rose-700 dark:text-rose-300",
      )}
      data-testid="due-package-waiting"
    >
      {new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day")}
    </span>
  );
}

/**
 * A family's card on the Due page. Ahmed 2026-11-23: back to cards, then "too big, a bigger family
 * leaves empty space, and I can't tell the cards apart". So the cards are full width, one under the
 * other (no holes beside a short card), each with its family's colour down the side and a tinted
 * header, and a package is ONE compact line on a wide screen, two on a laptop, a short block on a
 * phone. Every card uses the same columns, so names, amounts and buttons line up down the page.
 *
 *   • Header, one line: the parent, their children, what the family owes in all, and — with two
 *     bills or more — ONE payment link for the whole family (`/f/{token}`), plus paying ahead.
 *     With one bill, the package's own remind and copy already do it.
 *   • One line per package: who · what for · how much is used · since when · how much · actions.
 *
 * Each package keeps its own bill, so paying still marks exactly it paid.
 */
export function FamilyDueGroup({
  family,
  timezone,
  canSendInvoice,
  actionProps,
  onMessageOpened,
  onPrepay,
}: {
  family: DueFamily;
  timezone: string;
  canSendInvoice: boolean;
  actionProps: (row: LessonPackageRow) => PackageActionProps;
  onMessageOpened: () => void;
  /** Pay coming packages ahead for these children's running blocks (one payment). */
  onPrepay?: (rows: LessonPackageRow[]) => void;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const totals = owed(family.rows);
  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);
  const { prepayable, payable, familyLink, busy, copied, error, sendMessage, copyLink } = useFamilyPayLink(family, onMessageOpened);
  const showFamilyLink = canSendInvoice && familyLink;
  const showPrepay = onPrepay !== undefined && prepayable.length > 0;

  return (
    <FamilyCard
      family={family}
      testId={`due-family-${family.key}`}
      nameTestId="due-family-name"
      aside={
        <p className="flex shrink-0 items-baseline gap-1.5">
          <span className="text-muted-foreground text-[11px] font-medium">{t("family.totalLabel")}</span>
          {totals.length === 0 ? (
            <span className="text-sm font-bold text-amber-700 dark:text-amber-300">{t("family.notBilled")}</span>
          ) : (
            <span className="text-[15px] font-bold text-rose-600 tabular-nums dark:text-rose-400" data-testid="due-family-total">
              {totals.map((o) => money(o.amount_minor, o.currency)).join(" + ")}
            </span>
          )}
        </p>
      }
      tools={
        showFamilyLink || showPrepay ? (
          <>
            {showFamilyLink && (
              <>
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={busy}
                  className={cn(actionClass({ tone: "primary" }), "min-w-0 flex-1 sm:flex-none")}
                  data-testid="due-family-send"
                >
                  {busy ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden /> : <Link2 className="size-3.5 shrink-0" aria-hidden />}
                  <span className="truncate">{t("family.sendFamilyLink", { count: payable.length })}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className={cn(actionClass(), "w-8 shrink-0 px-0")}
                  aria-label={copied ? t("actions.copied") : t("actions.copyMessage")}
                  title={copied ? t("actions.copied") : t("actions.copyMessage")}
                  data-testid="due-family-copy"
                >
                  {copied ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                </button>
              </>
            )}
            {showPrepay && (
              <button
                type="button"
                onClick={() => onPrepay(prepayable)}
                className={cn(
                  actionClass(),
                  "min-w-0 flex-1 border-emerald-500/25 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/18 sm:flex-none dark:text-emerald-300",
                )}
                data-testid="family-prepay"
              >
                <CalendarCheck className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">
                  {prepayable.length > 1 ? t("prepay.familyButton", { count: prepayable.length }) : t("prepay.oneButton")}
                </span>
              </button>
            )}
          </>
        ) : undefined
      }
      notice={error && <p className="text-destructive border-b px-4 py-1 text-center text-[11px]">{t("family.linkFailed")}</p>}
    >
      {family.rows.map((row) => (
        <DueRow
          key={row.id}
          row={row}
          timezone={timezone}
          actions={actionProps(row)}
          payerName={family.name}
          canSendInvoice={canSendInvoice}
        />
      ))}
    </FamilyCard>
  );
}

/**
 * One package's line, the same columns in every card so they line up down the page:
 *   • phone:  who | amount · what for | since when · usage · actions          (two columns)
 *   • laptop: who | what for | since when | amount, then usage | actions        (two lines)
 *   • wide:   who | what for | usage | since when | amount | actions            (one line)
 */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_9.5rem_7.5rem] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_9.5rem_7.5rem_15rem]";

/** What the Due page puts outside the menu, or drops: early close and lesson sync are not for this page. */
export const DUE_HIDDEN = ["remind", "copyLink", "close", "sync"] as const;

/** Paid ahead (PackagePrepayments): this block was settled from a prepayment, or blocks wait prepaid. */
export function PrepaidChip({ row }: { row: LessonPackageRow }) {
  const t = useTranslations("packages.prepay");
  const left = row.prepaid_blocks_left ?? 0;
  if (!row.prepaid && left === 0) return null;
  return (
    <span
      className="shrink-0 rounded bg-emerald-500/12 px-1.5 py-px text-[10px] font-bold text-emerald-700 dark:text-emerald-300"
      data-testid="package-prepaid-chip"
    >
      {left > 0 ? t("chipLeft", { count: left }) : t("chip")}
    </span>
  );
}

function DueRow({
  row,
  timezone,
  actions,
  payerName,
  canSendInvoice,
}: {
  row: LessonPackageRow;
  timezone: string;
  actions: PackageActionProps;
  payerName: string;
  canSendInvoice: boolean;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const [historyOpen, setHistoryOpen] = useState(false);
  const { copyable, copied, copyMessage } = useRowPaymentCopy(row, payerName);

  const owes = row.outstanding_minor > 0;
  const remindable = owes || row.awaiting_next_package;
  const unbilled = row.invoice_id === null && row.minutes_consumed > 0;
  const purpose = row.purpose ?? "NEW";
  const reminded = row.reminders_sent > 0 && row.last_reminded_at !== null;

  const usage = `${t("family.lessonsTaken", { count: row.lesson_count, n: formatNumber(row.lesson_count, locale) })}${
    row.status !== "ACTIVE" ? ` · ${t(`status.${row.status}`)}` : ""
  }`;

  return (
    <li className={cn(ROW_GRID, FAMILY_ROW)} data-testid="due-package-row">
      {/* Who. */}
      <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={actions.onOpenDetail}
          className="hover:text-primary min-w-0 truncate text-start text-sm font-semibold transition-colors"
          title={row.student_name}
        >
          {row.student_name}
        </button>
        <PrepaidChip row={row} />
        {row.gap !== null && (
          <span className="shrink-0 text-rose-600 dark:text-rose-400" title={t("family.gap")} aria-label={t("family.gap")}>
            <AlertTriangle className="size-3.5" aria-hidden />
          </span>
        )}
      </div>

      {/* What the money is for, and which package. */}
      <div className="col-start-1 row-start-2 flex min-w-0 items-center gap-1.5 text-xs lg:col-start-2 lg:row-start-1">
        <span
          className={cn("shrink-0 rounded-md px-1.5 py-px text-[11px] font-semibold", PURPOSE_TONE[purpose])}
          data-testid="due-package-purpose"
        >
          {purposeText(row, purpose, t)}
        </span>
        <span className="min-w-0 truncate">
          <PackageShape row={row} />
        </span>
      </div>

      {/* How much of it is already used: a short bar, then the same in words. */}
      <div
        className="text-muted-foreground col-span-2 col-start-1 row-start-3 flex min-w-0 items-center gap-2 text-[11px] lg:row-start-2 2xl:col-span-1 2xl:col-start-3 2xl:row-start-1"
        title={usage}
      >
        <span className="bg-muted h-1.5 w-14 shrink-0 overflow-hidden rounded-full" aria-hidden>
          <span
            className={cn("block h-full rounded-full", row.status === "ACTIVE" ? "bg-amber-500" : "bg-rose-500")}
            style={{ width: `${Math.max(0, Math.min(100, row.percent_used))}%` }}
          />
        </span>
        <span className="min-w-0 truncate" data-testid="due-package-usage">
          {usage}
        </span>
      </div>

      {/* Since when — and how many reminders went. */}
      <div className="col-start-2 row-start-2 flex min-w-0 flex-wrap items-center justify-end gap-1 lg:col-start-3 lg:row-start-1 lg:justify-start 2xl:col-start-4">
        <WaitingChip createdAt={row.created_at} />
        {reminded && (
          <span
            className="inline-flex items-center gap-0.5 text-[11px] font-semibold whitespace-nowrap text-sky-700 dark:text-sky-300"
            title={t("card.reminders", {
              count: row.reminders_sent,
              n: formatNumber(row.reminders_sent, locale),
              date: formatDateTime(row.last_reminded_at as string, timezone, locale),
            })}
            data-testid="due-package-reminded"
          >
            <BellRing className="size-3" aria-hidden />
            {t("family.reminded", { count: row.reminders_sent, n: formatNumber(row.reminders_sent, locale) })}
          </span>
        )}
      </div>

      {/* How much. */}
      <span
        className={cn(
          "col-start-2 row-start-1 text-end text-sm font-bold whitespace-nowrap tabular-nums lg:col-start-4 2xl:col-start-5",
          owes ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400",
        )}
        data-testid="due-package-amount"
      >
        {owes
          ? formatMoney({ amount: row.outstanding_minor, currency: row.currency }, locale)
          : unbilled
            ? t("family.notBilled")
            : t("card.overdrawn", { over: blockMinutes(row.minutes_overdrawn, row.lesson_minutes, t, locale) })}
      </span>

      {/* Actions: remind, the payment message and the package log are an icon each (named on hover
          and to a screen reader); the leading action (Mark as paid) takes the rest, then "⋯". */}
      <div className="col-span-2 col-start-1 row-start-4 flex items-stretch gap-1.5 lg:col-start-3 lg:row-start-2 2xl:col-span-1 2xl:col-start-6 2xl:row-start-1">
        {canSendInvoice && remindable && (
          <button
            type="button"
            onClick={actions.onRemind}
            disabled={actions.reminding}
            className={cn(
              actionClass(),
              "w-8 shrink-0 border-sky-500/25 bg-sky-500/10 px-0 text-sky-700 hover:bg-sky-500/20 dark:text-sky-300",
            )}
            aria-label={t("actions.remind")}
            title={t("actions.remind")}
            data-testid="remind-package"
          >
            {actions.reminding ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <BellRing className="size-3.5" aria-hidden />}
          </button>
        )}
        {copyable && (
          <button
            type="button"
            onClick={() => void copyMessage()}
            className={cn(actionClass(), "w-8 shrink-0 px-0")}
            aria-label={copied ? t("actions.copied") : t("actions.copyMessage")}
            title={copied ? t("actions.copied") : t("actions.copyMessage")}
            data-testid="due-package-copy"
          >
            {copied ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          </button>
        )}
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className={cn(actionClass(), "w-8 shrink-0 px-0")}
          aria-label={t("actions.history")}
          title={t("actions.history")}
          data-testid="due-package-history"
        >
          <History className="size-3.5" aria-hidden />
        </button>
        <PackageActions {...actions} featuredCount={1} hide={DUE_HIDDEN} className="min-w-0 flex-1" />
      </div>

      <PackageHistoryModal
        studentId={row.student_id}
        studentName={row.student_name}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </li>
  );
}
