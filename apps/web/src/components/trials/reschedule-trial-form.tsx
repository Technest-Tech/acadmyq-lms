"use client";

import { CalendarClock, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { dayIn, hmIn } from "@/components/trials/trial-time";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, updateTrial, type TrialRow } from "@/lib/api";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3";

const DURATIONS = [15, 30, 45, 60, 90, 120];

/**
 * Move a trial to another slot — or, for a no-show or a cancelled trial, book it again: the same
 * PATCH puts it back to SCHEDULED at the new time, so the prospect keeps one trial record (and the
 * CRM lead one timeline) instead of collecting a dead row per attempt.
 *
 * Prefilled with the current slot on the academy's wall clock.
 */
export function RescheduleTrialForm({
  trial,
  timezone,
  onSaved,
  onCancel,
}: {
  trial: TrialRow;
  timezone: string;
  onSaved: (result: { day: string; warnings: string[] }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("trials");
  const rebook = trial.status !== "SCHEDULED";
  const [date, setDate] = useState(() => dayIn(trial.scheduled_at_utc, timezone));
  const [time, setTime] = useState(() => hmIn(trial.scheduled_at_utc, timezone));
  const [duration, setDuration] = useState(trial.duration_minutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const durations = DURATIONS.includes(trial.duration_minutes)
    ? DURATIONS
    : [...DURATIONS, trial.duration_minutes].sort((a, b) => a - b);

  async function save() {
    if (!date || !time) return setError(t("add.slotRequired"));
    setBusy(true);
    setError(null);
    try {
      const res = await updateTrial(trial.id, {
        local_datetime: `${date} ${time}`,
        timezone,
        duration_minutes: duration,
        ...(rebook ? { status: "SCHEDULED" as const } : {}),
      });
      onSaved({ day: date, warnings: (res.warnings ?? []).map((w) => w.message) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="reschedule-trial-form">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <p className="text-muted-foreground text-sm">
        {t.rich("reschedule.intro", {
          name: trial.display_name ?? "—",
          teacher: trial.teacher_name ?? "—",
          b: (chunks) => <span className="text-foreground font-semibold">{chunks}</span>,
        })}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-sm font-medium">
            <CalendarClock className="text-muted-foreground size-3.5" aria-hidden />
            {t("add.date")}
          </label>
          <input
            type="date"
            aria-label={t("add.date")}
            className={inputBase}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid="reschedule-trial-date"
          />
        </div>
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-sm font-medium">
            <Clock className="text-muted-foreground size-3.5" aria-hidden />
            {t("add.time")}
          </label>
          <input
            type="time"
            aria-label={t("add.time")}
            className={inputBase}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            data-testid="reschedule-trial-time"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">{t("add.duration")}</label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {durations.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDuration(d)}
              aria-pressed={duration === d}
              className={cn(
                "rounded-xl border py-2 text-xs font-semibold transition-colors",
                duration === d
                  ? "border-primary bg-primary/10 text-primary ring-primary/20 ring-2"
                  : "border-input text-muted-foreground hover:bg-muted/40",
              )}
            >
              {t("table.minutes", { count: d })}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("back")}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={busy}
          className="gap-1.5"
          data-testid="reschedule-trial-submit"
        >
          {busy && (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          )}
          {rebook ? t("reschedule.rebookSubmit") : t("reschedule.submit")}
        </Button>
      </div>
    </div>
  );
}
