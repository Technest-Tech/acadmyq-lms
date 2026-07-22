"use client";

import { ClipboardCheck, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { AdjustmentReason, SourceBadge } from "@/components/adjustments/source-badge";
import { PercentBadge, ScopeBadge, ScoreRing } from "@/components/quality/quality-badges";
import { ReportDetailModal } from "@/components/quality/report-detail-modal";
import {
  ApiError,
  listMyAdjustments,
  listMyQualityReports,
  type QualityReportRow,
  type TeacherAdjustmentRow,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Tab = "reports" | "money";

/**
 * The teacher's own view: every quality report written about them, and every award or discount on
 * their pay.
 *
 * This panel is the reason `teacher_quality.read_own` exists. Both pages let support change what a
 * teacher earns, and a teacher who cannot see why their pay moved has no way to correct a mistake
 * or to know what the rubric expects — so the surfaces that dock them and the surface that explains
 * it ship together. The reports open in the SAME detail modal the owner reads, not a summary of it.
 *
 * Note what is deliberately absent: the free-text `teacher_reports` log (NOTE/INCIDENT/PRAISE) is
 * not shown. That log predates this feature, was written under an expectation of privacy, and is
 * not a payroll document — exposing it retroactively would publish candid notes their authors never
 * meant a teacher to read. Quality reports are teacher-visible by design because they cost money.
 */
export function MyQualityPanel() {
  const t = useTranslations("quality");
  const tAdj = useTranslations("adjustments");
  const locale = useLocale();

  const [tab, setTab] = useState<Tab>("reports");
  const [reports, setReports] = useState<QualityReportRow[] | null>(null);
  const [adjustments, setAdjustments] = useState<TeacherAdjustmentRow[] | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [reportRes, adjRes] = await Promise.all([
        listMyQualityReports({ pageSize: 25, sort: "-created_at" }),
        listMyAdjustments({ pageSize: 25, sort: "-created_at" }),
      ]);
      setReports(reportRes.rows);
      setAdjustments(adjRes.rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setReports([]);
      setAdjustments([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loading = reports === null || adjustments === null;

  // Nothing to explain yet — don't take up the dashboard with an empty panel.
  if (!loading && reports.length === 0 && adjustments.length === 0 && error === null) {
    return null;
  }

  return (
    <section className="space-y-3" data-testid="my-quality-panel">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="text-primary size-4" aria-hidden />
        <h2 className="text-sm font-semibold">{t("mine.title")}</h2>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
        <div className="flex items-center gap-1 border-b px-2">
          <PanelTab active={tab === "reports"} onClick={() => setTab("reports")} icon={ClipboardCheck}>
            {t("mine.reportsTab", { count: reports?.length ?? 0 })}
          </PanelTab>
          <PanelTab active={tab === "money"} onClick={() => setTab("money")} icon={Scale}>
            {t("mine.moneyTab", { count: adjustments?.length ?? 0 })}
          </PanelTab>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="border-primary size-5 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        ) : tab === "reports" ? (
          reports.length === 0 ? (
            <EmptyRow message={t("mine.noReports")} />
          ) : (
            <ul className="divide-y">
              {reports.map((report) => (
                <li key={report.id}>
                  <button
                    type="button"
                    onClick={() => setDetailId(report.id)}
                    className="hover:bg-muted/40 flex w-full items-center gap-3 px-4 py-3 text-start transition-colors"
                  >
                    <ScoreRing score={100 - report.total_percent} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ScopeBadge scope={report.scope} />
                        <PercentBadge percent={report.total_percent} />
                      </div>
                      <p className="text-muted-foreground mt-1 truncate text-xs">
                        {report.scope === "SESSION"
                          ? (report.student_name ?? t("table.sessionFallback"))
                          : `${String(report.period_month).padStart(2, "0")}/${report.period_year}`}
                        {" · "}
                        {new Date(report.created_at).toLocaleDateString(locale)}
                      </p>
                    </div>
                    {report.amount_minor !== null && report.currency && (
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">
                        −{formatMoney({ amount: report.amount_minor, currency: report.currency }, locale)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : adjustments.length === 0 ? (
          <EmptyRow message={t("mine.noMoney")} />
        ) : (
          <ul className="divide-y">
            {adjustments.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-xl",
                    row.type === "REWARD"
                      ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
                      : "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400",
                  )}
                  aria-hidden
                >
                  {row.type === "REWARD" ? (
                    <TrendingUp className="size-4" />
                  ) : (
                    <TrendingDown className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <AdjustmentReason
                    source={row.source}
                    reason={row.reason}
                    sessionLocal={row.session_local}
                  />
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <SourceBadge source={row.source} />
                    <span className="text-muted-foreground text-[11px] tabular-nums">
                      {String(row.period_month).padStart(2, "0")}/{row.period_year}
                    </span>
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-sm font-semibold tabular-nums",
                    row.type === "REWARD"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400",
                  )}
                >
                  {row.type === "REWARD" ? "+" : "−"}
                  {formatMoney({ amount: row.amount_minor, currency: row.currency }, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-muted-foreground/70 text-xs">{tAdj("mine.hint")}</p>

      <ReportDetailModal reportId={detailId} mine onClose={() => setDetailId(null)} />
    </section>
  );
}

function PanelTab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof ClipboardCheck;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
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

function EmptyRow({ message }: { message: string }) {
  return <p className="text-muted-foreground px-4 py-10 text-center text-sm">{message}</p>;
}
