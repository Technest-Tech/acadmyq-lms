"use client";

import {
  BarChart3,
  CircleHelp,
  ListChecks,
  Pencil,
  SearchX,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  EmptyState,
  MiniStat,
  PageHeader,
  SearchField,
  StatusPill,
  tableHeadClass,
  TableSkeleton,
  tdClass,
  thClass,
  trClass,
} from "@/components/courses/lms-ui";
import { AlertBanner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { listQuizzes, type QuizRow } from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/** A quiz's display name: its own title, else the lesson it hangs off, else a placeholder. */
function quizName(q: QuizRow, untitled: string): string {
  return q.title?.trim() || q.lesson_title?.trim() || untitled;
}

/**
 * Every quiz in the academy, across all courses (docs/lms/04 §quizzes). A quiz is otherwise only
 * reachable through the lesson it hangs off, so this is the only place staff can see them all —
 * including quizzes attached to no lesson, which no learner can reach.
 */
export function QuizzesManager() {
  const t = useTranslations("courses.quizzes");
  const tc = useTranslations("courses");
  const locale = useLocale();
  const { can } = useAuth();
  const canManage = can("course.manage");

  const [rows, setRows] = useState<QuizRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    listQuizzes()
      .then((r) => setRows(r.quizzes))
      .catch(() => setError(tc("alerts.failed")))
      .finally(() => setLoading(false));
  }, [tc]);

  // The endpoint returns every quiz in one call, so search filters client-side.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return rows;
    return rows.filter(
      (r) =>
        quizName(r, "").toLowerCase().includes(q) || r.course_title.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const stats = useMemo(() => {
    const attempts = rows.reduce((n, r) => n + r.attempt_count, 0);
    const passed = rows.reduce((n, r) => n + r.passed_count, 0);
    return {
      quizzes: rows.length,
      questions: rows.reduce((n, r) => n + r.question_count, 0),
      attempts,
      // Pass rate is meaningless with no attempts — show a dash rather than a misleading 0%.
      passRate: attempts > 0 ? `${Math.round((100 * passed) / attempts)}%` : "—",
    };
  }, [rows]);

  if (!can("course.read")) {
    return (
      <div className="bg-card rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
        <EmptyState Icon={ListChecks} color="slate" title={tc("noAccess")} />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        Icon={ListChecks}
        color="emerald"
        title={t("title")}
        subtitle={t("subtitle")}
      />

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniStat
          Icon={ListChecks}
          color="emerald"
          label={t("stats.quizzes")}
          value={loading ? null : stats.quizzes}
          locale={locale}
        />
        <MiniStat
          Icon={CircleHelp}
          color="violet"
          label={t("stats.questions")}
          value={loading ? null : stats.questions}
          locale={locale}
        />
        <MiniStat
          Icon={Users}
          color="cyan"
          label={t("stats.attempts")}
          value={loading ? null : stats.attempts}
          locale={locale}
        />
        <MiniStat
          Icon={BarChart3}
          color="amber"
          label={t("stats.passRate")}
          value={loading ? null : stats.passRate}
          locale={locale}
        />
      </div>

      {rows.length > 0 && (
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={t("search")}
          className="sm:max-w-sm"
        />
      )}

      <div className="bg-card overflow-hidden rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
        {loading ? (
          <table className="w-full text-sm">
            <TableSkeleton cols={6} />
          </table>
        ) : rows.length === 0 ? (
          <EmptyState
            Icon={ListChecks}
            color="emerald"
            title={t("empty")}
            description={t("emptyHint")}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            Icon={SearchX}
            color="slate"
            title={tc("noResults")}
            description={tc("noResultsHint")}
            action={
              <Button variant="outline" onClick={() => setSearch("")}>
                {tc("clearFilters")}
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={tableHeadClass}>
                <tr>
                  <th className={thClass}>{t("col.quiz")}</th>
                  <th className={thClass}>{t("col.questions")}</th>
                  <th className={thClass}>{t("col.attempts")}</th>
                  <th className={thClass}>{t("col.passRate")}</th>
                  <th className={thClass}>{t("col.avgScore")}</th>
                  <th className={cn(thClass, "text-end")}>{t("col.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((q) => {
                  const rate =
                    q.attempt_count > 0
                      ? Math.round((100 * q.passed_count) / q.attempt_count)
                      : null;
                  return (
                    <tr key={q.id} className={trClass}>
                      <td className={tdClass}>
                        <Link
                          href={`/lms/quizzes/${q.id}`}
                          className="hover:text-primary font-medium transition-colors"
                        >
                          {quizName(q, t("untitled"))}
                        </Link>
                        <p className="text-muted-foreground mt-0.5 text-xs">{q.course_title}</p>
                        {q.lesson_id === null && (
                          <StatusPill tone="amber" className="mt-1.5">
                            <TriangleAlert className="size-3" aria-hidden />
                            {t("unattached")}
                          </StatusPill>
                        )}
                      </td>
                      <td className={cn(tdClass, "tabular-nums")}>
                        {formatNumber(q.question_count, locale)}
                        <span className="text-muted-foreground ms-1 text-xs">
                          {t("pts", { points: q.total_points })}
                        </span>
                      </td>
                      <td className={cn(tdClass, "tabular-nums")}>
                        {formatNumber(q.attempt_count, locale)}
                        <span className="text-muted-foreground ms-1 text-xs">
                          {t("byLearners", { count: q.learner_count })}
                        </span>
                      </td>
                      <td className={cn(tdClass, "tabular-nums")}>
                        {rate === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <StatusPill tone={rate >= q.pass_mark ? "emerald" : "rose"}>
                            {rate}%
                          </StatusPill>
                        )}
                      </td>
                      <td className={cn(tdClass, "tabular-nums")}>
                        {q.avg_score === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          `${q.avg_score}%`
                        )}
                      </td>
                      <td className={cn(tdClass, "text-end whitespace-nowrap")}>
                        <Link
                          href={`/lms/quizzes/${q.id}`}
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                        >
                          <BarChart3 /> <span className="hidden sm:inline">{t("results")}</span>
                        </Link>
                        {canManage && (
                          <Link
                            href={`/lms/courses/${q.course_id}`}
                            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                          >
                            <Pencil /> <span className="hidden sm:inline">{t("edit")}</span>
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
