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
  MessageSquare,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useInvoiceUrl } from "@/components/invoices/use-invoice-url";
import { blockAmount, blockMinutes } from "@/components/packages/lesson-price-fields";
import { actionClass, PackageActions, type PackageActionProps } from "@/components/packages/package-card";
import { PackageHistoryModal } from "@/components/packages/package-history-log";
import { createFamilyPayLink, type LessonPackageRow, type PackagePurpose } from "@/lib/api";
import { avatarTone, initials } from "@/lib/avatar";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

/** One family on the Due page: a parent and every package their children still owe on. */
export interface DueFamily {
  /** The guardian's id — or the student's, for a row that carries no family. */
  key: string;
  /** Null for a row that carries no family — it can have no family link. */
  guardianId: string | null;
  name: string;
  phone: string | null;
  /** The children with a package due, in the order their debts first appear. */
  children: string[];
  rows: LessonPackageRow[];
}

/**
 * Gathers due packages under their family, keeping the order they came in — the page sorts oldest
 * debt first, so a family sits where its oldest debt would.
 */
export function groupDueByFamily(rows: LessonPackageRow[]): DueFamily[] {
  const families = new Map<string, DueFamily>();
  for (const row of rows) {
    const key = row.guardian_id ?? `student:${row.student_id}`;
    let family = families.get(key);
    if (family === undefined) {
      family = {
        key,
        guardianId: row.guardian_id ?? null,
        name: row.guardian_name ?? row.student_name,
        phone: row.guardian_phone ?? null,
        children: [],
        rows: [],
      };
      families.set(key, family);
    }
    family.rows.push(row);
    if (!family.children.includes(row.student_name)) family.children.push(row.student_name);
  }
  return [...families.values()];
}

/** What the family owes, per currency — money is never summed across currencies. */
export function owed(rows: LessonPackageRow[]): { currency: string; amount_minor: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    if (r.outstanding_minor > 0) by.set(r.currency, (by.get(r.currency) ?? 0) + r.outstanding_minor);
  }
  return [...by.entries()].map(([currency, amount_minor]) => ({ currency, amount_minor }));
}

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
 * A family's payment message and link, shared by its card (phones) and its rows in the Due table:
 * with two bills or more under a real family, ONE link pays them all (`/f/{token}`); with one, that
 * bill's own link. Sent to the parent's WhatsApp, or copied as a ready message.
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

/**
 * A family's card on the Due page — sized to its content and laid out in masonry columns, so a
 * one-child family is a short card, not a tall empty one. The parent's name and what the family
 * owes in total lead; each child's package is a line under it (what the money is for, hours and
 * lessons, amount, the leading action and "⋯" — the same actions the full card offers). At the
 * foot: with two bills or more, ONE payment link for the whole family (`/f/{token}`); with one,
 * that bill's own link. Each package keeps its own bill, so paying still marks exactly it paid.
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

  return (
    <article
      className="bg-card mb-3 min-w-0 break-inside-avoid overflow-hidden rounded-2xl border shadow-sm"
      data-testid={`due-family-${family.key}`}
    >
      {/* Who owes, and how much in all — one line, so a one-child family stays a short card. */}
      <header className="flex items-center gap-3 px-3.5 py-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm",
            avatarTone(family.name),
          )}
          aria-hidden
        >
          {initials(family.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm leading-tight font-semibold" data-testid="due-family-name" title={family.name}>
            {family.name}
          </h3>
          <p className="text-muted-foreground mt-0.5 truncate text-xs" title={family.children.join("، ")}>
            {t("family.children", { count: family.children.length, names: family.children.join("، ") })}
          </p>
        </div>
        <div className="shrink-0 text-end">
          <p className="text-muted-foreground text-[10px] font-medium">{t("family.totalLabel")}</p>
          {totals.length === 0 ? (
            <p className="text-sm font-bold text-amber-600 dark:text-amber-400">{t("family.notBilled")}</p>
          ) : (
            totals.map((o) => (
              <p
                key={o.currency}
                className="text-base leading-tight font-bold text-rose-600 tabular-nums dark:text-rose-400"
                data-testid="due-family-total"
              >
                {money(o.amount_minor, o.currency)}
              </p>
            ))
          )}
        </div>
      </header>

      <ul className="divide-border/60 divide-y border-t">
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
      </ul>

      {canSendInvoice && payable.length > 0 && (
        <div className="bg-muted/25 flex items-stretch border-t">
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={busy}
            className="text-primary hover:bg-primary/5 flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-60"
            data-testid="due-family-send"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : familyLink ? (
              <Link2 className="size-3.5" aria-hidden />
            ) : (
              <MessageSquare className="size-3.5" aria-hidden />
            )}
            {familyLink ? t("family.sendFamilyLink", { count: payable.length }) : t("family.sendOne")}
          </button>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex w-10 shrink-0 items-center justify-center border-s transition-colors"
            aria-label={copied ? t("actions.copied") : t("actions.copyMessage")}
            title={copied ? t("actions.copied") : t("actions.copyMessage")}
            data-testid="due-family-copy"
          >
            {copied ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          </button>
        </div>
      )}
      {onPrepay && prepayable.length > 0 && (
        <button
          type="button"
          onClick={() => onPrepay(prepayable)}
          className="hover:bg-emerald-500/5 flex w-full items-center justify-center gap-1.5 border-t px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors dark:text-emerald-300"
          data-testid="family-prepay"
        >
          <CalendarCheck className="size-3.5" aria-hidden />
          {prepayable.length > 1 ? t("prepay.familyButton", { count: prepayable.length }) : t("prepay.oneButton")}
        </button>
      )}
      {error && <p className="text-destructive border-t px-3 py-1.5 text-center text-[11px]">{t("family.linkFailed")}</p>}
    </article>
  );
}

/**
 * One child's package inside a family card, in three lines: who and how much; what the money is for
 * (a new subscription, a renewal, the hours used…) and how long it has waited; the hours and lessons
 * behind it, with the leading action and "⋯".
 */
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
  const remindable = row.outstanding_minor > 0 || row.awaiting_next_package;
  const { copyable, copied, copyMessage } = useRowPaymentCopy(row, payerName);

  const owes = row.outstanding_minor > 0;
  const unbilled = row.invoice_id === null && row.minutes_consumed > 0;
  const purpose = row.purpose ?? "NEW";
  const days = Math.max(0, Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86_400_000));

  return (
    <li className="px-3.5 py-2.5" data-testid="due-package-row">
      {/* Who, and how much. */}
      <div className="flex items-baseline justify-between gap-3">
        <button
          type="button"
          onClick={actions.onOpenDetail}
          className="hover:text-primary min-w-0 truncate text-start text-sm font-semibold transition-colors"
        >
          {row.student_name}
        </button>
        <span
          className={cn(
            "shrink-0 text-sm font-bold tabular-nums",
            owes ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400",
          )}
        >
          {owes
            ? formatMoney({ amount: row.outstanding_minor, currency: row.currency }, locale)
            : unbilled
              ? t("family.notBilled")
              : t("card.overdrawn", { over: blockMinutes(row.minutes_overdrawn, row.lesson_minutes, t, locale) })}
        </span>
      </div>

      {/* What the money is for, in words — and how long it has waited. */}
      <div className="text-muted-foreground mt-1 flex min-w-0 items-center justify-between gap-3 text-xs">
        <p className="min-w-0 truncate">
          <span className={cn("rounded px-1.5 py-0.5 font-semibold", PURPOSE_TONE[purpose])} data-testid="due-package-purpose">
            {purposeText(row, purpose, t)}
          </span>
          <span className="ms-1.5">
            {row.label}
            {row.subject && ` · ${row.subject.course ?? row.subject.teacher_name}`}
          </span>
        </p>
        <span className="shrink-0">{new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day")}</span>
      </div>

      {/* How much of the package is already used: the bar, then the same thing in words. */}
      <div className="mt-2">
        <div className="bg-muted h-1 overflow-hidden rounded-full" aria-hidden>
          <div
            className={cn("h-full rounded-full", row.status === "ACTIVE" ? "bg-amber-500" : "bg-rose-500")}
            style={{ width: `${Math.max(0, Math.min(100, row.percent_used))}%` }}
          />
        </div>
        <div className="text-muted-foreground mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px]">
          <span data-testid="due-package-usage">
            {blockAmount(row.minutes_sold, row.lesson_minutes, t, locale)} · {t("family.lessonsTaken", { count: row.lesson_count, n: formatNumber(row.lesson_count, locale) })}
            {row.status !== "ACTIVE" && ` · ${t(`status.${row.status}`)}`}
          </span>
          {row.reminders_sent > 0 && row.last_reminded_at !== null && (
            <span
              className="inline-flex items-center gap-1 font-medium text-sky-700 dark:text-sky-300"
              title={t("card.reminders", {
                count: row.reminders_sent,
                n: formatNumber(row.reminders_sent, locale),
                date: formatDateTime(row.last_reminded_at, timezone, locale),
              })}
            >
              <BellRing className="size-3" aria-hidden />
              {t("family.reminded", { count: row.reminders_sent, n: formatNumber(row.reminders_sent, locale) })}
            </span>
          )}
        </div>
        {row.gap !== null && (
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
            <AlertTriangle className="size-3 shrink-0" aria-hidden />
            {t("family.gap")}
          </p>
        )}
      </div>

      {/* One line: remind keeps its word, the payment message and the package log are an icon each
          (named on hover and to a screen reader), then the leading action and "⋯". */}
      <div className="mt-2 flex items-stretch gap-1.5">
        {canSendInvoice && remindable && (
          <button
            type="button"
            onClick={actions.onRemind}
            disabled={actions.reminding}
            className={cn(actionClass({ tone: "primary" }), "min-w-0 flex-1")}
            data-testid="remind-package"
          >
            {actions.reminding ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
            ) : (
              <BellRing className="size-3.5 shrink-0" aria-hidden />
            )}
            <span className="truncate">{t("actions.remind")}</span>
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
        <PackageActions {...actions} featuredCount={1} hide={DUE_HIDDEN} className="ms-auto shrink-0" />
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
