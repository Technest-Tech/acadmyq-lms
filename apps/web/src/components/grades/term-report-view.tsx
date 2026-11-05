"use client";

import { ArrowLeft, Award, Eye, EyeOff, Printer, Save } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { formatPercent } from "@/components/grades/grade-sheet";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass, textareaClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { useCapability } from "@/lib/capabilities";
import {
  getTermReport,
  percentTone,
  publishTermReport,
  saveTermReport,
  unpublishTermReport,
  type TermReportResponse,
} from "@/lib/grades-api";
import { cn } from "@/lib/utils";
import { useLevelWord } from "@/lib/levels";

const TONE: Record<ReturnType<typeof percentTone>, string> = {
  low: "text-rose-600",
  high: "text-emerald-700",
  mid: "text-slate-900",
  none: "text-slate-400",
};

function longDate(iso: string, locale: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(d);
}

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The certificates gallery with this student's name, course and today's date already typed in. */
export function certificateHref(name: string, course: string, date = localToday()): string {
  const q = new URLSearchParams({ recipient: name, course, date });
  return `/certificates?${q.toString()}`;
}

/**
 * One student's term report (docs/centre-profile, Phase 2 §5), laid out as the page a parent holds
 * in their hand: the academy's name, the student and the group, attendance, the grades table with
 * its weighted total, the teacher's comment and the overall grade. The comment is typed here; the
 * office publishes it to the parent's page, prints it (the chrome steps out of the print), or goes
 * on to a completion certificate with the name already filled in.
 */
export function TermReportView({ groupId, studentId, onBack, onChanged }: { groupId: string; studentId: string; onBack: () => void; onChanged?: () => void }) {
  const t = useTranslations("grades");
  const word = useLevelWord();
  const locale = useLocale();
  const { can } = useAuth();
  // The gallery is a switch of its own; without it the button has nowhere to go.
  const certificates = useCapability("certificates") && can("certificate.read");

  const [data, setData] = useState<TermReportResponse | null>(null);
  const [comment, setComment] = useState("");
  const [overall, setOverall] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "publish">(null);

  const apply = useCallback((res: TermReportResponse) => {
    setData(res);
    setComment(res.report.comment ?? "");
    setOverall(res.report.overall_grade ?? "");
  }, []);

  useEffect(() => {
    let alive = true;
    getTermReport(groupId, studentId)
      .then((res) => alive && apply(res))
      .catch((err) => alive && setError(apiErrorMessage(err, t("view.loadFailed"))));
    return () => {
      alive = false;
    };
  }, [groupId, studentId, apply, t]);

  // Printing shows the report alone (globals.css `print-isolate`); the class leaves with the view.
  useEffect(() => {
    document.body.classList.add("print-isolate");
    return () => document.body.classList.remove("print-isolate");
  }, []);

  const dirty = data !== null && (comment.trim() !== (data.report.comment ?? "") || overall.trim() !== (data.report.overall_grade ?? ""));

  async function save() {
    setBusy("save");
    setError(null);
    try {
      apply(await saveTermReport(groupId, studentId, { comment: comment.trim() || null, overall_grade: overall.trim() || null }));
      setNotice(t("view.saved"));
      onChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, t("saveFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function togglePublish() {
    if (!data) return;
    setBusy("publish");
    setError(null);
    try {
      // Publish what is on the screen, not what was last saved.
      if (dirty) await saveTermReport(groupId, studentId, { comment: comment.trim() || null, overall_grade: overall.trim() || null });
      apply(data.report.published_at ? await unpublishTermReport(groupId, studentId) : await publishTermReport(groupId, studentId));
      setNotice(null);
      onChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, t("saveFailed")));
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return error ? <AlertBanner variant="error" message={error} /> : <p className="text-muted-foreground py-10 text-center text-sm">{t("loading")}</p>;
  }

  const { report, academy, can_mark: canMark, can_publish: canPublish } = data;
  const published = report.published_at !== null;
  const course = [report.group.name, report.group.level].filter(Boolean).join(" — ");

  return (
    <div className="space-y-4" data-testid="term-report-view">
      <div className="flex flex-wrap items-center justify-between gap-2" data-print-hide>
        <button type="button" onClick={onBack} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {t("view.back")}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {canMark && (
            <Button type="button" variant="secondary" onClick={() => void save()} disabled={busy !== null || !dirty} data-testid="report-save">
              <Save className="size-4" />
              {t("view.save")}
            </Button>
          )}
          {canPublish && (
            <Button type="button" variant={published ? "outline" : "default"} onClick={() => void togglePublish()} disabled={busy !== null} data-testid="report-publish">
              {published ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              {published ? t("view.unpublish") : t("view.publish")}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => window.print()} data-testid="report-print">
            <Printer className="size-4" />
            {t("view.print")}
          </Button>
          {certificates && (
            <Link href={certificateHref(report.student.full_name, course)} className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")} data-testid="report-certificate">
              <Award className="size-4" />
              {t("view.certificate")}
            </Link>
          )}
        </div>
      </div>

      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      {canPublish && (
        <p className={cn("text-xs", published ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")} data-print-hide data-testid="report-publish-state">
          {published ? t("view.publishedAt", { date: longDate(report.published_at!, locale) }) : t("view.notPublished")}
        </p>
      )}

      {/* ── The page itself: white paper whatever the theme, so the print and the screen agree ── */}
      <article
        data-print-area
        className="mx-auto w-full max-w-[210mm] rounded-xl border bg-white p-6 text-slate-900 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-10"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="min-w-0">
            <p className="text-lg font-bold">{academy.name}</p>
            <p className="text-sm text-slate-500">{t("view.title")}</p>
          </div>
          {academy.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element -- the academy's own logo, any host
            <img src={academy.logo_url} alt="" className="h-14 w-auto max-w-[8rem] object-contain" />
          )}
        </header>

        <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label={t("view.student")}>
            <span className="text-base font-bold" data-testid="report-student">{report.student.full_name}</span>
          </Row>
          <Row label={t("view.group")}>{report.group.name}</Row>
          {(report.group.level || report.student.level) && <Row label={t("view.level", { word })}>{report.group.level ?? report.student.level}</Row>}
          {report.group.teacher_name && <Row label={t("view.teacher")}>{report.group.teacher_name}</Row>}
          <Row label={t("view.period")}>
            <span className="tabular-nums">{t("view.periodRange", { from: longDate(report.period.from, locale), to: longDate(report.period.to, locale) })}</span>
          </Row>
        </dl>

        {/* Attendance */}
        <section className="mt-6" data-testid="report-attendance">
          <h3 className="text-sm font-bold">
            {t("view.attendance")}
            <span className="ms-2 text-xs font-normal text-slate-500">{t("view.lessonsHeld", { count: report.attendance.lessons_held })}</span>
          </h3>
          {report.attendance.lessons_held === 0 ? (
            <p className="mt-2 text-sm text-slate-500">{t("view.noAttendance")}</p>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label={t("view.rate")} value={report.attendance.rate === null ? "—" : `${report.attendance.rate}%`} strong />
              <Stat label={t("view.present")} value={String(report.attendance.present)} />
              <Stat label={t("view.late")} value={String(report.attendance.late)} />
              <Stat label={t("view.absent")} value={String(report.attendance.absent)} tone={report.attendance.absent > 0 ? "text-rose-600" : undefined} />
              <Stat label={t("view.excused")} value={String(report.attendance.excused)} />
            </div>
          )}
        </section>

        {/* Grades */}
        <section className="mt-6" data-testid="report-grades">
          <h3 className="text-sm font-bold">{t("view.grades")}</h3>
          {report.grades.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">{t("view.noGrades")}</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-1.5 text-start font-semibold">{t("view.assessment")}</th>
                  <th className="hidden py-1.5 text-start font-semibold sm:table-cell">{t("view.date")}</th>
                  <th className="py-1.5 text-end font-semibold">{t("view.score")}</th>
                  <th className="py-1.5 text-end font-semibold">{t("view.percent")}</th>
                  <th className="hidden py-1.5 text-end font-semibold sm:table-cell">{t("view.weight")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.grades.map((g) => (
                  <tr key={g.assessment_id}>
                    <td className="py-1.5">
                      <p className="font-medium">{g.title}</p>
                      <p className="text-xs text-slate-500">{t(`kinds.${g.kind}`)}</p>
                    </td>
                    <td className="hidden py-1.5 text-slate-600 tabular-nums sm:table-cell">{g.held_on ?? "—"}</td>
                    <td className="py-1.5 text-end tabular-nums">
                      {g.absent ? (
                        <span className="text-rose-600">{t("view.absentFromExam")}</span>
                      ) : g.score === null ? (
                        <span className="text-slate-400">{t("view.notGraded")}</span>
                      ) : (
                        <>
                          {g.score} <span className="text-slate-400">/ {g.max_score}</span>
                        </>
                      )}
                    </td>
                    <td className={cn("py-1.5 text-end font-semibold tabular-nums", TONE[percentTone(g.percent)])}>{formatPercent(g.percent)}</td>
                    <td className="hidden py-1.5 text-end text-slate-600 tabular-nums sm:table-cell">{g.weight}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300">
                  <td className="py-2 font-bold" colSpan={2}>
                    {t("view.total")}
                  </td>
                  <td className={cn("py-2 text-end text-base font-bold tabular-nums", TONE[percentTone(report.total.weighted_percent)])} colSpan={3} data-testid="report-total">
                    {formatPercent(report.total.weighted_percent)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        {/* Overall grade + the teacher's comment */}
        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div>
            <h3 className="text-sm font-bold">{t("view.comment")}</h3>
            {canMark ? (
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
                maxLength={4000}
                placeholder={t("view.commentPlaceholder")}
                className={cn(textareaClass, "mt-2 bg-white text-slate-900 print:border-0 print:p-0")}
                data-testid="report-comment"
              />
            ) : (
              <p className="mt-2 text-sm whitespace-pre-line">{report.comment ?? <span className="text-slate-400">{t("view.noComment")}</span>}</p>
            )}
          </div>
          <div>
            <h3 className="text-sm font-bold">{t("view.overallGrade")}</h3>
            {canMark ? (
              <input
                value={overall}
                onChange={(e) => setOverall(e.target.value)}
                maxLength={40}
                placeholder={t("view.overallGradePlaceholder")}
                className={cn(fieldClass, "mt-2 bg-white text-center text-lg font-bold text-slate-900 print:border-0")}
                data-testid="report-overall"
              />
            ) : (
              <p className="mt-2 text-2xl font-bold">{report.overall_grade ?? "—"}</p>
            )}
          </div>
        </section>

        <footer className="mt-8 flex items-center justify-between border-t border-slate-200 pt-3 text-xs text-slate-500">
          <span>{t("view.issuedOn", { date: longDate(localToday(), locale) })}</span>
          <span>{academy.name}</span>
        </footer>
      </article>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-slate-500">{label}:</dt>
      <dd className="min-w-0 font-medium break-words">{children}</dd>
    </div>
  );
}

function Stat({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={cn("tabular-nums", strong ? "text-lg font-bold" : "text-base font-semibold", tone)}>{value}</p>
    </div>
  );
}
