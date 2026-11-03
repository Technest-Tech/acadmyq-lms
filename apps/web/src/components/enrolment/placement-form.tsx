"use client";

import { CalendarClock, Clock, GraduationCap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { listTrialTeachers } from "@/lib/api";
import { bookPlacement, type EnrolmentRequest } from "@/lib/enrolment-api";
import { cn } from "@/lib/utils";

const FALLBACK_DURATIONS = [15, 30, 45, 60, 90, 120];

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * "احجز حصة تحديد مستوى" from a request: the teacher, the day, the time and the length — the same
 * roster, durations and academy clock the trials board's own form uses (`/api/trials/teachers`), so
 * a slot typed as 17:00 is 17:00 at the centre. Who the lesson is for is already known: the request
 * carries the child's name and the phone, and the server copies them onto the trial.
 */
export function PlacementForm({
  request,
  onBooked,
  onCancel,
}: {
  request: EnrolmentRequest;
  onBooked: (result: { request: EnrolmentRequest; warnings: string[] }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("enrolment");

  const [teachers, setTeachers] = useState<{ id: string; full_name: string }[]>([]);
  const [durations, setDurations] = useState<number[]>(FALLBACK_DURATIONS);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState("");
  const [date, setDate] = useState(today());
  const [time, setTime] = useState(request.preferred_time ?? "17:00");
  const [duration, setDuration] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void listTrialTeachers()
      .then((r) => {
        if (!alive) return;
        setTeachers(r.teachers);
        if (r.durations.length > 0) setDurations(r.durations);
        setTimezone(r.timezone);
        if (r.teachers.length === 1) setTeacherId((prev) => prev || r.teachers[0]!.id);
      })
      .catch((err) => alive && setError(apiErrorMessage(err, t("placement.failed"))));
    return () => {
      alive = false;
    };
  }, [t]);

  async function submit() {
    if (!teacherId) return setError(t("placement.teacherRequired"));
    if (!date || !time) return setError(t("placement.slotRequired"));
    setBusy(true);
    setError(null);
    try {
      const res = await bookPlacement(request.id, {
        teacher_id: teacherId,
        local_datetime: `${date} ${time}`,
        timezone: timezone ?? undefined,
        duration_minutes: duration,
      });
      onBooked({ request: res.request, warnings: res.warnings.map((w) => w.message) });
    } catch (err) {
      setError(apiErrorMessage(err, t("placement.failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="placement-form">
      {error && (
        <p role="alert" className="text-destructive text-sm font-medium">
          {error}
        </p>
      )}

      <div className="bg-muted/40 rounded-xl border px-3.5 py-2.5 text-sm">
        <p className="font-semibold">{request.student_name}</p>
        <p className="text-muted-foreground text-xs">
          <bdi dir="ltr">{request.phone}</bdi>
          {request.subject ? ` · ${request.subject}` : ""}
          {request.level ? ` · ${request.level}` : ""}
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-sm font-medium">
          <GraduationCap className="text-muted-foreground size-3.5" aria-hidden />
          {t("placement.teacher")}
          <span className="text-destructive">*</span>
        </label>
        <Combobox
          options={teachers.map((tch) => ({ value: tch.id, label: tch.full_name }))}
          value={teacherId}
          onChange={setTeacherId}
          placeholder={t("placement.selectTeacher")}
          searchPlaceholder={t("placement.searchTeacher")}
          data-testid="placement-teacher"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-sm font-medium">
            <CalendarClock className="text-muted-foreground size-3.5" aria-hidden />
            {t("placement.date")}
          </label>
          <input type="date" className={fieldClass} value={date} onChange={(e) => setDate(e.target.value)} aria-label={t("placement.date")} data-testid="placement-date" />
        </div>
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-sm font-medium">
            <Clock className="text-muted-foreground size-3.5" aria-hidden />
            {t("placement.time")}
          </label>
          <input type="time" className={fieldClass} value={time} onChange={(e) => setTime(e.target.value)} aria-label={t("placement.time")} data-testid="placement-time" />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">{t("placement.duration")}</label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {durations.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDuration(d)}
              aria-pressed={duration === d}
              className={cn(
                "rounded-xl border py-2 text-xs font-semibold transition-colors",
                duration === d ? "border-primary bg-primary/10 text-primary ring-primary/20 ring-2" : "border-input text-muted-foreground hover:bg-muted/40",
              )}
            >
              {t("placement.minutes", { n: d })}
            </button>
          ))}
        </div>
      </div>

      {timezone && <p className="text-muted-foreground text-xs">{t("placement.clock", { tz: timezone.replace(/_/g, " ") })}</p>}

      <div className="flex items-center justify-between gap-2 border-t pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("placement.cancel")}
        </Button>
        <Button type="button" size="sm" onClick={() => void submit()} disabled={busy} className="gap-1.5" data-testid="placement-submit">
          {busy ? <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" /> : <CalendarClock className="size-3.5" aria-hidden />}
          {t("placement.submit")}
        </Button>
      </div>
    </div>
  );
}
