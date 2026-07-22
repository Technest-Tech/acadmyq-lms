"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Field, inputClass } from "@/components/courses/form-bits";
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
 * answers are marked with a radio (SINGLE / TRUE_FALSE) or checkboxes (MULTIPLE).
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
    const options = type === "TRUE_FALSE" || q.type === "TRUE_FALSE" ? blankOptions(type) : q.options;
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

  return (
    <Modal open onClose={onClose} title={t("title")}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        {error && <AlertBanner variant="error" message={error} />}

        {loading ? (
          <p className="text-muted-foreground py-8 text-center text-sm">…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
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
                  onChange={(e) => setMaxAttempts(e.target.value === "" ? "" : Number(e.target.value))}
                  className={inputClass}
                />
              </Field>
            </div>

            {questions.map((q, i) => (
              <div key={i} className="space-y-3 rounded-xl border p-3">
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground pt-2 text-xs tabular-nums">{i + 1}.</span>
                  <input
                    value={q.prompt}
                    onChange={(e) => patch(i, { prompt: e.target.value })}
                    placeholder={t("prompt")}
                    className={cn(inputClass, "flex-1")}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("removeQuestion")}
                    onClick={() => setQuestions((qs) => qs.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2 ps-6">
                  <select
                    value={q.type}
                    onChange={(e) => setType(i, e.target.value as QuestionType)}
                    className={cn(inputClass, "w-auto")}
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
                      className={cn(inputClass, "w-16")}
                    />
                  </label>
                </div>

                <ul className="space-y-1.5 ps-6">
                  {q.options.map((o, oi) => (
                    <li key={oi} className="flex items-center gap-2">
                      <input
                        type={q.type === "MULTIPLE" ? "checkbox" : "radio"}
                        name={`correct-${i}`}
                        checked={o.is_correct}
                        onChange={(e) => setOption(i, oi, { is_correct: e.target.checked })}
                        aria-label={t("markCorrect")}
                        className="size-4"
                      />
                      <input
                        value={o.text}
                        disabled={q.type === "TRUE_FALSE"}
                        onChange={(e) => setOption(i, oi, { text: e.target.value })}
                        placeholder={t("option")}
                        className={cn(inputClass, "flex-1")}
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
                    className="ms-6"
                    onClick={() => patch(i, { options: [...q.options, { text: "", is_correct: false }] })}
                  >
                    <Plus className="size-3.5" /> {t("addOption")}
                  </Button>
                )}
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setQuestions((qs) => [
                  ...qs,
                  { prompt: "", type: "SINGLE", points: 1, options: blankOptions("SINGLE") },
                ])
              }
            >
              <Plus /> {t("addQuestion")}
            </Button>
          </>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button type="button" onClick={submit} disabled={busy || loading || !valid}>
          {t("save")}
        </Button>
      </div>
    </Modal>
  );
}
