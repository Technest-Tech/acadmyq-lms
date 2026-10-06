"use client";

import {
  AlertTriangle,
  ArrowLeftRight,
  BadgeCheck,
  BookOpenCheck,
  CalendarDays,
  CalendarClock,
  CalendarX,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  FileImage,
  Link2,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useInvoiceUrl } from "@/components/invoices/use-invoice-url";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LessonPackageRow } from "@/lib/api";
import { apiBase } from "@/lib/api-base";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatDateTime, formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

/** One thing the card can do. Exactly one of `onClick` / `href` / `external` is set. */
type CardAction = {
  key: string;
  icon: typeof Clock3;
  label: string;
  onClick?: () => void;
  /** An in-app route. */
  href?: string;
  /** Opens in a new tab. */
  external?: string;
  danger?: boolean;
  disabled?: boolean;
  spin?: boolean;
  testId?: string;
};

/** A compact operational card: balance, lesson count, dates and collection actions. */
export function PackageCard({
  row,
  timezone,
  onOpenDetail,
  onEdit,
  onClose,
  onBillOverdraft,
  onSyncLessons,
  onSendPayment,
  onMarkPaid,
  onRenew,
  onReturnToMonthly,
  canManage,
  canSendInvoice,
  canMarkPaid,
  syncing,
  sendingPayment,
}: {
  row: LessonPackageRow;
  timezone: string;
  onOpenDetail: () => void;
  onEdit: () => void;
  onClose: () => void;
  onBillOverdraft: () => void;
  onSyncLessons: () => void;
  onSendPayment: () => void;
  onMarkPaid: () => void;
  /** Sell this student their next block. */
  onRenew: () => void;
  /** Take a student whose block ran out off package billing altogether. */
  onReturnToMonthly: () => void;
  canManage: boolean;
  canSendInvoice: boolean;
  canMarkPaid: boolean;
  syncing: boolean;
  sendingPayment: boolean;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);

  const isActive = row.status === "ACTIVE";
  const low = isActive && row.minutes_remaining <= 60;
  const owes = row.outstanding_minor > 0;
  // Still being taught with no package open — money is accruing somewhere this card can't hold.
  const outOfHours = row.gap !== null;
  const alarm = owes || outOfHours;
  const strandedOverdraft = row.minutes_overdrawn > 0 && !row.overdraft_billed;
  const invoiceUrl = useInvoiceUrl();
  const paymentUrl = row.invoice_token !== null ? invoiceUrl(row.invoice_token) : null;

  async function copyPaymentLink() {
    if (paymentUrl === null) return;
    await navigator.clipboard.writeText(paymentUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  /**
   * Every action this card offers, in the order they matter for THIS package's state. The first
   * two are buttons; the rest sit behind "⋯". It used to be up to eleven buttons at once, which
   * buried the one that mattered (open the next block, collect what's owed) among the ones that
   * almost never do (sync, copy link, proof).
   */
  const actions: CardAction[] = [];
  const add = (when: boolean, action: CardAction) => {
    if (when) actions.push(action);
  };
  const hasInvoice = row.invoice_id !== null;

  add(canManage && row.awaiting_next_package, {
    key: "renew",
    icon: Plus,
    label: t("actions.renew"),
    onClick: onRenew,
    testId: "renew-package",
  });
  add(canManage && !isActive && strandedOverdraft, {
    key: "billOverdraft",
    icon: AlertTriangle,
    label: t("actions.billOverdraft"),
    onClick: onBillOverdraft,
    danger: true,
  });
  add(canSendInvoice && hasInvoice && owes, {
    key: "sendPayment",
    icon: sendingPayment ? Loader2 : MessageCircle,
    label: t("actions.sendPayment"),
    onClick: onSendPayment,
    disabled: sendingPayment,
    spin: sendingPayment,
  });
  add(canMarkPaid && hasInvoice && owes, {
    key: "markPaid",
    icon: BadgeCheck,
    label: t("actions.markPaid"),
    onClick: onMarkPaid,
  });
  add(true, {
    key: "viewLessons",
    icon: BookOpenCheck,
    label: t("actions.viewLessons"),
    onClick: onOpenDetail,
  });
  add(hasInvoice, {
    key: "viewInvoice",
    icon: Receipt,
    label: t("actions.viewInvoice"),
    href: `/invoices?id=${row.invoice_id}`,
  });
  add(canSendInvoice && hasInvoice && !owes, {
    key: "sendPaymentPaid",
    icon: sendingPayment ? Loader2 : MessageCircle,
    label: t("actions.sendPayment"),
    onClick: onSendPayment,
    disabled: sendingPayment,
    spin: sendingPayment,
  });
  if (paymentUrl !== null) {
    actions.push(
      {
        key: "paymentLink",
        icon: ExternalLink,
        label: t("actions.paymentLink"),
        external: paymentUrl,
      },
      {
        key: "copyLink",
        icon: Copy,
        label: t("actions.copyLink"),
        onClick: () => void copyPaymentLink(),
      },
    );
  }
  add(row.payment_proof_url !== null, {
    key: "viewProof",
    icon: FileImage,
    label: t("actions.viewProof"),
    external: `${apiBase()}${row.payment_proof_url}`,
  });
  if (canManage && isActive) {
    actions.push(
      {
        key: "edit",
        icon: Pencil,
        label: t("actions.edit"),
        onClick: onEdit,
        testId: "edit-package",
      },
      {
        key: "sync",
        icon: syncing ? Loader2 : RefreshCw,
        label: t("actions.syncLessons"),
        onClick: onSyncLessons,
        disabled: syncing,
        spin: syncing,
      },
      {
        key: "close",
        icon: Link2,
        label: t("actions.close"),
        onClick: onClose,
        testId: "close-package",
      },
    );
  }
  add(canManage && row.awaiting_next_package, {
    key: "toMonthly",
    icon: ArrowLeftRight,
    label: t("actions.toMonthly"),
    onClick: onReturnToMonthly,
    testId: "package-to-monthly",
  });

  const featured = actions.slice(0, 2);
  const overflow = actions.slice(2);

  return (
    <article
      data-testid="package-card"
      className={cn(
        "bg-card group flex min-w-0 flex-col overflow-hidden rounded-2xl border shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg",
        alarm && "border-rose-300/70 dark:border-rose-800/60",
        !alarm && low && "border-amber-300/70 dark:border-amber-800/60",
      )}
    >
      <div
        className={cn(
          "relative border-b px-4 py-3.5",
          alarm
            ? "bg-gradient-to-br from-rose-500/[0.12] via-rose-500/[0.05] to-transparent"
            : low
              ? "bg-gradient-to-br from-amber-500/[0.13] via-amber-500/[0.05] to-transparent"
              : "bg-gradient-to-br from-primary/[0.12] via-primary/[0.04] to-transparent",
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl ring-1",
              alarm
                ? "bg-rose-500/10 text-rose-600 ring-rose-500/20"
                : low
                  ? "bg-amber-500/10 text-amber-600 ring-amber-500/20"
                  : "bg-primary/10 text-primary ring-primary/20",
            )}
          >
            <WalletCards className="size-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onOpenDetail}
              className="hover:text-primary block max-w-full truncate text-start text-sm font-bold transition-colors"
            >
              {row.student_name}
            </button>
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              #{row.sequence_no} · {row.label}
            </p>
          </div>
          <StatusPill status={row.status} label={t(`status.${row.status}`)} />
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="grid grid-cols-2 gap-2">
          <Metric
            icon={Clock3}
            label={t("card.totalHours")}
            value={formatHours(row.minutes_sold, locale)}
            tone="violet"
          />
          <Metric
            icon={BookOpenCheck}
            label={t("card.lessonsUsed")}
            value={formatNumber(row.lesson_count, locale)}
            tone="blue"
          />
          <Metric
            icon={RefreshCw}
            label={t("card.remainingShort")}
            value={formatHours(row.minutes_remaining, locale)}
            tone={low ? "amber" : "emerald"}
          />
          <Metric
            icon={WalletCards}
            label={t("card.packageTotal")}
            value={formatMoney(
              { amount: row.price_minor, currency: row.currency },
              locale,
            )}
            tone="slate"
          />
        </div>

        <div className="mt-3.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">{t("card.progress")}</span>
            <span className="font-bold tabular-nums">
              {formatNumber(row.percent_used, locale)}%
            </span>
          </div>
          <div className="bg-muted flex h-2 overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full rounded-full",
                low ? "bg-amber-500" : "bg-primary",
              )}
              style={{ width: `${Math.min(100, row.percent_used)}%` }}
            />
          </div>
        </div>

        {/* The four facts someone rings up about. They sit on their own surface rather than as
            loose lines under a rule — on a card this dense, plain text reads as filler and the
            eye goes straight past the one number that matters. */}
        <dl className="bg-muted/35 mt-3.5 space-y-2 rounded-xl p-3 text-xs">
          <InfoRow
            icon={CalendarDays}
            label={t("card.startDate")}
            value={formatDate(row.starts_on, locale)}
            hint={
              row.expires_on === null
                ? undefined
                : t("card.endsOn", {
                    date: formatDate(row.expires_on, locale),
                  })
            }
          />
          <InfoRow
            icon={WalletCards}
            label={t("card.hourlyRate")}
            value={t("card.perHour", {
              amount: formatMoney(
                {
                  amount: row.hourly_rate_minor,
                  currency: row.currency,
                },
                locale,
              ),
            })}
          />
          <InfoRow
            icon={CalendarClock}
            label={t("card.nextLesson")}
            value={
              row.next_lesson_at === null
                ? t("card.noneScheduled")
                : formatDateTime(row.next_lesson_at, timezone, locale)
            }
            hint={
              row.upcoming_lesson_count > 0
                ? t("card.upcomingCount", { count: row.upcoming_lesson_count })
                : undefined
            }
          />
          <InfoRow
            icon={Receipt}
            highlight={owes}
            label={t("card.payment")}
            value={
              row.invoice_id === null
                ? t("card.notBilledYet")
                : row.invoice_status === "PAID"
                  ? t("card.paid")
                  : owes
                    ? t("card.amountDue", {
                        amount: formatMoney(
                          {
                            amount: row.outstanding_minor,
                            currency: row.currency,
                          },
                          locale,
                        ),
                      })
                    : t("card.invoiceOpen")
            }
            hint={
              row.payment_reference !== null
                ? t("card.paymentReference", {
                    reference: row.payment_reference,
                  })
                : (row.payment_reason ?? undefined)
            }
            danger={owes}
          />
        </dl>

        {row.minutes_overdrawn > 0 && (
          <p className="bg-destructive/8 text-destructive mt-3 flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[11px] font-semibold">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            {t("card.overdrawn", {
              over: formatHours(row.minutes_overdrawn, locale),
            })}
          </p>
        )}

        {/* What was taught after the block ran out. Those lessons are billed by the hour on the
            student's monthly invoice — a different page — so without this the card said "next
            lesson tomorrow" and nothing about where that lesson's money was going. */}
        {row.gap !== null && (
          <div
            className="mt-3 rounded-xl border border-rose-300/60 bg-rose-500/[0.07] px-3 py-2.5 text-[11px] dark:border-rose-800/50"
            data-testid="package-gap"
          >
            <p className="flex items-center gap-1.5 font-bold text-rose-700 dark:text-rose-300">
              <CalendarX className="size-3.5 shrink-0" aria-hidden />
              {t("card.gapTitle")}
            </p>
            <p className="mt-0.5 leading-4 text-rose-900/80 dark:text-rose-200/85">
              {t("card.gapBody", {
                count: row.gap.lessons,
                // Pre-formatted so the count wears the same digits as the hours beside it.
                n: formatNumber(row.gap.lessons, locale),
                hours: formatHours(row.gap.minutes, locale),
                amount: row.gap.amounts
                  .map((a) =>
                    formatMoney(
                      { amount: a.amount_minor, currency: a.currency },
                      locale,
                    ),
                  )
                  .join(" + "),
              })}
            </p>
          </div>
        )}
        {row.gap === null &&
          row.awaiting_next_package &&
          row.upcoming_lesson_count > 0 && (
            <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-amber-500/10 px-2.5 py-2 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
              <CalendarX className="mt-px size-3.5 shrink-0" aria-hidden />
              {t("card.noPackageOpen")}
            </p>
          )}

        <div className="mt-auto flex items-stretch gap-1.5 border-t pt-3">
          {featured.map((action, i) => (
            <ActionChip
              key={action.key}
              action={action}
              tone={action.danger ? "danger" : i === 0 ? "primary" : "neutral"}
            />
          ))}
          {overflow.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger>
                <button
                  type="button"
                  aria-label={copied ? t("actions.copied") : t("actions.more")}
                  title={copied ? t("actions.copied") : t("actions.more")}
                  data-testid="package-card-menu"
                  className={cn(actionClass(), "w-9 shrink-0 px-0")}
                >
                  {copied ? (
                    <Check className="size-4 text-emerald-600" aria-hidden />
                  ) : (
                    <MoreHorizontal className="size-4" aria-hidden />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {overflow.map((action) => (
                  <MenuAction key={action.key} action={action} />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </article>
  );
}

/** One of the (at most two) actions shown as a button on the card itself. */
function ActionChip({
  action,
  tone,
}: {
  action: CardAction;
  tone: "primary" | "danger" | "neutral";
}) {
  const Icon = action.icon;
  const className = cn(actionClass({ tone }), "min-w-0 flex-1");
  const content = (
    <>
      <Icon
        className={cn("size-3.5 shrink-0", action.spin && "animate-spin")}
        aria-hidden
      />
      <span className="truncate">{action.label}</span>
    </>
  );

  if (action.href !== undefined) {
    return (
      <Link href={action.href} className={className} data-testid={action.testId}>
        {content}
      </Link>
    );
  }
  if (action.external !== undefined) {
    return (
      <a
        href={action.external}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        data-testid={action.testId}
      >
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled}
      data-testid={action.testId}
      className={className}
    >
      {content}
    </button>
  );
}

/** One of the actions behind "⋯". Links stay real links, so open-in-new-tab still works. */
function MenuAction({ action }: { action: CardAction }) {
  const Icon = action.icon;
  const content = (
    <>
      <Icon className={cn(action.spin && "animate-spin")} aria-hidden />
      {action.label}
    </>
  );

  if (action.href !== undefined) {
    return (
      <DropdownMenuItem
        data-testid={action.testId}
        render={<Link href={action.href} />}
      >
        {content}
      </DropdownMenuItem>
    );
  }
  if (action.external !== undefined) {
    return (
      <DropdownMenuItem
        data-testid={action.testId}
        render={
          <a href={action.external} target="_blank" rel="noopener noreferrer" />
        }
      >
        {content}
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem
      onClick={action.onClick}
      disabled={action.disabled}
      destructive={action.danger}
      data-testid={action.testId}
    >
      {content}
    </DropdownMenuItem>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
  tone: "violet" | "blue" | "emerald" | "amber" | "slate";
}) {
  const colors = {
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
    blue: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
    slate: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  };
  return (
    <div className="bg-muted/35 min-w-0 rounded-xl p-2.5">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-lg",
            colors[tone],
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </span>
        <span className="text-muted-foreground truncate text-[10px] font-medium">
          {label}
        </span>
      </div>
      <p
        className="mt-1.5 truncate text-sm font-bold tabular-nums"
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  hint,
  danger,
  highlight,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  hint?: string;
  danger?: boolean;
  /** Lift this row out of the list — used for a debt, which is never "one of four facts". */
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-2",
        highlight &&
          "bg-destructive/10 ring-destructive/20 -mx-1.5 rounded-lg px-1.5 py-1 ring-1",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          highlight ? "text-destructive" : "text-muted-foreground",
        )}
        aria-hidden
      />
      <dt
        className={cn(
          "shrink-0",
          highlight ? "text-destructive/80" : "text-muted-foreground",
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "ms-auto min-w-0 truncate text-end font-semibold",
          danger && "text-destructive",
        )}
      >
        {value}
        {hint && (
          <span className="text-muted-foreground ms-1 font-normal">
            · {hint}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * Every action on this card wears the same filled chip, including the two that are links.
 *
 * They used to be bare text on the card's own background, which read as captions rather than
 * as things you could press — and the ones that WERE filled (view, bill overdraft) then looked
 * like the only real buttons. A surface each, and the hierarchy is carried by colour instead.
 */
function actionClass({
  tone = "neutral",
}: {
  tone?: "neutral" | "primary" | "danger";
} = {}): string {
  return cn(
    "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border px-2 text-[11px] font-semibold transition-colors disabled:opacity-50",
    tone === "primary" &&
      "border-primary/25 bg-primary/10 text-primary hover:bg-primary/18",
    tone === "danger" &&
      "border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/18",
    tone === "neutral" &&
      "border-border/70 bg-muted/60 text-foreground/80 hover:bg-muted",
  );
}

function StatusPill({
  status,
  label,
}: {
  status: LessonPackageRow["status"];
  label: string;
}) {
  const tone =
    status === "ACTIVE"
      ? "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300"
      : status === "COMPLETED"
        ? "bg-slate-400/12 text-slate-600 ring-slate-400/25 dark:text-slate-300"
        : "bg-muted text-muted-foreground ring-border";
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1",
        tone,
      )}
    >
      {label}
    </span>
  );
}

function formatDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(
    locale.startsWith("ar") ? `${locale}-u-nu-arab` : locale,
    { dateStyle: "medium", timeZone: "UTC" },
  ).format(new Date(`${date}T00:00:00Z`));
}
