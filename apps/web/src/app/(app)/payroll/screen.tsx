"use client";

import {
  BadgeMinus,
  BadgePlus,
  CalendarCheck,
  CalendarRange,
  ChevronLeft,
  Clock3,
  FileSpreadsheet,
  FileText,
  Loader2,
  Search,
  Send,
  Users,
  Wallet,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { PayoutDetailModal } from "@/components/payroll/payout-detail-modal";
import { PayoutTransferCell, transferState } from "@/components/payroll/payout-transfer-cell";
import {
  TeacherRangeLessonsModal,
  type TeacherRangeTarget,
} from "@/components/payroll/teacher-range-lessons-modal";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import {
  ApiError,
  apiFetch,
  getPayrollRange,
  toQueryString,
  type DataTableQuery,
  type ListResult,
  type PayoutRow,
  type PayrollRange,
  type PayrollRangeTeacher,
} from "@/lib/api";
import { avatarTone } from "@/lib/avatar";
import { exportRowsToExcel, type ExcelColumn } from "@/lib/export-excel";
import { formatMoney, formatNumber } from "@/lib/money";
import { searchMatches } from "@/lib/search-fold";
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
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${STATUS_STYLES[status]}`}
    >
      <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
      {t(`status.${status}`)}
    </span>
  );
}

/** `MM/YYYY` — the month a statement is for. */
const periodLabel = (row: PayoutRow) => `${String(row.period_month).padStart(2, "0")}/${row.period_year}`;

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

// ── Where a teacher's money stands ─────────────────────────────────────────────

type TeacherTransfer = "PENDING" | "DONE" | "NONE";

/**
 * A teacher is waiting while any statement on their row is waiting, and paid once every statement
 * that owes something has gone out. A row with nothing owed is neither.
 */
function teacherTransfer(row: PayrollRangeTeacher): TeacherTransfer {
  const states = row.statements.map(transferState).filter((s) => s !== "NOTHING_DUE");
  if (states.length === 0) return "NONE";
  return states.includes("PENDING") ? "PENDING" : "DONE";
}

/** The row taught, earned or was adjusted in the window — not only reachable through a statement. */
const earnedInWindow = (row: PayrollRangeTeacher) =>
  row.sessions > 0 ||
  row.base_minor !== 0 ||
  row.lessons_minor !== 0 ||
  row.rewards_minor !== 0 ||
  row.deductions_minor !== 0;

// ── Stat cards (owner only) ────────────────────────────────────────────────────

const STAT_GRID: Record<number, string> = {
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
};

/**
 * What the window costs, as slim coloured cards (the look Ahmed settled on for Due, 2026-11-22):
 * the total owed, what it is made of, and how many teachers have had their money. Each money card
 * lists every currency side by side, never summed (§3.6).
 */
function PayrollStats({ range, loading }: { range: PayrollRange | null; loading: boolean }) {
  const t = useTranslations("payroll");
  const locale = useLocale();

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="bg-card h-[58px] animate-pulse rounded-xl border shadow-sm" />
        ))}
      </div>
    );
  }

  // An empty period keeps the cards where they are, at "—": a big empty box at the top of the page
  // read as broken. Saying the period is empty is the table's job, below the dates.
  if (range === null || range.currencies.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" data-testid="payroll-stats">
        <StatCard tone="emerald" icon={Wallet} label={t("rangePayable")} values={["—"]} testId="payroll-stat-payable" />
        <StatCard tone="sky" icon={Clock3} label={t("rangeLessons")} values={["—"]} testId="payroll-stat-lessons" />
        <StatCard tone="violet" icon={BadgePlus} label={t("rangeRewards")} values={["—"]} testId="payroll-stat-rewards" />
        <StatCard tone="rose" icon={BadgeMinus} label={t("rangeDeductions")} values={["—"]} testId="payroll-stat-deductions" />
      </div>
    );
  }

  const buckets = range.currencies;
  const money = (pick: (b: (typeof buckets)[number]) => number, skipZero = false) => {
    const values = buckets
      .filter((b) => !skipZero || pick(b) !== 0)
      .map((b) => formatMoney({ amount: pick(b), currency: b.currency }, locale));
    return values.length > 0 ? values : ["—"];
  };

  const teachers = new Set(range.teachers.filter(earnedInWindow).map((r) => r.teacher_id)).size;
  const minutes = buckets.reduce((sum, b) => sum + b.minutes, 0);
  const anyFixed = buckets.some((b) => b.base_minor > 0);

  const states = range.teachers.map(teacherTransfer).filter((s) => s !== "NONE");
  const sent = states.filter((s) => s === "DONE").length;
  const waiting = states.length - sent;

  const cards = 4 + (anyFixed ? 1 : 0) + (states.length > 0 ? 1 : 0);

  return (
    <div className={cn("grid grid-cols-2 gap-2.5", STAT_GRID[cards])} data-testid="payroll-stats">
      <StatCard
        tone="emerald"
        icon={Wallet}
        label={t("rangePayable")}
        values={money((b) => b.net_minor)}
        hint={t("rangeTeachers", { count: teachers })}
        testId="payroll-stat-payable"
      />
      <StatCard
        tone="sky"
        icon={Clock3}
        label={t("rangeLessons")}
        values={money((b) => b.lessons_minor)}
        hint={t("rangeTaught", { hours: formatHours(minutes, locale) })}
        testId="payroll-stat-lessons"
      />
      {anyFixed && (
        <StatCard
          tone="sky"
          icon={CalendarCheck}
          label={t("rangeFixed")}
          values={money((b) => b.base_minor, true)}
          testId="payroll-stat-fixed"
        />
      )}
      <StatCard
        tone="violet"
        icon={BadgePlus}
        label={t("rangeRewards")}
        values={money((b) => b.rewards_minor, true)}
        testId="payroll-stat-rewards"
      />
      <StatCard
        tone="rose"
        icon={BadgeMinus}
        label={t("rangeDeductions")}
        values={money((b) => b.deductions_minor, true)}
        testId="payroll-stat-deductions"
      />
      {states.length > 0 && (
        <StatCard
          tone="amber"
          icon={Send}
          label={t("transferDone")}
          values={[t("statTransferred", { sent: formatNumber(sent, locale), total: formatNumber(states.length, locale) })]}
          hint={waiting > 0 ? t("statWaiting", { count: formatNumber(waiting, locale) }) : undefined}
          testId="payroll-stat-transfer"
        />
      )}
    </div>
  );
}

// ── One table for the teachers ─────────────────────────────────────────────────

const HEAD = "px-3 py-2 text-start text-[11px] font-semibold whitespace-nowrap";
const CELL = "px-3 py-2 whitespace-nowrap";

const TRANSFER_VIEWS = ["ALL", "PENDING", "DONE"] as const;
type TransferView = (typeof TRANSFER_VIEWS)[number];

/** Filter badges in colour (Ahmed 2026-11-22): a soft tint at rest, filled when applied. */
const BADGE_TONES = {
  sky: { rest: "border-sky-200 bg-sky-500/10 text-sky-700 hover:bg-sky-500/15 dark:border-sky-900/60 dark:text-sky-300", on: "border-sky-600 bg-sky-600 text-white" },
  violet: { rest: "border-violet-200 bg-violet-500/10 text-violet-700 hover:bg-violet-500/15 dark:border-violet-900/60 dark:text-violet-300", on: "border-violet-600 bg-violet-600 text-white" },
  amber: { rest: "border-amber-200 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:border-amber-900/60 dark:text-amber-300", on: "border-amber-500 bg-amber-500 text-white" },
  emerald: { rest: "border-emerald-200 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:border-emerald-900/60 dark:text-emerald-300", on: "border-emerald-600 bg-emerald-600 text-white" },
  slate: { rest: "border-slate-200 bg-slate-500/10 text-slate-700 hover:bg-slate-500/15 dark:border-slate-700 dark:text-slate-300", on: "border-slate-700 bg-slate-700 text-white dark:border-slate-500 dark:bg-slate-500" },
} as const;

type BadgeTone = keyof typeof BADGE_TONES;

function Badge({
  tone,
  active,
  onClick,
  testId,
  children,
}: {
  tone: BadgeTone;
  active: boolean;
  onClick: () => void;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors",
        active ? cn(BADGE_TONES[tone].on, "shadow-sm") : BADGE_TONES[tone].rest,
      )}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

const TRANSFER_VIEW_TONE: Record<TransferView, BadgeTone> = { ALL: "slate", PENDING: "amber", DONE: "emerald" };

const PRESET_TONE: Record<string, BadgeTone> = { thisMonth: "sky", lastMonth: "violet", last30: "amber" };

function Avatar({ name }: { name: string | null }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
        avatarTone(name ?? "—"),
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/**
 * The month and whether it is still open — what a statement line opens with. The statement's own
 * total joins them only when it is not the payable figure already on the row (a window that cuts a
 * month, or two months on one row): that total is what the transfer switch is about.
 */
function StatementTag({ statement, row }: { statement: PayoutRow; row: PayrollRangeTeacher }) {
  const locale = useLocale();
  const showTotal = row.statements.length > 1 || statement.total_minor !== row.net_minor;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground text-xs tabular-nums">{periodLabel(statement)}</span>
      <PayoutStatusBadge status={statement.status} />
      {showTotal && (
        <span className="text-xs font-semibold tabular-nums" data-testid={`statement-total-${statement.id}`}>
          {formatMoney({ amount: statement.total_minor, currency: statement.currency }, locale)}
        </span>
      )}
    </span>
  );
}

/**
 * Every teacher once (Ahmed 2026-11-22: "the teachers section at the top and the one at the bottom
 * should be one section"). The page used to show the window's figures in one table and the monthly
 * statements in a second one further down, with the same names in both and nothing saying why.
 *
 * Now a row is a teacher: what they taught and earn in the window, then the statement(s) the window
 * touches with their transfer switch and the button that opens them. A window inside one month (the
 * default) gives one statement per teacher, so one line; a window across two months gives the
 * teacher two statement lines beside the same figures. Tapping the teacher opens the lessons behind
 * the figures, where they can be corrected.
 */
function TeacherSalaries({
  range,
  loading,
  busy,
  canMark,
  onOpenStatement,
  onMutated,
}: {
  range: PayrollRange | null;
  loading: boolean;
  busy: boolean;
  canMark: boolean;
  onOpenStatement: (id: string) => void;
  onMutated: () => void;
}) {
  const t = useTranslations("payroll");
  const locale = useLocale();
  const [opened, setOpened] = useState<TeacherRangeTarget | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<TransferView>("ALL");
  const [exporting, setExporting] = useState(false);
  const tTable = useTranslations("datatable");
  const closeLessons = useCallback(() => setOpened(null), []);

  // The table is always on the page, headers and all (Ahmed 2026-11-22: "why isn't the salaries
  // table showing even with no data"). Loading, an empty period or a failed load is a line in it.
  const all = range?.teachers ?? [];
  const dates = range ? { from: range.from, to: range.to } : null;

  const counts: Record<TransferView, number> = {
    ALL: all.length,
    PENDING: all.filter((r) => teacherTransfer(r) === "PENDING").length,
    DONE: all.filter((r) => teacherTransfer(r) === "DONE").length,
  };

  // Find one teacher among many by name, Arabic-forgiving (Lingo 2026-11-15).
  const teachers = all.filter(
    (row) =>
      searchMatches(row.teacher_name ?? "", query) &&
      (view === "ALL" || teacherTransfer(row) === view),
  );

  // The fixed-salary column only earns its width when somebody in the window is on a salary.
  const anyFixed = all.some((row) => row.base_minor > 0);

  // What the table says when it has no rows: why, in the owner's words.
  const emptyText =
    range === null ? "—" : all.length === 0 ? t("rangeEmpty") : query ? t("searchNoTeacher") : t("transferViewEmpty");
  const columnCount = anyFixed ? 10 : 9;

  const open = (row: PayrollRangeTeacher) =>
    setOpened({ teacherId: row.teacher_id, teacherName: row.teacher_name, currency: row.currency });

  const transferWords = (s: PayoutRow) =>
    ({
      DONE: t("transferDone"),
      TREASURY: t("transferTreasury"),
      PENDING: t("transferPending"),
      NOTHING_DUE: "",
    })[transferState(s)];

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    const fmt = (row: PayrollRangeTeacher, v: number) => formatMoney({ amount: v, currency: row.currency }, locale);
    const columns: ExcelColumn<PayrollRangeTeacher>[] = [
      { header: t("colTeacher"), value: (row) => row.teacher_name ?? "", width: 24 },
      { header: t("rangeTaughtShort"), value: (row) => formatHours(row.minutes, locale), width: 12 },
      ...(anyFixed
        ? [{ header: t("rangeFixed"), value: (row: PayrollRangeTeacher) => fmt(row, row.base_minor) }]
        : []),
      { header: t("rangeLessons"), value: (row) => fmt(row, row.lessons_minor) },
      { header: t("rangeRewards"), value: (row) => fmt(row, row.rewards_minor) },
      { header: t("rangeDeductions"), value: (row) => fmt(row, row.deductions_minor) },
      { header: t("rangePayable"), value: (row) => fmt(row, row.net_minor) },
      {
        header: t("colStatement"),
        value: (row) =>
          row.statements.map((s) => `${periodLabel(s)} ${t(`status.${s.status}`)}`).join(" / "),
        width: 26,
      },
      {
        header: t("colTransfer"),
        value: (row) => row.statements.map(transferWords).filter(Boolean).join(" / "),
        width: 26,
      },
    ];
    try {
      await exportRowsToExcel({
        fileName: dates ? `payroll-${dates.from}-${dates.to}` : "payroll",
        sheetName: t("title"),
        columns,
        rows: teachers,
        rightToLeft: locale === "ar",
      });
    } finally {
      setExporting(false);
    }
  }

  /** The statement controls for one line: the month, the transfer switch, the button. */
  const statementCells = (row: PayrollRangeTeacher, s: PayoutRow | undefined, first: boolean) => (
    <>
      <td className={cn(CELL, !first && "border-t border-dashed border-border/60")}>
        {s ? <StatementTag statement={s} row={row} /> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className={cn("px-3 py-2", !first && "border-t border-dashed border-border/60")}>
        {s && <PayoutTransferCell row={s} canMark={canMark} onChanged={onMutated} />}
      </td>
      <td className={cn(CELL, "pe-4 text-end", !first && "border-t border-dashed border-border/60")}>
        {s && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="gap-1"
            onClick={(e) => {
              e.stopPropagation();
              onOpenStatement(s.id);
            }}
            data-testid={`open-statement-${s.id}`}
          >
            <FileText aria-hidden />
            {t("openStatement")}
          </Button>
        )}
      </td>
    </>
  );

  return (
    <section className="space-y-3" data-testid="teacher-salaries">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="text-primary size-4" aria-hidden />
        <h2 className="text-sm font-semibold">{t("teachersTitle")}</h2>
        <span className="text-muted-foreground text-xs">{t("teachersHint")}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("colTransfer")}>
          {TRANSFER_VIEWS.map((key) => (
            <Badge
              key={key}
              tone={TRANSFER_VIEW_TONE[key]}
              active={view === key}
              onClick={() => setView(key)}
              testId={`transfer-view-${key}`}
            >
              {t(`transferView.${key}`)}
              <span className={cn("tabular-nums", view === key ? "text-white/80" : "opacity-70")}>
                {formatNumber(counts[key], locale)}
              </span>
            </Badge>
          ))}
        </div>
        <div className="relative ms-auto w-full sm:w-64">
          <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchTeacher")}
            aria-label={t("searchTeacher")}
            className="border-input bg-background placeholder:text-muted-foreground focus:border-primary w-full rounded-lg border py-1.5 ps-9 pe-3 text-sm outline-none"
            data-testid="salary-search"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleExport()}
          disabled={exporting || teachers.length === 0}
          className="bg-card gap-1.5 shadow-sm"
          data-testid="salary-export"
        >
          {exporting ? <Loader2 className="animate-spin" aria-hidden /> : <FileSpreadsheet aria-hidden />}
          {tTable("export")}
        </Button>
      </div>

      <div className={cn("transition-opacity", busy && "opacity-60")}>
        {/* Phones and tablets: one card per teacher — nine columns do not fit, and a salary is read
            teacher by teacher anyway. The figures open the lessons; the statements sit under them. */}
        {teachers.length === 0 && (
          <div
            className="bg-card text-muted-foreground rounded-xl border border-dashed px-4 py-8 text-center text-sm lg:hidden"
            aria-busy={loading || undefined}
          >
            {loading ? t("loading") : emptyText}
          </div>
        )}
        {teachers.length > 0 && (
          <ul className="space-y-2 lg:hidden">
            {teachers.map((row) => {
              const fmt = (v: number) => formatMoney({ amount: v, currency: row.currency }, locale);
              return (
                <li
                  key={`${row.teacher_id}-${row.currency}`}
                  className="bg-card overflow-hidden rounded-xl border text-sm shadow-sm"
                  data-testid={`salary-card-${row.teacher_id}`}
                >
                  <button
                    type="button"
                    onClick={() => open(row)}
                    aria-label={t("rangeLessonsTitle", { name: row.teacher_name ?? "—" })}
                    className="active:bg-muted/30 focus-visible:ring-ring/60 block w-full text-start outline-none focus-visible:ring-2"
                  >
                    <div className="from-primary/[0.07] flex items-center gap-2.5 border-b bg-gradient-to-l to-transparent px-4 py-2.5">
                      <Avatar name={row.teacher_name} />
                      <span className="min-w-0 flex-1 truncate font-medium">{row.teacher_name ?? "—"}</span>
                      <span className="text-primary inline-flex shrink-0 items-center text-[11px] font-semibold">
                        {t("lessonsLink")}
                        <ChevronLeft className="size-3.5 ltr:rotate-180" aria-hidden />
                      </span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-2.5 text-xs">
                      {row.base_minor > 0 && (
                        <div className="col-span-2 min-w-0">
                          <dt className="text-muted-foreground">{t("rangeFixed")}</dt>
                          <dd className="mt-0.5 font-medium break-words tabular-nums">{fmt(row.base_minor)}</dd>
                        </div>
                      )}
                      <div className="min-w-0">
                        <dt className="text-muted-foreground">{t("rangeTaughtShort")}</dt>
                        <dd className="mt-0.5 font-medium tabular-nums">{formatHours(row.minutes, locale)}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-muted-foreground">{t("rangeLessons")}</dt>
                        <dd className="mt-0.5 font-medium break-words tabular-nums">{fmt(row.lessons_minor)}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-muted-foreground">{t("rangeRewards")}</dt>
                        <dd className="mt-0.5 font-medium break-words text-emerald-600 tabular-nums dark:text-emerald-400">
                          {row.rewards_minor > 0 ? fmt(row.rewards_minor) : "—"}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-muted-foreground">{t("rangeDeductions")}</dt>
                        <dd className="mt-0.5 font-medium break-words text-red-600 tabular-nums dark:text-red-400">
                          {row.deductions_minor > 0 ? fmt(row.deductions_minor) : "—"}
                        </dd>
                      </div>
                    </dl>
                    <div className="bg-muted/25 flex items-center justify-between gap-3 border-t px-4 py-2">
                      <span className="text-muted-foreground text-xs">{t("rangePayable")}</span>
                      <span className="font-bold break-words tabular-nums">{fmt(row.net_minor)}</span>
                    </div>
                  </button>
                  {row.statements.map((s) => (
                    <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-2.5">
                      <StatementTag statement={s} row={row} />
                      <div className="min-w-0 flex-1">
                        <PayoutTransferCell row={s} canMark={canMark} onChanged={onMutated} />
                      </div>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        className="gap-1"
                        onClick={() => onOpenStatement(s.id)}
                      >
                        <FileText aria-hidden />
                        {t("openStatement")}
                      </Button>
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        )}

        {/* Laptop and up: a compact coloured table, one line per teacher (two when the window
            crosses a month, one per statement, the figures spanning both). */}
        <div className="bg-card hidden overflow-hidden rounded-xl border shadow-sm lg:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" data-testid="salary-by-teacher">
                <thead>
                  <tr className="from-primary/[0.09] via-primary/[0.035] text-muted-foreground border-b bg-gradient-to-l to-transparent">
                    <th className={cn(HEAD, "ps-4")}>{t("colTeacher")}</th>
                    <th className={cn(HEAD, "text-end")}>{t("rangeTaughtShort")}</th>
                    {anyFixed && <th className={cn(HEAD, "text-end")}>{t("rangeFixed")}</th>}
                    <th className={cn(HEAD, "text-end")}>{t("rangeLessons")}</th>
                    <th className={cn(HEAD, "text-end")}>{t("rangeRewards")}</th>
                    <th className={cn(HEAD, "text-end")}>{t("rangeDeductions")}</th>
                    <th className={cn(HEAD, "text-end")}>{t("rangePayable")}</th>
                    <th className={HEAD}>{t("colStatement")}</th>
                    <th className={HEAD}>{t("colTransfer")}</th>
                    <th className={cn(HEAD, "pe-4")}>
                      <span className="sr-only">{t("openStatement")}</span>
                    </th>
                  </tr>
                </thead>
                {teachers.length === 0 && (
                  <tbody>
                    {loading ? (
                      Array.from({ length: 3 }, (_, i) => (
                        <tr key={i} className={cn(i > 0 && "border-t border-border/60")} aria-hidden>
                          <td colSpan={columnCount} className="px-4 py-3">
                            <div className="bg-muted h-4 animate-pulse rounded" />
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={columnCount} className="px-4 py-10 text-center" data-testid="salary-empty">
                          <CalendarRange className="text-muted-foreground/60 mx-auto mb-2 size-6" aria-hidden />
                          <p className="text-muted-foreground text-sm">{emptyText}</p>
                          {range !== null && all.length === 0 && (
                            <p className="text-muted-foreground mt-1 text-xs">{t("rangeEmptyHint")}</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                )}
                {teachers.map((row, i) => {
                  const fmt = (v: number) => formatMoney({ amount: v, currency: row.currency }, locale);
                  const span = Math.max(1, row.statements.length);
                  const [first, ...rest] = row.statements;
                  return (
                    <tbody
                      key={`${row.teacher_id}-${row.currency}`}
                      className={cn(
                        "hover:bg-primary/[0.04] cursor-pointer transition-colors",
                        i > 0 && "border-t border-border/60",
                        i % 2 === 1 && "bg-muted/30",
                      )}
                      data-testid={`salary-row-${row.teacher_id}`}
                    >
                      <tr onClick={() => open(row)}>
                        <td rowSpan={span} className={cn(CELL, "ps-4")}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              open(row);
                            }}
                            aria-label={t("rangeLessonsTitle", { name: row.teacher_name ?? "—" })}
                            className="focus-visible:ring-ring/60 flex items-center gap-2.5 rounded-md text-start outline-none focus-visible:ring-2"
                          >
                            <Avatar name={row.teacher_name} />
                            <span className="font-medium hover:underline">{row.teacher_name ?? "—"}</span>
                          </button>
                        </td>
                        <td rowSpan={span} className={cn(CELL, "text-muted-foreground text-end tabular-nums")}>
                          {formatHours(row.minutes, locale)}
                        </td>
                        {anyFixed && (
                          <td rowSpan={span} className={cn(CELL, "text-end tabular-nums")}>
                            {row.base_minor > 0 ? fmt(row.base_minor) : "—"}
                          </td>
                        )}
                        <td rowSpan={span} className={cn(CELL, "text-end tabular-nums")}>
                          {fmt(row.lessons_minor)}
                        </td>
                        <td rowSpan={span} className={cn(CELL, "text-end text-emerald-600 tabular-nums dark:text-emerald-400")}>
                          {row.rewards_minor > 0 ? fmt(row.rewards_minor) : "—"}
                        </td>
                        <td rowSpan={span} className={cn(CELL, "text-end text-red-600 tabular-nums dark:text-red-400")}>
                          {row.deductions_minor > 0 ? fmt(row.deductions_minor) : "—"}
                        </td>
                        <td rowSpan={span} className={cn(CELL, "text-end font-bold tabular-nums")}>
                          {fmt(row.net_minor)}
                        </td>
                        {statementCells(row, first, true)}
                      </tr>
                      {rest.map((s) => (
                        <tr key={s.id} onClick={() => open(row)}>
                          {statementCells(row, s, false)}
                        </tr>
                      ))}
                    </tbody>
                  );
                })}
              </table>
            </div>
          </div>
      </div>

      <TeacherRangeLessonsModal
        target={opened}
        from={range?.from ?? ""}
        to={range?.to ?? ""}
        onClose={closeLessons}
        onMutated={onMutated}
      />
    </section>
  );
}

// ── A teacher's own statements ─────────────────────────────────────────────────

/** A teacher (payout.read_own) sees only their own monthly statements, by the months the window touches. */
function OwnStatements({
  from,
  to,
  onOpen,
  refreshToken,
}: {
  from: string;
  to: string;
  onOpen: (id: string) => void;
  refreshToken: number;
}) {
  const t = useTranslations("payroll");
  const locale = useLocale();

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
      return apiFetch(`/api/me/payouts${toQueryString(merged)}`);
    },
    [from, to],
  );

  const columns: ColumnDef<PayoutRow>[] = [
    {
      key: "period",
      header: t("colPeriod"),
      sortKey: "period",
      render: (row) => <span className="tabular-nums">{periodLabel(row)}</span>,
    },
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
        <span className={cn("font-bold tabular-nums", row.total_minor < 0 && "text-red-600 dark:text-red-400")}>
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
            onOpen(row.id);
          }}
        >
          {t("view")}
        </Button>
      ),
    },
  ];

  return (
    <DataTable<PayoutRow>
      fetcher={fetcher}
      columns={columns}
      getRowId={(row) => row.id}
      defaultSort="-period"
      onRowClick={(row) => onOpen(row.id)}
      emptyMessage={t("empty")}
      testId="payouts-table"
      refreshToken={refreshToken}
    />
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

/**
 * The salaries page. Owners (payout.read) get, top to bottom: the window, what it costs, and ONE
 * table of teachers that is also where each month's statement is opened, ticked as transferred and
 * corrected. Teachers (payout.read_own) see only their own statements. The API enforces both scopes.
 */
export function PayrollScreen() {
  const t = useTranslations("payroll");
  const { can } = useAuth();

  const isOwner = can("payout.read");
  const isTeacher = !isOwner && can("payout.read_own");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  // ONE control drives the whole page: the window. It feeds the salary figures exactly (they are
  // re-added from lessons and adjustments by date) and the statements by overlap (a payout is a
  // month, so it is "in" a window it touches).
  const [{ from, to }, setRange] = useState(defaultRange);
  const [range, setRangeData] = useState<PayrollRange | null>(null);
  const [fetching, setFetching] = useState(true);
  // A failed load says so, instead of passing for "no lessons in this period".
  const [loadError, setLoadError] = useState<string | null>(null);
  // A reload can outrun the previous one (a fast change of dates); only the newest lands.
  const seq = useRef(0);

  const refreshAll = useCallback(() => setRefreshToken((n) => n + 1), []);

  useEffect(() => {
    if (!isOwner || from === "" || to === "" || from > to) return;
    const current = ++seq.current;
    setFetching(true);
    getPayrollRange(from, to)
      .then((res) => {
        if (current !== seq.current) return;
        setRangeData(res);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (current !== seq.current) return;
        setRangeData(null);
        setLoadError(err instanceof ApiError ? err.message : t("loadError"));
      })
      .finally(() => {
        if (current === seq.current) setFetching(false);
      });
  }, [from, to, isOwner, refreshToken, t]);

  if (!isOwner && !isTeacher) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  // The skeleton only covers the first load. A reload (a tick, a correction, new dates) keeps the
  // figures on screen and dims them, so a switch never makes the table jump away under the cursor.
  const firstLoad = fetching && range === null;

  // The preset the dates match, if any, shows as the applied badge.
  const activePreset = RANGE_PRESETS.find((p) => {
    const r = p.build();
    return r.from === from && r.to === to;
  })?.key;

  const inputClass =
    "border-input bg-background focus:border-primary focus:ring-primary/15 h-8 rounded-lg border px-3 text-sm outline-none transition-colors focus:ring-3";

  return (
    <div className="space-y-4">
      {/* No hero banner (Ahmed 2026-11-22: "remove that header, put the stat cards in its place"):
          the page opens on what the period costs. The title stays for screen readers. */}
      <h1 className="sr-only">{t("title")}</h1>

      {isOwner && <PayrollStats range={range} loading={firstLoad} />}

      {isOwner && loadError && (
        <AlertBanner variant="error" message={loadError} onDismiss={() => setLoadError(null)} />
      )}

      {/* ── The window ──────────────────────────────────────────────────
          Two dates, not a month dropdown: an academy pays for a period it chooses (the 26th to the
          25th, a fortnight, a single week of cover) and a month picker cannot express any of it. */}
      <div className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 shadow-sm">
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
        <div className="ms-auto flex flex-wrap items-center gap-1.5">
          {RANGE_PRESETS.map((preset) => (
            <Badge
              key={preset.key}
              tone={PRESET_TONE[preset.key] ?? "sky"}
              active={activePreset === preset.key}
              onClick={() => setRange(preset.build())}
              testId={`range-preset-${preset.key}`}
            >
              {t(`rangePreset.${preset.key}`)}
            </Badge>
          ))}
        </div>
      </div>

      {isOwner && (
        <>
          <TeacherSalaries
            range={range}
            loading={firstLoad}
            busy={fetching}
            canMark={can("payout.adjust")}
            onOpenStatement={setSelectedId}
            onMutated={refreshAll}
          />
        </>
      )}

      {isTeacher && (
        <OwnStatements from={from} to={to} onOpen={setSelectedId} refreshToken={refreshToken} />
      )}

      <PayoutDetailModal
        payoutId={selectedId}
        onClose={() => setSelectedId(null)}
        onMutated={refreshAll}
      />
    </div>
  );
}

/** Two-letter initials for the teacher avatar chip. */
function initials(name?: string | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "").concat(parts[1]?.[0] ?? "").toUpperCase() || "—";
}
