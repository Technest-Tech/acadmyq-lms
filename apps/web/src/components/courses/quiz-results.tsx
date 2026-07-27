"use client";

import {
  ArrowLeft,
  BarChart3,
  CircleHelp,
  ListChecks,
  Target,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  EmptyState,
  InitialsAvatar,
  MiniStat,
  PageHeader,
  Panel,
  Sk,
  StatusPill,
  tableHeadClass,
  tdClass,
  thClass,
  trClass,
} from "@/components/courses/lms-ui";
import { AlertBanner } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { getQuizResults, type QuizResults } from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Absolute-date formatting for a submission timestamp; the list is already ordered newest-first. */
function formatWhen(iso: string | null, locale: string): string {
  if (iso === null) return "—";
  return new Date(iso).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * How learners actually did on one quiz (docs/lms/04 §quizzes). Three reads, in the order staff
 * ask them: the headline numbers, then which QUESTIONS are tripping people up, then the individual
 * attempts. The per-question correct-rate uses the same rule as live grading, so it reconciles with
 * the scores beside it.
 */
export function QuizResultsScreen({ quizId }: { quizId: string }) {
  const t = useTranslations("courses.quizzes");
  const tc = useTranslations("courses");
  const locale = useLocale();
  const { can } = useAuth();

  const [data, setData] = useState<QuizResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getQuizResults(quizId)
      .then(setData)
      .catch(() => setError(tc("alerts.failed")))
      .finally(() => setLoading(false));
  }, [quizId, tc]);

  if (!can("course.read")) {
    return (
      <div className="bg-card rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
        <EmptyState Icon={ListChecks} color="slate" title={tc("noAccess")} />
      </div>
    );
  }

  const summary = data?.summary;
  const title = data?.quiz.title?.trim() || t("untitled");
  // Pass rate is per ATTEMPT; `passed_learners` answers the different question of who ever passed.
  const passRate =
    summary && summary.attempts > 0
      ? Math.round((100 * summary.passed) / summary.attempts)
      : null;

  return (
    <div className="space-y-5 pb-4">
      <Link
        href="/lms/quizzes"
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ms-1")}
      >
        <ArrowLeft className="rtl:rotate-180" /> {t("backToQuizzes")}
      </Link>

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {loading ? (
        <Sk className="h-28 rounded-2xl" />
      ) : data === null ? (
        <div className="bg-card rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
          <EmptyState Icon={ListChecks} color="slate" title={tc("notFound")} />
        </div>
      ) : (
        <>
          <PageHeader
            Icon={ListChecks}
            color="emerald"
            title={title}
            subtitle={data.quiz.course_title}
            actions={
              <Link
                href={`/lms/courses/${data.quiz.course_id}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                {t("openCourse")}
              </Link>
            }
          />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MiniStat
              Icon={Users}
              color="cyan"
              label={t("stats.attempts")}
              value={summary?.attempts ?? null}
              locale={locale}
            />
            <MiniStat
              Icon={Users}
              color="violet"
              label={t("stats.learners")}
              value={summary?.learners ?? null}
              locale={locale}
            />
            <MiniStat
              Icon={BarChart3}
              color="emerald"
              label={t("stats.passRate")}
              value={passRate === null ? "—" : `${passRate}%`}
              locale={locale}
            />
            <MiniStat
              Icon={Target}
              color="amber"
              label={t("stats.avgScore")}
              value={summary?.avg_score === null ? "—" : `${summary?.avg_score}%`}
              locale={locale}
            />
          </div>

          <p className="text-muted-foreground text-xs">
            {t("passMarkNote", {
              mark: data.quiz.pass_mark,
              learners: summary?.passed_learners ?? 0,
              total: summary?.learners ?? 0,
            })}
          </p>

          <Panel Icon={CircleHelp} color="violet" title={t("questionBreakdown")} flush>
            {data.questions.length === 0 ? (
              <EmptyState
                Icon={CircleHelp}
                color="violet"
                title={t("noQuestionsYet")}
                description={t("noQuestionsYetHint")}
              />
            ) : (
              <ul className="divide-y">
                {data.questions.map((q, i) => (
                  <li key={q.id} className="flex items-start gap-3 px-5 py-3.5">
                    <span className="text-muted-foreground mt-0.5 shrink-0 text-xs font-semibold tabular-nums">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{q.prompt}</p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {tc(`quiz.types.${q.type}`)} · {t("pts", { points: q.points })}
                      </p>
                      {q.correct_rate !== null && (
                        <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              q.correct_rate >= 70
                                ? "bg-emerald-500"
                                : q.correct_rate >= 40
                                  ? "bg-amber-500"
                                  : "bg-rose-500",
                            )}
                            style={{ width: `${q.correct_rate}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-end">
                      {q.correct_rate === null ? (
                        <span className="text-muted-foreground text-sm">—</span>
                      ) : (
                        <>
                          <p className="text-sm font-semibold tabular-nums">{q.correct_rate}%</p>
                          <p className="text-muted-foreground text-xs tabular-nums">
                            {t("correctOf", { correct: q.correct_count, total: q.attempts })}
                          </p>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel Icon={Users} color="cyan" title={t("attemptsTitle")} flush>
            {data.attempts.length === 0 ? (
              <EmptyState
                Icon={Users}
                color="cyan"
                title={t("noAttempts")}
                description={t("noAttemptsHint")}
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className={tableHeadClass}>
                      <tr>
                        <th className={thClass}>{t("col.learner")}</th>
                        <th className={thClass}>{t("col.score")}</th>
                        <th className={thClass}>{t("col.outcome")}</th>
                        <th className={thClass}>{t("col.submitted")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.attempts.map((a) => (
                        <tr key={a.id} className={trClass}>
                          <td className={tdClass}>
                            <div className="flex items-center gap-2.5">
                              <InitialsAvatar name={a.learner_name} />
                              <div className="min-w-0">
                                <p className="truncate font-medium">{a.learner_name}</p>
                                <p className="text-muted-foreground truncate text-xs">
                                  {a.learner_email}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className={cn(tdClass, "font-semibold tabular-nums")}>
                            {a.score === null ? "—" : `${a.score}%`}
                          </td>
                          <td className={tdClass}>
                            <StatusPill tone={a.passed ? "emerald" : "rose"}>
                              {a.passed ? t("passed") : t("failed")}
                            </StatusPill>
                          </td>
                          <td className={cn(tdClass, "text-muted-foreground whitespace-nowrap")}>
                            {formatWhen(a.submitted_at, locale)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.attempts_truncated && (
                  <p className="text-muted-foreground border-t px-5 py-3 text-xs">
                    {t("truncated", {
                      shown: formatNumber(data.attempts.length, locale),
                      total: formatNumber(summary?.attempts ?? 0, locale),
                    })}
                  </p>
                )}
              </>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
