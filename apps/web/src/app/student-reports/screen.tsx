"use client";

import { NotebookPen, Send } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  listMyStudentReports,
  listStudentReportStudents,
  type StudentReportRow,
  type StudentReportStatus,
  type StudentReportStudent,
  submitStudentReport,
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

/** The current calendar month as a YYYY-MM string for the <input type="month"> default. */
function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function StudentReportsScreen() {
  const t = useTranslations("studentReports");
  const locale = useLocale();
  const { can } = useAuth();

  const [students, setStudents] = useState<StudentReportStudent[]>([]);
  const [reports, setReports] = useState<StudentReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [studentId, setStudentId] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const monthFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
        year: "numeric",
        month: "long",
      }),
    [locale],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ students: studs }, { reports: reps }] = await Promise.all([
        listStudentReportStudents(),
        listMyStudentReports(),
      ]);
      setStudents(studs);
      setReports(reps);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await submitStudentReport({
        student_id: studentId,
        period_month: `${month}-01`,
        title: title.trim(),
        body: body.trim(),
      });
      setSuccess(t("form.success"));
      setTitle("");
      setBody("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!can("student_report.submit")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const canSubmit =
    !busy && studentId !== "" && month !== "" && title.trim() !== "" && body.trim() !== "";

  return (
    <div className="w-full space-y-6">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="bg-primary/10 ring-primary/15 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">
          <NotebookPen className="text-primary size-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-xl font-semibold leading-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
      </div>

      {error && (
        <AlertBanner
          variant="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}
      {success && (
        <AlertBanner
          variant="success"
          message={success}
          onDismiss={() => setSuccess(null)}
        />
      )}

      {/* ── New report form ──────────────────────────────────────────── */}
      <form
        onSubmit={submit}
        className="bg-card space-y-4 rounded-2xl border p-4"
        data-testid="student-report-form"
      >
        <h2 className="font-semibold">{t("form.heading")}</h2>

        {students.length === 0 && !loading ? (
          <p className="text-muted-foreground text-sm">{t("form.noStudents")}</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">{t("form.student")}</span>
                <select
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  required
                  data-testid="sr-student"
                  className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2 text-sm outline-none transition-colors focus:ring-3"
                >
                  <option value="" disabled>
                    {t("form.studentPlaceholder")}
                  </option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="font-medium">{t("form.month")}</span>
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  required
                  data-testid="sr-month"
                  className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2 text-sm outline-none transition-colors focus:ring-3"
                />
              </label>
            </div>

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">{t("form.reportTitle")}</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
                placeholder={t("form.titlePlaceholder")}
                data-testid="sr-title"
                className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2 text-sm outline-none transition-colors focus:ring-3"
              />
            </label>

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">{t("form.body")}</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={5000}
                required
                rows={6}
                placeholder={t("form.bodyPlaceholder")}
                data-testid="sr-body"
                className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full resize-y rounded-xl border px-3.5 py-2 text-sm outline-none transition-colors focus:ring-3"
              />
            </label>

            <Button
              type="submit"
              disabled={!canSubmit}
              data-testid="sr-submit"
              className="gap-1.5"
            >
              <Send className="size-3.5" />
              {busy ? t("form.submitting") : t("form.submit")}
            </Button>
          </>
        )}
      </form>

      {/* ── Past reports ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="font-semibold">{t("list.heading")}</h2>
        {loading ? (
          <p className="text-muted-foreground text-sm">{t("loading")}</p>
        ) : reports.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("list.empty")}</p>
        ) : (
          <ul className="space-y-3" data-testid="my-reports-list">
            {reports.map((r) => (
              <li
                key={r.id}
                className="bg-card space-y-2 rounded-2xl border p-4"
                data-testid="my-report-card"
                data-status={r.status}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold leading-tight">{r.title}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {(r.student_name ?? "—") +
                        " · " +
                        monthFmt.format(new Date(r.period_month))}
                    </p>
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
                {r.status !== "PENDING" && r.review_note && (
                  <p className="text-muted-foreground text-xs">
                    {t("list.reviewedBy", {
                      who: r.reviewed_by_name ?? "—",
                      note: r.review_note,
                    })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
