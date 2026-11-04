"use client";

import { AlertTriangle, BookOpenCheck, ClipboardList, Pencil, Plus, Save, Sigma, Trash2, Trophy, UserX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssessmentForm } from "@/components/grades/assessment-form";
import { apiErrorMessage } from "@/components/groups/group-form";
import { PersonAvatar, SectionCard, SoftBadge, StatCard, type PastelTone } from "@/components/groups/group-look";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  deleteAssessment,
  getGradeSheet,
  percentTone,
  saveScores,
  type Assessment,
  type GradeSheet as Sheet,
  type ScoreEntry,
} from "@/lib/grades-api";
import { useCentreLook } from "@/lib/capabilities";
import { cn } from "@/lib/utils";

/** What a cell looks like while it is being typed: the score as text, and the absence flag. */
interface CellDraft {
  score: string;
  absent: boolean;
}

type Drafts = Record<string, Record<string, CellDraft>>;

const TONE: Record<ReturnType<typeof percentTone>, string> = {
  low: "text-rose-600 dark:text-rose-400",
  high: "text-emerald-600 dark:text-emerald-400",
  mid: "text-foreground",
  none: "text-muted-foreground",
};

/** A total as a soft badge in a centre's look. */
const TONE_BADGE: Record<ReturnType<typeof percentTone>, PastelTone> = { low: "rose", high: "emerald", mid: "amber", none: "slate" };

export function formatPercent(p: number | null): string {
  if (p === null) return "—";
  return `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
}

function draftsOf(sheet: Sheet): Drafts {
  const out: Drafts = {};
  for (const a of sheet.assessments) {
    const column: Record<string, CellDraft> = {};
    for (const m of sheet.members) {
      const cell = sheet.scores[m.student_id]?.[a.id];
      column[m.student_id] = { score: cell?.score != null ? String(cell.score) : "", absent: cell?.absent ?? false };
    }
    out[a.id] = column;
  }
  return out;
}

function sameCell(d: CellDraft, saved: { score: number | null; absent: boolean } | undefined): boolean {
  const savedScore = saved?.score != null ? String(saved.score) : "";
  return d.score.trim() === savedScore && d.absent === (saved?.absent ?? false);
}

/**
 * The grade sheet of one group (docs/centre-profile, Phase 2 §5): students down, assessments
 * across, a score or an absence in each cell, the weighted total at the end. A column is saved as
 * one (PUT scores), so a half-typed quiz never lands. The group's teacher types the scores; the
 * office adds and removes columns too; everyone else reads. Mobile stacks one card per student.
 */
export function GradeSheet({ groupId }: { groupId: string }) {
  const t = useTranslations("grades");
  const look = useCentreLook();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [form, setForm] = useState<{ open: boolean; assessment: Assessment | null }>({ open: false, assessment: null });
  const [confirmDelete, setConfirmDelete] = useState<Assessment | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((s: Sheet) => {
    setSheet(s);
    setDrafts(draftsOf(s));
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await getGradeSheet(groupId));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("loadFailed")));
    }
  }, [groupId, apply, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirtyColumns = useMemo(() => {
    if (!sheet) return new Set<string>();
    const out = new Set<string>();
    for (const a of sheet.assessments) {
      for (const m of sheet.members) {
        const d = drafts[a.id]?.[m.student_id];
        if (d && !sameCell(d, sheet.scores[m.student_id]?.[a.id])) {
          out.add(a.id);
          break;
        }
      }
    }
    return out;
  }, [sheet, drafts]);

  function setCell(aid: string, sid: string, patch: Partial<CellDraft>) {
    setDrafts((prev) => {
      const column = prev[aid] ?? {};
      const current = column[sid] ?? { score: "", absent: false };
      return { ...prev, [aid]: { ...column, [sid]: { ...current, ...patch } } };
    });
    setNotice(null);
  }

  function entriesOf(aid: string): ScoreEntry[] {
    return (sheet?.members ?? []).map((m) => {
      const d = drafts[aid]?.[m.student_id] ?? { score: "", absent: false };
      const score = d.score.trim() === "" ? null : Number(d.score);
      return { student_id: m.student_id, score: d.absent ? null : score, absent: d.absent };
    });
  }

  async function saveColumn(aid: string) {
    setSaving(aid);
    setError(null);
    try {
      apply(await saveScores(groupId, aid, entriesOf(aid)));
      setNotice(t("sheet.saved"));
    } catch (err) {
      setError(apiErrorMessage(err, t("saveFailed")));
    } finally {
      setSaving(null);
    }
  }

  async function saveAll() {
    for (const aid of dirtyColumns) {
      await saveColumn(aid);
    }
  }

  async function removeAssessment(a: Assessment) {
    setBusy(true);
    setError(null);
    try {
      await deleteAssessment(groupId, a.id, a.graded_count > 0);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, t("saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  if (!sheet) {
    return error ? <AlertBanner variant="error" message={error} /> : <p className="text-muted-foreground py-10 text-center text-sm">{t("loading")}</p>;
  }

  const canMark = sheet.can_mark;
  const { members, assessments } = sheet;
  const totals = members.map((m) => sheet.totals[m.student_id] ?? null).filter((v): v is number => v !== null);
  const average = totals.length > 0 ? totals.reduce((sum, v) => sum + v, 0) / totals.length : null;
  const top = totals.length > 0 ? Math.max(...totals) : null;
  const below = totals.filter((v) => percentTone(v) === "low").length;

  const toolbar = (
        <div className="flex flex-wrap items-center gap-2">
          {dirtyColumns.size > 0 && (
            <>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                {t("sheet.unsaved")}
              </span>
              <Button type="button" variant="secondary" onClick={() => void saveAll()} disabled={saving !== null} data-testid="grades-save-all">
                <Save className="size-4" />
                {t("sheet.saveAll")}
              </Button>
            </>
          )}
          {canMark && (
            <Button type="button" onClick={() => setForm({ open: true, assessment: null })} data-testid="assessment-add">
              <Plus className="size-4" />
              {t("sheet.add")}
            </Button>
          )}
        </div>
  );

  const body =
    assessments.length === 0 ? (
        <p className={cn("text-muted-foreground p-6 text-center text-sm", !look && "rounded-xl border border-dashed")}>{t("sheet.empty")}</p>
      ) : members.length === 0 ? (
        <p className={cn("text-muted-foreground p-6 text-center text-sm", !look && "rounded-xl border border-dashed")}>{t("sheet.noMembers")}</p>
      ) : (
        <>
          {/* ── Desktop: the grid ── */}
          <div className={cn("hidden overflow-x-auto md:block", !look && "rounded-xl border")}>
            <table className="w-full text-sm" data-testid="grade-table">
              <thead className={cn("text-xs", look ? "bg-muted" : "bg-muted/40")}>
                <tr>
                  <th className={cn("sticky start-0 px-3 py-2 text-start font-semibold", look ? "bg-muted px-5" : "bg-muted/40")}>{t("sheet.student")}</th>
                  {assessments.map((a) => (
                    <th key={a.id} className="min-w-[9rem] px-2 py-2 text-start align-top font-semibold" data-testid={`assessment-col-${a.id}`}>
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <p className="truncate">{a.title}</p>
                          <p className="text-muted-foreground font-normal">
                            {t(`kinds.${a.kind}`)} · {t("sheet.outOf", { max: a.max_score })}
                            {a.weight !== 1 && <> · {t("sheet.weight", { weight: a.weight })}</>}
                          </p>
                          {a.held_on && <p className="text-muted-foreground font-normal tabular-nums">{a.held_on}</p>}
                        </div>
                        {canMark && (
                          <div className="flex shrink-0 gap-0.5">
                            <button
                              type="button"
                              aria-label={t("sheet.edit")}
                              onClick={() => setForm({ open: true, assessment: a })}
                              className="text-muted-foreground hover:text-foreground rounded p-1"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={t("sheet.delete")}
                              onClick={() => setConfirmDelete(a)}
                              className="text-muted-foreground rounded p-1 hover:text-rose-600"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                      {canMark && dirtyColumns.has(a.id) && (
                        <Button
                          type="button"
                          size="xs"
                          className="mt-1.5"
                          onClick={() => void saveColumn(a.id)}
                          disabled={saving !== null}
                          data-testid={`save-col-${a.id}`}
                        >
                          <Save className="size-3" />
                          {t("sheet.save")}
                        </Button>
                      )}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-end font-semibold">{t("sheet.total")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {members.map((m) => (
                  <tr key={m.student_id} data-testid={`grade-row-${m.student_id}`}>
                    <td className={cn("sticky start-0 px-3 py-2 font-medium", look ? "bg-card px-5 font-bold" : "bg-background")}>
                      <span className={look ? "flex items-center gap-2.5" : undefined}>
                        {look && <PersonAvatar name={m.full_name} className="size-9" />}
                        <span>
                          {m.full_name}
                          {m.left && <span className="text-muted-foreground ms-1.5 text-xs font-normal">({t("sheet.left")})</span>}
                        </span>
                      </span>
                    </td>
                    {assessments.map((a) => (
                      <td key={a.id} className="px-2 py-1.5">
                        <CellEditor
                          draft={drafts[a.id]?.[m.student_id] ?? { score: "", absent: false }}
                          max={a.max_score}
                          percent={sheet.scores[m.student_id]?.[a.id]?.percent ?? null}
                          disabled={!canMark}
                          onChange={(patch) => setCell(a.id, m.student_id, patch)}
                          testId={`cell-${m.student_id}-${a.id}`}
                        />
                      </td>
                    ))}
                    <td className={cn("px-3 py-2 text-end font-bold tabular-nums", look ? "px-5" : TONE[percentTone(sheet.totals[m.student_id] ?? null)])}>
                      {look ? (
                        <SoftBadge tone={TONE_BADGE[percentTone(sheet.totals[m.student_id] ?? null)]}>{formatPercent(sheet.totals[m.student_id] ?? null)}</SoftBadge>
                      ) : (
                        formatPercent(sheet.totals[m.student_id] ?? null)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Mobile: one card per student ── */}
          <ul className={cn("grid grid-cols-1 gap-3 md:hidden", look && "p-3")}>
            {members.map((m) => (
              <li key={m.student_id} className="rounded-xl border p-3" data-testid={`grade-card-${m.student_id}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">
                    {m.full_name}
                    {m.left && <span className="text-muted-foreground ms-1.5 text-xs font-normal">({t("sheet.left")})</span>}
                  </p>
                  <p className={cn("text-sm font-bold tabular-nums", TONE[percentTone(sheet.totals[m.student_id] ?? null)])}>
                    {formatPercent(sheet.totals[m.student_id] ?? null)}
                  </p>
                </div>
                <ul className="mt-2 space-y-2">
                  {assessments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{a.title}</p>
                        <p className="text-muted-foreground text-xs">{t("sheet.outOf", { max: a.max_score })}</p>
                      </div>
                      <CellEditor
                        draft={drafts[a.id]?.[m.student_id] ?? { score: "", absent: false }}
                        max={a.max_score}
                        percent={sheet.scores[m.student_id]?.[a.id]?.percent ?? null}
                        disabled={!canMark}
                        onChange={(patch) => setCell(a.id, m.student_id, patch)}
                      />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      );

  return (
    <div className="space-y-4" data-testid="grade-sheet">
      {look && assessments.length > 0 && members.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <StatCard icon={ClipboardList} tone="violet" label={t("look.assessments")} value={assessments.length} />
          <StatCard icon={Sigma} tone="sky" label={t("look.average")} value={formatPercent(average === null ? null : Math.round(average * 10) / 10)} />
          <StatCard icon={Trophy} tone="emerald" label={t("look.top")} value={formatPercent(top)} />
          <StatCard
            icon={AlertTriangle}
            tone={below > 0 ? "rose" : "slate"}
            label={t("look.low")}
            value={<span className={below > 0 ? "text-rose-600 dark:text-rose-400" : undefined}>{below}</span>}
          />
        </div>
      )}

      {look ? (
        <>
          {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}
          {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
          <SectionCard icon={BookOpenCheck} tone="violet" title={t("tabs.grades")} hint={!canMark ? t("sheet.readOnly") : undefined} action={toolbar} flush>
            {body}
          </SectionCard>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-sm">{!canMark && t("sheet.readOnly")}</p>
            {toolbar}
          </div>
          {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}
          {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
          {body}
        </>
      )}

      <Modal
        open={form.open}
        onClose={() => setForm({ open: false, assessment: null })}
        title={form.assessment ? t("form.editTitle") : t("form.createTitle")}
      >
        {form.open && (
          <AssessmentForm
            groupId={groupId}
            assessment={form.assessment}
            onCancel={() => setForm({ open: false, assessment: null })}
            onSaved={() => {
              setForm({ open: false, assessment: null });
              void load();
            }}
          />
        )}
      </Modal>

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={t("sheet.deleteTitle")}
        description={
          confirmDelete
            ? [t("sheet.deleteHint", { title: confirmDelete.title }), confirmDelete.graded_count > 0 ? t("sheet.deleteWithScores", { count: confirmDelete.graded_count }) : null]
                .filter(Boolean)
                .join(" ")
            : undefined
        }
      >
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setConfirmDelete(null)} disabled={busy}>
            {t("sheet.cancel")}
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => confirmDelete && void removeAssessment(confirmDelete)} data-testid="assessment-delete-confirm">
            {t("sheet.deleteConfirm")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/** A score box with the absence toggle beside it and the saved percent under it. */
function CellEditor({
  draft,
  max,
  percent,
  disabled,
  onChange,
  testId,
}: {
  draft: CellDraft;
  max: number;
  percent: number | null;
  disabled: boolean;
  onChange: (patch: Partial<CellDraft>) => void;
  testId?: string;
}) {
  const t = useTranslations("grades");
  const over = draft.score.trim() !== "" && Number(draft.score) > max;

  return (
    <div className="flex items-center gap-1.5">
      <div className="w-20">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={max}
          step="0.5"
          value={draft.absent ? "" : draft.score}
          placeholder={draft.absent ? t("sheet.absent") : t("sheet.scorePlaceholder")}
          disabled={disabled || draft.absent}
          aria-invalid={over || undefined}
          onChange={(e) => onChange({ score: e.target.value })}
          className={cn(
            "border-input bg-background focus:border-primary h-8 w-full rounded-lg border px-2 text-sm tabular-nums outline-none disabled:opacity-60",
            over && "border-rose-500",
            draft.absent && "bg-rose-50 placeholder:text-rose-600 dark:bg-rose-950/30",
          )}
          data-testid={testId}
        />
        <p className={cn("mt-0.5 text-[11px] leading-none tabular-nums", TONE[percentTone(percent)])}>{formatPercent(percent)}</p>
      </div>
      {!disabled && (
        <button
          type="button"
          aria-label={draft.absent ? t("sheet.unmarkAbsent") : t("sheet.markAbsent")}
          aria-pressed={draft.absent}
          title={draft.absent ? t("sheet.unmarkAbsent") : t("sheet.markAbsent")}
          onClick={() => onChange({ absent: !draft.absent, score: "" })}
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border text-xs font-bold",
            draft.absent ? "border-rose-300 bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200" : "text-muted-foreground hover:bg-muted",
          )}
          data-testid={testId ? `${testId}-absent` : undefined}
        >
          <UserX className="size-3.5" />
        </button>
      )}
    </div>
  );
}
