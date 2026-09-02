"use client";

import {
  BadgeMinus,
  BadgePlus,
  CalendarRange,
  Clock3,
  Lock,
  Users,
  Wallet,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { FinalizePeriodModal } from "@/components/payroll/finalize-period-modal";
import { PayoutDetailModal } from "@/components/payroll/payout-detail-modal";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/ui/page-hero";
import {
  DataTable,
  type ColumnDef,
  type FilterDef,
} from "@/components/ui/data-table";
import {
  apiFetch,
  getPayrollRange,
  toQueryString,
  type DataTableQuery,
  type ListResult,
  type PayoutRow,
  type PayrollRange,
} from "@/lib/api";
import { type ExcelColumn } from "@/lib/export-excel";
import { formatMoney } from "@/lib/money";
import { formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<PayoutRow["status"], string> = {
  OPEN: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  FINALIZED:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
};

const STATUS_DOT: Record<PayoutRow["status"], string> = {
  OPEN: "bg-blue-500",
  FINALIZED: "bg-emerald-500",
};

function PayoutStatusBadge({ status }: { status: PayoutRow["status"] }) {
  const t = useTranslations("payroll");
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
      {t(`status.${status}`)}
    </span>
  );
}

// ── The window ─────────────────────────────────────────────────────────────────

/** Today and the first of this month, as `YYYY-MM-DD` in the viewer's own clock. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function defaultRange(): { from: string; to: string } {
  const now = new Date();

  return {
    from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: isoDate(now),
  };
}

/** `YYYY-MM` for a date string — the month a statement would be filed under. */
const monthOf = (date: string) => date.slice(0, 7);

/**
 * The windows an academy actually pays over. Presets, not a calendar-month dropdown — the point of
 * the feature is that payroll periods are rarely a calendar month.
 */
const RANGE_PRESETS: ReadonlyArray<{ key: string; build: () => { from: string; to: string } }> = [
  { key: "thisMonth", build: defaultRange },
  {
    key: "lastMonth",
    build: () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: isoDate(first), to: isoDate(last) };
    },
  },
  {
    key: "last30",
    build: () => {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      return { from: isoDate(start), to: isoDate(now) };
    },
  },
];

// ── Salary summary (owner only) — what this window costs, per currency ─────────

/**
 * The payroll bill for the chosen window.
 *
 * Every figure here is a SALARY figure. The page used to lead with revenue-vs-payouts profit and
 * with what students still owe — real numbers, but neither of them tells you what to pay anyone,
 * and both are answered properly on the financial statistics and invoices pages. What an owner
 * comes here for is: how much do I owe, to how many people, for how many hours.
 *
 * Never summed across currencies (§3.6) — a teacher paid in USD gets their own card.
 */
function SalarySummaryPanel({
  range,
  loading,
}: {
  range: PayrollRange | null;
  loading: boolean;
}) {
  const t = useTranslations("payroll");
  const locale = useLocale();

  if (loading) {
    return (
      <div className="bg-card h-[132px] animate-pulse rounded-2xl border shadow-sm" aria-hidden />
    );
  }

  if (range === null || range.currencies.length === 0) {
    return (
      <div className="text-muted-foreground bg-card rounded-2xl border border-dashed px-4 py-8 text-center text-sm">
        {t("rangeEmpty")}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {range.currencies.map((bucket) => {
        const fmt = (v: number) => formatMoney({ amount: v, currency: bucket.currency }, locale);

        return (
          <div
            key={bucket.currency}
            data-testid={`salary-card-${bucket.currency}`}
            className="bg-card ring-foreground/[0.04] relative overflow-hidden rounded-2xl border p-4 shadow-sm ring-1"
          >
            <div className="flex items-center justify-between">
              <span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tracking-wide">
                {bucket.currency}
              </span>
              <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-xl">
                <Wallet className="size-4.5" aria-hidden />
              </span>
            </div>

            <p className="text-muted-foreground mt-3 text-xs font-medium">{t("rangePayable")}</p>
            <p className="text-2xl font-extrabold tracking-tight tabular-nums">
              {fmt(bucket.net_minor)}
            </p>

            {/* What the total is MADE OF. A salary you cannot decompose is a salary you cannot
                defend to the person receiving it. */}
            <dl className="mt-3 grid grid-cols-3 gap-2 border-t pt-3 text-xs">
              <div>
                <dt className="text-muted-foreground flex items-center gap-1">
                  <Clock3 className="size-3" aria-hidden />
                  {t("rangeLessons")}
                </dt>
                <dd className="mt-0.5 font-semibold tabular-nums">{fmt(bucket.lessons_minor)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground flex items-center gap-1">
                  <BadgePlus className="size-3" aria-hidden />
                  {t("rangeRewards")}
                </dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {fmt(bucket.rewards_minor)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground flex items-center gap-1">
                  <BadgeMinus className="size-3" aria-hidden />
                  {t("rangeDeductions")}
                </dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-red-600 dark:text-red-400">
                  {fmt(bucket.deductions_minor)}
                </dd>
              </div>
            </dl>

            <p className="text-muted-foreground mt-2.5 flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1">
                <Users className="size-3" aria-hidden />
                {t("rangeTeachers", { count: bucket.teachers })}
              </span>
              <span aria-hidden>·</span>
              <span>{t("rangeTaught", { hours: formatHours(bucket.minutes, locale) })}</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ── Per-teacher salaries for the window ────────────────────────────────────────

/**
 * Who gets paid what, for the window.
 *
 * Deliberately NOT the statements table below it: a row here is a teacher summed across whatever
 * monthly statements the window cuts through, which is the question "pay everyone for the 10th to
 * the 24th" actually asks. The statements table stays as the place you open one to see its lessons
 * or finalize it.
 */
function SalaryByTeacher({
  range,
  loading,
}: {
  range: PayrollRange | null;
  loading: boolean;
}) {
  const t = useTranslations("payroll");
  const locale = useLocale();

  if (loading || range === null || range.teachers.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Users className="text-primary size-4" aria-hidden />
        <h2 className="text-sm font-semibold">{t("rangeByTeacher")}</h2>
        <span className="text-muted-foreground text-xs">{t("rangeByTeacherHint")}</span>
      </div>

      <div className="bg-card overflow-x-auto rounded-2xl border shadow-sm">
        <table className="w-full text-sm" data-testid="salary-by-teacher">
          <thead className="text-muted-foreground bg-muted/40 text-xs">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{t("colTeacher")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("rangeTaughtShort")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("rangeLessons")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("rangeRewards")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("rangeDeductions")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("rangePayable")}</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {range.teachers.map((row) => {
              const fmt = (v: number) => formatMoney({ amount: v, currency: row.currency }, locale);

              return (
                <tr key={`${row.teacher_id}-${row.currency}`} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                        {initials(row.teacher_name)}
                      </span>
                      <span className="font-medium">{row.teacher_name ?? "—"}</span>
                      {/* An open statement means this number can still move before payday. */}
                      {row.has_open && (
                        <span className="bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 rounded-full px-2 py-0.5 text-[11px] font-medium">
                          {t("status.OPEN")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-muted-foreground px-4 py-2.5 text-end tabular-nums">
                    {formatHours(row.minutes, locale)}
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{fmt(row.lessons_minor)}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums text-emerald-600 dark:text-emerald-400">
                    {row.rewards_minor > 0 ? fmt(row.rewards_minor) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums text-red-600 dark:text-red-400">
                    {row.deductions_minor > 0 ? fmt(row.deductions_minor) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-end font-bold tabular-nums">
                    {fmt(row.net_minor)}
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

// ── Screen ─────────────────────────────────────────────────────────────────────

/**
 * Premium payroll dashboard (Sprint 8+). Owners (payout.read) see all teachers' payouts, the
 * per-currency profit summary, the period-finalize action, and can add rewards/deductions to
 * open statements. Teachers (payout.read_own) see only their own statements. The API enforces
 * both scopes for real.
 */
export function PayrollScreen() {
  const t = useTranslations("payroll");
  const locale = useLocale();
  const { can } = useAuth();

  const isOwner = can("payout.read");
  const isTeacher = !isOwner && can("payout.read_own");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  // ONE control drives the whole page: the window. It feeds the salary figures exactly (they are
  // re-added from lessons and adjustments by date) and the statements table by overlap (a payout
  // is a month, so it is "in" a window it touches).
  const [{ from, to }, setRange] = useState(defaultRange);
  const [range, setRangeData] = useState<PayrollRange | null>(null);
  const [rangeLoading, setRangeLoading] = useState(true);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const refreshAll = useCallback(() => setRefreshToken((n) => n + 1), []);

  useEffect(() => {
    if (!isOwner || from === "" || to === "" || from > to) return;
    let cancelled = false;
    setRangeLoading(true);
    getPayrollRange(from, to)
      .then((res) => {
        if (!cancelled) setRangeData(res);
      })
      .catch(() => {
        if (!cancelled) setRangeData(null);
      })
      .finally(() => {
        if (!cancelled) setRangeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, isOwner, refreshToken]);

  const fetcher = useCallback(
    (q: DataTableQuery): Promise<ListResult<PayoutRow>> => {
      const merged: DataTableQuery = {
        ...q,
        filter: {
          ...(q.filter ?? {}),
          ...(from ? { period_from: monthOf(from) } : {}),
          ...(to ? { period_to: monthOf(to) } : {}),
        },
      };
      const base = isOwner ? "/api/payouts" : "/api/me/payouts";
      return apiFetch(`${base}${toQueryString(merged)}`);
    },
    [from, to, isOwner],
  );

  if (!isOwner && !isTeacher) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const columns: ColumnDef<PayoutRow>[] = [
    ...(isOwner
      ? [
          {
            key: "teacher",
            header: t("colTeacher"),
            sortKey: "teacher_name",
            render: (row: PayoutRow) => (
              <div className="flex items-center gap-2.5">
                <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                  {initials(row.teacher_name)}
                </span>
                <span className="font-medium">{row.teacher_name ?? "—"}</span>
              </div>
            ),
          } satisfies ColumnDef<PayoutRow>,
        ]
      : []),
    {
      key: "status",
      header: t("colStatus"),
      render: (row) => <PayoutStatusBadge status={row.status} />,
    },
    {
      key: "total",
      header: t("colTotal"),
      sortKey: "total_minor",
      className: "text-end",
      render: (row) => (
        <span
          className={cn(
            "font-bold tabular-nums",
            row.total_minor < 0 && "text-red-600 dark:text-red-400",
          )}
        >
          {formatMoney({ amount: row.total_minor, currency: row.currency }, locale)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-end",
      render: (row) => (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedId(row.id);
          }}
        >
          {t("view")}
        </Button>
      ),
    },
  ];

  const exportColumns: ExcelColumn<PayoutRow>[] = [
    ...(isOwner
      ? [
          {
            header: t("colTeacher"),
            value: (row: PayoutRow) => row.teacher_name ?? "",
            width: 24,
          } satisfies ExcelColumn<PayoutRow>,
        ]
      : []),
    {
      header: t("colPeriod"),
      value: (row) =>
        `${String(row.period_month).padStart(2, "0")}/${row.period_year}`,
    },
    { header: t("colStatus"), value: (row) => t(`status.${row.status}`) },
    {
      header: t("colTotal"),
      value: (row) =>
        formatMoney({ amount: row.total_minor, currency: row.currency }, locale),
    },
  ];

  const statusFilter: FilterDef = {
    key: "status",
    label: t("filterStatus"),
    options: [
      { value: "OPEN", label: t("status.OPEN") },
      { value: "FINALIZED", label: t("status.FINALIZED") },
    ],
  };

  const inputClass =
    "border-input bg-background focus:border-primary focus:ring-primary/15 h-8 rounded-lg border px-3 text-sm outline-none transition-colors focus:ring-3";

  return (
    <div className="space-y-5">
      <PageHero
        latticeId="payroll-hero-lattice"
        icon={Wallet}
        title={t("title")}
        subtitle={isOwner ? t("subtitle") : t("subtitleTeacher")}
        actions={
          isOwner && can("payout.finalize") ? (
            <Button
              type="button"
              size="lg"
              onClick={() => setFinalizeOpen(true)}
              className="gap-2 border-transparent bg-white px-4 text-emerald-800 shadow-md hover:bg-white/90"
            >
              <Lock className="size-4" aria-hidden />
              {t("finalizePeriod")}
            </Button>
          ) : undefined
        }
      />

      {flash && (
        <AlertBanner
          variant="success"
          message={flash}
          onDismiss={() => setFlash(null)}
        />
      )}

      {/* ── The window ──────────────────────────────────────────────────
          Two dates, not a month dropdown: an academy pays for a period it chooses (the 26th to the
          25th, a fortnight, a single week of cover) and a month picker cannot express any of it. */}
      <div className="bg-card flex flex-wrap items-end gap-3 rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <CalendarRange className="text-primary size-4" aria-hidden />
          <span className="text-sm font-semibold">{t("rangeTitle")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            <span className="text-muted-foreground">{t("rangeFrom")}</span>
            <input
              type="date"
              value={from}
              max={to || undefined}
              aria-label={t("rangeFrom")}
              data-testid="range-from"
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs font-medium">
            <span className="text-muted-foreground">{t("rangeTo")}</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              aria-label={t("rangeTo")}
              data-testid="range-to"
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className={inputClass}
            />
          </label>
        </div>
        <div className="ms-auto flex flex-wrap gap-1.5">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => setRange(preset.build())}
              className="text-muted-foreground hover:bg-muted/60 hover:text-foreground rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors"
            >
              {t(`rangePreset.${preset.key}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Salary figures for exactly that window — owner only */}
      {isOwner && <SalarySummaryPanel range={range} loading={rangeLoading} />}
      {isOwner && <SalaryByTeacher range={range} loading={rangeLoading} />}

      {/* The monthly statements the window touches — the place you open one or finalize it. */}
      <div className="flex items-center gap-2">
        <Lock className="text-primary size-4" aria-hidden />
        <h2 className="text-sm font-semibold">{t("statementsTitle")}</h2>
        <span className="text-muted-foreground text-xs">{t("statementsHint")}</span>
      </div>

      <DataTable<PayoutRow>
        fetcher={fetcher}
        columns={columns}
        getRowId={(row) => row.id}
        filters={isOwner ? [statusFilter] : []}
        defaultSort="-period"
        onRowClick={(row) => setSelectedId(row.id)}
        emptyMessage={t("empty")}
        testId="payouts-table"
        exportConfig={{
          fileName: "payroll",
          sheetName: t("title"),
          columns: exportColumns,
        }}
        refreshToken={refreshToken}
      />

      <PayoutDetailModal
        payoutId={selectedId}
        onClose={() => setSelectedId(null)}
        onMutated={refreshAll}
      />

      {isOwner && (
        <FinalizePeriodModal
          open={finalizeOpen}
          // Finalizing is still a MONTH operation — a statement is a month — so it defaults to the
          // month the window ends in rather than pretending it can close an arbitrary span.
          defaultYear={to ? Number(to.slice(0, 4)) : undefined}
          defaultMonth={to ? Number(to.slice(5, 7)) : undefined}
          onClose={() => setFinalizeOpen(false)}
          onSuccess={(finalized, period) => {
            setFinalizeOpen(false);
            setFlash(t("finalizeSuccess", { count: finalized, period }));
            refreshAll();
          }}
        />
      )}
    </div>
  );
}

/** Two-letter initials for the teacher avatar chip. */
function initials(name?: string | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "").concat(parts[1]?.[0] ?? "").toUpperCase() || "—";
}
