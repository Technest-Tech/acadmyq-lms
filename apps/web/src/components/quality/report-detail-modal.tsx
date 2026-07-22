"use client";

import { Check, Trash2, User, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ScopeBadge, ScoreRing, scoreTone } from "@/components/quality/quality-badges";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  deleteQualityReport,
  getMyQualityReport,
  getQualityReport,
  type QualityReportDetail,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * One report, in full — the same component the owner and the teacher read.
 *
 * That sharing is deliberate. This document explains why someone's pay was cut, so the version the
 * teacher sees must be the version their manager sees; a softened or abridged teacher view would
 * make the statement unarguable. `mine` only switches which endpoint fetches it (the teacher's is
 * self-scoped server-side), and `canManage` only decides whether the withdraw button renders.
 */
export function ReportDetailModal({
  reportId,
  mine = false,
  canManage = false,
  onClose,
  onDeleted,
}: {
  reportId: string | null;
  mine?: boolean;
  canManage?: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const t = useTranslations("quality");
  const locale = useLocale();

  const [data, setData] = useState<QualityReportDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (reportId === null) return;
    let cancelled = false;
    setData(null);
    setError(null);
    const fetcher = mine ? getMyQualityReport : getQualityReport;
    fetcher(reportId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reportId, mine]);

  async function remove() {
    if (reportId === null || !window.confirm(t("detail.confirmDelete"))) return;
    setBusy(true);
    try {
      await deleteQualityReport(reportId);
      onDeleted?.();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const report = data?.report;
  const score = report ? 100 - report.total_percent : 100;
  const tone = scoreTone(score);
  const breached = data?.items.filter((i) => !i.met) ?? [];
  const met = data?.items.filter((i) => i.met) ?? [];

  return (
    <Modal
      open={reportId !== null}
      onClose={onClose}
      title={t("detail.title")}
      size="lg"
      footer={
        canManage && report ? (
          <div className="flex w-full items-center justify-between gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void remove()}
              data-testid="quality-report-delete"
            >
              <Trash2 className="size-3.5" aria-hidden />
              {t("detail.withdraw")}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t("close")}
            </Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={onClose} className="ms-auto">
            {t("close")}
          </Button>
        )
      }
    >
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {!report ? (
        <div className="flex items-center justify-center py-16">
          <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Verdict header */}
          <div className={cn("flex items-center gap-4 rounded-2xl p-4", tone.bg)}>
            <ScoreRing score={score} size={56} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold">{report.teacher_name}</p>
                <ScopeBadge scope={report.scope} />
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {report.scope === "SESSION"
                  ? t("detail.aboutSession", {
                      student: report.student_name ?? "—",
                    })
                  : t("detail.aboutMonth", {
                      period: `${String(report.period_month).padStart(2, "0")}/${report.period_year}`,
                    })}
              </p>
            </div>
            <div className="text-end">
              {report.total_percent > 0 ? (
                <>
                  <p className={cn("text-lg font-bold tabular-nums", tone.text)}>
                    −{report.total_percent}%
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {report.amount_minor !== null && report.currency
                      ? formatMoney(
                          { amount: report.amount_minor, currency: report.currency },
                          locale,
                        )
                      : /* No pay accrued yet, so the percent bites into nothing — a real
                           state the statement will fill in once the teacher earns. */
                        t("detail.pending")}
                  </p>
                </>
              ) : (
                <p className={cn("text-sm font-semibold", tone.text)}>{t("passed")}</p>
              )}
            </div>
          </div>

          {/* Author + when */}
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5">
              <User className="size-3.5" aria-hidden />
              {report.author_name ?? t("detail.unknownAuthor")}
            </span>
            <span>{new Date(report.created_at).toLocaleString(locale)}</span>
          </div>

          {report.note && (
            <div className="bg-muted/40 rounded-xl p-3">
              <p className="text-muted-foreground mb-1 text-xs font-medium">
                {t("detail.note")}
              </p>
              <p className="text-sm whitespace-pre-wrap">{report.note}</p>
            </div>
          )}

          {/* The answer sheet — failures first, because that is what the reader came for. */}
          {breached.length > 0 && (
            <ItemGroup
              title={t("detail.notMet", { count: breached.length })}
              items={breached}
              failed
            />
          )}
          {met.length > 0 && (
            <ItemGroup title={t("detail.met", { count: met.length })} items={met} />
          )}
        </div>
      )}
    </Modal>
  );
}

function ItemGroup({
  title,
  items,
  failed = false,
}: {
  title: string;
  items: QualityReportDetail["items"];
  failed?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p
        className={cn(
          "text-xs font-semibold",
          failed ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {title}
      </p>
      <ul className="divide-y overflow-hidden rounded-xl border">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-3 py-2">
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded",
                failed
                  ? "bg-red-500 text-white"
                  : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
              )}
              aria-hidden
            >
              {failed ? <X className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{item.criterion_name}</p>
              <p className="text-muted-foreground truncate text-xs">{item.category_name}</p>
            </div>
            <span
              className={cn(
                "shrink-0 text-xs font-semibold tabular-nums",
                failed ? "text-red-600 dark:text-red-400" : "text-muted-foreground/50",
              )}
            >
              −{item.discount_percent}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
