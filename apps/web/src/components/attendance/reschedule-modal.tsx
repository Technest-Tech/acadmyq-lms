"use client";

import { CalendarClock, Clock, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  dateInTz,
  dayLongLabel,
  timeInTz,
  toLocalInput,
} from "@/components/scheduling/calendar/utils";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  type DaySession,
  rescheduleSession,
  type SchedulingWarning,
} from "@/lib/api";

const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3";

/**
 * Move a single SCHEDULED occurrence to a new time from the Attendance day view (§5.2/§3.6).
 * The origin becomes RESCHEDULED and the server mints a linked SCHEDULED successor, so a session
 * can be rescheduled only once — the caller therefore only offers this while it is still SCHEDULED.
 *
 * The new wall-clock is sent with the viewer timezone so the backend resolves it per-date
 * (DST-correct). Conflict/availability warnings come back as soft guidance: the move has ALREADY
 * succeeded when they arrive, so they are surfaced for the user to read but never block or roll back.
 */
export function RescheduleModal({
  session,
  timeZone,
  open,
  onClose,
  onDone,
}: {
  session: DaySession | null;
  /** Viewer timezone; defaults to the browser's resolved zone. */
  timeZone?: string;
  open: boolean;
  onClose: () => void;
  /** The reschedule landed — the caller should reload the day. */
  onDone: () => void;
}) {
  const t = useTranslations("attendance");
  const tSched = useTranslations("scheduling");
  const locale = useLocale();
  const tz = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  const [when, setWhen] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<SchedulingWarning[]>([]);
  const [done, setDone] = useState(false);

  // Re-arm the form for each session the user opens: prefill the picker with the current time
  // and drop any state left behind by the previous one.
  useEffect(() => {
    if (!session) return;
    setWhen(toLocalInput(session.scheduled_at_utc, tz));
    setReason("");
    setError(null);
    setWarnings([]);
    setDone(false);
  }, [session, tz]);

  if (!session) return null;

  const currentDay = dayLongLabel(dateInTz(session.scheduled_at_utc, tz), locale);
  const currentTime = timeInTz(session.scheduled_at_utc, tz, locale);
  const unchanged = when === toLocalInput(session.scheduled_at_utc, tz);

  async function submit() {
    if (!session || busy || done) return;
    setBusy(true);
    setError(null);
    try {
      const res = await rescheduleSession(session.id, {
        local_datetime: when.replace("T", " "),
        timezone: tz,
        reason: reason || undefined,
      });
      // The successor now exists. Rescheduling this same occurrence again would be rejected (it is
      // RESCHEDULED now), so lock the form. With nothing to read, close and refresh straight away;
      // otherwise hold the modal open so the warnings can be seen.
      setDone(true);
      setWarnings(res.warnings ?? []);
      if (!res.warnings?.length) onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      // Once the move has landed the day view is stale (the successor sits elsewhere), so ANY
      // dismissal — X, backdrop, Esc — has to reload, not just the explicit acknowledge button.
      onClose={done ? onDone : onClose}
      title={tSched("actions.rescheduleTitle")}
      description={session.student_name ?? undefined}
      footer={
        done ? (
          <Button type="button" data-testid="reschedule-acknowledge" onClick={onDone}>
            {tSched("actions.acknowledge")}
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t("close")}
            </Button>
            <Button
              type="button"
              data-testid="do-reschedule"
              disabled={busy || !when || unchanged}
              onClick={() => void submit()}
              className="gap-1.5"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <RotateCcw className="size-3.5" aria-hidden />
              )}
              {tSched("actions.reschedule")}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-5" data-testid="reschedule-modal">
        {/* ── Where the class sits today ────────────────────────────────── */}
        <div className="flex items-start gap-3 rounded-2xl border bg-gradient-to-br from-muted/50 to-transparent p-4">
          <div className="bg-primary/10 ring-primary/15 flex size-11 shrink-0 items-center justify-center rounded-xl ring-1">
            <CalendarClock className="text-primary size-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-xs font-medium">
              {t("currentTime")}
            </p>
            <p className="mt-0.5 font-semibold leading-tight">{currentDay}</p>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Clock className="size-3.5" aria-hidden />
                {currentTime}
              </span>
              <span>·</span>
              <span>
                {session.duration_minutes} {t("min")}
              </span>
              {session.teacher_name && (
                <>
                  <span>·</span>
                  <span>{session.teacher_name}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <p className="text-muted-foreground text-xs">
          {tSched("actions.rescheduleHint")}
        </p>

        {/* ── New time + reason ─────────────────────────────────────────── */}
        <label className="block space-y-1.5">
          <span className="text-muted-foreground text-xs font-medium">
            {tSched("actions.newTime")}
          </span>
          <input
            type="datetime-local"
            aria-label={tSched("actions.newTime")}
            data-testid="reschedule-when"
            className={inputClass}
            value={when}
            disabled={done}
            onChange={(e) => setWhen(e.target.value)}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-muted-foreground text-xs font-medium">
            {tSched("actions.reason")}
          </span>
          <input
            aria-label={tSched("actions.reason")}
            data-testid="reschedule-reason"
            className={inputClass}
            value={reason}
            disabled={done}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        {error && (
          <p
            role="alert"
            data-testid="reschedule-error"
            className="text-destructive border-destructive/20 bg-destructive/5 rounded-xl border px-3 py-2 text-xs font-medium"
          >
            {error}
          </p>
        )}

        {/* The move already succeeded — these are advisory, not failures. */}
        {done && (
          <div className="space-y-2">
            <p
              role="status"
              data-testid="reschedule-done"
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300"
            >
              {t("rescheduleDone")}
            </p>
            {warnings.length > 0 && (
              <ul className="space-y-1.5" data-testid="reschedule-warnings">
                {warnings.map((w, i) => (
                  <li
                    key={i}
                    role="alert"
                    data-warning={w.type}
                    className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300"
                  >
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {w.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
