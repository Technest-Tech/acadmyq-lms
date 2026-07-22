"use client";

import {
  Award,
  ClipboardCheck,
  ListChecks,
  Plus,
  TrendingDown,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { PercentBadge, ScopeBadge, ScoreRing, scoreTone } from "@/components/quality/quality-badges";
import { ReportComposer } from "@/components/quality/report-composer";
import { ReportDetailModal } from "@/components/quality/report-detail-modal";
import { RubricBuilder } from "@/components/quality/rubric-builder";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  getQualitySummary,
  listQualityReports,
  listTeachers,
  type QualityReportRow,
  type QualitySummary,
  type TeacherRow,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const YEARS = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);

type Tab = "reports" | "rubric";

/**
 * The Teacher Quality page.
 *
 * Two tabs, in the order the work happens: the REPORTS you write day to day, and the RUBRIC you
 * define once and rarely touch. The rubric is the setup step, so it must not be the landing tab —
 * but it is one click away, because an empty rubric makes the reports tab useless and the empty
 * state has to be able to send you there.
 */
export function QualityManager() {
  const t = useTranslations("quality");
  const locale = useLocale();
  const { can } = useAuth();

  const canManage = can("teacher_quality.manage");

  const now = new Date();
  const [tab, setTab] = useState<Tab>("reports");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  useEffect(() => {
    listTeachers({ pageSize: 200, sort: "name" })
      .then((res) => setTeachers(res.rows.filter((teacher) => teacher.is_active)))
      .catch(() => setTeachers([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    getQualitySummary(year, month)
      .then((res) => {
        if (!cancelled) setSummary(res);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [year, month, refreshToken]);

  const columns: ColumnDef<QualityReportRow>[] = [
    {
      key: "teacher",
      header: t("table.teacher"),
      sortKey: "teacher",
      render: (row) => (
        <div className="flex items-center gap-3">
          <ScoreRing score={100 - row.total_percent} size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{row.teacher_name}</p>
            <p className="text-muted-foreground truncate text-xs">
              {row.scope === "SESSION"
                ? (row.student_name ?? t("table.sessionFallback"))
                : `${String(row.period_month).padStart(2, "0")}/${row.period_year}`}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "scope",
      header: t("table.scope"),
      render: (row) => <ScopeBadge scope={row.scope} />,
    },
    {
      key: "percent",
      header: t("table.verdict"),
      sortKey: "percent",
      render: (row) => <PercentBadge percent={row.total_percent} />,
    },
    {
      key: "amount",
      header: t("table.cost"),
      render: (row) =>
        row.amount_minor !== null && row.currency ? (
          <span className="text-sm font-medium tabular-nums text-red-600 dark:text-red-400">
            −{formatMoney({ amount: row.amount_minor, currency: row.currency }, locale)}
          </span>
        ) : (
          // The report costs nothing yet: either it found nothing wrong, or the teacher has no
          // pay for it to bite into. Both are real answers, not missing data.
          <span className="text-muted-foreground text-xs">
            {row.total_percent > 0 ? t("table.pending") : "—"}
          </span>
        ),
    },
    {
      key: "author",
      header: t("table.author"),
      render: (row) => (
        <div className="leading-tight">
          <p className="truncate text-xs">{row.author_name ?? "—"}</p>
          <p className="text-muted-foreground text-xs">
            {new Date(row.created_at).toLocaleDateString(locale)}
          </p>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="from-primary/10 via-primary/5 relative overflow-hidden rounded-3xl bg-gradient-to-br to-transparent p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ClipboardCheck className="text-primary size-5" aria-hidden />
              <h1 className="text-xl font-bold">{t("title")}</h1>
            </div>
            <p className="text-muted-foreground mt-1 max-w-xl text-sm">{t("subtitle")}</p>
          </div>
          {canManage && (
            <Button onClick={() => setComposerOpen(true)} data-testid="quality-new-report">
              <Plus className="size-4" aria-hidden />
              {t("newReport")}
            </Button>
          )}
        </div>
      </div>

      {alert && <AlertBanner variant="success" message={alert} onDismiss={() => setAlert(null)} />}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b">
        <TabButton active={tab === "reports"} onClick={() => setTab("reports")} icon={ClipboardCheck}>
          {t("tabs.reports")}
        </TabButton>
        <TabButton active={tab === "rubric"} onClick={() => setTab("rubric")} icon={ListChecks}>
          {t("tabs.rubric")}
        </TabButton>
      </div>

      {tab === "rubric" ? (
        <RubricBuilder canManage={canManage} onChanged={refresh} />
      ) : (
        <div className="space-y-5">
          {/* Period + stats */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="border-input bg-background focus:border-primary focus:ring-primary/15 rounded-xl border px-3 py-1.5 text-sm outline-none focus:ring-3"
              aria-label={t("composer.month")}
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {String(m).padStart(2, "0")}
                </option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="border-input bg-background focus:border-primary focus:ring-primary/15 rounded-xl border px-3 py-1.5 text-sm outline-none focus:ring-3"
              aria-label={t("composer.year")}
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <QualityStats summary={summary} locale={locale} />

          <DataTable<QualityReportRow>
            testId="quality-reports-table"
            refreshToken={refreshToken}
            fetcher={(q) =>
              listQualityReports({
                ...q,
                filter: { ...q.filter, period: `${year}-${month}` },
              })
            }
            getRowId={(row) => row.id}
            searchable
            defaultSort="-created_at"
            onRowClick={(row) => setDetailId(row.id)}
            filters={[
              {
                key: "scope",
                label: t("table.scope"),
                options: [
                  { value: "SESSION", label: t("scope.SESSION") },
                  { value: "MONTHLY", label: t("scope.MONTHLY") },
                ],
              },
            ]}
            emptyMessage={t("table.empty")}
            columns={columns}
          />
        </div>
      )}

      <ReportComposer
        open={composerOpen}
        teachers={teachers}
        onClose={() => setComposerOpen(false)}
        onCreated={() => {
          refresh();
          setAlert(t("alerts.created"));
        }}
      />

      <ReportDetailModal
        reportId={detailId}
        canManage={canManage}
        onClose={() => setDetailId(null)}
        onDeleted={() => {
          refresh();
          setAlert(t("alerts.withdrawn"));
        }}
      />
    </div>
  );
}

// ── Stat tiles ────────────────────────────────────────────────────────────────

function QualityStats({
  summary,
  locale,
}: {
  summary: QualitySummary | null;
  locale: string;
}) {
  const t = useTranslations("quality");

  if (summary === null) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-card h-[92px] animate-pulse rounded-2xl border shadow-sm" aria-hidden />
        ))}
      </div>
    );
  }

  const tone = scoreTone(summary.avg_score);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="bg-card flex items-center gap-3 rounded-2xl border p-4 shadow-sm">
        <ScoreRing score={summary.avg_score} size={44} />
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">{t("stats.avgScore")}</p>
          <p className={cn("text-lg font-bold tabular-nums", tone.text)}>
            {summary.avg_score}
            <span className="text-muted-foreground/60 ms-0.5 text-xs font-normal">/100</span>
          </p>
        </div>
      </div>

      <StatTile
        icon={ClipboardCheck}
        iconClass="text-sky-600 dark:text-sky-400"
        label={t("stats.reports")}
        value={String(summary.report_count)}
      />
      <StatTile
        icon={Users}
        iconClass="text-amber-600 dark:text-amber-400"
        label={t("stats.flagged")}
        value={String(summary.teachers_flagged)}
        hint={t("stats.flaggedHint")}
      />

      <div className="bg-card rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <TrendingDown className="size-4 text-red-600 dark:text-red-400" aria-hidden />
          <p className="text-muted-foreground text-xs">{t("stats.docked")}</p>
        </div>
        {summary.docked.length === 0 ? (
          <p className="mt-1 text-lg font-bold tabular-nums">—</p>
        ) : (
          <div className="mt-1 space-y-0.5">
            {/* One line per currency: teachers are paid in their own, and the system never
                converts, so a single summed figure would be a fiction. */}
            {summary.docked.map((row) => (
              <p
                key={row.currency}
                className="text-lg leading-tight font-bold tabular-nums text-red-600 dark:text-red-400"
              >
                −{formatMoney({ amount: row.amount_minor, currency: row.currency }, locale)}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  iconClass,
  label,
  value,
  hint,
}: {
  icon: typeof Award;
  iconClass: string;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-card rounded-2xl border p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4", iconClass)} aria-hidden />
        <p className="text-muted-foreground text-xs">{label}</p>
      </div>
      <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground/70 text-[11px]">{hint}</p>}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof ListChecks;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-primary text-foreground"
          : "text-muted-foreground hover:text-foreground border-transparent",
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </button>
  );
}
