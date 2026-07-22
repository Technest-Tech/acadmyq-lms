"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  learnQuiz,
  learnSubmitQuiz,
  type LearnQuizPayload,
  type LearnQuizResult,
} from "@/lib/learn-api";
import { cn } from "@/lib/utils";

/**
 * The learner quiz runner (docs/lms/04). Fetches the quiz (no correct-answer flags), collects the
 * learner's choices, and submits for server-side grading. On a pass it calls `onPassed` so the player
 * refreshes progress (the lesson flips to COMPLETED, and the course may issue a certificate).
 */
export function QuizRunner({
  academy,
  lessonId,
  onPassed,
}: {
  academy: string;
  lessonId: string;
  onPassed?: () => void;
}) {
  const t = useTranslations("learn.quiz");
  const [data, setData] = useState<LearnQuizPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LearnQuizResult | null>(null);

  function load() {
    setResult(null);
    setSelected({});
    setError(null);
    setData(null);
    learnQuiz(academy, lessonId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : t("error")));
  }

  useEffect(load, [academy, lessonId]); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(questionId: string, optionId: string, type: string) {
    setSelected((s) => {
      const current = s[questionId] ?? [];
      if (type === "MULTIPLE") {
        return {
          ...s,
          [questionId]: current.includes(optionId)
            ? current.filter((id) => id !== optionId)
            : [...current, optionId],
        };
      }
      return { ...s, [questionId]: [optionId] };
    });
  }

  async function submit() {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const answers = data.questions.map((q) => ({
        question_id: q.id,
        selected_option_ids: selected[q.id] ?? [],
      }));
      const res = await learnSubmitQuiz(academy, lessonId, answers);
      setResult(res);
      if (res.passed) onPassed?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return <div className="rounded-xl border border-dashed p-4 text-sm text-red-600">{error}</div>;
  }
  if (!data) {
    return <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-sm">…</div>;
  }

  const answeredAll = data.questions.every((q) => (selected[q.id] ?? []).length > 0);
  const attemptsLeft =
    data.quiz.max_attempts === null ? null : data.quiz.max_attempts - data.quiz.attempts_used;

  // ── result screen ──
  if (result) {
    const canRetry = !result.passed && (result.max_attempts === null || result.attempts_used < result.max_attempts);
    return (
      <div className="space-y-4 rounded-xl border p-6 text-center">
        {result.passed ? (
          <CheckCircle2 className="mx-auto size-10 text-emerald-500" />
        ) : (
          <XCircle className="mx-auto size-10 text-red-500" />
        )}
        <p className="text-lg font-semibold">{t("score", { score: result.score })}</p>
        <p className={cn("text-sm", result.passed ? "text-emerald-600" : "text-red-600")}>
          {result.passed ? t("passed") : t("failed", { mark: data.quiz.pass_mark })}
        </p>
        {result.certificate && (
          <p className="text-sm font-medium text-emerald-600">{t("certificateEarned")}</p>
        )}
        {canRetry && (
          <button
            type="button"
            onClick={load}
            className="border-input hover:bg-muted rounded-lg border px-4 py-2 text-sm"
          >
            {t("retry")}
          </button>
        )}
      </div>
    );
  }

  // ── already passed on a previous attempt ──
  if (data.quiz.passed) {
    return (
      <div className="space-y-3 rounded-xl border p-6 text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-500" />
        <p className="font-medium">{t("alreadyPassed", { score: data.quiz.best_score ?? 0 })}</p>
        <button
          type="button"
          onClick={load}
          className="border-input hover:bg-muted rounded-lg border px-4 py-2 text-sm"
        >
          {t("retake")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>{t("passMark", { mark: data.quiz.pass_mark })}</span>
        {attemptsLeft !== null && <span>{t("attemptsLeft", { n: attemptsLeft })}</span>}
      </div>

      {data.questions.map((q, i) => (
        <div key={q.id} className="space-y-2 rounded-xl border p-4">
          <p className="text-sm font-medium">
            {i + 1}. {q.prompt}
          </p>
          <ul className="space-y-1.5">
            {q.options.map((o) => {
              const isSel = (selected[q.id] ?? []).includes(o.id);
              return (
                <li key={o.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm transition-colors",
                      isSel ? "border-primary bg-primary/5" : "border-input hover:bg-muted",
                    )}
                  >
                    <input
                      type={q.type === "MULTIPLE" ? "checkbox" : "radio"}
                      name={`q-${q.id}`}
                      checked={isSel}
                      onChange={() => choose(q.id, o.id, q.type)}
                      className="size-4"
                    />
                    {o.text}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {error && <div className="text-sm text-red-600">{error}</div>}

      <button
        type="button"
        onClick={submit}
        disabled={busy || !answeredAll || attemptsLeft === 0}
        className="bg-primary text-primary-foreground w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50"
      >
        {t("submit")}
      </button>
    </div>
  );
}
