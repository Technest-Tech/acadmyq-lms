"use client";

import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  GraduationCap,
  Inbox,
  Layers,
  RefreshCw,
  Search,
  SearchX,
  User,
  X,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  approveStudentReport,
  listStudentReportsForReview,
  rejectStudentReport,
  type StudentReportRow,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type SortKey = "newest" | "oldest";

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

/**
 * Student Reports review queue (admin-facing). Teachers submit monthly progress reports and the
 * owner/support triages them here — filter by status, search across student/teacher/title/body,
 * and approve or reject one at a time or in bulk. Gated client-side by student_report.review;
 * every endpoint enforces it for real with Gate::authorize.
 */
export function StudentReportReviewsScreen() {
  const t = useTranslations("studentReportReviews");
  const locale = useLocale();
  const { can } = useAuth();

  const [reports, setReports] = useState<StudentReportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [filter, setFilter] = useState<StatusFilter>("PENDING");
  const [query, setQuery] = useState("");
  const [teacher, setTeacher] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const canReview = can("student_report.review");

  const load = useCallback(async () => {
    setError(null);
    try {
      const { reports: rows } = await listStudentReportsForReview();
      setReports(rows);
      // Drop selections whose reports are gone or no longer pending.
      setSelected((prev) => {
        const pending = new Set(
          rows.filter((r) => r.status === "PENDING").map((r) => r.id),
        );
        return new Set([...prev].filter((id) => pending.has(id)));
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Without the capability the screen renders a permission notice — don't fetch a certain 403.
    if (!canReview) return;
    void load();
  }, [canReview, load]);

  const counts = useMemo(
    () => ({
      ALL: reports.length,
      PENDING: reports.filter((r) => r.status === "PENDING").length,
      APPROVED: reports.filter((r) => r.status === "APPROVED").length,
      REJECTED: reports.filter((r) => r.status === "REJECTED").length,
    }),
    [reports],
  );

  /** Every teacher who has ever submitted — the teacher dropdown's options. */
  const teachers = useMemo(
    () =>
      [...new Set(reports.map((r) => r.teacher_name).filter(Boolean))].sort(
        (a, b) => String(a).localeCompare(String(b)),
      ) as string[],
    [reports],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = reports.filter((r) => {
      if (filter !== "ALL" && r.status !== filter) return false;
      if (teacher && r.teacher_name !== teacher) return false;
      if (!q) return true;
      return [r.title, r.body, r.student_name, r.teacher_name]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
    });
    return rows.sort((a, b) => {
      const diff =
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return sort === "newest" ? diff : -diff;
    });
  }, [reports, filter, teacher, query, sort]);

  const selectablePending = useMemo(
    () => visible.filter((r) => r.status === "PENDING"),
    [visible],
  );

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (!canReview) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const filtersActive = query.trim() !== "" || teacher !== "";

  return (
    <div className="w-full space-y-6 pb-24">
      {/* ── Hero header ──────────────────────────────────────────────── */}
      <div className="from-primary/[0.07] via-card to-card ring-foreground/[0.06] relative overflow-hidden rounded-2xl bg-gradient-to-br p-5 shadow-sm ring-1">
        <div className="bg-primary/10 pointer-events-none absolute -top-16 -end-16 size-40 rounded-full blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 ring-primary/15 flex size-11 shrink-0 items-center justify-center rounded-xl ring-1">
              <ClipboardCheck className="text-primary size-5.5" aria-hidden />
            </div>
            <div>
              <h1 className="text-xl leading-tight font-semibold">
                {t("title")}
              </h1>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {t("subtitle")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {counts.PENDING > 0 && (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset",
                  STATUS_STYLE.PENDING.chip,
                )}
                data-testid="pending-banner"
              >
                <Clock3 className="size-3.5" aria-hidden />
                {t("pendingBanner", { count: counts.PENDING })}
              </span>
            )}
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
        </div>
      </div>

      {error && (
        <AlertBanner
          variant="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}

      {/* ── Counts, which double as the status filter ────────────────── */}
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

      {/* ── Search / teacher / sort ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute inset-y-0 start-3 my-auto size-4"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            data-testid="search"
            className={cn(FIELD_CLASS, "ps-9 pe-9")}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("actions.clearSearch")}
              className="text-muted-foreground hover:text-foreground absolute inset-y-0 end-2.5 my-auto flex size-5 items-center justify-center rounded-md"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {teachers.length > 1 && (
          <select
            value={teacher}
            onChange={(e) => setTeacher(e.target.value)}
            aria-label={t("allTeachers")}
            data-testid="teacher-filter"
            className={cn(FIELD_CLASS, "w-auto min-w-44")}
          >
            <option value="">{t("allTeachers")}</option>
            {teachers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={() => setSort((s) => (s === "newest" ? "oldest" : "newest"))}
          data-testid="sort"
          className="h-[38px] gap-1.5"
        >
          {sort === "newest" ? (
            <ArrowDownWideNarrow className="size-3.5" />
          ) : (
            <ArrowUpWideNarrow className="size-3.5" />
          )}
          {t(`sort.${sort}`)}
        </Button>
      </div>

      {/* ── Select-all affordance for the bulk bar ───────────────────── */}
      {selectablePending.length > 0 && (
        <label className="text-muted-foreground flex w-fit cursor-pointer items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            data-testid="select-all"
            checked={
              selected.size > 0 && selected.size === selectablePending.length
            }
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? new Set(selectablePending.map((r) => r.id))
                  : new Set(),
              )
            }
            className="accent-primary size-4 rounded"
          />
          {t("bulk.selectAll", { count: selectablePending.length })}
        </label>
      )}

      {/* ── The queue ────────────────────────────────────────────────── */}
      {loading ? (
        <SkeletonCards count={3} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={filtersActive ? SearchX : Inbox}
          title={filtersActive ? t("noResults") : t(`empty.${filter}`)}
          hint={filtersActive ? t("noResultsHint") : undefined}
          action={
            filtersActive ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setTeacher("");
                }}
                data-testid="clear-filters"
              >
                {t("actions.clearFilters")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-3" data-testid="student-reports-list">
          {visible.map((r) => (
            <StudentReportCard
              key={r.id}
              report={r}
              locale={locale}
              selected={selected.has(r.id)}
              onToggleSelect={() => toggleSelected(r.id)}
              onChanged={load}
              onError={setError}
            />
          ))}
        </ul>
      )}

      {/* ── Bulk action bar ──────────────────────────────────────────── */}
      {selected.size > 0 && (
        <BulkBar
          ids={[...selected]}
          onDone={async () => {
            setSelected(new Set());
            await load();
          }}
          onClear={() => setSelected(new Set())}
          onError={setError}
        />
      )}
    </div>
  );
}

/** Sticky bar that appears once reports are ticked — decide many at once with one shared note. */
function BulkBar({
  ids,
  onDone,
  onClear,
  onError,
}: {
  ids: string[];
  onDone: () => Promise<void>;
  onClear: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("studentReportReviews");
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  const busy = progress !== null;

  async function decideAll(approve: boolean) {
    setProgress(0);
    try {
      for (const [i, id] of ids.entries()) {
        if (approve) await approveStudentReport(id, note || undefined);
        else await rejectStudentReport(id, note || undefined);
        setProgress(i + 1);
      }
      setNote("");
      await onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
      // Refresh anyway — some of the batch may already have gone through.
      await onDone();
    } finally {
      setProgress(null);
    }
  }

  return (
    <div
      className="sticky bottom-4 z-20 mx-auto w-full max-w-3xl"
      data-testid="bulk-bar"
    >
      <div className="bg-card/95 ring-foreground/10 flex flex-wrap items-center gap-2 rounded-2xl border p-2.5 shadow-lg ring-1 backdrop-blur-md">
        <span className="bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold">
          {busy
            ? t("bulk.working", { done: progress, total: ids.length })
            : t("bulk.selected", { count: ids.length })}
        </span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder={t("notePlaceholder")}
          aria-label={t("notePlaceholder")}
          data-testid="bulk-note"
          className={cn(FIELD_CLASS, "min-w-40 flex-1")}
        />
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void decideAll(true)}
          data-testid="bulk-approve"
          className="gap-1.5"
        >
          <Check className="size-3.5" />
          {t("bulk.approve")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void decideAll(false)}
          data-testid="bulk-reject"
          className="border-destructive/30 text-destructive hover:bg-destructive/10 gap-1.5"
        >
          <X className="size-3.5" />
          {t("bulk.reject")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onClear}
          data-testid="bulk-clear"
        >
          {t("bulk.clear")}
        </Button>
      </div>
    </div>
  );
}

function StudentReportCard({
  report: r,
  locale,
  selected,
  onToggleSelect,
  onChanged,
  onError,
}: {
  report: StudentReportRow;
  locale: string;
  selected: boolean;
  onToggleSelect: () => void;
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
  const style = STATUS_STYLE[r.status];
  const month = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
    year: "numeric",
    month: "long",
  }).format(new Date(r.period_month));

  return (
    <li
      className={cn(
        "bg-card ring-foreground/[0.06] relative overflow-hidden rounded-2xl border shadow-sm ring-1 transition-shadow hover:shadow-md",
        selected && "border-primary/40 ring-primary/20 ring-2",
      )}
      data-testid="student-report-card"
      data-status={r.status}
    >
      {/* Status rail down the inline-start edge */}
      <span
        className={cn("absolute inset-y-0 start-0 w-1", style.rail)}
        aria-hidden
      />

      <div className="space-y-3 p-4 ps-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {pending && (
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggleSelect}
                aria-label={t("bulk.selectOne", { title: r.title })}
                data-testid="select-report"
                className="accent-primary mt-3 size-4 shrink-0 rounded"
              />
            )}
            <InitialsAvatar name={r.student_name} />
            <div className="min-w-0">
              <p className="leading-tight font-semibold">{r.title}</p>
              <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <MetaItem icon={User}>{r.student_name ?? "—"}</MetaItem>
                {r.teacher_name && (
                  <MetaItem icon={GraduationCap}>{r.teacher_name}</MetaItem>
                )}
                <MetaItem icon={CalendarClock}>{month}</MetaItem>
                <MetaItem icon={FileText}>
                  {t("submitted", {
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
          moreLabel={t("actions.showMore")}
          lessLabel={t("actions.showLess")}
        />

        {/* The owner's decision, once made */}
        {!pending && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-xl px-3 py-2 text-xs ring-1 ring-inset",
              style.chip,
            )}
            data-testid="decision"
          >
            <style.icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p>
              <span className="font-semibold">
                {t(`decidedBy.${r.status}`, {
                  who: r.reviewed_by_name ?? "—",
                  when: r.reviewed_at ? relativeTime(r.reviewed_at, locale) : "—",
                })}
              </span>
              {r.review_note && (
                <span className="opacity-90"> — {r.review_note}</span>
              )}
            </p>
          </div>
        )}

        {pending && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder={t("notePlaceholder")}
              aria-label={t("notePlaceholder")}
              className={cn(FIELD_CLASS, "min-w-40 flex-1")}
            />
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
        )}
      </div>
    </li>
  );
}
