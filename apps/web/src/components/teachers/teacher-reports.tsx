"use client";

import {
  AlertTriangle,
  FileText,
  Send,
  Sparkles,
  StickyNote,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  addDays,
  todayInTz,
} from "@/components/scheduling/calendar/utils";
import {
  ApiError,
  type CalendarSession,
  createTeacherReport,
  deleteTeacherReport,
  getCalendar,
  getSession,
  listTeacherReports,
  type ReportField,
  type SessionReportData,
  type TeacherReport,
  type TeacherReportKind,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const KIND_META: Record<
  TeacherReportKind,
  { icon: typeof StickyNote; chip: string; dot: string }
> = {
  NOTE: {
    icon: StickyNote,
    chip: "bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300",
    dot: "bg-slate-400",
  },
  INCIDENT: {
    icon: AlertTriangle,
    chip: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    dot: "bg-red-500",
  },
  PRAISE: {
    icon: Sparkles,
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
};

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

/** The teacher's Reports tab: internal performance notes written ABOUT the teacher (owner/support)
 *  plus the lesson reports the teacher filled in for their own attended sessions. */
export function TeacherReports({
  teacherId,
  timeZone,
}: {
  teacherId: string;
  timeZone?: string;
}) {
  const { can } = useAuth();
  const canManage = can("teacher_report.manage");
  const canSeeLessons = can("session.read");

  return (
    <div className="space-y-8">
      {canManage && <PerformanceNotes teacherId={teacherId} />}
      {canSeeLessons && (
        <LessonReports teacherId={teacherId} timeZone={timeZone} />
      )}
    </div>
  );
}

// ── Performance notes (new feature) ──────────────────────────────────────────

function PerformanceNotes({ teacherId }: { teacherId: string }) {
  const t = useTranslations("teachers");
  const locale = useLocale();

  const [reports, setReports] = useState<TeacherReport[] | null>(null);
  const [kind, setKind] = useState<TeacherReportKind>("NOTE");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  const load = useCallback(async () => {
    try {
      const res = await listTeacherReports(teacherId);
      setReports(res.reports);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setReports([]);
    }
  }, [teacherId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createTeacherReport(teacherId, { kind, body: body.trim() });
      setBody("");
      setKind("NOTE");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await deleteTeacherReport(teacherId, id);
      setConfirmId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold">{t("reports.notesTitle")}</h3>
      </div>

      {error && (
        <AlertBanner
          variant="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}

      {/* Write form */}
      <form
        onSubmit={submit}
        className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm"
        data-testid="teacher-report-form"
      >
        <div className="flex flex-wrap gap-1.5">
          {(["NOTE", "INCIDENT", "PRAISE"] as TeacherReportKind[]).map((k) => {
            const Meta = KIND_META[k];
            const Icon = Meta.icon;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                  kind === k
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {t(`reports.kind.${k}`)}
              </button>
            );
          })}
        </div>
        <textarea
          aria-label={t("reports.notesTitle")}
          className={cn(inputBase, "min-h-20 resize-y px-3.5 py-2.5")}
          placeholder={t("reports.addPlaceholder")}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          data-testid="teacher-report-body"
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={busy || body.trim() === ""}
            className="gap-1.5"
            data-testid="submit-teacher-report"
          >
            {busy ? (
              <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
            ) : (
              <Send className="size-3.5" />
            )}
            {t("reports.add")}
          </Button>
        </div>
      </form>

      {/* List */}
      {reports === null ? (
        <div className="flex items-center justify-center py-8">
          <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : reports.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t("reports.empty")}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="teacher-reports-list">
          {reports.map((r) => {
            const Meta = KIND_META[r.kind];
            const Icon = Meta.icon;
            return (
              <li
                key={r.id}
                className="rounded-2xl border bg-card p-4 shadow-sm"
                data-report={r.id}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                      Meta.chip,
                    )}
                  >
                    <Icon className="size-3" />
                    {t(`reports.kind.${r.kind}`)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-sm">{r.body}</p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {r.author_name ?? "—"} ·{" "}
                      {dateFmt.format(new Date(r.created_at))}
                    </p>
                  </div>
                  {confirmId === r.id ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => setConfirmId(null)}
                      >
                        {t("reports.cancel")}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="xs"
                        onClick={() => void remove(r.id)}
                        data-testid="confirm-delete-report"
                      >
                        {t("reports.delete")}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={t("reports.delete")}
                      onClick={() => setConfirmId(r.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Lesson reports (existing per-session reports the teacher wrote) ───────────

function LessonReports({
  teacherId,
  timeZone,
}: {
  teacherId: string;
  timeZone?: string;
}) {
  const t = useTranslations("teachers");
  const locale = useLocale();
  const tz =
    timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  const [sessions, setSessions] = useState<CalendarSession[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const to = todayInTz(tz);
    const from = addDays(to, -90);
    void getCalendar({ from, to, teacherId })
      .then((res) =>
        setSessions(res.sessions.filter((s) => s.status === "ATTENDED")),
      )
      .catch(() => setSessions([]));
  }, [teacherId, tz]);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <StickyNote className="size-4 text-violet-500" aria-hidden />
        <h3 className="text-sm font-semibold">{t("reports.lessonsTitle")}</h3>
      </div>

      {sessions === null ? (
        <div className="flex items-center justify-center py-8">
          <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : sessions.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t("reports.lessonsEmpty")}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 px-4 py-3"
              data-lesson={s.id}
            >
              <StickyNote
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {s.student_name ?? "—"}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {dateFmt.format(new Date(s.scheduled_at_utc))}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setOpenId(s.id)}
              >
                {t("reports.viewReport")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <LessonReportModal sessionId={openId} onClose={() => setOpenId(null)} />
    </section>
  );
}

function LessonReportModal({
  sessionId,
  onClose,
}: {
  sessionId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("teachers");
  const locale = useLocale();
  const [report, setReport] = useState<SessionReportData | null>(null);
  const [fields, setFields] = useState<ReportField[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    setReport(null);
    void getSession(sessionId)
      .then((res) => {
        setReport(res.report);
        setFields(res.reportFields);
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  const values = report?.values ?? {};

  return (
    <Modal
      open={sessionId !== null}
      onClose={onClose}
      title={t("reports.lessonReport")}
      size="md"
    >
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : report === null ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("reports.noReport")}
        </p>
      ) : (
        <dl className="space-y-3">
          {fields.map((f) => {
            const v = values[f.key];
            return (
              <div key={f.id} className="rounded-xl border bg-muted/20 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {locale === "ar" ? f.label_ar : f.label_en}
                </dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-sm">
                  {v === null || v === undefined || v === ""
                    ? "—"
                    : String(v)}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </Modal>
  );
}
