"use client";

import { CalendarPlus, Clock, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import { ApiError, createSession, type StudentRow } from "@/lib/api";
import { cn } from "@/lib/utils";

const fieldClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3 disabled:cursor-not-allowed disabled:opacity-60";

const DURATION_PRESETS = [30, 45, 60, 90, 120];

/**
 * Quick-create a one-off session (§5.1) straight from an empty calendar slot. The day + time
 * come pre-filled from where the owner clicked; they pick a student (the teacher defaults to
 * that student's assignment server-side) and a duration, then POST. The local wall-clock plus
 * the viewer timezone go to the backend so the stored UTC instant is DST-correct.
 */
export function QuickCreateModal({
  students,
  initialDate,
  initialTime,
  timeZone,
  onClose,
  onCreated,
}: {
  students: StudentRow[];
  /** Y-m-d the slot fell on, in the viewer timezone. */
  initialDate: string;
  /** "HH:MM" wall-clock of the clicked slot. */
  initialTime: string;
  timeZone: string;
  onClose: () => void;
  onCreated: (warnings: string[]) => void;
}) {
  const t = useTranslations("scheduling");
  const [studentId, setStudentId] = useState("");
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [duration, setDuration] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const studentOptions = useMemo(
    () =>
      students.map((s) => ({
        value: s.id,
        label: s.full_name,
        sublabel: s.teacher_name ?? undefined,
      })),
    [students],
  );

  const durationOptions = useMemo(() => {
    const vals = DURATION_PRESETS.includes(duration)
      ? DURATION_PRESETS
      : [...DURATION_PRESETS, duration].sort((a, b) => a - b);
    return vals.map((v) => ({
      value: String(v),
      label: `${v} ${t("timetable.durationUnit")}`,
    }));
  }, [duration, t]);

  async function submit() {
    if (!studentId) {
      setError(t("quickCreate.errStudent"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await createSession({
        student_id: studentId,
        local_datetime: `${date} ${time}`,
        timezone: timeZone,
        duration_minutes: duration,
      });
      onCreated((res.warnings ?? []).map((w) => w.message));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("quickCreate.title")}
      description={t("quickCreate.subtitle")}
      size="md"
    >
      <div className="space-y-5" data-testid="quick-create">
        {error && (
          <AlertBanner
            variant="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        )}

        {/* Student */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-sm font-medium">
            <User className="size-3.5 text-muted-foreground" aria-hidden />
            {t("quickCreate.student")}
            <span className="text-destructive">*</span>
          </label>
          <Combobox
            options={studentOptions}
            value={studentId}
            onChange={setStudentId}
            placeholder={t("quickCreate.selectStudent")}
            searchPlaceholder={t("quickCreate.searchStudent")}
          />
        </div>

        {/* Date + time */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-muted-foreground text-xs font-medium">
              {t("quickCreate.date")}
            </label>
            <input
              type="date"
              aria-label={t("quickCreate.date")}
              data-testid="quick-create-date"
              className={fieldClass}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
              <Clock className="size-3.5" aria-hidden />
              {t("quickCreate.time")}
            </label>
            <input
              type="time"
              aria-label={t("quickCreate.time")}
              data-testid="quick-create-time"
              className={fieldClass}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        </div>

        {/* Duration */}
        <div className="space-y-1.5 sm:max-w-xs">
          <label className="text-muted-foreground text-xs font-medium">
            {t("quickCreate.duration")}
          </label>
          <Combobox
            options={durationOptions}
            value={String(duration)}
            onChange={(v) => setDuration(Number(v))}
            placeholder={t("quickCreate.duration")}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={busy}
          >
            {t("actions.acknowledge")}
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="quick-create-submit"
            onClick={() => void submit()}
            disabled={busy || !studentId}
            className="gap-1.5"
          >
            {busy ? (
              <span
                className={cn(
                  "size-3.5 animate-spin rounded-full border border-current border-t-transparent",
                )}
              />
            ) : (
              <CalendarPlus className="size-3.5" />
            )}
            {t("quickCreate.create")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
