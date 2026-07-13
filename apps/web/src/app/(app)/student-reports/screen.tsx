"use client";

import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Eraser,
  Inbox,
  Layers,
  ListPlus,
  NotebookPen,
  RotateCcw,
  Search,
  SearchX,
  Send,
  User,
  X,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useAuth } from "@/components/auth-provider";
import {
  EmptyState,
  FIELD_CLASS,
  InitialsAvatar,
  MetaItem,
  ReportBody,
  SkeletonCards,
  STATUS_FILTERS,
  STATUS_STYLE,
  StatTile,
  StatusPill,
  relativeTime,
  type StatusFilter,
} from "@/components/student-reports/report-ui";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  listMyStudentReports,
  listStudentReportStudents,
  type StudentReportRow,
  type StudentReportStudent,
  submitStudentReport,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const TITLE_MAX = 200;
const BODY_MAX = 5000;

const FILTER_ICON = {
  ALL: Layers,
  PENDING: Clock3,
  APPROVED: CheckCircle2,
  REJECTED: XCircle,
} as const;

const FILTER_TONE = {
  ALL: "bg-primary/10 text-primary",
  PENDING: STATUS_STYLE.PENDING.tone,
  APPROVED: STATUS_STYLE.APPROVED.tone,
  REJECTED: STATUS_STYLE.REJECTED.tone,
} as const;

/** The current calendar month as a YYYY-MM string for the <input type="month"> default. */
function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Student Reports (teacher-facing). The teacher writes a monthly progress report for one of their
 * students and sends it to the admin, then tracks the verdict here. A rejected report can be
 * revised and resubmitted — the API keeps at most one PENDING report per student and month, so a
 * decided report is never edited, it is rewritten.
 */
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

  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [query, setQuery] = useState("");

  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

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

  const canWrite = can("student_report.submit");

  useEffect(() => {
    // Without the capability the screen renders a permission notice — don't fetch a certain 403.
    if (!canWrite) return;
    void load();
  }, [canWrite, load]);

  const counts = useMemo(
    () => ({
      ALL: reports.length,
      PENDING: reports.filter((r) => r.status === "PENDING").length,
      APPROVED: reports.filter((r) => r.status === "APPROVED").length,
      REJECTED: reports.filter((r) => r.status === "REJECTED").length,
    }),
    [reports],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((r) => {
      if (filter !== "ALL" && r.status !== filter) return false;
      if (!q) return true;
      return [r.title, r.body, r.student_name]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
    });
  }, [reports, filter, query]);

  /**
   * The API allows only one PENDING report per (student, month) — surface that up front instead
   * of letting the teacher write a whole report and then bounce off a 422.
   */
  const duplicate = useMemo(
    () =>
      studentId !== "" &&
      reports.some(
        (r) =>
          r.status === "PENDING" &&
          r.student_id === studentId &&
          r.period_month.slice(0, 7) === month,
      ),
    [reports, studentId, month],
  );

  /** Pull a rejected report back into the composer so the teacher can fix it and resend. */
  const revise = useCallback((r: StudentReportRow) => {
    setStudentId(r.student_id);
    setMonth(r.period_month.slice(0, 7));
    setTitle(r.title);
    setBody(r.body);
    setSuccess(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Land the cursor in the title so the teacher can start editing immediately.
    window.setTimeout(() => titleRef.current?.focus(), 350);
  }, []);

  function reset() {
    setTitle("");
    setBody("");
    setStudentId("");
    setMonth(currentMonth());
  }

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

  if (!canWrite) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const canSubmit =
    !busy &&
    !duplicate &&
    studentId !== "" &&
    month !== "" &&
    title.trim() !== "" &&
    body.trim() !== "";

  const searching = query.trim() !== "";

  return (
    <div className="w-full space-y-6">
      {/* ── Hero header ──────────────────────────────────────────────── */}
      <div className="from-primary/[0.07] via-card to-card ring-foreground/[0.06] relative overflow-hidden rounded-2xl bg-gradient-to-br p-5 shadow-sm ring-1">
        <div className="bg-primary/10 pointer-events-none absolute -top-16 -end-16 size-40 rounded-full blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="bg-primary/10 ring-primary/15 flex size-11 shrink-0 items-center justify-center rounded-xl ring-1">
            <NotebookPen className="text-primary size-5.5" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl leading-tight font-semibold">{t("title")}</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {t("subtitle")}
            </p>
          </div>
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

      {/* ── Composer ─────────────────────────────────────────────────── */}
      <ReportComposer
        formRef={formRef}
        titleRef={titleRef}
        students={students}
        loading={loading}
        studentId={studentId}
        setStudentId={setStudentId}
        month={month}
        setMonth={setMonth}
        title={title}
        setTitle={setTitle}
        body={body}
        setBody={setBody}
        duplicate={duplicate}
        busy={busy}
        canSubmit={canSubmit}
        onSubmit={submit}
        onReset={reset}
      />

      {/* ── Counts, which double as the status filter ────────────────── */}
      {reports.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STATUS_FILTERS.map((key) => (
            <StatTile
              key={key}
              label={t(`stats.${key}`)}
              value={counts[key]}
              icon={FILTER_ICON[key]}
              tone={FILTER_TONE[key]}
              active={filter === key}
              onClick={() => setFilter(key)}
              testId={`filter-${key}`}
            />
          ))}
        </div>
      )}

      {/* ── Past reports ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{t("list.heading")}</h2>
          {reports.length > 0 && (
            <div className="relative min-w-56">
              <Search
                className="text-muted-foreground pointer-events-none absolute inset-y-0 start-3 my-auto size-4"
                aria-hidden
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("list.searchPlaceholder")}
                aria-label={t("list.searchPlaceholder")}
                data-testid="search"
                className={cn(FIELD_CLASS, "ps-9 pe-9")}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={t("list.clearSearch")}
                  className="text-muted-foreground hover:text-foreground absolute inset-y-0 end-2.5 my-auto flex size-5 items-center justify-center rounded-md"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <SkeletonCards count={2} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={searching ? SearchX : Inbox}
            title={
              searching
                ? t("list.noResults")
                : reports.length === 0
                  ? t("list.empty")
                  : t(`list.emptyFor.${filter}`)
            }
            hint={
              searching || reports.length > 0 ? undefined : t("list.emptyHint")
            }
            action={
              searching ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setQuery("")}
                >
                  {t("list.clearSearch")}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-3" data-testid="my-reports-list">
            {visible.map((r) => (
              <MyReportCard
                key={r.id}
                report={r}
                locale={locale}
                monthLabel={monthFmt.format(new Date(r.period_month))}
                onRevise={() => revise(r)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Composer ──────────────────────────────────────────────────────────────────

function ReportComposer({
  formRef,
  titleRef,
  students,
  loading,
  studentId,
  setStudentId,
  month,
  setMonth,
  title,
  setTitle,
  body,
  setBody,
  duplicate,
  busy,
  canSubmit,
  onSubmit,
  onReset,
}: {
  formRef: RefObject<HTMLFormElement | null>;
  titleRef: RefObject<HTMLInputElement | null>;
  students: StudentReportStudent[];
  loading: boolean;
  studentId: string;
  setStudentId: (v: string) => void;
  month: string;
  setMonth: (v: string) => void;
  title: string;
  setTitle: (v: string) => void;
  body: string;
  setBody: (v: string) => void;
  duplicate: boolean;
  busy: boolean;
  canSubmit: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onReset: () => void;
}) {
  const t = useTranslations("studentReports");
  const dirty = title !== "" || body !== "";

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="bg-card ring-foreground/[0.06] space-y-4 rounded-2xl border p-5 shadow-sm ring-1"
      data-testid="student-report-form"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t("form.heading")}</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t("form.hint")}
          </p>
        </div>
        {dirty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            data-testid="sr-reset"
            className="gap-1.5"
          >
            <Eraser className="size-3.5" />
            {t("form.reset")}
          </Button>
        )}
      </div>

      {students.length === 0 && !loading ? (
        <EmptyState icon={User} title={t("form.noStudents")} />
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
                className={FIELD_CLASS}
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
                className={FIELD_CLASS}
              />
            </label>
          </div>

          {/* One PENDING report per student and month — say so before they write it. */}
          {duplicate && (
            <p
              className={cn(
                "flex items-start gap-2 rounded-xl px-3 py-2 text-xs ring-1 ring-inset",
                STATUS_STYLE.PENDING.chip,
              )}
              data-testid="duplicate-warning"
            >
              <Clock3 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {t("form.duplicate")}
            </p>
          )}

          <label className="block space-y-1.5 text-sm">
            <span className="flex items-center justify-between">
              <span className="font-medium">{t("form.reportTitle")}</span>
              <Counter value={title.length} max={TITLE_MAX} />
            </span>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={TITLE_MAX}
              required
              placeholder={t("form.titlePlaceholder")}
              data-testid="sr-title"
              className={FIELD_CLASS}
            />
          </label>

          <label className="block space-y-1.5 text-sm">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{t("form.body")}</span>
              <span className="flex items-center gap-2">
                {body.trim() === "" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setBody(t("form.outlineTemplate"))}
                    data-testid="sr-outline"
                    className="gap-1"
                  >
                    <ListPlus className="size-3" />
                    {t("form.outline")}
                  </Button>
                )}
                <Counter value={body.length} max={BODY_MAX} />
              </span>
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={BODY_MAX}
              required
              rows={8}
              placeholder={t("form.bodyPlaceholder")}
              data-testid="sr-body"
              className={cn(FIELD_CLASS, "resize-y leading-relaxed")}
            />
          </label>

          <div className="flex items-center gap-3 border-t pt-4">
            <Button
              type="submit"
              disabled={!canSubmit}
              data-testid="sr-submit"
              className="gap-1.5"
            >
              <Send className="size-3.5" />
              {busy ? t("form.submitting") : t("form.submit")}
            </Button>
            <p className="text-muted-foreground text-xs">
              {t("form.reviewNotice")}
            </p>
          </div>
        </>
      )}
    </form>
  );
}

/** Character counter that turns amber as the field approaches its cap. */
function Counter({ value, max }: { value: number; max: number }) {
  const near = value > max * 0.9;
  return (
    <span
      className={cn(
        "text-[0.7rem] tabular-nums",
        near ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
      )}
    >
      {value}/{max}
    </span>
  );
}

// ── The teacher's own reports ─────────────────────────────────────────────────

function MyReportCard({
  report: r,
  locale,
  monthLabel,
  onRevise,
}: {
  report: StudentReportRow;
  locale: string;
  monthLabel: string;
  onRevise: () => void;
}) {
  const t = useTranslations("studentReports");
  const style = STATUS_STYLE[r.status];
  const rejected = r.status === "REJECTED";

  return (
    <li
      className={cn(
        "bg-card ring-foreground/[0.06] relative overflow-hidden rounded-2xl border shadow-sm ring-1 transition-shadow hover:shadow-md",
        rejected && "ring-rose-500/20",
      )}
      data-testid="my-report-card"
      data-status={r.status}
    >
      <span
        className={cn("absolute inset-y-0 start-0 w-1", style.rail)}
        aria-hidden
      />

      <div className="space-y-3 p-4 ps-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <InitialsAvatar name={r.student_name} />
            <div className="min-w-0">
              <p className="leading-tight font-semibold">{r.title}</p>
              <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <MetaItem icon={User}>{r.student_name ?? "—"}</MetaItem>
                <MetaItem icon={CalendarClock}>{monthLabel}</MetaItem>
                <MetaItem icon={Clock3}>
                  {t("list.submitted", {
                    when: relativeTime(r.created_at, locale),
                  })}
                </MetaItem>
              </div>
            </div>
          </div>
          <StatusPill status={r.status} label={t(`status.${r.status}`)} />
        </div>

        <ReportBody
          text={r.body}
          moreLabel={t("list.showMore")}
          lessLabel={t("list.showLess")}
        />

        {/* The admin's verdict — and, when it's a rejection, the way back in. */}
        {r.status !== "PENDING" && (
          <div
            className={cn(
              "space-y-2 rounded-xl px-3 py-2.5 text-xs ring-1 ring-inset",
              style.chip,
            )}
            data-testid="decision"
          >
            <div className="flex items-start gap-2">
              <style.icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <p>
                <span className="font-semibold">
                  {t(`list.decided.${r.status}`, {
                    who: r.reviewed_by_name ?? "—",
                    when: r.reviewed_at
                      ? relativeTime(r.reviewed_at, locale)
                      : "—",
                  })}
                </span>
                {r.review_note && (
                  <span className="opacity-90"> — {r.review_note}</span>
                )}
              </p>
            </div>
            {rejected && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRevise}
                data-testid="sr-revise"
                className="gap-1.5 bg-transparent"
              >
                <RotateCcw className="size-3.5" />
                {t("list.revise")}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
