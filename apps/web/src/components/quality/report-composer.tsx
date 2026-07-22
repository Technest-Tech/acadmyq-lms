"use client";

import {
  AlertTriangle,
  CalendarRange,
  Check,
  GraduationCap,
  ListChecks,
  Loader2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScoreRing } from "@/components/quality/quality-badges";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  createQualityReport,
  getQualityRubric,
  listQualityTeacherSessions,
  type QualityCategory,
  type QualityScope,
  type QualitySessionOption,
  type TeacherRow,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const YEARS = Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - i);

/**
 * Write a quality report: pick what it judges, then walk the rubric.
 *
 * Two decisions shape this form.
 *
 * Every criterion starts MET. The rubric lists what a teacher is supposed to do, so the neutral
 * state is "they did it" and support ticks only what went wrong — an all-good lesson is zero
 * clicks, and nobody can dock a teacher by forgetting to fill something in.
 *
 * The preview shows a PERCENT, never money. What the report costs depends on pay the client is not
 * allowed to compute (money math is the API's job, and a MONTHLY report bites into a total that is
 * still growing). Promising a number here that the statement later contradicts would be worse than
 * showing none, so the form states the rule and the ledger states the amount.
 */
export function ReportComposer({
  open,
  teachers,
  presetTeacherId,
  onClose,
  onCreated,
}: {
  open: boolean;
  teachers: TeacherRow[];
  presetTeacherId?: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations("quality");
  const now = new Date();

  const [teacherId, setTeacherId] = useState(presetTeacherId ?? "");
  const [scope, setScope] = useState<QualityScope>("SESSION");
  const [sessionId, setSessionId] = useState("");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [note, setNote] = useState("");

  const [rubric, setRubric] = useState<QualityCategory[] | null>(null);
  const [sessions, setSessions] = useState<QualitySessionOption[] | null>(null);
  // Only the BREACHED criteria live here; absence means "met".
  const [breached, setBreached] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = useCallback(() => {
    setTeacherId(presetTeacherId ?? "");
    setScope("SESSION");
    setSessionId("");
    setNote("");
    setBreached(new Set());
    setError(null);
  }, [presetTeacherId]);

  useEffect(() => {
    if (!open) return;
    reset();
    getQualityRubric()
      .then((res) => setRubric(res.categories))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : String(err));
        setRubric([]);
      });
  }, [open, reset]);

  // The session picker follows the chosen teacher — you judge a lesson they actually taught.
  useEffect(() => {
    if (!open || !teacherId || scope !== "SESSION") return;
    let cancelled = false;
    setSessions(null);
    setSessionId("");
    listQualityTeacherSessions(teacherId)
      .then((res) => {
        if (!cancelled) setSessions(res.sessions);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, teacherId, scope]);

  const allCriteria = useMemo(
    () => (rubric ?? []).flatMap((c) => c.criteria),
    [rubric],
  );

  const totalPercent = useMemo(() => {
    const sum = allCriteria
      .filter((c) => breached.has(c.id))
      .reduce((acc, c) => acc + c.discount_percent, 0);
    // Mirrors the server's ceiling: no verdict costs more than the pay it bites into.
    return Math.round(Math.min(sum, 100) * 100) / 100;
  }, [allCriteria, breached]);

  function toggle(id: string) {
    setBreached((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const ready =
    teacherId !== "" &&
    allCriteria.length > 0 &&
    (scope === "MONTHLY" || sessionId !== "");

  async function save() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await createQualityReport({
        teacher_id: teacherId,
        scope,
        session_id: scope === "SESSION" ? sessionId : null,
        period_year: scope === "MONTHLY" ? year : undefined,
        period_month: scope === "MONTHLY" ? month : undefined,
        note: note.trim() || null,
        // The WHOLE sheet, not just the failures: a report should record that the other
        // criteria were considered and passed, which is what makes it readable as a verdict.
        items: allCriteria.map((c) => ({
          criterion_id: c.id,
          met: !breached.has(c.id),
        })),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const score = 100 - totalPercent;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("composer.title")}
      description={t("composer.description")}
      size="xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ScoreRing score={score} size={40} label={t("composer.scoreLabel", { score })} />
            <div className="leading-tight">
              <p className="text-sm font-semibold tabular-nums">
                {totalPercent > 0
                  ? t("composer.willDock", { percent: totalPercent })
                  : t("composer.noDock")}
              </p>
              <p className="text-muted-foreground text-xs">
                {scope === "SESSION"
                  ? t("composer.basisSession")
                  : t("composer.basisMonthly")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={!ready || busy} data-testid="quality-report-save">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("composer.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {/* Who + what it judges */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("composer.teacher")}>
            <select
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              className={cn(inputBase, "px-3 py-2")}
              data-testid="quality-composer-teacher"
            >
              <option value="">{t("composer.pickTeacher")}</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.full_name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("composer.scope")}>
            <div className="grid grid-cols-2 gap-2">
              <ScopeCard
                active={scope === "SESSION"}
                icon={GraduationCap}
                title={t("scope.SESSION")}
                hint={t("composer.scopeSessionHint")}
                onClick={() => setScope("SESSION")}
                testId="quality-scope-session"
              />
              <ScopeCard
                active={scope === "MONTHLY"}
                icon={CalendarRange}
                title={t("scope.MONTHLY")}
                hint={t("composer.scopeMonthlyHint")}
                onClick={() => setScope("MONTHLY")}
                testId="quality-scope-monthly"
              />
            </div>
          </Field>
        </div>

        {scope === "SESSION" ? (
          <Field label={t("composer.session")}>
            {!teacherId ? (
              <p className="text-muted-foreground rounded-xl border border-dashed px-3 py-2.5 text-xs">
                {t("composer.pickTeacherFirst")}
              </p>
            ) : sessions === null ? (
              <div className="text-muted-foreground flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {t("composer.loadingSessions")}
              </div>
            ) : sessions.length === 0 ? (
              <p className="text-muted-foreground rounded-xl border border-dashed px-3 py-2.5 text-xs">
                {t("composer.noSessions")}
              </p>
            ) : (
              <select
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className={cn(inputBase, "px-3 py-2")}
                data-testid="quality-composer-session"
              >
                <option value="">{t("composer.pickSession")}</option>
                {sessions.map((session) => (
                  // Already judged: a lesson is judged once, and the server enforces it with a
                  // unique index — so say so here rather than letting the save 422.
                  <option key={session.id} value={session.id} disabled={session.has_report}>
                    {session.local_date}
                    {session.student_name ? ` · ${session.student_name}` : ""}
                    {session.has_report ? ` · ${t("composer.alreadyJudged")}` : ""}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : (
          <Field label={t("composer.period")}>
            <div className="flex gap-2">
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className={cn(inputBase, "px-3 py-2")}
                aria-label={t("composer.month")}
              >
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className={cn(inputBase, "px-3 py-2")}
                aria-label={t("composer.year")}
              >
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </Field>
        )}

        {/* The rubric walk */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ListChecks className="text-primary size-4" aria-hidden />
              <h3 className="text-sm font-semibold">{t("composer.checklist")}</h3>
            </div>
            {breached.size > 0 && (
              <button
                type="button"
                onClick={() => setBreached(new Set())}
                className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
              >
                {t("composer.clearAll")}
              </button>
            )}
          </div>
          <p className="text-muted-foreground text-xs">{t("composer.checklistHint")}</p>

          {rubric === null ? (
            <div className="flex items-center justify-center py-10">
              <div className="border-primary size-5 animate-spin rounded-full border-2 border-t-transparent" />
            </div>
          ) : allCriteria.length === 0 ? (
            <div className="rounded-xl border border-dashed px-3 py-6 text-center">
              <p className="text-muted-foreground text-sm">{t("composer.noRubric")}</p>
              <p className="text-muted-foreground/70 mt-1 text-xs">
                {t("composer.noRubricHint")}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {rubric.map((category) => (
                <div key={category.id} className="overflow-hidden rounded-xl border">
                  <p className="bg-muted/40 px-3 py-2 text-xs font-semibold">
                    {category.name}
                  </p>
                  <ul className="divide-y">
                    {category.criteria.map((criterion) => {
                      const failed = breached.has(criterion.id);
                      return (
                        <li key={criterion.id}>
                          <button
                            type="button"
                            onClick={() => toggle(criterion.id)}
                            aria-pressed={failed}
                            className={cn(
                              "flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors",
                              failed
                                ? "bg-red-50/70 dark:bg-red-950/20"
                                : "hover:bg-muted/40",
                            )}
                            data-testid={`quality-criterion-${criterion.id}`}
                          >
                            <span
                              className={cn(
                                "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                                failed
                                  ? "border-red-500 bg-red-500 text-white"
                                  : "border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                              )}
                              aria-hidden
                            >
                              {failed ? (
                                <X className="size-3" strokeWidth={3} />
                              ) : (
                                <Check className="size-3" strokeWidth={3} />
                              )}
                            </span>
                            <span
                              className={cn(
                                "flex-1 text-sm",
                                failed && "text-red-700 dark:text-red-300",
                              )}
                            >
                              {criterion.name}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums transition-colors",
                                failed
                                  ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                                  : "text-muted-foreground/60 bg-transparent",
                              )}
                            >
                              −{criterion.discount_percent}%
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <Field label={t("composer.note")} optional>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={t("composer.notePlaceholder")}
            className={cn(inputBase, "resize-y px-3 py-2")}
          />
          <p className="text-muted-foreground/70 mt-1 text-xs">{t("composer.noteHint")}</p>
        </Field>
      </div>
    </Modal>
  );
}

// ── Local pieces ──────────────────────────────────────────────────────────────

function Field({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("quality");
  return (
    <div className="space-y-1.5">
      <label className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        {label}
        {optional && (
          <span className="text-muted-foreground/60 font-normal">({t("optional")})</span>
        )}
      </label>
      {children}
    </div>
  );
}

function ScopeCard({
  active,
  icon: Icon,
  title,
  hint,
  onClick,
  testId,
}: {
  active: boolean;
  icon: typeof GraduationCap;
  title: string;
  hint: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "rounded-xl border p-2.5 text-start transition-all",
        active
          ? "border-primary bg-primary/5 ring-primary/15 ring-3"
          : "hover:border-muted-foreground/30",
      )}
    >
      <span className="flex items-center gap-1.5">
        <Icon className={cn("size-3.5", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
        <span className="text-xs font-semibold">{title}</span>
      </span>
      <span className="text-muted-foreground mt-0.5 block text-[11px] leading-snug">{hint}</span>
    </button>
  );
}
