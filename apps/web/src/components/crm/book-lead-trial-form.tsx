"use client";

import { CalendarClock, Clock, GraduationCap, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  ApiError,
  bookLeadTrial,
  listCrmTeachers,
  type LeadRow,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border py-2.5 px-3.5 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

/** Fallback durations if the roster call hasn't landed yet — the server sends the real set. */
const FALLBACK_DURATIONS = [15, 30, 45, 60, 90, 120];

/** Tomorrow, in the browser's own day — the answer for "when?" nine times out of ten. */
function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The trial details the TRIAL stage asks for: which teacher, when, and for how long. Moving a
 * lead into that column opens this — the stage exists because a real trial was booked, so the
 * booking is the move, not a label change.
 *
 * On save the trial lands on the academy calendar and in the trials statistics immediately. A
 * clash with another lesson or trial comes back as a WARNING rather than a refusal (§3.7): the
 * person booking knows things the roster does not, so they are told, not stopped.
 */
export function BookLeadTrialForm({
  lead,
  onCancel,
  onBooked,
}: {
  lead: LeadRow;
  onCancel: () => void;
  /** `warnings` are non-blocking notes about the slot (conflict, outside availability). */
  onBooked: (warnings: string[]) => void;
}) {
  const t = useTranslations("crm");
  const locale = useLocale();

  const [teachers, setTeachers] = useState<{ id: string; full_name: string }[]>([]);
  const [durations, setDurations] = useState<number[]>(FALLBACK_DURATIONS);
  const [timezone, setTimezone] = useState<string | null>(null);

  const [teacherId, setTeacherId] = useState(lead.trial_teacher_id ?? "");
  const [date, setDate] = useState(tomorrow());
  const [time, setTime] = useState("17:00");
  const [duration, setDuration] = useState(30);
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listCrmTeachers()
      .then((r) => {
        if (cancelled) return;
        setTeachers(r.teachers);
        if (r.durations.length > 0) setDurations(r.durations);
        setTimezone(r.timezone);
        // One teacher on the roster is not a choice — pick them.
        if (r.teachers.length === 1) setTeacherId((prev) => prev || r.teachers[0]!.id);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function book() {
    if (!teacherId) {
      setError(t("trial.teacherRequired"));
      return;
    }
    if (!date || !time) {
      setError(t("trial.slotRequired"));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await bookLeadTrial(lead.id, {
        teacher_id: teacherId,
        local_datetime: `${date} ${time}`,
        // The academy's own timezone is the booking's frame of reference — the owner reading
        // this from another country is still booking a lesson in the academy's day.
        timezone: timezone ?? undefined,
        duration_minutes: duration,
        notes: notes.trim() || null,
      });
      onBooked(res.warnings.map((w) => w.message));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const teacherName = teachers.find((tch) => tch.id === teacherId)?.full_name;

  return (
    <div className="space-y-5" data-testid="crm-trial-form">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {/* Who this trial is for — the reason the form is open. */}
      <div className="border-primary/20 bg-primary/5 flex items-start gap-3 rounded-xl border px-4 py-3">
        <Sparkles className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">{lead.full_name}</p>
          <p className="text-muted-foreground text-xs">{t("trial.intro")}</p>
        </div>
      </div>

      {/* A lead already carrying a trial is being given another one — say so plainly. */}
      {lead.trial_id !== null && (
        <p className="rounded-xl border border-dashed px-3.5 py-2.5 text-xs text-muted-foreground">
          {t("trial.existingHint")}
        </p>
      )}

      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-sm font-medium">
          <GraduationCap className="text-muted-foreground size-3.5" aria-hidden />
          {t("trial.teacher")}
          <span className="text-destructive">*</span>
        </label>
        <Combobox
          options={teachers.map((tch) => ({ value: tch.id, label: tch.full_name }))}
          value={teacherId}
          onChange={setTeacherId}
          placeholder={t("trial.selectTeacher")}
          searchPlaceholder={t("trial.searchTeacher")}
          data-testid="crm-trial-teacher"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-sm font-medium">
            <CalendarClock className="text-muted-foreground size-3.5" aria-hidden />
            {t("trial.date")}
            <span className="text-destructive">*</span>
          </label>
          <input
            type="date"
            aria-label={t("trial.date")}
            className={inputBase}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid="crm-trial-date"
          />
        </div>
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-sm font-medium">
            <Clock className="text-muted-foreground size-3.5" aria-hidden />
            {t("trial.time")}
            <span className="text-destructive">*</span>
          </label>
          <input
            type="time"
            aria-label={t("trial.time")}
            className={inputBase}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            data-testid="crm-trial-time"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">{t("trial.duration")}</label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {durations.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDuration(d)}
              className={cn(
                "rounded-xl border py-2 text-xs font-semibold transition-colors",
                duration === d
                  ? "border-primary bg-primary/10 text-primary ring-primary/20 ring-2"
                  : "border-input text-muted-foreground hover:bg-muted/40",
              )}
            >
              {t("trial.minutes", { count: d })}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">{t("trial.notes")}</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder={t("trial.notesPlaceholder")}
          className="border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3"
        />
      </div>

      {/* What is about to be written, in words — the calendar entry, read back. */}
      {teacherId && date && time && (
        <div className="rounded-xl border bg-gradient-to-br from-sky-500/[0.07] to-transparent px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-600/80 dark:text-sky-400/70">
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
          <p className="text-muted-foreground text-xs">
            <span dir="ltr">{time}</span> · {t("trial.minutes", { count: duration })}
            {teacherName ? ` · ${teacherName}` : ""}
            {timezone ? ` · ${timezone.replace(/_/g, " ")}` : ""}
          </p>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("trial.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void book()}
          disabled={busy || !teacherId || !date || !time}
          className="gap-1.5"
          data-testid="crm-trial-submit"
        >
          {busy ? (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          ) : (
            <CalendarClock className="size-3.5" aria-hidden />
          )}
          {t("trial.confirm")}
        </Button>
      </div>
    </div>
  );
}
