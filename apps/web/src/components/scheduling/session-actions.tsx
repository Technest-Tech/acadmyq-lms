"use client";

import {
  Ban,
  CalendarClock,
  Clock,
  ClipboardCheck,
  GraduationCap,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  type CalendarSession,
  cancelSession,
  requestCancellation,
  rescheduleSession,
  type SchedulingWarning,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { dateInTz, dayLongLabel, endUtc, STATUS_CHIP, timeInTz } from "./calendar/utils";

const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3";

/** Trim a UTC ISO instant to the "YYYY-MM-DDTHH:mm" a datetime-local input expects, in tz. */
function toLocalInput(utcIso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcIso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * Reschedule or cancel a single occurrence (§5.2/5.3). Reschedule sends the new wall-clock plus
 * the viewer timezone so the backend converts per-date (DST-correct) and links the successor;
 * cancel records who cancelled (non-billable). Conflict/availability warnings returned by the
 * server are surfaced but never block — the operation has already succeeded.
 */
export function SessionActions({
  session,
  timeZone,
  onClose,
  onDone,
  onError,
  hideHeader = false,
  readOnly = false,
}: {
  session: CalendarSession;
  timeZone: string;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
  /** Suppress the built-in title/close row when rendered inside a Modal that supplies its own. */
  hideHeader?: boolean;
  /** Render details only — no attendance/reschedule/cancel affordances (e.g. teacher view). */
  readOnly?: boolean;
}) {
  const t = useTranslations("scheduling");
  const locale = useLocale();
  const router = useRouter();
  const { can } = useAuth();
  const [when, setWhen] = useState(() =>
    toLocalInput(session.scheduled_at_utc, timeZone),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<SchedulingWarning[]>([]);
  const [rescheduled, setRescheduled] = useState(false);
  const [requestSent, setRequestSent] = useState(false);

  // Recording attendance happens on the dedicated Attendance page. Deep-link to it with the
  // session's day pre-selected and its id so the report opens straight away.
  function goToAttendance() {
    const params = new URLSearchParams({
      session: session.id,
      date: dateInTz(session.scheduled_at_utc, timeZone),
    });
    if (session.student_name) params.set("name", session.student_name);
    router.push(`/attendance?${params.toString()}`);
  }

  // A teacher can no longer cancel directly — they raise a request for the owner to approve.
  // Owners (session.cancel) still cancel immediately.
  const requestMode = !can("session.cancel") && can("session.cancel_request");

  async function doReschedule() {
    setBusy(true);
    try {
      const res = await rescheduleSession(session.id, {
        local_datetime: when.replace("T", " "),
        timezone: timeZone,
        reason: reason || undefined,
      });
      // The reschedule succeeded — the successor now exists. Rescheduling this same occurrence
      // again would be rejected by the server (it is RESCHEDULED now), so lock the action and,
      // when there are no warnings to read, refresh straight away.
      setRescheduled(true);
      setWarnings(res.warnings ?? []);
      if (!res.warnings?.length) onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function doCancel(by: "teacher" | "student") {
    setBusy(true);
    try {
      if (requestMode) {
        await requestCancellation(session.id, {
          cancelled_by: by,
          reason: reason || undefined,
        });
        setRequestSent(true);
      } else {
        await cancelSession(session.id, {
          cancelled_by: by,
          reason: reason || undefined,
        });
        onDone();
      }
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const dayLabel = dayLongLabel(dateInTz(session.scheduled_at_utc, timeZone), locale);
  const timeRange = `${timeInTz(session.scheduled_at_utc, timeZone, locale)} – ${timeInTz(endUtc(session), timeZone, locale)}`;

  return (
    <div className="space-y-5" data-testid="session-actions">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">
            {t("actions.title", { name: session.student_name ?? "" })}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-testid="close-actions"
            onClick={onClose}
          >
            ✕
          </Button>
        </div>
      )}

      {/* ── Session summary ──────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border bg-gradient-to-br from-muted/50 to-transparent">
        <div className="flex items-start gap-3 p-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/15">
            <CalendarClock className="size-5 text-primary" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-tight">{dayLabel}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Clock className="size-3.5" aria-hidden />
                {timeRange}
              </span>
              <span>·</span>
              <span>{t("actions.durationMin", { count: session.duration_minutes })}</span>
              {session.teacher_name && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <GraduationCap className="size-3.5" aria-hidden />
                    {session.teacher_name}
                  </span>
                </>
              )}
            </div>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-0.5 text-[0.7rem] font-medium",
              STATUS_CHIP[session.status],
            )}
          >
            {t(`status.${session.status}`)}
          </span>
        </div>

        {/* Attendance & report entry — handled on the Attendance page */}
        {!readOnly && (
          <button
            type="button"
            onClick={goToAttendance}
            data-testid="open-attendance"
            className="flex w-full items-center gap-2 border-t px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
          >
            <ClipboardCheck className="size-4 text-muted-foreground" aria-hidden />
            {t("actions.attendance")}
          </button>
        )}
      </div>

      {/* ── Warnings ─────────────────────────────────────────────────── */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          <ul className="space-y-1.5" data-testid="action-warnings">
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
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid="confirm-after-warning"
            onClick={onDone}
          >
            {t("actions.acknowledge")}
          </Button>
        </div>
      )}

      {/* ── Shared reason ────────────────────────────────────────────── */}
      {!readOnly && (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("actions.reason")}
          </span>
          <input
            aria-label={t("actions.reason")}
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}

      {/* ── Reschedule ───────────────────────────────────────────────── */}
      {!readOnly && can("session.reschedule") && (
        <section className="space-y-2.5 rounded-2xl border p-4">
          <div className="flex items-center gap-2">
            <RotateCcw className="size-4 text-muted-foreground" aria-hidden />
            <h3 className="text-sm font-semibold">{t("actions.rescheduleTitle")}</h3>
          </div>
          <p className="text-xs text-muted-foreground">{t("actions.rescheduleHint")}</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-52 flex-1 space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("actions.newTime")}
              </span>
              <input
                type="datetime-local"
                aria-label={t("actions.newTime")}
                data-testid="reschedule-when"
                className={inputClass}
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </label>
            <Button
              type="button"
              size="sm"
              disabled={busy || rescheduled}
              data-testid="do-reschedule"
              onClick={() => void doReschedule()}
              className="gap-1.5"
            >
              <RotateCcw className="size-3.5" />
              {t("actions.reschedule")}
            </Button>
          </div>
        </section>
      )}

      {/* ── Cancel lesson / request cancellation ─────────────────────── */}
      {!readOnly && (can("session.cancel") || can("session.cancel_request")) && (
        <section className="space-y-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
          <div className="flex items-center gap-2">
            <Ban className="size-4 text-destructive/70" aria-hidden />
            <h3 className="text-sm font-semibold text-destructive">
              {t(requestMode ? "actions.requestCancelTitle" : "actions.cancelTitle")}
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(requestMode ? "actions.requestCancelHint" : "actions.cancelHint")}
          </p>
          {requestSent ? (
            <p
              role="status"
              data-testid="request-sent"
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300"
            >
              {t("actions.requestSent")}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy}
                data-testid="cancel-by-teacher"
                onClick={() => void doCancel("teacher")}
                className="gap-1.5"
              >
                <Ban className="size-3.5" />
                {t(requestMode ? "actions.requestCancelByTeacher" : "actions.cancelByTeacher")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                data-testid="cancel-by-student"
                onClick={() => void doCancel("student")}
                className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                <Ban className="size-3.5" />
                {t(requestMode ? "actions.requestCancelByStudent" : "actions.cancelByStudent")}
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
