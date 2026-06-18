"use client";

import { Calendar, Clock, GraduationCap, Zap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  createSession,
  listTeachers,
  updateStudent,
  type TeacherRow,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const DURATION_OPTIONS = [
  { value: 30, key: "dur30" },
  { value: 45, key: "dur45" },
  { value: 60, key: "dur60" },
  { value: 90, key: "dur90" },
] as const;

export function ScheduleTrialModal({
  open,
  studentId,
  studentName,
  defaultTeacherId,
  onClose,
  onScheduled,
}: {
  open: boolean;
  studentId: string;
  studentName: string;
  defaultTeacherId?: string;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const t = useTranslations("students");
  const locale = useLocale();
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [teacherId, setTeacherId] = useState(defaultTeacherId ?? "");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("17:00");
  const [duration, setDuration] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void listTeachers({ pageSize: 50, filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (defaultTeacherId) setTeacherId(defaultTeacherId);
  }, [defaultTeacherId]);

  // Default date to tomorrow
  useEffect(() => {
    if (!open || date) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setDate(tomorrow.toISOString().split("T")[0] ?? "");
  }, [open, date]);

  async function submit() {
    if (!teacherId) { setError(t("trial.errTeacher")); return; }
    if (!date) { setError(t("trial.errDate")); return; }
    if (!time) { setError(t("trial.errTime")); return; }

    setBusy(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await createSession({
        student_id: studentId,
        teacher_id: teacherId,
        local_datetime: `${date}T${time}:00`,
        timezone,
        duration_minutes: duration,
      });
      await updateStudent(studentId, { status: "TRIAL_BOOKED" });
      onScheduled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border py-2.5 text-sm outline-none transition-colors focus:ring-3";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("trial.title")}
      description={t("trial.description", { name: studentName })}
      size="sm"
    >
      <div className="space-y-5">
        {error && (
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        )}

        {/* Trial info card */}
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-950/20">
          <Zap className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            {t("trial.info")}
          </p>
        </div>

        {/* Teacher */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-sm font-medium">
            <GraduationCap className="size-3.5 text-muted-foreground" />
            {t("trial.teacher")}
            <span className="text-destructive">*</span>
          </label>
          <Combobox
            options={teachers.map((tch) => ({ value: tch.id, label: tch.full_name }))}
            value={teacherId}
            onChange={setTeacherId}
            placeholder={t("trial.selectTeacher")}
            searchPlaceholder={t("trial.searchTeacher")}
          />
        </div>

        {/* Date + Time row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <Calendar className="size-3.5 text-muted-foreground" />
              {t("trial.date")}
              <span className="text-destructive">*</span>
            </label>
            <input
              type="date"
              className={cn(inputClass, "ps-3.5 pe-3.5")}
              value={date}
              min={new Date().toISOString().split("T")[0]}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <Clock className="size-3.5 text-muted-foreground" />
              {t("trial.time")}
              <span className="text-destructive">*</span>
            </label>
            <input
              type="time"
              className={cn(inputClass, "ps-3.5 pe-3.5")}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        </div>

        {/* Duration picker */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("trial.duration")}</label>
          <div className="grid grid-cols-4 gap-2">
            {DURATION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDuration(opt.value)}
                className={cn(
                  "rounded-xl border py-2.5 text-xs font-semibold transition-all",
                  duration === opt.value
                    ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/20"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/50",
                )}
              >
                {t(`trial.${opt.key}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Preview card */}
        {date && time && teacherId && (
          <div className="rounded-xl border bg-gradient-to-br from-amber-500/[0.07] to-transparent px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600/80 dark:text-amber-400/70">
              {t("trial.preview")}
            </p>
            <p className="mt-1 text-sm font-semibold">
              {new Date(`${date}T${time}`).toLocaleDateString(locale, {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              {time} · {duration} {t("form.minutesShort")} ·{" "}
              {teachers.find((tch) => tch.id === teacherId)?.full_name ?? ""}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {t("trial.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={busy || !teacherId || !date || !time}
            className="gap-1.5 bg-amber-500 text-white hover:bg-amber-600 border-transparent focus-visible:ring-amber-500/40"
          >
            {busy ? (
              <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
            ) : (
              <Zap className="size-3.5" />
            )}
            {t("trial.schedule")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
