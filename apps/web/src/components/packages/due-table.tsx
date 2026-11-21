"use client";

import {
  AlertTriangle,
  BadgeCheck,
  BellOff,
  BellRing,
  BookOpenCheck,
  CalendarCheck,
  Check,
  CircleDollarSign,
  Copy,
  ExternalLink,
  FileImage,
  History,
  Hourglass,
  Link2,
  Loader2,
  MessageSquare,
  Receipt,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
  DUE_HIDDEN,
  owed,
  PrepaidChip,
  PURPOSE_TONE,
  purposeText,
  useFamilyPayLink,
  useRowPaymentCopy,
  type DueFamily,
} from "@/components/packages/family-due-group";
import { blockAmount, blockMinutes } from "@/components/packages/lesson-price-fields";
import { actionClass, PackageActions, type PackageActionProps } from "@/components/packages/package-card";
import { PackageHistoryModal } from "@/components/packages/package-history-log";
import { KNOWN_METHODS, paidAmount } from "@/components/packages/paid-package-card";
import { buttonVariants } from "@/components/ui/button";
import type { LessonPackageRow } from "@/lib/api";
import { apiBase } from "@/lib/api-base";
import { avatarTone, initials } from "@/lib/avatar";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

// ── Stat cards ────────────────────────────────────────────────────────────────

/** A stat card's colour: a wash of it behind the card, a solid icon chip, the figure in it. */
const STAT_TONES = {
  rose: {
    card: "border-rose-200/80 from-rose-500/[0.13] via-rose-500/[0.04] dark:border-rose-900/50",
    chip: "from-rose-500 to-rose-600 shadow-rose-500/25",
    value: "text-rose-700 dark:text-rose-300",
    bar: "bg-rose-500",
  },
  amber: {
    card: "border-amber-200/80 from-amber-500/[0.14] via-amber-500/[0.04] dark:border-amber-900/50",
    chip: "from-amber-500 to-orange-500 shadow-amber-500/25",
    value: "text-amber-700 dark:text-amber-300",
    bar: "bg-amber-500",
  },
  sky: {
    card: "border-sky-200/80 from-sky-500/[0.13] via-sky-500/[0.04] dark:border-sky-900/50",
    chip: "from-sky-500 to-blue-600 shadow-sky-500/25",
    value: "text-sky-700 dark:text-sky-300",
    bar: "bg-sky-500",
  },
  violet: {
    card: "border-violet-200/80 from-violet-500/[0.13] via-violet-500/[0.04] dark:border-violet-900/50",
    chip: "from-violet-500 to-purple-600 shadow-violet-500/25",
    value: "text-violet-700 dark:text-violet-300",
    bar: "bg-violet-500",
  },
  emerald: {
    card: "border-emerald-200/80 from-emerald-500/[0.13] via-emerald-500/[0.04] dark:border-emerald-900/50",
    chip: "from-emerald-500 to-teal-600 shadow-emerald-500/25",
    value: "text-emerald-700 dark:text-emerald-300",
    bar: "bg-emerald-500",
  },
} as const;

type StatTone = keyof typeof STAT_TONES;

/**
 * One coloured stat card: the label and a solid icon chip on top, the figure large under them (one
 * line per currency — money is never summed across currencies, and never truncated: it wraps).
 */
function StatCard({
  tone,
  icon: Icon,
  label,
  values,
  hint,
  testId,
}: {
  tone: StatTone;
  icon: LucideIcon;
  label: string;
  values: string[];
  hint?: string;
  testId?: string;
}) {
  const s = STAT_TONES[tone];
  return (
    <div
      className={cn("bg-card relative overflow-hidden rounded-2xl border bg-gradient-to-br to-transparent p-4 shadow-sm", s.card)}
      data-testid={testId}
    >
      <span className={cn("absolute inset-y-4 start-0 w-1 rounded-e-full", s.bar)} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground pt-0.5 text-xs font-semibold">{label}</p>
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md", s.chip)}>
          <Icon className="size-5" aria-hidden />
        </span>
      </div>
      <div className="mt-1 space-y-0.5">
        {values.map((v) => (
          <p key={v} className={cn("leading-tight font-bold break-words tabular-nums", values.length > 2 ? "text-lg" : "text-2xl", s.value)}>
            {v}
          </p>
        ))}
      </div>
      {hint && <p className="text-muted-foreground mt-1.5 text-xs">{hint}</p>}
    </div>
  );
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/**
 * The Due page's stat cards (Ahmed 2026-11-22: "the statistics as coloured cards"): how many packages
 * wait and in how many families, the money owed per currency, how many have had no reminder, and how
 * long the oldest has waited. Over every due package, not just the ones the search shows.
 */
export function DueStats({
  rows,
  dueAmounts,
}: {
  /** Every package on Due. */
  rows: LessonPackageRow[];
  /** The server's per-currency total, when the summary has come back. */
  dueAmounts?: { currency: string; amount_minor: number }[];
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const families = new Set(rows.map((r) => r.guardian_id ?? `student:${r.student_id}`)).size;
  const amounts = dueAmounts ?? owed(rows);
  const reminded = rows.filter((r) => r.reminders_sent > 0).length;
  const oldest = rows.reduce<LessonPackageRow | null>((o, r) => (o === null || r.created_at < o.created_at ? r : o), null);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="due-stats">
      <StatCard
        tone="rose"
        icon={AlertTriangle}
        label={t("dueStats.packages")}
        values={[formatNumber(rows.length, locale)]}
        hint={rows.length > 0 ? t("dueStats.families", { count: families }) : undefined}
        testId="due-count"
      />
      <StatCard
        tone="amber"
        icon={CircleDollarSign}
        label={t("dueStats.amount")}
        values={amounts.length > 0 ? amounts.map((a) => formatMoney({ amount: a.amount_minor, currency: a.currency }, locale)) : ["—"]}
        testId="due-stats-amount"
      />
      <StatCard
        tone="sky"
        icon={BellOff}
        label={t("dueStats.notReminded")}
        values={[formatNumber(rows.length - reminded, locale)]}
        hint={t("dueStats.reminded", { count: reminded })}
        testId="due-stats-not-reminded"
      />
      <StatCard
        tone="violet"
        icon={Hourglass}
        label={t("dueStats.oldest")}
        values={[oldest === null ? t("dueStats.nothing") : new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-daysSince(oldest.created_at), "day")]}
        hint={oldest?.student_name}
        testId="due-stats-oldest"
      />
    </div>
  );
}

/** The Paid tab's cards: how many packages are paid, and what they brought in per currency. */
export function PaidStats({
  count,
  collected,
}: {
  count: number;
  collected: { currency: string; amount_minor: number }[];
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="paid-stats">
      <StatCard tone="emerald" icon={BadgeCheck} label={t("dueStats.paidCount")} values={[formatNumber(count, locale)]} testId="paid-stats-count" />
      <StatCard
        tone="sky"
        icon={Wallet}
        label={t("dueStats.collected")}
        values={collected.length > 0 ? collected.map((c) => formatMoney({ amount: c.amount_minor, currency: c.currency }, locale)) : ["—"]}
        testId="paid-stats-collected"
      />
    </div>
  );
}

// ── The Due table ─────────────────────────────────────────────────────────────

/** How long a debt has waited, in words, coloured by how worrying that is. */
function WaitingChip({ createdAt }: { createdAt: string }) {
  const locale = useLocale();
  const days = daysSince(createdAt);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        days <= 2
          ? "bg-sky-500/12 text-sky-700 dark:text-sky-300"
          : days <= 7
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
            : "bg-rose-500/12 text-rose-700 dark:text-rose-300",
      )}
      data-testid="due-table-waiting"
    >
      {new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day")}
    </span>
  );
}

const HEAD = "px-3 py-3 text-start text-xs font-semibold whitespace-nowrap";

/**
 * The Due page as a table (Ahmed 2026-11-22), shown from tablet width up; phones keep the family
 * cards. A family is one band of rows: its parent's cell spans its children's rows and carries what
 * the family owes in all and the family's own actions (one payment link for every bill, the message,
 * paying ahead); each child's package is a row — what it is for, how much of it is used, the amount,
 * how long it has waited, the reminders, and the package's actions.
 */
export function DueTable({
  families,
  timezone,
  canSendInvoice,
  actionProps,
  onMessageOpened,
  onPrepay,
}: {
  families: DueFamily[];
  timezone: string;
  canSendInvoice: boolean;
  actionProps: (row: LessonPackageRow) => PackageActionProps;
  onMessageOpened: () => void;
  onPrepay?: (rows: LessonPackageRow[]) => void;
}) {
  const t = useTranslations("packages");
  return (
    <section className="bg-card hidden overflow-hidden rounded-2xl border shadow-sm md:block" data-testid="due-table">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] border-collapse text-sm">
          <thead>
            <tr className="from-primary/[0.09] via-primary/[0.035] text-muted-foreground border-b bg-gradient-to-l to-transparent">
              <th className={cn(HEAD, "ps-5")}>{t("dueTable.family")}</th>
              <th className={HEAD}>{t("dueTable.student")}</th>
              <th className={HEAD}>{t("dueTable.purpose")}</th>
              <th className={HEAD}>{t("dueTable.package")}</th>
              <th className={cn(HEAD, "text-end")}>{t("dueTable.amount")}</th>
              <th className={HEAD}>{t("dueTable.waiting")}</th>
              <th className={HEAD}>{t("dueTable.reminders")}</th>
              <th className={cn(HEAD, "pe-4 text-end")}>
                <span className="sr-only">{t("dueTable.actions")}</span>
              </th>
            </tr>
          </thead>
          {families.map((family, i) => (
            <FamilyBand
              key={family.key}
              family={family}
              striped={i % 2 === 1}
              timezone={timezone}
              canSendInvoice={canSendInvoice}
              actionProps={actionProps}
              onMessageOpened={onMessageOpened}
              onPrepay={onPrepay}
            />
          ))}
        </table>
      </div>
    </section>
  );
}

function FamilyBand({
  family,
  striped,
  timezone,
  canSendInvoice,
  actionProps,
  onMessageOpened,
  onPrepay,
}: {
  family: DueFamily;
  striped: boolean;
  timezone: string;
  canSendInvoice: boolean;
  actionProps: (row: LessonPackageRow) => PackageActionProps;
  onMessageOpened: () => void;
  onPrepay?: (rows: LessonPackageRow[]) => void;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const totals = owed(family.rows);
  const { prepayable, payable, familyLink, busy, copied, error, sendMessage, copyLink } = useFamilyPayLink(family, onMessageOpened);

  const familyCell = (
    <td rowSpan={family.rows.length} className="relative w-60 border-e align-top">
      <span className={cn("absolute inset-y-3 start-0 w-1 rounded-e-full", avatarTone(family.name))} aria-hidden />
      <div className="space-y-2.5 py-3 ps-5 pe-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm", avatarTone(family.name))}
            aria-hidden
          >
            {initials(family.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold" title={family.name} data-testid="due-table-family-name">
              {family.name}
            </p>
            {family.phone && (
              <p className="text-muted-foreground truncate text-xs tabular-nums" dir="ltr">
                {family.phone}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-rose-500/[0.08] px-3 py-2 dark:bg-rose-500/10">
          <p className="text-[11px] font-medium text-rose-700/80 dark:text-rose-300/80">{t("family.totalLabel")}</p>
          {totals.length === 0 ? (
            <p className="text-sm font-bold text-amber-600 dark:text-amber-400">{t("family.notBilled")}</p>
          ) : (
            totals.map((o) => (
              <p key={o.currency} className="text-base leading-tight font-bold break-words text-rose-600 tabular-nums dark:text-rose-400" data-testid="due-table-family-total">
                {formatMoney({ amount: o.amount_minor, currency: o.currency }, locale)}
              </p>
            ))
          )}
        </div>

        {canSendInvoice && payable.length > 0 && (
          <div className="flex items-stretch gap-1.5">
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={busy}
              className={cn(actionClass({ tone: "primary" }), "min-w-0 flex-1")}
              data-testid="due-table-family-send"
            >
              {busy ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
              ) : familyLink ? (
                <Link2 className="size-3.5 shrink-0" aria-hidden />
              ) : (
                <MessageSquare className="size-3.5 shrink-0" aria-hidden />
              )}
              <span className="truncate">{familyLink ? t("family.sendFamilyLink", { count: payable.length }) : t("family.sendOne")}</span>
            </button>
            <button
              type="button"
              onClick={() => void copyLink()}
              className={cn(actionClass(), "w-8 shrink-0 px-0")}
              aria-label={copied ? t("actions.copied") : t("actions.copyMessage")}
              title={copied ? t("actions.copied") : t("actions.copyMessage")}
            >
              {copied ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            </button>
          </div>
        )}
        {onPrepay && prepayable.length > 0 && (
          <button
            type="button"
            onClick={() => onPrepay(prepayable)}
            className="inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-300"
          >
            <CalendarCheck className="size-3.5 shrink-0" aria-hidden />
            {prepayable.length > 1 ? t("prepay.familyButton", { count: prepayable.length }) : t("prepay.oneButton")}
          </button>
        )}
        {error && <p className="text-destructive text-[11px]">{t("family.linkFailed")}</p>}
      </div>
    </td>
  );

  return (
    <tbody className={cn("border-t-2 border-border/80 first-of-type:border-t-0", striped && "bg-muted/25")} data-testid={`due-table-family-${family.key}`}>
      {family.rows.map((row, i) => (
        <DueTableRow
          key={row.id}
          row={row}
          familyCell={i === 0 ? familyCell : null}
          last={i === family.rows.length - 1}
          timezone={timezone}
          payerName={family.name}
          canSendInvoice={canSendInvoice}
          actions={actionProps(row)}
        />
      ))}
    </tbody>
  );
}

function DueTableRow({
  row,
  familyCell,
  last,
  timezone,
  payerName,
  canSendInvoice,
  actions,
}: {
  row: LessonPackageRow;
  /** The family's spanning cell, on its first row only. */
  familyCell: React.ReactNode;
  last: boolean;
  timezone: string;
  payerName: string;
  canSendInvoice: boolean;
  actions: PackageActionProps;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const [historyOpen, setHistoryOpen] = useState(false);
  const { copyable, copied, copyMessage } = useRowPaymentCopy(row, payerName);
  const purpose = row.purpose ?? "NEW";
  const owes = row.outstanding_minor > 0;
  const unbilled = row.invoice_id === null && row.minutes_consumed > 0;
  const remindable = owes || row.awaiting_next_package;

  return (
    <tr className={cn("hover:bg-primary/[0.03] align-middle transition-colors", !last && "border-b border-border/50")} data-testid="due-table-row">
      {familyCell}

      {/* Who, and which package. */}
      <td className="px-3 py-3">
        <button type="button" onClick={actions.onOpenDetail} className="hover:text-primary block max-w-48 truncate text-start font-semibold transition-colors">
          {row.student_name}
        </button>
        <div className="text-muted-foreground mt-0.5 flex max-w-56 flex-wrap items-center gap-1 text-xs">
          <span className="font-semibold tabular-nums">#{formatNumber(row.sequence_no, locale)}</span>
          <span className="truncate">{row.label}</span>
          {row.subject && (
            <span className="rounded bg-violet-500/10 px-1 py-px text-[10px] font-semibold text-violet-700 dark:text-violet-300">
              {row.subject.course ?? row.subject.teacher_name}
            </span>
          )}
          <PrepaidChip row={row} />
        </div>
      </td>

      {/* What the money is for, in words. */}
      <td className="px-3 py-3">
        <span className={cn("inline-block rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap", PURPOSE_TONE[purpose])} data-testid="due-table-purpose">
          {purposeText(row, purpose, t)}
        </span>
      </td>

      {/* How much of it is used: the bar, then the same in words. */}
      <td className="w-52 px-3 py-3">
        <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
          <div
            className={cn("h-full rounded-full", row.status === "ACTIVE" ? "bg-amber-500" : "bg-rose-500")}
            style={{ width: `${Math.max(0, Math.min(100, row.percent_used))}%` }}
          />
        </div>
        <p className="text-muted-foreground mt-1 text-xs" data-testid="due-table-usage">
          {blockAmount(row.minutes_sold, row.lesson_minutes, t, locale)} · {t("family.lessonsTaken", { count: row.lesson_count, n: formatNumber(row.lesson_count, locale) })}
          {row.status !== "ACTIVE" && ` · ${t(`status.${row.status}`)}`}
        </p>
        {row.gap !== null && (
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
            <AlertTriangle className="size-3 shrink-0" aria-hidden />
            {t("family.gap")}
          </p>
        )}
      </td>

      <td className="px-3 py-3 text-end">
        <span
          className={cn("text-base font-bold whitespace-nowrap tabular-nums", owes ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400")}
          data-testid="due-table-amount"
        >
          {owes
            ? formatMoney({ amount: row.outstanding_minor, currency: row.currency }, locale)
            : unbilled
              ? t("family.notBilled")
              : t("card.overdrawn", { over: blockMinutes(row.minutes_overdrawn, row.lesson_minutes, t, locale) })}
        </span>
      </td>

      <td className="px-3 py-3">
        <WaitingChip createdAt={row.created_at} />
      </td>

      <td className="px-3 py-3">
        {row.reminders_sent > 0 && row.last_reminded_at !== null ? (
          <span
            className="inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap text-sky-700 dark:text-sky-300"
            title={t("card.reminders", {
              count: row.reminders_sent,
              n: formatNumber(row.reminders_sent, locale),
              date: formatDateTime(row.last_reminded_at, timezone, locale),
            })}
          >
            <BellRing className="size-3.5" aria-hidden />
            {t("family.reminded", { count: row.reminders_sent, n: formatNumber(row.reminders_sent, locale) })}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs whitespace-nowrap">{t("dueTable.notReminded")}</span>
        )}
      </td>

      {/* The package's actions: remind, its payment message, its log — then Mark as paid and "⋯". */}
      <td className="px-3 py-3 pe-4">
        <div className="flex items-center justify-end gap-1.5">
          {canSendInvoice && remindable && (
            <button
              type="button"
              onClick={actions.onRemind}
              disabled={actions.reminding}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-sky-500/25 bg-sky-500/10 text-sky-700 transition-colors hover:bg-sky-500/20 disabled:opacity-50 dark:text-sky-300"
              aria-label={t("actions.remind")}
              title={t("actions.remind")}
              data-testid="due-table-remind"
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
          >
            <History className="size-3.5" aria-hidden />
          </button>
          <PackageActions {...actions} featuredCount={1} hide={DUE_HIDDEN} className="shrink-0" />
        </div>
        <PackageHistoryModal studentId={row.student_id} studentName={row.student_name} open={historyOpen} onClose={() => setHistoryOpen(false)} />
      </td>
    </tr>
  );
}

// ── The Paid tab's table ──────────────────────────────────────────────────────

/**
 * The Due page's Paid tab as a table, from tablet width up (phones keep the paid cards): who, which
 * package, what came in, how, when, the reference, and the receipt / invoice / lessons behind it.
 */
export function PaidTable({
  rows,
  timezone,
  onOpenDetail,
}: {
  rows: LessonPackageRow[];
  timezone: string;
  onOpenDetail: (row: LessonPackageRow) => void;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const methodLabel = (m: string | null) => (m === null ? "—" : KNOWN_METHODS.includes(m) ? t(`paid.method.${m}`) : m);

  return (
    <section className="bg-card hidden overflow-hidden rounded-2xl border border-emerald-200/70 shadow-sm md:block dark:border-emerald-900/50" data-testid="paid-table">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="text-muted-foreground border-b bg-gradient-to-l from-emerald-500/[0.10] via-emerald-500/[0.035] to-transparent">
              <th className={cn(HEAD, "ps-5")}>{t("dueTable.student")}</th>
              <th className={HEAD}>{t("dueTable.package")}</th>
              <th className={cn(HEAD, "text-end")}>{t("dueTable.paidAmount")}</th>
              <th className={HEAD}>{t("paid.methodLabel")}</th>
              <th className={HEAD}>{t("paid.paidAt")}</th>
              <th className={HEAD}>{t("paid.reference")}</th>
              <th className={cn(HEAD, "pe-4 text-end")}>
                <span className="sr-only">{t("dueTable.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const receipts = row.receipts ?? [];
              const methods = receipts.length > 0 ? [...new Set(receipts.map((r) => methodLabel(r.method)))].join("، ") : methodLabel(row.payment_method);
              const paidOn = row.paid_at !== null ? formatDateTime(row.paid_at, timezone, locale) : (receipts[0]?.received_on ?? "—");
              const reference = receipts.find((r) => r.reference)?.reference ?? row.payment_reference ?? "—";
              const receipt = receipts[0] ?? null;
              return (
                <tr key={row.id} className={cn("hover:bg-emerald-500/[0.04] transition-colors", i > 0 && "border-t border-border/50", i % 2 === 1 && "bg-muted/25")} data-testid="paid-table-row">
                  <td className="py-3 ps-5 pe-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white", avatarTone(row.guardian_name ?? row.student_name))}
                        aria-hidden
                      >
                        {initials(row.student_name)}
                      </span>
                      <div className="min-w-0">
                        <button type="button" onClick={() => onOpenDetail(row)} className="hover:text-primary block max-w-48 truncate text-start font-semibold transition-colors">
                          {row.student_name}
                        </button>
                        {row.guardian_name && row.guardian_name !== row.student_name && (
                          <p className="text-muted-foreground max-w-48 truncate text-xs">{row.guardian_name}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="text-muted-foreground px-3 py-3 text-xs">
                    <span className="text-foreground font-semibold tabular-nums">#{formatNumber(row.sequence_no, locale)}</span> {row.label}
                  </td>
                  <td className="px-3 py-3 text-end">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-bold whitespace-nowrap text-white tabular-nums">
                      <BadgeCheck className="size-3.5" aria-hidden />
                      {formatMoney({ amount: paidAmount(row), currency: row.currency }, locale)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs font-semibold">{methods}</td>
                  <td className="px-3 py-3 text-xs whitespace-nowrap text-emerald-700 dark:text-emerald-300">{paidOn}</td>
                  <td className="text-muted-foreground max-w-40 truncate px-3 py-3 text-xs" title={reference} data-testid="paid-table-reference">
                    {reference}
                  </td>
                  <td className="px-3 py-3 pe-4">
                    <div className="flex items-center justify-end gap-1.5">
                      {receipt !== null ? (
                        <a
                          href={receipt.public_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(buttonVariants({ size: "sm" }), "h-8 gap-1.5 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-700")}
                        >
                          <ExternalLink className="size-3.5" aria-hidden />
                          {receipts.length > 1 ? `${t("paid.openReceipt")} (${formatNumber(receipts.length, locale)})` : t("paid.openReceipt")}
                        </a>
                      ) : row.payment_proof_url !== null ? (
                        <a
                          href={`${apiBase()}${row.payment_proof_url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(buttonVariants({ size: "sm" }), "h-8 gap-1.5 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-700")}
                        >
                          <FileImage className="size-3.5" aria-hidden />
                          {t("actions.viewProof")}
                        </a>
                      ) : null}
                      <Link
                        href={`/invoices?id=${row.invoice_id}`}
                        className={cn(actionClass(), "w-8 shrink-0 px-0")}
                        aria-label={t("actions.viewInvoice")}
                        title={t("actions.viewInvoice")}
                      >
                        <Receipt className="size-3.5" aria-hidden />
                      </Link>
                      <button
                        type="button"
                        onClick={() => onOpenDetail(row)}
                        className={cn(actionClass(), "w-8 shrink-0 px-0")}
                        aria-label={t("actions.viewLessons")}
                        title={t("actions.viewLessons")}
                      >
                        <BookOpenCheck className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
