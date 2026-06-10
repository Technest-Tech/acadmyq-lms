"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  deleteStudentSchedule,
  getStudentSchedule,
  putStudentSchedule,
  type ScheduleSlot,
} from "@/lib/api";

const inputClass =
  "border-input bg-background rounded-md border px-2 py-1.5 text-sm";

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
}: {
  studentId: string;
  canManage: boolean;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("scheduling");
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [timezone, setTimezone] = useState("");
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
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return <p className="text-muted-foreground text-sm">…</p>;
  }

  return (
    <section className="space-y-3" data-testid="student-schedule">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t("title")}</h2>
        {active && (
          <span
            className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700"
            data-testid="schedule-active"
          >
            {t("active")}
          </span>
        )}
      </div>

      {notice && (
        <p
          role="status"
          className="text-sm text-emerald-600"
          data-testid="schedule-notice"
        >
          {notice}
        </p>
      )}

      {slots.length === 0 && (
        <p className="text-muted-foreground text-sm">{t("none")}</p>
      )}

      <div className="space-y-2" data-testid="schedule-slots">
        {slots.map((s, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2" data-slot={i}>
            <label className="space-y-1">
              <span className="text-xs">{t("weekdayLabel")}</span>
              <select
                aria-label={t("weekdayLabel")}
                className={inputClass}
                value={s.weekday}
                disabled={!canManage}
                onChange={(e) => update(i, { weekday: Number(e.target.value) })}
              >
                {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                  <option key={d} value={d}>
                    {t(`weekday.${d}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs">{t("startTime")}</span>
              <input
                type="time"
                aria-label={t("startTime")}
                className={inputClass}
                value={s.start_time_local}
                disabled={!canManage}
                onChange={(e) =>
                  update(i, { start_time_local: e.target.value })
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs">{t("duration")}</span>
              <input
                type="number"
                min={1}
                aria-label={t("duration")}
                className={`${inputClass} w-20`}
                value={s.duration_minutes}
                disabled={!canManage}
                onChange={(e) =>
                  update(i, { duration_minutes: Number(e.target.value) })
                }
              />
            </label>
            {canManage && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={t("removeSlot")}
                onClick={() =>
                  setSlots((prev) => prev.filter((_, idx) => idx !== i))
                }
              >
                ✕
              </Button>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            data-testid="add-slot"
            onClick={() =>
              setSlots((prev) => [
                ...prev,
                { weekday: 1, start_time_local: "17:00", duration_minutes: 30 },
              ])
            }
          >
            {t("addSlot")}
          </Button>
          <label className="space-y-1">
            <span className="text-xs">{t("timezone")}</span>
            <input
              aria-label={t("timezone")}
              className={inputClass}
              placeholder={t("timezonePlaceholder")}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
          </label>
          <Button
            type="button"
            size="sm"
            disabled={saving || slots.length === 0}
            data-testid="save-schedule"
            onClick={() => void save()}
          >
            {saving ? t("saving") : t("save")}
          </Button>
          {active && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={saving}
              data-testid="delete-schedule"
              onClick={() => void remove()}
            >
              {t("delete")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
