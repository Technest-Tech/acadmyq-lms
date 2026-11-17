"use client";

import { academyDayStartIso, academyFormat, academyToday } from "@/lib/academy-clock";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  FileWarning,
  Loader2,
  MessageCircle,
  NotebookText,
  PencilLine,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttendanceReportModal } from "@/components/attendance/attendance-report-modal";
import { StatusBadge } from "@/components/attendance/status-badge";
import { useAuth } from "@/components/auth-provider";
import {
  LessonReportBody,
  reportAnswers,
  reportAsText,
  reportPlainText,
  reportText,
} from "@/components/reports/lesson-report-body";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import { PageHero } from "@/components/ui/page-hero";
import {
  ApiError,
  listLessonReports,
  listStudents,
  listTeachers,
  type LessonReportLogRow,
  type ReportField,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { numeralLocale } from "@/lib/numerals";
import { cn } from "@/lib/utils";

export type ReportsTab = "written" | "missing";
export type ReportsPeriod = "all" | "month" | "last" | "quarter";
type Period = ReportsPeriod;

const PAGE_SIZE = 20;
const PERIODS: Period[] = ["all", "month", "last", "quarter"];

/** "YYYY-MM-01" of the month `back` months before the academy's current one. */
function monthStart(back: number): string {
  const today = academyToday();
  const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - back, 1, 12));
  return d.toISOString().slice(0, 10);
}

/** The window a period chip stands for, as the instants the API takes. */
function periodWindow(period: Period): { from?: string; to?: string } {
  switch (period) {
    case "month":
      return { from: academyDayStartIso(monthStart(0)) };
    case "last":
      return { from: academyDayStartIso(monthStart(1)), to: academyDayStartIso(monthStart(0)) };
    case "quarter":
      return { from: academyDayStartIso(monthStart(2)) };
    default:
      return {};
  }
}

/**
 * سجل التقارير — every private lesson's report in one place. Teachers could only reach an old report
 * through a salary statement (Ahmed, 2026-11-17: "مش بيقدروا يلاقوا التقارير الماضيه بسهوله غير ف
 * المرتبات"). Two tabs: the reports written, newest first, and the delivered lessons still owed one.
 * A report opens whole (fields, scores, text), with previous/next so a student's run of lessons reads
 * like a notebook, and an edit button that opens the lesson's own popup.
 *
 * A teacher sees their own lessons (the API scopes them); the office sees everyone's and may pick a
 * teacher. `initialTab` / `initialStudent` / `initialPeriod` come from the URL (the dashboard links here).
 */
export function LessonReportsLog({
  initialTab = "written",
  initialStudent = "",
  initialPeriod = "all",
}: {
  initialTab?: ReportsTab;
  initialStudent?: string;
  initialPeriod?: ReportsPeriod;
}) {
  const t = useTranslations("lessonReports");
  const locale = useLocale();
  const { session, can } = useAuth();
  const isTeacher = session?.role === "TEACHER";
  const canWrite = can("session.write_report");

  const [tab, setTab] = useState<ReportsTab>(initialTab);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [studentId, setStudentId] = useState(initialStudent);
  const [teacherId, setTeacherId] = useState("");
  const [period, setPeriod] = useState<Period>(initialPeriod);

  const [rows, setRows] = useState<LessonReportLogRow[] | null>(null);
  const [fields, setFields] = useState<ReportField[]>([]);
  const [counts, setCounts] = useState<{ written: number; missing: number } | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [students, setStudents] = useState<{ value: string; label: string }[]>([]);
  const [teachers, setTeachers] = useState<{ value: string; label: string }[]>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [editing, setEditing] = useState<LessonReportLogRow | null>(null);

  // Typing settles before the list asks again.
  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    if (!can("student.read")) return;
    listStudents({ pageSize: 100, sort: "name" })
      .then((r) => setStudents(r.rows.map((s) => ({ value: s.id, label: s.full_name }))))
      .catch(() => setStudents([]));
  }, [can]);

  useEffect(() => {
    if (isTeacher || !can("teacher.read")) return;
    listTeachers({ pageSize: 100 })
      .then((r) =>
        setTeachers(
          r.rows
            .map((tr) => ({ value: tr.id, label: tr.full_name }))
            .sort((a, b) => a.label.localeCompare(b.label, locale)),
        ),
      )
      .catch(() => setTeachers([]));
  }, [can, isTeacher, locale]);

  const query = useMemo(() => {
    const span = periodWindow(period);
    return {
      search,
      pageSize: PAGE_SIZE,
      filter: {
        tab,
        student_id: studentId,
        teacher_id: teacherId,
        from: span.from ?? "",
        to: span.to ?? "",
      },
    };
  }, [search, tab, studentId, teacherId, period]);

  // A request that lands after a newer one is dropped, so a fast typist never sees stale rows.
  const generation = useRef(0);
  const load = useCallback(async () => {
    const mine = ++generation.current;
    setRows(null);
    setError(null);
    try {
      const res = await listLessonReports({ ...query, page: 1 });
      if (mine !== generation.current) return;
      setRows(res.rows);
      setFields(res.fields);
      setCounts(res.counts);
      setTotal(res.total);
      setPage(1);
    } catch (err) {
      if (mine !== generation.current) return;
      setError(err instanceof ApiError ? err.message : String(err));
      setRows([]);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    const mine = generation.current;
    setLoadingMore(true);
    try {
      const res = await listLessonReports({ ...query, page: page + 1 });
      if (mine !== generation.current) return;
      setRows((prev) => [...(prev ?? []), ...res.rows]);
      setPage(page + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const dayFmt = useMemo(() => academyFormat(numeralLocale(locale), { weekday: "short", day: "numeric" }), [locale]);
  const monthFmt = useMemo(() => academyFormat(numeralLocale(locale), { month: "long", year: "numeric" }), [locale]);
  const timeFmt = useMemo(() => academyFormat(numeralLocale(locale), { hour: "numeric", minute: "2-digit" }), [locale]);
  const fullFmt = useMemo(
    () => academyFormat(numeralLocale(locale), { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }),
    [locale],
  );

  // Rows under their month: a long history reads by month, the way salaries and bills do.
  const months = useMemo(() => {
    const out: { key: string; label: string; items: { row: LessonReportLogRow; index: number }[] }[] = [];
    (rows ?? []).forEach((row, index) => {
      const label = monthFmt.format(new Date(row.scheduled_at_utc));
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push({ row, index });
      else out.push({ key: `${label}-${index}`, label, items: [{ row, index }] });
    });
    return out;
  }, [rows, monthFmt]);

  const filtered = search !== "" || studentId !== "" || teacherId !== "" || period !== "all";
  const opened = openIndex !== null ? (rows?.[openIndex] ?? null) : null;

  return (
    <div className="space-y-4" data-testid="lesson-reports-log">
      <PageHero
        icon={NotebookText}
        title={t("title")}
        subtitle={t(isTeacher ? "subtitleTeacher" : "subtitle")}
        latticeId="lesson-reports-lattice"
      />

      {/* ── The two tabs, each with its count under the current filters ── */}
      <div className="grid grid-cols-2 gap-2 sm:max-w-md" role="tablist">
        {(["written", "missing"] as const).map((key) => {
          const active = tab === key;
          const count = counts?.[key];
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              data-testid={`reports-tab-${key}`}
              className={cn(
                "flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-start text-sm font-semibold transition-colors",
                active
                  ? key === "missing"
                    ? "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
                    : "border-primary bg-primary/10 text-foreground"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                {key === "written" ? <NotebookText className="size-4 shrink-0" aria-hidden /> : <FileWarning className="size-4 shrink-0" aria-hidden />}
                <span className="truncate">{t(`tabs.${key}`)}</span>
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums",
                  key === "missing" && (count ?? 0) > 0 ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground",
                )}
              >
                {count === undefined ? "…" : formatNumber(count, locale)}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Filters ── */}
      <div className="bg-card space-y-3 rounded-2xl border p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t("search")}</span>
            <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("search")}
              data-testid="reports-search"
              className="border-input bg-background focus:border-primary focus:ring-primary/15 h-10 w-full rounded-xl border ps-9 pe-3 text-sm outline-none focus:ring-3"
            />
          </label>
          {students.length > 0 && (
            <Combobox
              options={[{ value: "", label: t("allStudents") }, ...students]}
              value={studentId}
              onChange={setStudentId}
              placeholder={t("allStudents")}
              searchPlaceholder={t("findStudent")}
              className="sm:w-56"
              data-testid="reports-student"
            />
          )}
          {teachers.length > 0 && (
            <Combobox
              options={[{ value: "", label: t("allTeachers") }, ...teachers]}
              value={teacherId}
              onChange={setTeacherId}
              placeholder={t("allTeachers")}
              searchPlaceholder={t("findTeacher")}
              className="sm:w-56"
              data-testid="reports-teacher"
            />
          )}
        </div>
        <div className="no-scrollbar -mx-1 flex items-center gap-1.5 overflow-x-auto px-1">
          <CalendarDays className="text-muted-foreground size-4 shrink-0" aria-hidden />
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              data-testid={`reports-period-${p}`}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                period === p ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground",
              )}
            >
              {t(`period.${p}`)}
            </button>
          ))}
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                setSearch("");
                setStudentId("");
                setTeacherId("");
                setPeriod("all");
              }}
              className="text-muted-foreground hover:text-foreground ms-auto inline-flex shrink-0 items-center gap-1 px-2 text-xs font-medium"
            >
              <X className="size-3.5" aria-hidden />
              {t("clear")}
            </button>
          )}
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {/* ── The list ── */}
      {rows === null ? (
        <div className="space-y-2" aria-busy>
          {[1, 2, 3, 4].map((k) => (
            <div key={k} className="bg-muted h-24 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card flex flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-14 text-center">
          {tab === "missing" && !filtered ? (
            <>
              <Check className="size-10 text-emerald-500" aria-hidden />
              <p className="font-semibold">{t("noneMissing")}</p>
            </>
          ) : (
            <>
              <NotebookText className="text-muted-foreground size-10" aria-hidden />
              <p className="font-semibold">{t(filtered ? "noMatch" : "noneWritten")}</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {months.map((month) => (
            <section key={month.key} className="space-y-2">
              <h2 className="text-muted-foreground px-1 text-xs font-bold tracking-wide">{month.label}</h2>
              <ul className="space-y-2">
                {month.items.map(({ row, index }) => (
                  <li key={row.id}>
                    <ReportCard
                      row={row}
                      fields={fields}
                      tab={tab}
                      showTeacher={!isTeacher}
                      canWrite={canWrite}
                      day={dayFmt.format(new Date(row.scheduled_at_utc))}
                      time={timeFmt.format(new Date(row.scheduled_at_utc))}
                      onOpen={() => (tab === "missing" ? setEditing(row) : setOpenIndex(index))}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {rows.length < total && (
            <div className="flex justify-center">
              <Button variant="outline" size="lg" onClick={() => void loadMore()} disabled={loadingMore} data-testid="reports-more">
                {loadingMore && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t("more", { shown: formatNumber(rows.length, locale), total: formatNumber(total, locale) })}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── One report, whole ── */}
      <Modal
        open={opened !== null}
        onClose={() => setOpenIndex(null)}
        title={opened?.student_name ?? t("title")}
        description={opened ? fullFmt.format(new Date(opened.scheduled_at_utc)) : undefined}
        size="lg"
      >
        {opened && openIndex !== null && (
          <ReportDetail
            row={opened}
            fields={fields}
            showTeacher={!isTeacher}
            writtenAt={opened.written_at ? fullFmt.format(new Date(opened.written_at)) : null}
            canWrite={canWrite}
            // The list is newest first: "previous" is the older lesson, further down.
            onOlder={openIndex < (rows?.length ?? 0) - 1 ? () => setOpenIndex(openIndex + 1) : undefined}
            onNewer={openIndex > 0 ? () => setOpenIndex(openIndex - 1) : undefined}
            onEdit={() => {
              setEditing(opened);
              setOpenIndex(null);
            }}
          />
        )}
      </Modal>

      {editing && (
        <AttendanceReportModal
          sessionId={editing.id}
          studentName={editing.student_name}
          open
          onClose={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ── A row ────────────────────────────────────────────────────────────────────

function ReportCard({
  row,
  fields,
  tab,
  showTeacher,
  canWrite,
  day,
  time,
  onOpen,
}: {
  row: LessonReportLogRow;
  fields: ReportField[];
  tab: ReportsTab;
  showTeacher: boolean;
  canWrite: boolean;
  day: string;
  time: string;
  onOpen: () => void;
}) {
  const t = useTranslations("lessonReports");
  const locale = useLocale();
  const answers = reportAnswers(row.report_values, fields);
  const text = reportText(row.report_values);
  const label = (f: ReportField) => (locale === "ar" ? f.label_ar : f.label_en) || f.label_ar;
  const missing = tab === "missing";
  const [weekday, dayNum] = splitDay(day);

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={missing && !canWrite}
      data-testid="report-row"
      className={cn(
        "bg-card group flex w-full items-stretch gap-3 rounded-2xl border p-3 text-start shadow-xs transition-colors sm:p-4",
        "hover:border-primary/40 hover:bg-muted/30 disabled:cursor-default disabled:hover:border-border disabled:hover:bg-card",
        missing && "border-amber-200 dark:border-amber-900/60",
      )}
    >
      {/* The date, as a page torn off a calendar. */}
      <span
        className={cn(
          "flex w-12 shrink-0 flex-col items-center justify-center rounded-xl py-1.5 text-center",
          missing ? "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "bg-primary/10 text-primary",
        )}
      >
        <span className="text-[10px] leading-tight font-semibold">{weekday}</span>
        <span className="text-lg leading-tight font-extrabold tabular-nums">{dayNum}</span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-bold">{row.student_name ?? "—"}</span>
          <StatusBadge status={row.status} className="text-[10px]" />
        </span>
        <span className="text-muted-foreground mt-0.5 block truncate text-xs">
          {[time, t("minutes", { count: formatNumber(row.duration_minutes, locale) }), showTeacher ? row.teacher_name : null].filter(Boolean).join(" · ")}
        </span>

        {missing ? (
          <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <FileWarning className="size-3.5" aria-hidden />
            {t("notWritten")}
          </span>
        ) : (
          <>
            {answers.length > 0 && (
              <span className="mt-1.5 flex flex-wrap gap-1">
                {answers.slice(0, 4).map((a) => (
                  <span key={a.field.key} className="bg-muted max-w-full truncate rounded-md px-1.5 py-0.5 text-[11px]">
                    <span className="text-muted-foreground">{label(a.field)}:</span> <span className="font-semibold">{a.value}</span>
                  </span>
                ))}
                {answers.length > 4 && (
                  <span className="text-muted-foreground px-1 text-[11px]">+{formatNumber(answers.length - 4, locale)}</span>
                )}
              </span>
            )}
            {text && <span className="text-foreground/80 mt-1.5 line-clamp-2 text-xs leading-relaxed">{reportPlainText(text)}</span>}
            <span className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
              {!row.written_by_teacher && row.written_by_name && (
                <span className="inline-flex items-center gap-1">
                  <UserRound className="size-3" aria-hidden />
                  {t("writtenBy", { name: row.written_by_name })}
                </span>
              )}
              {row.whatsapp_sent_at && (
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                  <MessageCircle className="size-3" aria-hidden />
                  {t("sentToParent")}
                </span>
              )}
            </span>
          </>
        )}
      </span>

      <span className="flex shrink-0 items-center">
        {missing ? (
          canWrite && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-white">
              <PencilLine className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">{t("write")}</span>
            </span>
          )
        ) : (
          <ChevronLeft className="text-muted-foreground size-4 transition-transform group-hover:-translate-x-0.5 ltr:rotate-180 ltr:group-hover:translate-x-0.5" aria-hidden />
        )}
      </span>
    </button>
  );
}

/** "الأحد ١٠" → ["الأحد", "١٠"]; the formatter's order differs by language, the number is the digits. */
function splitDay(day: string): [string, string] {
  const num = day.match(/[0-9٠-٩]+/)?.[0] ?? "";
  const name = day.replace(num, "").replace(/[,،]/g, "").trim();
  return [name, num];
}

// ── One report, opened ───────────────────────────────────────────────────────

function ReportDetail({
  row,
  fields,
  showTeacher,
  writtenAt,
  canWrite,
  onOlder,
  onNewer,
  onEdit,
}: {
  row: LessonReportLogRow;
  fields: ReportField[];
  showTeacher: boolean;
  writtenAt: string | null;
  canWrite: boolean;
  onOlder?: () => void;
  onNewer?: () => void;
  onEdit: () => void;
}) {
  const t = useTranslations("lessonReports");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);

  useEffect(() => setCopied(false), [row.id]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportAsText(row.report_values, fields, locale));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser that refuses the clipboard leaves the report on screen to select by hand.
    }
  }

  return (
    <div className="space-y-4" data-testid="report-detail">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusBadge status={row.status} />
        <span className="bg-muted rounded-full px-2 py-0.5 font-medium">{t("minutes", { count: formatNumber(row.duration_minutes, locale) })}</span>
        {showTeacher && row.teacher_name && (
          <span className="bg-muted rounded-full px-2 py-0.5 font-medium">{row.teacher_name}</span>
        )}
        {row.whatsapp_sent_at && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <MessageCircle className="size-3" aria-hidden />
            {t("sentToParent")}
          </span>
        )}
      </div>

      <LessonReportBody values={row.report_values} fields={fields} />

      {(writtenAt || row.written_by_name) && (
        <p className="text-muted-foreground text-xs">
          {writtenAt && t("writtenAt", { at: writtenAt })}
          {!row.written_by_teacher && row.written_by_name ? ` · ${t("writtenBy", { name: row.written_by_name })}` : ""}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={onNewer} disabled={!onNewer} data-testid="report-newer">
            <ChevronRight className="size-4 ltr:rotate-180" aria-hidden />
            {t("newer")}
          </Button>
          <Button variant="outline" size="sm" onClick={onOlder} disabled={!onOlder} data-testid="report-older">
            {t("older")}
            <ChevronLeft className="size-4 ltr:rotate-180" aria-hidden />
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => void copy()} data-testid="report-copy">
            {copied ? <Check className="size-4 text-emerald-600" aria-hidden /> : <ClipboardCopy className="size-4" aria-hidden />}
            {copied ? t("copied") : t("copy")}
          </Button>
          {canWrite && (
            <Button size="sm" onClick={onEdit} data-testid="report-edit">
              <PencilLine className="size-4" aria-hidden />
              {t("edit")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
