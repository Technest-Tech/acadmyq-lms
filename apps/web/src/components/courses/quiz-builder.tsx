"use client";

import { GripVertical, ListChecks, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Field, inputClass, selectClass } from "@/components/courses/form-bits";
import { EmptyState, Sk } from "@/components/courses/lms-ui";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  getQuiz,
  QUESTION_TYPES,
  saveQuiz,
  type QuestionType,
  type QuizQuestionInput,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/** Editable draft of a question (mirrors QuizQuestionInput, always with concrete option rows). */
type Draft = {
  prompt: string;
  type: QuestionType;
  points: number;
  options: Array<{ text: string; is_correct: boolean }>;
};

const blankOptions = (type: QuestionType) =>
  type === "TRUE_FALSE"
    ? [
        { text: "True", is_correct: true },
        { text: "False", is_correct: false },
      ]
    : [
        { text: "", is_correct: true },
        { text: "", is_correct: false },
      ];

/**
 * The quiz builder (docs/lms/04). Loads a quiz by id, edits its pass mark, attempt limit and
 * questions/options, and saves the whole thing (the API replaces questions atomically). Correct
 * answers are marked with a radio (SINGLE / TRUE_FALSE) or checkboxes (MULTIPLE), and the marked
 * option is tinted green so a long quiz can be proof-read at a glance.
 */
export function QuizBuilder({
  courseId,
  quizId,
  onClose,
  onSaved,
}: {
  courseId: string;
  quizId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("courses.quiz");
  const [loading, setLoading] = useState(true);
  const [passMark, setPassMark] = useState(60);
  const [maxAttempts, setMaxAttempts] = useState<number | "">("");
  const [questions, setQuestions] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getQuiz(courseId, quizId)
      .then((d) => {
        setPassMark(d.quiz.pass_mark);
        setMaxAttempts(d.quiz.max_attempts ?? "");
        setQuestions(
          d.questions.map((q) => ({
            prompt: q.prompt,
            type: q.type,
            points: q.points,
            options: q.options.map((o) => ({ text: o.text, is_correct: o.is_correct })),
          })),
        );
      })
      .catch(() => setError(t("loadFailed")))
      .finally(() => setLoading(false));
  }, [courseId, quizId, t]);

  function patch(i: number, next: Partial<Draft>) {
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...next } : q)));
  }
  function setType(i: number, type: QuestionType) {
    const q = questions[i];
    if (!q) return;
    // Switching to/from TRUE_FALSE resets the options; MULTIPLE↔SINGLE keeps them.
    const options =
      type === "TRUE_FALSE" || q.type === "TRUE_FALSE" ? blankOptions(type) : q.options;
    patch(i, { type, options });
  }
  function setOption(i: number, oi: number, next: Partial<{ text: string; is_correct: boolean }>) {
    const q = questions[i];
    if (!q) return;
    let options = q.options.map((o, idx) => (idx === oi ? { ...o, ...next } : o));
    // Radio semantics for single-answer questions: only one option stays correct.
    if (next.is_correct === true && q.type !== "MULTIPLE") {
      options = options.map((o, idx) => ({ ...o, is_correct: idx === oi }));
    }
    patch(i, { options });
  }

  const valid =
    questions.length > 0 &&
    questions.every(
      (q) =>
        q.prompt.trim() !== "" &&
        q.options.length >= 2 &&
        q.options.every((o) => o.text.trim() !== "") &&
        (q.type === "MULTIPLE"
          ? q.options.some((o) => o.is_correct)
          : q.options.filter((o) => o.is_correct).length === 1),
    );

  const totalPoints = questions.reduce((n, q) => n + q.points, 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload: QuizQuestionInput[] = questions.map((q) => ({
        prompt: q.prompt.trim(),
        type: q.type,
        points: q.points,
        options: q.options.map((o) => ({ text: o.text.trim(), is_correct: o.is_correct })),
      }));
      await saveQuiz(courseId, quizId, {
        pass_mark: passMark,
        max_attempts: maxAttempts === "" ? null : Number(maxAttempts),
        questions: payload,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  function addQuestion() {
    setQuestions((qs) => [
      ...qs,
      { prompt: "", type: "SINGLE", points: 1, options: blankOptions("SINGLE") },
    ]);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("title")}
      description={
        loading
          ? undefined
          : t("summary", { questions: questions.length, points: totalPoints })
      }
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={busy || loading || !valid}>
            {t("save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <AlertBanner variant="error" message={error} />}

        {loading ? (
          <div className="space-y-3">
            <Sk className="h-16 rounded-xl" />
            <Sk className="h-32 rounded-xl" />
            <Sk className="h-32 rounded-xl" />
          </div>
        ) : (
          <>
            <div className="bg-muted/40 grid gap-4 rounded-xl p-3 sm:grid-cols-2">
              <Field label={t("passMark")}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={passMark}
                  onChange={(e) => setPassMark(Math.max(0, Math.min(100, Number(e.target.value))))}
                  className={inputClass}
                />
              </Field>
              <Field label={t("maxAttempts")}>
                <input
                  type="number"
                  min={1}
                  placeholder={t("unlimited")}
                  value={maxAttempts}
                  onChange={(e) =>
                    setMaxAttempts(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  className={inputClass}
                />
              </Field>
            </div>

            {questions.length === 0 ? (
              <EmptyState
                Icon={ListChecks}
                color="emerald"
                title={t("noQuestions")}
                description={t("noQuestionsHint")}
                action={
                  <Button type="button" onClick={addQuestion}>
                    <Plus /> {t("addQuestion")}
                  </Button>
                }
              />
            ) : (
              questions.map((q, i) => (
                <div
                  key={i}
                  className="bg-card space-y-3 rounded-xl border p-3 shadow-sm transition-shadow focus-within:shadow-md"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground mt-2 flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums">
                      <GripVertical className="size-3.5 opacity-40" aria-hidden />
                      {i + 1}
                    </span>
                    <input
                      value={q.prompt}
                      onChange={(e) => patch(i, { prompt: e.target.value })}
                      placeholder={t("prompt")}
                      className={cn(inputClass, "flex-1 font-medium")}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="mt-1"
                      aria-label={t("removeQuestion")}
                      onClick={() => setQuestions((qs) => qs.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 ps-7">
                    <select
                      value={q.type}
                      onChange={(e) => setType(i, e.target.value as QuestionType)}
                      className={cn(selectClass, "h-8 w-auto text-xs")}
                    >
                      {QUESTION_TYPES.map((ty) => (
                        <option key={ty} value={ty}>
                          {t(`types.${ty}`)}
                        </option>
                      ))}
                    </select>
                    <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                      {t("points")}
                      <input
                        type="number"
                        min={1}
                        value={q.points}
                        onChange={(e) => patch(i, { points: Math.max(1, Number(e.target.value)) })}
                        className={cn(inputClass, "h-8 w-16 text-xs")}
                      />
                    </label>
                  </div>

                  <ul className="space-y-1.5 ps-7">
                    {q.options.map((o, oi) => (
                      <li
                        key={oi}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border p-1.5 transition-colors",
                          o.is_correct
                            ? "border-emerald-300/60 bg-emerald-50/60 dark:border-emerald-800/50 dark:bg-emerald-950/25"
                            : "border-transparent",
                        )}
                      >
                        <input
                          type={q.type === "MULTIPLE" ? "checkbox" : "radio"}
                          name={`correct-${i}`}
                          checked={o.is_correct}
                          onChange={(e) => setOption(i, oi, { is_correct: e.target.checked })}
                          aria-label={t("markCorrect")}
                          className="accent-primary ms-1 size-4 shrink-0 cursor-pointer"
                        />
                        <input
                          value={o.text}
                          disabled={q.type === "TRUE_FALSE"}
                          onChange={(e) => setOption(i, oi, { text: e.target.value })}
                          placeholder={t("option")}
                          className={cn(inputClass, "h-8 flex-1 border-transparent bg-transparent")}
                        />
                        {q.type !== "TRUE_FALSE" && q.options.length > 2 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("removeOption")}
                            onClick={() =>
                              patch(i, { options: q.options.filter((_, idx) => idx !== oi) })
                            }
                          >
                            <Trash2 className="size-3.5 opacity-60" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>

                  {q.type !== "TRUE_FALSE" && q.options.length < 10 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ms-7"
                      onClick={() =>
                        patch(i, { options: [...q.options, { text: "", is_correct: false }] })
                      }
                    >
                      <Plus /> {t("addOption")}
                    </Button>
                  )}
                </div>
              ))
            )}

            {questions.length > 0 && (
              <Button type="button" variant="outline" className="w-full" onClick={addQuestion}>
                <Plus /> {t("addQuestion")}
              </Button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
