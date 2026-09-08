"use client";

import {
  AlertTriangle,
  CalendarPlus,
  Check,
  Link2,
  Lock,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  addPackageLesson,
  ApiError,
  getLessonPackage,
  listAttachablePackageLessons,
  listTeachers,
  removePackageLesson,
  updatePackageLesson,
  type LessonPackageCredit,
  type LessonPackageRow,
  type PackageAttachableLesson,
  type TeacherRow,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { formatDateTime, formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background focus:border-primary focus:ring-primary/15 rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-colors focus:ring-3";

/** Which lesson row, if any, has been opened for a correction or a removal. */
type RowMode = { creditId: string; kind: "edit" | "remove" } | null;

/**
 * Which lessons ate this package, in order — and the controls to put that right.
 *
 * This is the ledger, and it is the answer to every "why is my balance that number" question a
 * parent will ever ask: one row per lesson, its length, the balance it left behind, and — for the
 * one that ran past the end — exactly how far past and what it cost. Deliberately NOT the invoice:
 * the bill shows the block as one line, and the breakdown lives here.
 *
 * It is also where the owner corrects it. Real academies mis-record lessons, teach before the
 * block is sold, and split a shared sibling record months in — so a ledger you can only READ
 * leaves the balance permanently wrong. Three actions cover it: add a lesson, correct how long one
 * ran, take one off. Every one of them moves the underlying ATTENDED session, its invoice line and
 * the teacher's payout together, because a package balance that disagrees with the timetable is
 * not a fix, it is a second bug.
 */
export function PackageDetail({
  row,
  timezone,
  canManage = false,
  onChanged,
}: {
  row: LessonPackageRow;
  timezone: string;
  canManage?: boolean;
  onChanged?: () => void;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();

  const [pkg, setPkg] = useState<LessonPackageRow>(row);
  const [credits, setCredits] = useState<LessonPackageCredit[] | null>(null);
  const [rowMode, setRowMode] = useState<RowMode>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getLessonPackage(row.id);
      setPkg(r.package);
      setCredits(r.credits);
    } catch {
      setCredits([]);
    }
  }, [row.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Re-read the ledger, then let the list behind the modal catch up too. */
  const settled = useCallback(async () => {
    setRowMode(null);
    setAdding(false);
    await load();
    onChanged?.();
  }, [load, onChanged]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await settled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * The balance after each lesson, in the order the minutes were actually burned.
   *
   * Computed here rather than stored: the running figure is a reading of the ledger, and one
   * corrected lesson has to move every line beneath it without a migration.
   */
  const ledger = useMemo(() => {
    const capacity = pkg.minutes_sold;
    let used = 0;
    return (credits ?? []).map((credit) => {
      used += credit.minutes;
      return { credit, used, left: capacity - used };
    });
  }, [credits, pkg.minutes_sold]);

  const isActive = pkg.status === "ACTIVE";
  const percent = Math.min(100, Math.max(0, pkg.percent_used));

  return (
    <div className="space-y-4">
      {/* ── The balance, at a glance ──────────────────────────────────── */}
      <div className="space-y-2.5">
        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Fact label={t("detail.sold")} value={formatHours(pkg.minutes_sold, locale)} />
          <Fact label={t("detail.used")} value={formatHours(pkg.minutes_consumed, locale)} />
          <Fact
            label={t("detail.remaining")}
            value={formatHours(pkg.minutes_remaining, locale)}
            strong
          />
          <Fact
            label={t("detail.rate")}
            value={formatMoney(
              { amount: pkg.hourly_rate_minor, currency: pkg.currency },
              locale,
            )}
          />
        </dl>

        <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
          <div
            className={cn(
              "h-full rounded-full transition-[width]",
              pkg.minutes_overdrawn > 0
                ? "bg-destructive"
                : percent >= 85
                  ? "bg-amber-500"
                  : "bg-primary",
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {pkg.minutes_overdrawn > 0 && (
        <p className="bg-destructive/8 text-destructive rounded-xl px-3 py-2.5 text-xs font-medium">
          {t("detail.overdraftNote", {
            over: formatHours(pkg.minutes_overdrawn, locale),
            amount: formatMoney(
              {
                amount: Math.round((pkg.hourly_rate_minor * pkg.minutes_overdrawn) / 60),
                currency: pkg.currency,
              },
              locale,
            ),
          })}
        </p>
      )}

      {error !== null && (
        <p className="bg-destructive/8 text-destructive rounded-xl px-3 py-2.5 text-xs font-medium">
          {error}
        </p>
      )}

      {/* ── Ledger toolbar ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">{t("detail.lessons")}</h4>
          {credits !== null && credits.length > 0 && (
            <p className="text-muted-foreground text-[11px]">
              {t("detail.ledgerCount", {
                count: credits.length,
                total: formatHours(pkg.minutes_consumed, locale),
              })}
            </p>
          )}
        </div>

        {canManage && isActive && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {t("detail.addLesson")}
          </Button>
        )}
      </div>

      {canManage && adding && (
        <AddLessonPanel
          packageId={pkg.id}
          timezone={timezone}
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={(input) => run(() => addPackageLesson(pkg.id, input))}
        />
      )}

      {credits === null && <p className="text-muted-foreground text-xs">{t("detail.loading")}</p>}

      {credits !== null && credits.length === 0 && !adding && (
        <p className="text-muted-foreground rounded-xl border border-dashed px-3 py-6 text-center text-xs">
          {t("detail.noLessons")}
        </p>
      )}

      {/* ── The ledger ────────────────────────────────────────────────── */}
      {credits !== null && credits.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[34rem] border-collapse text-xs">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground text-start">
                <Th className="w-8 text-center">#</Th>
                <Th>{t("detail.colLesson")}</Th>
                <Th>{t("detail.colTeacher")}</Th>
                <Th className="text-end">{t("detail.colLength")}</Th>
                <Th className="text-end">{t("detail.colLeft")}</Th>
                {canManage && (
                  <Th className="w-20">
                    <span className="sr-only">{t("detail.colActions")}</span>
                  </Th>
                )}
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {ledger.map(({ credit, left }, index) => {
                const editing = rowMode?.creditId === credit.id && rowMode.kind === "edit";
                const removing = rowMode?.creditId === credit.id && rowMode.kind === "remove";

                return (
                  <Fragment key={credit.id}>
                    <tr
                      className={cn(
                        "align-middle",
                        credit.minutes_overdrawn > 0 && "bg-destructive/5",
                        (editing || removing) && "bg-muted/40",
                      )}
                    >
                      <td className="text-muted-foreground px-2 py-2 text-center tabular-nums">
                        {index + 1}
                      </td>
                      <td className="px-2 py-2">
                        <span className="font-medium">
                          {credit.scheduled_at_utc !== null
                            ? formatDateTime(credit.scheduled_at_utc, timezone, locale)
                            : credit.description}
                        </span>
                        <span className="flex flex-wrap items-center gap-1 pt-0.5">
                          {credit.minutes_overdrawn > 0 && (
                            <Flag tone="destructive">
                              {t("detail.overBy", {
                                over: formatHours(credit.minutes_overdrawn, locale),
                                amount: formatMoney(
                                  { amount: credit.amount_minor, currency: credit.currency },
                                  locale,
                                ),
                              })}
                            </Flag>
                          )}
                          {credit.locked && (
                            <Flag tone="muted">
                              <Lock className="size-2.5" aria-hidden />
                              {t(
                                credit.lock_reason === "PAYOUT_FINALIZED"
                                  ? "detail.lockedPayout"
                                  : "detail.lockedInvoice",
                              )}
                            </Flag>
                          )}
                        </span>
                      </td>
                      <td className="text-muted-foreground px-2 py-2">
                        {credit.teacher_name ?? "—"}
                      </td>
                      <td className="px-2 py-2 text-end font-semibold tabular-nums">
                        {formatHours(credit.minutes, locale)}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-2 text-end tabular-nums",
                          left < 0 ? "text-destructive font-semibold" : "text-muted-foreground",
                        )}
                      >
                        {formatHours(Math.max(0, left), locale)}
                      </td>
                      {canManage && (
                        <td className="px-2 py-2">
                          <span className="flex items-center justify-end gap-0.5">
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              disabled={credit.locked || busy}
                              title={
                                credit.locked ? t("detail.lockedHint") : t("detail.editLesson")
                              }
                              aria-label={t("detail.editLesson")}
                              onClick={() =>
                                setRowMode(editing ? null : { creditId: credit.id, kind: "edit" })
                              }
                            >
                              <Pencil aria-hidden />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              disabled={credit.locked || busy}
                              title={
                                credit.locked ? t("detail.lockedHint") : t("detail.removeLesson")
                              }
                              aria-label={t("detail.removeLesson")}
                              onClick={() =>
                                setRowMode(
                                  removing ? null : { creditId: credit.id, kind: "remove" },
                                )
                              }
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          </span>
                        </td>
                      )}
                    </tr>

                    {editing && (
                      <tr className="bg-muted/40">
                        <td colSpan={canManage ? 6 : 5} className="px-3 pb-3">
                          <EditLengthRow
                            minutes={credit.minutes}
                            busy={busy}
                            onCancel={() => setRowMode(null)}
                            onSave={(minutes) =>
                              run(() => updatePackageLesson(pkg.id, credit.id, minutes))
                            }
                          />
                        </td>
                      </tr>
                    )}

                    {removing && (
                      <tr className="bg-muted/40">
                        <td colSpan={canManage ? 6 : 5} className="px-3 pb-3">
                          <RemoveLessonRow
                            busy={busy}
                            onCancel={() => setRowMode(null)}
                            onRemove={(rebill) =>
                              run(() => removePackageLesson(pkg.id, credit.id, rebill))
                            }
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Correct how long a lesson ran.
 *
 * Length is the only edit that changes what a package is worth, and it is never only the
 * package's business — the same minutes are on the parent's invoice and in the teacher's payout,
 * so the server moves all three or refuses. Hence one field: the rest of a recorded lesson is
 * history, and history is not an edit form.
 */
function EditLengthRow({
  minutes,
  busy,
  onCancel,
  onSave,
}: {
  minutes: number;
  busy: boolean;
  onCancel: () => void;
  onSave: (minutes: number) => void;
}) {
  const t = useTranslations("packages");
  const [value, setValue] = useState(String(minutes));
  const parsed = Number.parseInt(value, 10);
  const valid = Number.isFinite(parsed) && parsed >= 1 && parsed <= 600;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground text-[11px] font-medium">
          {t("detail.newLength")}
        </span>
        <input
          type="number"
          min={1}
          max={600}
          value={value}
          autoFocus
          className={cn(inputBase, "w-28")}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <p className="text-muted-foreground grow pb-2 text-[11px]">{t("detail.editHint")}</p>
      <Button size="sm" disabled={!valid || busy || parsed === minutes} onClick={() => onSave(parsed)}>
        <Check aria-hidden />
        {t("detail.save")}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
        {t("detail.cancel")}
      </Button>
    </div>
  );
}

/**
 * Take a lesson off the package — and say what happens to the money.
 *
 * Both answers are a decision someone has to make on purpose, so neither is a default button:
 * the lesson either goes back on the parent's bill (it happened, someone pays for it) or leaves
 * the record entirely (it was never this student's lesson — the shared sibling record, the
 * mis-clicked attendance). Offering only "remove" would silently pick one.
 */
function RemoveLessonRow({
  busy,
  onCancel,
  onRemove,
}: {
  busy: boolean;
  onCancel: () => void;
  onRemove: (rebill: boolean) => void;
}) {
  const t = useTranslations("packages");

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-[11px]">{t("detail.removeHint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onRemove(true)}>
          {t("detail.removeAndBill")}
        </Button>
        <Button size="sm" variant="destructive" disabled={busy} onClick={() => onRemove(false)}>
          <Trash2 aria-hidden />
          {t("detail.removeAndDrop")}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t("detail.cancel")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Put a lesson on this package — one intention, two shapes.
 *
 * ATTACH is for a lesson the system already knows about that landed in the wrong place (taught
 * before the block was sold, billed monthly by mistake, left on a sibling's record). RECORD is for
 * one that was taught but never entered at all: it creates a real attended lesson, so the teacher
 * is paid for it, rather than a decorative row that makes the balance look right and the timetable
 * wrong.
 */
function AddLessonPanel({
  packageId,
  timezone,
  busy,
  onCancel,
  onSubmit,
}: {
  packageId: string;
  timezone: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (
    input:
      | { session_id: string }
      | {
          local_datetime: string;
          duration_minutes: number;
          teacher_id?: string;
          timezone?: string;
        },
  ) => void;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [lessons, setLessons] = useState<PackageAttachableLesson[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("60");
  const [teacherId, setTeacherId] = useState("");
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);

  useEffect(() => {
    void listAttachablePackageLessons(packageId)
      .then((r) => setLessons(r.lessons))
      .catch(() => setLessons([]));
  }, [packageId]);

  // Only needed on the record-a-lesson side, and the server falls back to the student's own
  // teacher when this is left alone — so it is fetched lazily and stays optional.
  useEffect(() => {
    if (mode !== "new" || teachers.length > 0) return;
    void listTeachers({ pageSize: 200 })
      .then((r) => setTeachers(r.rows.filter((x) => x.is_active)))
      .catch(() => setTeachers([]));
  }, [mode, teachers.length]);

  const durationNum = Number.parseInt(duration, 10);
  const canRecord =
    when !== "" && Number.isFinite(durationNum) && durationNum >= 1 && durationNum <= 600;

  return (
    <div className="bg-muted/40 space-y-3 rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="bg-background inline-flex rounded-lg border p-0.5">
          <ModeTab active={mode === "existing"} onClick={() => setMode("existing")}>
            <Link2 aria-hidden className="size-3" />
            {t("detail.modeExisting")}
          </ModeTab>
          <ModeTab active={mode === "new"} onClick={() => setMode("new")}>
            <CalendarPlus aria-hidden className="size-3" />
            {t("detail.modeNew")}
          </ModeTab>
        </div>
        <Button size="icon-xs" variant="ghost" onClick={onCancel} aria-label={t("detail.cancel")}>
          <X aria-hidden />
        </Button>
      </div>

      {mode === "existing" && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-[11px]">{t("detail.existingHint")}</p>

          {lessons === null && (
            <p className="text-muted-foreground text-xs">{t("detail.loading")}</p>
          )}

          {lessons !== null && lessons.length === 0 && (
            <p className="text-muted-foreground text-xs">{t("detail.noAttachable")}</p>
          )}

          {lessons !== null && lessons.length > 0 && (
            <div className="bg-background max-h-56 divide-y overflow-y-auto rounded-lg border">
              {lessons.map((lesson) => (
                <label
                  key={lesson.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-2.5 py-2 text-xs",
                    lesson.locked && "cursor-not-allowed opacity-50",
                    picked === lesson.id && "bg-primary/5",
                  )}
                >
                  <input
                    type="radio"
                    name="attach-lesson"
                    className="accent-primary"
                    disabled={lesson.locked}
                    checked={picked === lesson.id}
                    onChange={() => setPicked(lesson.id)}
                  />
                  <span className="grow">
                    {formatDateTime(lesson.scheduled_at_utc, timezone, locale)}
                    {lesson.teacher_name !== null && (
                      <span className="text-muted-foreground"> · {lesson.teacher_name}</span>
                    )}
                  </span>
                  {lesson.locked && (
                    <Flag tone="muted">
                      <Lock className="size-2.5" aria-hidden />
                      {t("detail.lockedInvoice")}
                    </Flag>
                  )}
                  <span className="font-semibold">
                    {formatHours(lesson.duration_minutes, locale)}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              disabled={picked === null || busy}
              onClick={() => picked !== null && onSubmit({ session_id: picked })}
            >
              <Plus aria-hidden />
              {t("detail.attach")}
            </Button>
          </div>
        </div>
      )}

      {mode === "new" && (
        <div className="space-y-2.5">
          <p className="text-muted-foreground flex items-start gap-1.5 text-[11px]">
            <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
            {t("detail.newHint")}
          </p>

          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px] font-medium">
                {t("detail.fieldWhen")}
              </span>
              <input
                type="datetime-local"
                value={when}
                className={inputBase}
                onChange={(e) => setWhen(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px] font-medium">
                {t("detail.fieldLength")}
              </span>
              <input
                type="number"
                min={1}
                max={600}
                value={duration}
                className={inputBase}
                onChange={(e) => setDuration(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px] font-medium">
                {t("detail.fieldTeacher")}
              </span>
              <select
                value={teacherId}
                className={inputBase}
                onChange={(e) => setTeacherId(e.target.value)}
              >
                <option value="">{t("detail.teacherDefault")}</option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.full_name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              disabled={!canRecord || busy}
              onClick={() =>
                onSubmit({
                  local_datetime: when,
                  duration_minutes: durationNum,
                  timezone,
                  ...(teacherId !== "" ? { teacher_id: teacherId } : {}),
                })
              }
            >
              <Plus aria-hidden />
              {t("detail.record")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn("px-2 py-1.5 text-start text-[11px] font-medium", className)}
    >
      {children}
    </th>
  );
}

function Flag({
  tone,
  children,
}: {
  tone: "destructive" | "muted";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
        tone === "destructive"
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function Fact({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="bg-muted/40 rounded-xl px-3 py-2">
      <dt className="text-muted-foreground text-[11px]">{label}</dt>
      <dd className={cn("mt-0.5 text-sm", strong ? "font-bold" : "font-semibold")}>{value}</dd>
    </div>
  );
}
