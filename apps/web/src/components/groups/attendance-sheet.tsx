"use client";

import { CheckCheck, MessageSquareText, Video } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_TONE,
  hasStarted,
  lessonDate,
  lessonTime,
  textareaClass,
} from "@/components/groups/group-format";
import { apiErrorMessage } from "@/components/groups/group-form";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getGroupLesson,
  saveGroupAttendance,
  type GroupAttendanceStatus,
  type GroupLessonSheet,
} from "@/lib/groups-api";
import { cn } from "@/lib/utils";

type Row = { status: GroupAttendanceStatus; note: string; showNote: boolean };

/**
 * One lesson's attendance sheet. Everyone starts PRESENT — the teacher taps only the exceptions —
 * because in a class of fifteen, fourteen came. Saving marks the lesson held and records what was
 * taught and the homework in the same go. Re-opening a held lesson edits its sheet.
 *
 * A lesson that has not started cannot be marked; an owner can tick "record anyway" for a sheet
 * filled in ahead (the server enforces the same rule and audits the override).
 */
export function AttendanceSheet({
  lessonId,
  onSaved,
  onCancel,
}: {
  lessonId: string;
  onSaved: (sheet: GroupLessonSheet) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("groups");
  const locale = useLocale();
  const { session } = useAuth();
  const isOwner = session?.role === "ACADEMY_OWNER" || session?.role === "SUPER_ADMIN";

  const [sheet, setSheet] = useState<GroupLessonSheet | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [topic, setTopic] = useState("");
  const [homework, setHomework] = useState("");
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getGroupLesson(lessonId)
      .then((res) => {
        if (!live) return;
        setSheet(res);
        setTopic(res.lesson.topic ?? "");
        setHomework(res.lesson.homework ?? "");
        setRows(
          Object.fromEntries(
            res.roster.map((r) => [
              r.student_id,
              { status: r.status ?? "PRESENT", note: r.note ?? "", showNote: Boolean(r.note) },
            ]),
          ),
        );
      })
      .catch((err) => live && setError(apiErrorMessage(err, t("sheet.loadFailed"))));
    return () => {
      live = false;
    };
  }, [lessonId, t]);

  const counts = useMemo(() => {
    const c: Record<GroupAttendanceStatus, number> = { PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0 };
    for (const r of Object.values(rows)) c[r.status]++;
    return c;
  }, [rows]);

  if (!sheet) {
    return error ? (
      <AlertBanner variant="error" message={error} />
    ) : (
      <p className="text-muted-foreground py-6 text-center text-sm">{t("sheet.loading")}</p>
    );
  }

  const { lesson, group } = sheet;
  const started = hasStarted(lesson);
  const blocked = !started && !(isOwner && override);

  function set(studentId: string, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [studentId]: { ...prev[studentId]!, ...patch } }));
  }

  function allPresent() {
    setRows((prev) =>
      Object.fromEntries(Object.entries(prev).map(([id, r]) => [id, { ...r, status: "PRESENT" as const }])),
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await saveGroupAttendance(lesson.id, {
        // Everyone is sent, so a re-save that flips someone BACK to present is recorded too.
        entries: Object.entries(rows).map(([student_id, r]) => ({
          student_id,
          status: r.status,
          note: r.note.trim() || null,
        })),
        topic: topic.trim() || null,
        homework: homework.trim() || null,
        override_timing: !started && override ? true : undefined,
      });
      onSaved(res);
    } catch (err) {
      setError(apiErrorMessage(err, t("sheet.saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="attendance-sheet">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{group.name}</p>
          <p className="text-muted-foreground text-sm">
            {lessonDate(lesson.scheduled_at_utc, group.timezone, locale)} ·{" "}
            {lessonTime(lesson.scheduled_at_utc, group.timezone, locale)} ·{" "}
            {t("minutes", { count: lesson.duration_minutes })}
            {lesson.teacher_name ? ` · ${lesson.teacher_name}` : ""}
          </p>
        </div>
        {group.meeting_url && (
          <a
            href={group.meeting_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
          >
            <Video className="size-4" aria-hidden />
            {t("sheet.join")}
          </a>
        )}
      </div>

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      {lesson.status === "CANCELLED" && <AlertBanner variant="info" message={t("sheet.cancelled")} />}

      {sheet.roster.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
          {t("sheet.empty")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm" data-testid="sheet-counts">
              {ATTENDANCE_STATUSES.map((s) => (
                <span key={s} className="me-3 inline-flex items-center gap-1">
                  <span className={cn("inline-block size-2 rounded-full", ATTENDANCE_TONE[s].on)} />
                  {t(`attendance.${s}`)} <strong className="tabular-nums">{counts[s]}</strong>
                </span>
              ))}
            </p>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={allPresent}>
              <CheckCheck className="size-3.5" />
              {t("sheet.allPresent")}
            </Button>
          </div>

          <ul className="divide-y rounded-xl border">
            {sheet.roster.map((r) => {
              const row = rows[r.student_id];
              if (!row) return null;
              return (
                <li key={r.student_id} className="space-y-2 p-3" data-testid={`sheet-row-${r.student_id}`}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{r.full_name}</span>
                      {!r.member && (
                        <span className="text-muted-foreground shrink-0 text-xs">{t("sheet.formerMember")}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {ATTENDANCE_STATUSES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={row.status === s}
                          onClick={() => set(r.student_id, { status: s })}
                          className={cn(
                            "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
                            row.status === s ? ATTENDANCE_TONE[s].on : ATTENDANCE_TONE[s].off,
                          )}
                          data-testid={`mark-${r.student_id}-${s}`}
                        >
                          {t(`attendance.${s}`)}
                        </button>
                      ))}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("sheet.addNote")}
                        onClick={() => set(r.student_id, { showNote: !row.showNote })}
                      >
                        <MessageSquareText className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  {row.showNote && (
                    <input
                      className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm outline-none"
                      value={row.note}
                      maxLength={500}
                      onChange={(e) => set(r.student_id, { note: e.target.value })}
                      placeholder={t("sheet.notePlaceholder")}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="sheet-topic">
            {t("sheet.topic")}
          </label>
          <textarea
            id="sheet-topic"
            className={textareaClass}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={2000}
            placeholder={t("sheet.topicPlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="sheet-homework">
            {t("sheet.homework")}
          </label>
          <textarea
            id="sheet-homework"
            className={textareaClass}
            value={homework}
            onChange={(e) => setHomework(e.target.value)}
            maxLength={2000}
            placeholder={t("sheet.homeworkPlaceholder")}
          />
        </div>
      </div>

      {!started && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <p>{t("sheet.notStarted")}</p>
          {isOwner && (
            <label className="mt-2 flex items-center gap-2 font-medium">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              {t("sheet.recordAnyway")}
            </label>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("form.cancel")}
        </Button>
        <Button
          type="button"
          onClick={() => void save()}
          disabled={busy || blocked || lesson.status === "CANCELLED"}
          data-testid="sheet-save"
        >
          {busy ? t("form.saving") : lesson.status === "HELD" ? t("sheet.update") : t("sheet.save")}
        </Button>
      </div>
    </div>
  );
}
