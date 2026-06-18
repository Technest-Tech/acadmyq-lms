"use client";

import {
  CalendarClock,
  Check,
  ClipboardCheck,
  GraduationCap,
  Inbox,
  NotebookPen,
  RefreshCw,
  User,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  approveStudentReport,
  listStudentReportsForReview,
  rejectStudentReport,
  type StudentReportRow,
  type StudentReportStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUS_CHIP: Record<StudentReportStatus, string> = {
  PENDING:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  APPROVED:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  REJECTED:
    "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
};

/**
 * Student Reports review queue (admin-facing). Teachers submit monthly progress reports
 * and the owner/support approves or rejects them here. Gated client-side by
 * student_report.review; every endpoint enforces it for real with Gate::authorize.
 */
export function StudentReportReviewsScreen() {
  const t = useTranslations("studentReportReviews");
  const locale = useLocale();
  const { can } = useAuth();

  const [reports, setReports] = useState<StudentReportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const canReview = can("student_report.review");

  const load = useCallback(async () => {
    setError(null);
    try {
      const { reports: rows } = await listStudentReportsForReview();
      setReports(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canReview) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  return (
    <div className="w-full space-y-6">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 ring-primary/15 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">
            <ClipboardCheck className="text-primary size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-tight">{t("title")}</h1>
            <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          className="gap-1.5"
          data-testid="refresh"
        >
          <RefreshCw className="size-3.5" />
          {t("actions.refresh")}
        </Button>
      </div>

      {error && (
        <AlertBanner
          variant="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}

      {loading ? (
        <p className="text-muted-foreground text-sm">{t("loading")}</p>
      ) : reports.length === 0 ? (
        <EmptyState message={t("empty")} />
      ) : (
        <ul className="space-y-3" data-testid="student-reports-list">
          {reports.map((r) => (
            <StudentReportCard
              key={r.id}
              report={r}
              canReview={canReview}
              locale={locale}
              onChanged={load}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function StudentReportCard({
  report: r,
  canReview,
  locale,
  onChanged,
  onError,
}: {
  report: StudentReportRow;
  canReview: boolean;
  locale: string;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("studentReportReviews");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      if (approve) await approveStudentReport(r.id, note || undefined);
      else await rejectStudentReport(r.id, note || undefined);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const pending = r.status === "PENDING";
  const month = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
    year: "numeric",
    month: "long",
  }).format(new Date(r.period_month));

  return (
    <li
      className="bg-card space-y-3 rounded-2xl border p-4"
      data-testid="student-report-card"
      data-status={r.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 ring-primary/15 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">
            <NotebookPen className="text-primary size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="font-semibold leading-tight">{r.title}</p>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <User className="size-3.5" aria-hidden />
                {r.student_name ?? "—"}
              </span>
              {r.teacher_name && (
                <span className="inline-flex items-center gap-1.5">
                  <GraduationCap className="size-3.5" aria-hidden />
                  {r.teacher_name}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="size-3.5" aria-hidden />
                {month}
              </span>
            </div>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold",
            STATUS_CHIP[r.status],
          )}
        >
          {t(`status.${r.status}`)}
        </span>
      </div>

      <p className="text-foreground/90 bg-muted/40 whitespace-pre-wrap rounded-xl px-3 py-2 text-sm">
        {r.body}
      </p>

      {!pending && r.review_note && (
        <p className="text-muted-foreground text-xs">
          {t("decisionNote", {
            who: r.reviewed_by_name ?? "—",
            note: r.review_note,
          })}
        </p>
      )}

      {canReview && pending && (
        <div className="space-y-2 border-t pt-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("notePlaceholder")}
            aria-label={t("notePlaceholder")}
            className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2 text-sm outline-none transition-colors focus:ring-3"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void decide(true)}
              data-testid="sr-approve"
              className="gap-1.5"
            >
              <Check className="size-3.5" />
              {t("actions.approve")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void decide(false)}
              data-testid="sr-reject"
              className="border-destructive/30 text-destructive hover:bg-destructive/10 gap-1.5"
            >
              <X className="size-3.5" />
              {t("actions.reject")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="text-muted-foreground flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed py-16 text-center"
      data-testid="empty-state"
    >
      <Inbox className="size-8 opacity-40" aria-hidden />
      <p className="text-sm">{message}</p>
    </div>
  );
}
