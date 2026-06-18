"use client";

import { CalendarPlus, Clock, Globe, Plus, Trash2, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  putStudentSchedule,
  type ScheduleSlot,
  type StudentRow,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const fieldClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:cursor-not-allowed disabled:opacity-60";

const DURATION_PRESETS = [30, 45, 60, 90, 120];

/** Region-relevant zones; mirrors the inline editor's curated list. */
const TZ_CURATED = [
  "Africa/Cairo", "Asia/Riyadh", "Asia/Dubai", "Asia/Kuwait", "Asia/Qatar",
  "Asia/Bahrain", "Asia/Amman", "Asia/Baghdad", "Asia/Beirut", "Asia/Jerusalem",
  "Africa/Khartoum", "Africa/Casablanca", "Africa/Tunis", "Africa/Algiers",
  "Africa/Tripoli", "Europe/Istanbul", "Europe/London", "Europe/Paris",
  "America/New_York", "UTC",
];

/**
 * The "new student timetable" form (§5.1) as a focused modal: pick a student, build their
 * recurring weekly slots, choose a timezone, and PUT the schedule — the backend generates the
 * concrete sessions and returns the created/removed counts. Reuses the same slot model as the
 * inline editor so a timetable created here is identical to one edited from a student card.
 */
export function AddTimetableModal({
  students,
  defaultTimezone,
  onClose,
  onCreated,
}: {
  students: StudentRow[];
  defaultTimezone: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations("scheduling");
  const [studentId, setStudentId] = useState("");
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [slots, setSlots] = useState<ScheduleSlot[]>([
    { weekday: 1, start_time_local: "17:00", duration_minutes: 30 },
  ]);
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

  const weekdayOptions = useMemo(
    () => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: t(`weekday.${d}`) })),
    [t],
  );

  const durationOptions = (current: number) => {
    const vals = DURATION_PRESETS.includes(current)
      ? DURATION_PRESETS
      : [...DURATION_PRESETS, current].sort((a, b) => a - b);
    return vals.map((v) => ({ value: String(v), label: `${v} ${t("timetable.durationUnit")}` }));
  };

  const tzOptions = useMemo(() => {
    const set = new Set(TZ_CURATED);
    if (timezone) set.add(timezone);
    return [...set].map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
  }, [timezone]);

  function update(i: number, patch: Partial<ScheduleSlot>) {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  const studentName = students.find((s) => s.id === studentId)?.full_name ?? "";

  async function submit() {
    if (!studentId) {
      setError(t("timetables.errStudent"));
      return;
    }
    if (slots.length === 0) {
      setError(t("timetables.errSlots"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await putStudentSchedule(studentId, {
        timezone: timezone || undefined,
        slots: slots.map((s) => ({
          weekday: s.weekday,
          start_time_local: s.start_time_local,
          duration_minutes: s.duration_minutes,
        })),
      });
      onCreated();
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
      title={t("timetables.addTitle")}
      description={t("timetables.addSubtitle")}
      size="lg"
    >
      <div className="space-y-5">
        {error && (
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        )}

        {/* Student picker */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-sm font-medium">
            <User className="size-3.5 text-muted-foreground" />
            {t("timetables.studentLabel")}
            <span className="text-destructive">*</span>
          </label>
          <Combobox
            options={studentOptions}
            value={studentId}
            onChange={setStudentId}
            placeholder={t("timetables.selectStudent")}
            searchPlaceholder={t("timetables.searchStudent")}
          />
        </div>

        {/* Slot rows */}
        <div className="space-y-2.5">
          <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
            {t("timetable.recurringTitle")}
          </p>
          {slots.map((s, i) => (
            <div
              key={i}
              data-slot={i}
              className="grid grid-cols-1 items-end gap-3 rounded-xl border bg-muted/20 p-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <div className="space-y-1">
                <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                  {t("weekdayLabel")}
                </span>
                <Combobox
                  options={weekdayOptions}
                  value={String(s.weekday)}
                  onChange={(v) => update(i, { weekday: Number(v) })}
                  placeholder={t("weekdayLabel")}
                />
              </div>

              <div className="space-y-1">
                <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                  {t("startTime")}
                </span>
                <div className="relative">
                  <Clock className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="time"
                    aria-label={t("startTime")}
                    className={cn(fieldClass, "w-full py-2 ps-9 pe-3")}
                    value={s.start_time_local}
                    onChange={(e) => update(i, { start_time_local: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                  {t("duration")}
                </span>
                <Combobox
                  options={durationOptions(s.duration_minutes)}
                  value={String(s.duration_minutes)}
                  onChange={(v) => update(i, { duration_minutes: Number(v) })}
                  placeholder={t("duration")}
                />
              </div>

              {slots.length > 1 ? (
                <button
                  type="button"
                  aria-label={t("removeSlot")}
                  onClick={() => setSlots((prev) => prev.filter((_, idx) => idx !== i))}
                  className="flex size-10 items-center justify-center justify-self-end rounded-xl border text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}

          <button
            type="button"
            data-testid="add-slot"
            onClick={() =>
              setSlots((prev) => [
                ...prev,
                { weekday: 1, start_time_local: "17:00", duration_minutes: 30 },
              ])
            }
            className="group flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-3 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
          >
            <span className="flex size-6 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/15 group-hover:text-primary">
              <Plus className="size-4" />
            </span>
            {t("addSlot")}
          </button>
        </div>

        {/* Timezone */}
        <div className="space-y-1.5 sm:max-w-xs">
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Globe className="size-3.5" aria-hidden />
            {t("timezone")}
          </label>
          <Combobox
            options={tzOptions}
            value={timezone}
            onChange={setTimezone}
            placeholder={t("timezonePlaceholder")}
            searchPlaceholder={t("timetable.searchTimezone")}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {t("actions.acknowledge")}
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="create-timetable"
            onClick={() => void submit()}
            disabled={busy || !studentId || slots.length === 0}
            className="gap-1.5"
          >
            {busy ? (
              <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
            ) : (
              <CalendarPlus className="size-3.5" />
            )}
            {t("timetables.create")}
            {studentName ? ` · ${studentName}` : ""}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
