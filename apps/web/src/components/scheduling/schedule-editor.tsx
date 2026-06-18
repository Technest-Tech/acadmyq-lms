"use client";

import { CalendarDays, Clock, Globe, Info, Plus, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  ApiError,
  deleteStudentSchedule,
  getStudentSchedule,
  putStudentSchedule,
  type ScheduleSlot,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const fieldClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:cursor-not-allowed disabled:opacity-60";

const DURATION_PRESETS = [30, 45, 60, 90, 120];

/** Region-relevant zones; the active schedule's own zone is always folded in. */
const TZ_CURATED = [
  "Africa/Cairo", "Asia/Riyadh", "Asia/Dubai", "Asia/Kuwait", "Asia/Qatar",
  "Asia/Bahrain", "Asia/Amman", "Asia/Baghdad", "Asia/Beirut", "Asia/Jerusalem",
  "Africa/Khartoum", "Africa/Casablanca", "Africa/Tunis", "Africa/Algiers",
  "Africa/Tripoli", "Europe/Istanbul", "Europe/London", "Europe/Paris",
  "America/New_York", "UTC",
];

/** Trim a stored "17:00:00" TIME down to the "17:00" an <input type=time> wants. */
function hhmm(time: string): string {
  return time.slice(0, 5);
}

/**
 * The per-student weekly recurring schedule editor (Sprint 5 §5.1). A row per weekday slot
 * (weekday + local start time + duration). Saving PUTs the whole slot set and the backend
 * regenerates concrete sessions over the rolling window — the returned created/removed counts
 * are surfaced. Deleting deactivates the schedule (future untouched sessions are removed,
 * history preserved). Read-only when the caller lacks `schedule.manage`.
 */
export function ScheduleSection({
  studentId,
  canManage,
  onError,
  onChanged,
}: {
  studentId: string;
  canManage: boolean;
  onError: (msg: string) => void;
  onChanged?: () => void;
}) {
  const t = useTranslations("scheduling");
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [timezone, setTimezone] = useState("");

  const weekdayOptions = useMemo(
    () => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: t(`weekday.${d}`) })),
    [t],
  );

  const durationOptions = useCallback(
    (current: number) => {
      const vals = DURATION_PRESETS.includes(current)
        ? DURATION_PRESETS
        : [...DURATION_PRESETS, current].sort((a, b) => a - b);
      return vals.map((v) => ({ value: String(v), label: `${v} ${t("timetable.durationUnit")}` }));
    },
    [t],
  );

  const tzOptions = useMemo(() => {
    const set = new Set(TZ_CURATED);
    if (timezone) set.add(timezone);
    return [...set].map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
  }, [timezone]);
  const [active, setActive] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getStudentSchedule(studentId);
      setActive(res.schedule !== null);
      setTimezone(res.schedule?.timezone ?? "");
      setSlots(
        res.slots.map((s) => ({
          weekday: s.weekday,
          start_time_local: hhmm(s.start_time_local),
          duration_minutes: s.duration_minutes,
        })),
      );
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoaded(true);
    }
  }, [studentId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  function update(i: number, patch: Partial<ScheduleSlot>) {
    setSlots((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    );
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      const res = await putStudentSchedule(studentId, {
        timezone: timezone || undefined,
        slots: slots.map((s) => ({
          weekday: s.weekday,
          start_time_local: s.start_time_local,
          duration_minutes: s.duration_minutes,
        })),
      });
      setNotice(
        t("saved", {
          created: res.generated.created,
          removed: res.generated.removed,
        }),
      );
      await load();
      onChanged?.();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setNotice(null);
    try {
      const res = await deleteStudentSchedule(studentId);
      setNotice(t("deleted", { removed: res.generated.removed }));
      await load();
      onChanged?.();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center rounded-2xl border bg-card py-12">
        <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border bg-card shadow-sm"
      data-testid="student-schedule"
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b bg-gradient-to-r from-primary/[0.06] to-transparent px-5 py-4">
        <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/15">
          <CalendarDays className="size-4 text-primary" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{t("timetable.recurringTitle")}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t("timetable.recurringSubtitle")}
          </p>
        </div>
        {active && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
            data-testid="schedule-active"
          >
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {t("active")}
          </span>
        )}
      </div>

      <div className="space-y-4 p-5">
        {notice && (
          <p
            role="status"
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300"
            data-testid="schedule-notice"
          >
            {notice}
          </p>
        )}

        {slots.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-10 text-center">
            <Clock className="size-6 text-muted-foreground/40" aria-hidden />
            <p className="text-muted-foreground text-sm">{t("none")}</p>
          </div>
        ) : (
          <div className="space-y-2.5" data-testid="schedule-slots">
            {slots.map((s, i) => (
              <div
                key={i}
                data-slot={i}
                className="grid grid-cols-1 items-end gap-3 rounded-xl border bg-muted/20 p-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
              >
                {/* Day */}
                <div className="space-y-1">
                  <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                    {t("weekdayLabel")}
                  </span>
                  <Combobox
                    options={weekdayOptions}
                    value={String(s.weekday)}
                    onChange={(v) => update(i, { weekday: Number(v) })}
                    disabled={!canManage}
                    placeholder={t("weekdayLabel")}
                  />
                </div>

                {/* Start time */}
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
                      disabled={!canManage}
                      onChange={(e) => update(i, { start_time_local: e.target.value })}
                    />
                  </div>
                </div>

                {/* Duration */}
                <div className="space-y-1">
                  <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                    {t("duration")}
                  </span>
                  <Combobox
                    options={durationOptions(s.duration_minutes)}
                    value={String(s.duration_minutes)}
                    onChange={(v) => update(i, { duration_minutes: Number(v) })}
                    disabled={!canManage}
                    placeholder={t("duration")}
                  />
                </div>

                {canManage ? (
                  <button
                    type="button"
                    aria-label={t("removeSlot")}
                    onClick={() =>
                      setSlots((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    className="flex size-10 items-center justify-center justify-self-end rounded-xl border text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        )}

        {canManage && (
          <div className="space-y-4">
            {/* Add appointment — full-width affordance that reads as a new row */}
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

            {/* Settings + actions panel */}
            <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
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

              {/* Regeneration hint */}
              <div className="flex items-start gap-2 rounded-lg bg-background/60 px-3 py-2 ring-1 ring-border/60">
                <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <p className="text-muted-foreground text-xs">{t("timetable.regenHint")}</p>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 border-t pt-3">
                {active && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    data-testid="delete-schedule"
                    onClick={() => void remove()}
                    className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/5"
                  >
                    <Trash2 className="size-3.5" />
                    {t("delete")}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  disabled={saving || slots.length === 0}
                  data-testid="save-schedule"
                  onClick={() => void save()}
                  className="gap-1.5"
                >
                  {saving ? (
                    <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                  ) : (
                    <Save className="size-3.5" />
                  )}
                  {saving ? t("saving") : t("save")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
