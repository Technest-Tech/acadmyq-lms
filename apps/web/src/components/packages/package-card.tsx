"use client";

import {
  AlertTriangle,
  BadgeCheck,
  BookOpenCheck,
  CalendarDays,
  CalendarClock,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  FileImage,
  Link2,
  Loader2,
  MessageCircle,
  Pencil,
  Receipt,
  RefreshCw,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import type { LessonPackageRow } from "@/lib/api";
import { apiBase } from "@/lib/api-base";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatDateTime, formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

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
  const strandedOverdraft = row.minutes_overdrawn > 0 && !row.overdraft_billed;
  const paymentUrl =
    row.invoice_token !== null && typeof window !== "undefined"
      ? `${window.location.origin}/i/${row.invoice_token}`
      : null;

  async function copyPaymentLink() {
    if (paymentUrl === null) return;
    await navigator.clipboard.writeText(paymentUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <article
      data-testid="package-card"
      className={cn(
        "bg-card group flex min-w-0 flex-col overflow-hidden rounded-2xl border shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg",
        owes && "border-rose-300/70 dark:border-rose-800/60",
        !owes && low && "border-amber-300/70 dark:border-amber-800/60",
      )}
    >
      <div
        className={cn(
          "relative border-b px-4 py-3.5",
          owes
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
              owes
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

        <div className="mt-auto grid grid-cols-2 gap-1.5 border-t pt-3">
          <ActionButton icon={BookOpenCheck} onClick={onOpenDetail} primary>
            {t("actions.viewLessons")}
          </ActionButton>
          {row.invoice_id !== null ? (
            <Link
              href={`/invoices?id=${row.invoice_id}`}
              className={actionClass()}
            >
              <Receipt className="size-3.5" aria-hidden />
              {t("actions.viewInvoice")}
            </Link>
          ) : (
            <span />
          )}

          {paymentUrl !== null && (
            <>
              <a
                href={paymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={actionClass()}
              >
                <ExternalLink className="size-3.5" aria-hidden />
                {t("actions.paymentLink")}
              </a>
              <ActionButton
                icon={copied ? Check : Copy}
                onClick={() => void copyPaymentLink()}
              >
                {copied ? t("actions.copied") : t("actions.copyLink")}
              </ActionButton>
            </>
          )}

          {canSendInvoice && row.invoice_id !== null && (
            <ActionButton
              icon={sendingPayment ? Loader2 : MessageCircle}
              onClick={onSendPayment}
              disabled={sendingPayment}
              iconClassName={sendingPayment ? "animate-spin" : undefined}
              full
            >
              {t("actions.sendPayment")}
            </ActionButton>
          )}

          {row.payment_proof_url !== null && (
            <a
              href={`${apiBase()}${row.payment_proof_url}`}
              target="_blank"
              rel="noopener noreferrer"
              className={actionClass()}
            >
              <FileImage className="size-3.5" aria-hidden />
              {t("actions.viewProof")}
            </a>
          )}

          {canMarkPaid && row.invoice_id !== null && owes && (
            <ActionButton icon={BadgeCheck} onClick={onMarkPaid} full>
              {t("actions.markPaid")}
            </ActionButton>
          )}

          {canManage && isActive && (
            <>
              {/* Correcting the terms sits with the other things you do TO a running package,
                  not up in the header: it is a repair, not the card's main verb. */}
              <ActionButton
                icon={Pencil}
                onClick={onEdit}
                testId="edit-package"
              >
                {t("actions.edit")}
              </ActionButton>
              <ActionButton
                icon={syncing ? Loader2 : RefreshCw}
                onClick={onSyncLessons}
                disabled={syncing}
                iconClassName={syncing ? "animate-spin" : undefined}
              >
                {t("actions.syncLessons")}
              </ActionButton>
              <ActionButton icon={Link2} onClick={onClose} full>
                {t("actions.close")}
              </ActionButton>
            </>
          )}

          {canManage && !isActive && strandedOverdraft && (
            <ActionButton
              icon={AlertTriangle}
              onClick={onBillOverdraft}
              danger
              full
            >
              {t("actions.billOverdraft")}
            </ActionButton>
          )}
        </div>
      </div>
    </article>
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
  full,
}: {
  tone?: "neutral" | "primary" | "danger";
  full?: boolean;
} = {}): string {
  return cn(
    "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border px-2 text-[11px] font-semibold transition-colors disabled:opacity-50",
    tone === "primary" &&
      "border-primary/25 bg-primary/10 text-primary hover:bg-primary/18",
    tone === "danger" &&
      "border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/18",
    tone === "neutral" &&
      "border-border/70 bg-muted/60 text-foreground/80 hover:bg-muted",
    full && "col-span-2",
  );
}

function ActionButton({
  icon: Icon,
  children,
  onClick,
  primary,
  danger,
  disabled,
  full,
  iconClassName,
  testId,
}: {
  icon: typeof Clock3;
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  full?: boolean;
  iconClassName?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={actionClass({
        tone: primary ? "primary" : danger ? "danger" : "neutral",
        full,
      })}
    >
      <Icon className={cn("size-3.5", iconClassName)} aria-hidden />
      {children}
    </button>
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
