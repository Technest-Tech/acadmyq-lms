"use client";

import { AlertTriangle, BadgeCheck, CalendarClock, CircleDollarSign, Hourglass, Layers, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { FAMILY_ROW, FamilyCard, owed, type DueFamily } from "@/components/packages/family-card";
import { blockAmount } from "@/components/packages/lesson-price-fields";
import { actionClass, PackageActions, type PackageActionProps } from "@/components/packages/package-card";
import { StatCard } from "@/components/ui/stat-card";
import type { LessonPackageRow } from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatDateTime, formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * Open packages, simplified for supervisors (Ahmed 2026-11-22: "every card has a million details —
 * keep only what matters"). A line answers four questions: who, how much is left, when is the next
 * lesson, and is it paid. Everything else (price, per-hour rate, start date, renewal terms, the
 * package's purpose) is one click away in the package itself. Since 2026-11-24 the lines sit in the
 * same family cards as Due ({@link FamilyCard}); this file keeps its old name.
 */

/** The Open page's filters — each is a stat card. */
export type OpenFilter = "all" | "low" | "unpaid" | "ranOut";

/**
 * The student's last block ran out and nothing was renewed — a decision is owed (open the next block
 * or move them to monthly). `gap` is set only once a lesson has been taught since; a block that ran
 * out with no lesson after it yet is still waiting (`awaiting_next_package`), and with Finished gone
 * this page is the only place it shows.
 */
export function isRanOut(row: LessonPackageRow): boolean {
  return row.status !== "ACTIVE" && (row.gap !== null || row.awaiting_next_package);
}

/** A running block with a lesson or less left (an hour, for a block sold in hours). */
export function isRunningLow(row: LessonPackageRow): boolean {
  return row.status === "ACTIVE" && row.minutes_remaining <= Math.max(60, row.lesson_minutes ?? 0);
}

/** Money owed on this block, or on an earlier one of the same student. */
export function isUnpaid(row: LessonPackageRow): boolean {
  return row.outstanding_minor > 0 || row.previous_unpaid !== null;
}

export function matchesOpenFilter(row: LessonPackageRow, filter: OpenFilter): boolean {
  if (filter === "low") return isRunningLow(row);
  if (filter === "unpaid") return isUnpaid(row);
  if (filter === "ranOut") return isRanOut(row);
  return true;
}

/** The stat cards over Open packages. Each one is also the filter for what it counts. */
export function OpenStats({
  rows,
  filter,
  onFilter,
}: {
  /** Every row on the page, before search and filter. */
  rows: LessonPackageRow[];
  filter: OpenFilter;
  onFilter: (filter: OpenFilter) => void;
}) {
  const t = useTranslations("packages.openStats");
  const locale = useLocale();
  const open = rows.filter((r) => r.status === "ACTIVE").length;
  const toggle = (next: OpenFilter) => onFilter(filter === next ? "all" : next);

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="open-stats">
      <StatCard
        tone="sky"
        icon={Layers}
        label={t("open")}
        values={[formatNumber(open, locale)]}
        onClick={() => onFilter("all")}
        active={filter === "all"}
        testId="open-stats-all"
      />
      <StatCard
        tone="amber"
        icon={Hourglass}
        label={t("low")}
        values={[formatNumber(rows.filter(isRunningLow).length, locale)]}
        onClick={() => toggle("low")}
        active={filter === "low"}
        testId="open-stats-low"
      />
      <StatCard
        tone="rose"
        icon={CircleDollarSign}
        label={t("unpaid")}
        values={[formatNumber(rows.filter(isUnpaid).length, locale)]}
        onClick={() => toggle("unpaid")}
        active={filter === "unpaid"}
        testId="open-stats-unpaid"
      />
      <StatCard
        tone="violet"
        icon={AlertTriangle}
        label={t("ranOut")}
        values={[formatNumber(rows.filter(isRanOut).length, locale)]}
        onClick={() => toggle("ranOut")}
        active={filter === "ranOut"}
        testId="open-stats-ran-out"
      />
    </div>
  );
}

/**
 * A family on the Open page, in the same tile as Due (Ahmed 2026-11-24: "make Open the same design
 * as Due"): the parent, what the family owes on these blocks when it owes anything, then each open
 * package in three short lines. They still answer only the supervisor's four questions — who, how
 * much is left, the next lesson, paid or not — with Renew on a block that ran out, the rest in "⋯".
 */
export function OpenFamilyCard({
  family,
  timezone,
  actionProps,
}: {
  family: DueFamily;
  timezone: string;
  actionProps: (row: LessonPackageRow) => PackageActionProps;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const totals = owed(family.rows);

  return (
    <FamilyCard
      family={family}
      testId={`open-family-${family.key}`}
      nameTestId="open-family-name"
      aside={
        totals.length > 0 ? (
          <p className="flex shrink-0 items-baseline gap-1" data-testid="open-family-owes">
            <span className="text-muted-foreground text-[10px] font-medium">{t("family.totalLabel")}</span>
            <span className="text-[13px] font-bold whitespace-nowrap text-rose-600 tabular-nums dark:text-rose-400">
              {totals.map((o) => formatMoney({ amount: o.amount_minor, currency: o.currency }, locale)).join(" + ")}
            </span>
          </p>
        ) : undefined
      }
    >
      {family.rows.map((row) => (
        <OpenRow key={row.id} row={row} timezone={timezone} actions={actionProps(row)} />
      ))}
    </FamilyCard>
  );
}

/** One open package inside a family tile. Keeps the `package-card` test id the old cards carried. */
function OpenRow({ row, timezone, actions }: { row: LessonPackageRow; timezone: string; actions: PackageActionProps }) {
  const t = useTranslations("packages.openTable");
  return (
    <li
      className={cn(FAMILY_ROW, isRanOut(row) && "bg-violet-500/[0.05]")}
      data-testid="package-card"
      data-previous-unpaid={row.previous_unpaid !== null || undefined}
    >
      {/* Who, and paid or not. */}
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={actions.onOpenDetail}
          className="hover:text-primary min-w-0 truncate text-start text-[13px] font-semibold transition-colors"
          title={row.student_name}
        >
          {row.student_name}
        </button>
        <span className="ms-auto flex shrink-0 justify-end">
          <Payment row={row} />
        </span>
      </div>

      {/* Which package, and what is left of it — or, for one that ran out, what has run on since. */}
      <div className="flex min-w-0 items-center gap-2 text-[11px]">
        <span className="min-w-0 shrink truncate">
          <PackageShape row={row} />
        </span>
        <span className="ms-auto flex min-w-0 shrink-0 items-center">
          <Balance row={row} />
        </span>
      </div>

      {/* The next lesson; Renew on a block that ran out, then "⋯". */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="text-muted-foreground inline-flex min-w-0 items-center gap-1 text-[11px] tabular-nums" title={t("nextLesson")}>
          <CalendarClock className="size-3.5 shrink-0" aria-hidden />
          <span className="sr-only">{t("nextLesson")}: </span>
          <span className="truncate">
            <NextLesson row={row} timezone={timezone} />
          </span>
        </span>
        <Actions row={row} actions={actions} className="ms-auto" />
      </div>
    </li>
  );
}

/**
 * The lessons-of-a-length a block was sold as, when that is KNOWN: a block counted in lessons, or
 * the auto-written label's "12 × 40" when it adds up to the minutes sold. Never guessed from the
 * minutes alone — 1200 minutes is 20 × 60 or 40 × 30, and a wrong guess is worse than hours.
 */
export function soldShape(row: Pick<LessonPackageRow, "minutes_total" | "lesson_minutes" | "label">): { lessons: number; minutes: number } | null {
  const total = row.minutes_total;
  if (row.lesson_minutes && total > 0 && total % row.lesson_minutes === 0) {
    return { lessons: total / row.lesson_minutes, minutes: row.lesson_minutes };
  }
  const digits = (row.label ?? "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const m = digits.match(/(\d+)\s*[×xX]\s*(\d+)/);
  if (m) {
    const lessons = Number(m[1]);
    const minutes = Number(m[2]);
    if (lessons > 0 && lessons * minutes === total) return { lessons, minutes };
  }
  return null;
}

/**
 * What the package IS, read from what was sold rather than its name (Ahmed 2026-11-22: most have
 * none): "12 lessons × 40 min", else its hours. The number in the run of renewals leads; a typed
 * name, if any, is on hover.
 */
export function PackageShape({ row }: { row: LessonPackageRow }) {
  const t = useTranslations("packages.openTable");
  const locale = useLocale();
  const shape = soldShape(row);
  const n = (value: number) => formatNumber(value, locale);
  const size =
    shape !== null
      ? t("shape", { count: shape.lessons, n: n(shape.lessons), len: n(shape.minutes) })
      : row.minutes_total % 60 === 0
        ? t("hours", { count: row.minutes_total / 60, n: n(row.minutes_total / 60) })
        : formatHours(row.minutes_total, locale);
  const subject = row.subject ? (row.subject.course ?? row.subject.teacher_name) : null;

  return (
    <span title={row.label.trim() !== "" ? row.label : undefined} data-testid="open-package-shape">
      <span className="text-muted-foreground tabular-nums">#{n(row.sequence_no)}</span>{" "}
      <span className="text-foreground font-medium">{size}</span>
      {subject && <span className="text-muted-foreground"> · {subject}</span>}
    </span>
  );
}

/** What is left of what was bought, as a bar and in words; for a block that ran out, what has run on since. */
function Balance({ row, wide = false }: { row: LessonPackageRow; wide?: boolean }) {
  const t = useTranslations("packages");
  const locale = useLocale();

  if (isRanOut(row)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 dark:text-violet-300" data-testid="package-gap">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        {t("openTable.ranOut", { count: row.gap?.lessons ?? 0, n: formatNumber(row.gap?.lessons ?? 0, locale) })}
      </span>
    );
  }

  const low = isRunningLow(row);
  return (
    <span className={cn("flex items-center gap-2", wide && "w-full")}>
      <span className={cn("bg-muted h-1.5 shrink-0 overflow-hidden rounded-full", wide ? "flex-1" : "w-10")} aria-hidden>
        <span
          className={cn("block h-full rounded-full", low ? "bg-amber-500" : "bg-primary")}
          style={{ width: `${Math.max(0, Math.min(100, 100 - row.percent_used))}%` }}
        />
      </span>
      <span className={cn("shrink-0 text-xs font-semibold tabular-nums", low ? "text-amber-700 dark:text-amber-300" : "text-foreground")} data-testid="open-package-left">
        {t("openTable.leftOf", {
          left: blockAmount(row.minutes_remaining, row.lesson_minutes, t, locale),
          total: blockAmount(row.minutes_sold, row.lesson_minutes, t, locale),
        })}
      </span>
    </span>
  );
}

function NextLesson({ row, timezone }: { row: LessonPackageRow; timezone: string }) {
  const t = useTranslations("packages.card");
  const locale = useLocale();
  return row.next_lesson_at === null ? (
    <span className="text-muted-foreground">{t("noneScheduled")}</span>
  ) : (
    <span>{formatDateTime(row.next_lesson_at, timezone, locale)}</span>
  );
}

/** Paid or not, in words — plus an earlier package still owed, which is otherwise on another page. */
function Payment({ row }: { row: LessonPackageRow }) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const owes = row.outstanding_minor > 0;
  const paid = row.invoice_id !== null && !owes;
  const earlier = row.previous_unpaid;

  return (
    <span className="inline-flex shrink-0 flex-wrap items-center justify-end gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap tabular-nums",
          owes
            ? "bg-rose-500/12 text-rose-700 dark:text-rose-300"
            : paid
              ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
              : "bg-muted text-muted-foreground",
        )}
        data-testid="open-package-payment"
      >
        {owes ? (
          t("card.amountDue", { amount: formatMoney({ amount: row.outstanding_minor, currency: row.currency }, locale) })
        ) : paid ? (
          <>
            <BadgeCheck className="size-3" aria-hidden />
            {t("card.paidBadge")}
          </>
        ) : (
          t("card.notBilledYet")
        )}
      </span>
      {earlier !== null && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-fuchsia-500/12 px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-fuchsia-700 dark:text-fuchsia-300"
          data-testid="previous-unpaid"
          title={t("card.previousUnpaidTitle", { count: earlier.packages })}
        >
          <AlertTriangle className="size-3" aria-hidden />
          {t("openTable.earlierUnpaid", {
            amount: earlier.amounts.map((a) => formatMoney({ amount: a.amount_minor, currency: a.currency }, locale)).join(" + "),
          })}
        </span>
      )}
    </span>
  );
}

/**
 * Only "⋯" on a running block — collecting money is the Due page's job. A block that ran out with
 * the student still coming leads with Renew, the decision it is waiting on.
 */
function Actions({ row, actions, className }: { row: LessonPackageRow; actions: PackageActionProps; className?: string }) {
  const t = useTranslations("packages.actions");
  const renew = isRanOut(row) && actions.canManage && row.awaiting_next_package;
  return (
    <div className={cn("flex shrink-0 items-center gap-1.5", className)}>
      {renew && (
        <button type="button" onClick={actions.onRenew} className={actionClass({ tone: "primary" })} data-testid="renew-package">
          <Plus className="size-3.5" aria-hidden />
          {t("renew")}
        </button>
      )}
      <PackageActions {...actions} featuredCount={0} hide={renew ? ["renew"] : undefined} />
    </div>
  );
}
