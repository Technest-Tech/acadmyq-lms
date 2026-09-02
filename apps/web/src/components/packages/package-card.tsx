"use client";

import { AlertTriangle, CircleDollarSign, Clock, Receipt } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { LessonPackageRow } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * One package as a card: who it is for, how much of it is left, and what is owed on it.
 *
 * The bar is the whole point of the screen — "live track for each student's package" is the
 * thing an owner asks for, and a number alone doesn't answer "are we nearly out". Overdraw is
 * drawn as a separate red segment rather than by letting the bar run past 100%, because those
 * are two different facts: the block is finished AND we went past it.
 */
export function PackageCard({
  row,
  onOpenDetail,
  onClose,
  onBillOverdraft,
  canManage,
}: {
  row: LessonPackageRow;
  onOpenDetail: () => void;
  onClose: () => void;
  onBillOverdraft: () => void;
  canManage: boolean;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();

  const isActive = row.status === "ACTIVE";
  const low = isActive && row.minutes_remaining <= 60;
  const owes = row.outstanding_minor > 0 && row.status === "COMPLETED";
  const strandedOverdraft = row.minutes_overdrawn > 0 && !row.overdraft_billed;

  return (
    <div
      data-testid="package-card"
      className={cn(
        "bg-card rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md",
        owes && "border-destructive/40",
        !owes && low && "border-amber-500/40",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpenDetail}
            className="hover:text-primary text-start text-sm font-semibold transition-colors"
          >
            {row.student_name}
          </button>
          <p className="text-muted-foreground truncate text-xs">
            #{row.sequence_no} · {row.label} · {t(`timing.${row.bill_timing}`)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill status={row.status} label={t(`status.${row.status}`)} />
          {low && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-400">
              <Clock className="size-3" aria-hidden />
              {t("badges.low")}
            </span>
          )}
          {owes && (
            <span className="bg-destructive/12 text-destructive ring-destructive/25 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1">
              <CircleDollarSign className="size-3" aria-hidden />
              {formatMoney({ amount: row.outstanding_minor, currency: row.currency }, locale)}
            </span>
          )}
        </div>
      </div>

      {/* ── The balance ──────────────────────────────────────────────── */}
      <div className="mt-3.5">
        <div className="bg-muted flex h-2 overflow-hidden rounded-full">
          <div
            className={cn("h-full", low ? "bg-amber-500" : "bg-primary")}
            style={{ width: `${Math.min(100, row.percent_used)}%` }}
          />
          {row.minutes_overdrawn > 0 && (
            <div
              className="bg-destructive h-full"
              style={{
                width: `${Math.min(
                  100 - Math.min(100, row.percent_used),
                  Math.round((row.minutes_overdrawn / Math.max(1, row.minutes_sold)) * 100),
                )}%`,
              }}
            />
          )}
        </div>

        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>
            {t("card.used", {
              used: formatHours(row.minutes_consumed, locale),
              total: formatHours(row.minutes_sold, locale),
            })}
          </span>
          <span className="text-foreground font-semibold">
            {t("card.remaining", { left: formatHours(row.minutes_remaining, locale) })}
          </span>
          {row.carried_over_minutes > 0 && (
            <span>
              {t("card.carried", {
                carried: formatHours(row.carried_over_minutes, locale),
              })}
            </span>
          )}
          {row.minutes_overdrawn > 0 && (
            <span className="text-destructive inline-flex items-center gap-1 font-semibold">
              <AlertTriangle className="size-3" aria-hidden />
              {t("card.overdrawn", {
                over: formatHours(row.minutes_overdrawn, locale),
              })}
            </span>
          )}
        </div>
      </div>

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t pt-3">
        <button
          type="button"
          onClick={onOpenDetail}
          className="text-primary hover:bg-primary/8 rounded-lg px-2 py-1 text-xs font-semibold transition-colors"
        >
          {t("actions.viewLessons")}
        </button>

        {row.invoice_id !== null && (
          <Link
            href={`/invoices?id=${row.invoice_id}`}
            className="text-muted-foreground hover:bg-muted/50 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors"
          >
            <Receipt className="size-3.5" aria-hidden />
            {t("actions.viewInvoice")}
          </Link>
        )}

        {canManage && isActive && (
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:bg-muted/50 ms-auto rounded-lg px-2 py-1 text-xs font-semibold transition-colors"
          >
            {t("actions.close")}
          </button>
        )}

        {/* Only reachable for an ON_START package whose last lesson overdrew it and for which no
            next package was ever opened — otherwise the debt rides along on that one's bill. */}
        {canManage && !isActive && strandedOverdraft && (
          <button
            type="button"
            onClick={onBillOverdraft}
            className="text-destructive hover:bg-destructive/8 ms-auto rounded-lg px-2 py-1 text-xs font-semibold transition-colors"
          >
            {t("actions.billOverdraft")}
          </button>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status, label }: { status: LessonPackageRow["status"]; label: string }) {
  const tone =
    status === "ACTIVE"
      ? "bg-primary/10 text-primary ring-primary/20"
      : status === "COMPLETED"
        ? "bg-slate-400/12 text-slate-600 ring-slate-400/25 dark:text-slate-300"
        : "bg-muted text-muted-foreground ring-border";

  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", tone)}>
      {label}
    </span>
  );
}
