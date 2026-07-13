"use client";

import {
  ArrowLeft,
  Ban,
  CalendarDays,
  Check,
  ClipboardCheck,
  Clock,
  GraduationCap,
  Hourglass,
  RotateCcw,
  TriangleAlert,
  type LucideIcon,
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
import {
  dateInTz,
  dayLongLabel,
  endUtc,
  isVoided,
  STATUS_CHIP,
  STATUS_RAIL,
  timeInTz,
  toLocalInput,
} from "./calendar/utils";

const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3";

/** Which action panel is open. `null` is the details screen with the action picker. */
type Mode = null | "reschedule" | "cancel";

/**
 * Reschedule or cancel a single occurrence (§5.2/5.3). Reschedule sends the new wall-clock plus
 * the viewer timezone so the backend converts per-date (DST-correct) and links the successor;
 * cancel records who cancelled (non-billable). Conflict/availability warnings returned by the
 * server are surfaced but never block — the operation has already succeeded.
 *
 * The surface opens on the lesson's details and asks what you want to do, rather than laying
 * every form out at once. That keeps the destructive path behind a deliberate choice instead of
 * two red buttons sitting under every lesson you merely wanted to look at — and it lets the
 * reason field live inside the action that actually sends it, which is no longer ambiguous.
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
  const [mode, setMode] = useState<Mode>(null);
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

  const day = dateInTz(session.scheduled_at_utc, timeZone);
  const dayLabel = dayLongLabel(day, locale);
  const timeRange = `${timeInTz(session.scheduled_at_utc, timeZone, locale)} – ${timeInTz(
    endUtc(session),
    timeZone,
    locale,
  )}`;
  const name = session.student_name ?? t("calendar.unnamedStudent");
  const canReschedule = can("session.reschedule");
  const canCancel = can("session.cancel") || can("session.cancel_request");
  const showPicker = !readOnly && !requestSent && warnings.length === 0;

  return (
    <div className="space-y-4" data-testid="session-actions">
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

      {/* ── The lesson itself ─────────────────────────────────────────────
          One card: who it's with, what state it's in, and the four facts that
          identify it — rather than a paragraph of dot-separated fragments. */}
      <section className="bg-card overflow-hidden rounded-2xl border shadow-sm">
        <div className="relative flex items-center gap-3 border-b px-4 py-3.5">
          {/* Status rail — the same colour language the grid uses. */}
          <span
            className={cn(
              "absolute inset-y-0 w-1 ltr:left-0 rtl:right-0",
              STATUS_RAIL[session.status],
            )}
            aria-hidden
          />
          <span className="bg-primary/10 text-primary ring-primary/15 flex size-11 shrink-0 items-center justify-center rounded-xl text-base font-bold uppercase ring-1">
            {name.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "truncate font-semibold",
                isVoided(session.status) && "text-muted-foreground line-through",
              )}
            >
              {name}
            </p>
            {session.teacher_name && (
              <p className="text-muted-foreground flex items-center gap-1.5 truncate text-xs">
                <GraduationCap className="size-3.5 shrink-0" aria-hidden />
                {session.teacher_name}
              </p>
            )}
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold",
              STATUS_CHIP[session.status],
            )}
          >
            {t(`status.${session.status}`)}
          </span>
        </div>

        <dl className="grid grid-cols-1 gap-px sm:grid-cols-3">
          <Fact Icon={CalendarDays} label={t("actions.date")} value={dayLabel} />
          <Fact Icon={Clock} label={t("actions.time")} value={timeRange} />
          <Fact
            Icon={Hourglass}
            label={t("actions.durationLabel")}
            value={t("actions.durationMin", { count: session.duration_minutes })}
          />
        </dl>
      </section>

      {/* ── Warnings ─────────────────────────────────────────────────────
          The operation already succeeded; these are advisory, so they end the
          flow with an acknowledge rather than offering the forms again. */}
      {warnings.length > 0 && (
        <div className="space-y-2.5">
          <ul className="space-y-1.5" data-testid="action-warnings">
            {warnings.map((w, i) => (
              <li
                key={i}
                role="alert"
                data-warning={w.type}
                className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300"
              >
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {w.message}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="confirm-after-warning"
            onClick={onDone}
            className="w-full gap-1.5"
          >
            <Check className="size-3.5" aria-hidden />
            {t("actions.acknowledge")}
          </Button>
        </div>
      )}

      {requestSent && (
        <p
          role="status"
          data-testid="request-sent"
          className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300"
        >
          <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t("actions.requestSent")}
        </p>
      )}

      {/* ── What do you want to do? ───────────────────────────────────── */}
      {showPicker && mode === null && (
        <div className="grid gap-2 sm:grid-cols-3">
          <ActionTile
            Icon={ClipboardCheck}
            label={t("actions.attendance")}
            testId="open-attendance"
            onClick={goToAttendance}
          />
          {canReschedule && (
            <ActionTile
              Icon={RotateCcw}
              label={t("actions.rescheduleTitle")}
              testId="open-reschedule"
              onClick={() => setMode("reschedule")}
            />
          )}
          {canCancel && (
            <ActionTile
              Icon={Ban}
              label={t(
                requestMode ? "actions.requestCancelTitle" : "actions.cancelTitle",
              )}
              testId="open-cancel"
              onClick={() => setMode("cancel")}
              destructive
            />
          )}
        </div>
      )}

      {/* ── Reschedule ───────────────────────────────────────────────── */}
      {showPicker && mode === "reschedule" && (
        <Panel
          Icon={RotateCcw}
          title={t("actions.rescheduleTitle")}
          hint={t("actions.rescheduleHint")}
          onBack={() => setMode(null)}
          backLabel={t("actions.back")}
        >
          <label className="block space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">
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

          <ReasonField t={t} value={reason} onChange={setReason} />

          <Button
            type="button"
            size="sm"
            disabled={busy || rescheduled}
            data-testid="do-reschedule"
            onClick={() => void doReschedule()}
            className="w-full gap-1.5"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            {t("actions.reschedule")}
          </Button>
        </Panel>
      )}

      {/* ── Cancel lesson / request cancellation ─────────────────────── */}
      {showPicker && mode === "cancel" && (
        <Panel
          Icon={Ban}
          title={t(
            requestMode ? "actions.requestCancelTitle" : "actions.cancelTitle",
          )}
          hint={t(requestMode ? "actions.requestCancelHint" : "actions.cancelHint")}
          onBack={() => setMode(null)}
          backLabel={t("actions.back")}
          destructive
        >
          <ReasonField t={t} value={reason} onChange={setReason} />

          {/* Cancelling is only half the answer — the API needs to know who cancelled,
              because that is what decides billability. So it's two explicit buttons. */}
          <div className="space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              {t("actions.cancelWho")}
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy}
                data-testid="cancel-by-teacher"
                onClick={() => void doCancel("teacher")}
                className="gap-1.5"
              >
                <Ban className="size-3.5" aria-hidden />
                {t(
                  requestMode
                    ? "actions.requestCancelByTeacher"
                    : "actions.cancelByTeacher",
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                data-testid="cancel-by-student"
                onClick={() => void doCancel("student")}
                className="border-destructive/30 text-destructive hover:bg-destructive/10 gap-1.5"
              >
                <Ban className="size-3.5" aria-hidden />
                {t(
                  requestMode
                    ? "actions.requestCancelByStudent"
                    : "actions.cancelByStudent",
                )}
              </Button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────────

/** One labelled fact in the lesson's detail grid. */
function Fact({
  Icon,
  label,
  value,
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-muted/30 flex items-center gap-2.5 px-4 py-3">
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <dt className="text-muted-foreground text-[0.65rem] font-medium tracking-wide uppercase">
          {label}
        </dt>
        <dd className="truncate text-xs font-semibold tabular-nums">{value}</dd>
      </div>
    </div>
  );
}

/** A choice on the details screen — one action, one tile. */
function ActionTile({
  Icon,
  label,
  testId,
  onClick,
  destructive = false,
}: {
  Icon: LucideIcon;
  label: string;
  testId: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "bg-card flex flex-col items-center justify-center gap-2 rounded-xl border px-3 py-4 text-center text-xs font-semibold shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md active:translate-y-0",
        destructive
          ? "border-destructive/25 text-destructive hover:border-destructive/40 hover:bg-destructive/5"
          : "hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
      )}
    >
      <Icon className="size-5" aria-hidden />
      {label}
    </button>
  );
}

/** The expanded form for one action, with the way back to the picker. */
function Panel({
  Icon,
  title,
  hint,
  onBack,
  backLabel,
  destructive = false,
  children,
}: {
  Icon: LucideIcon;
  title: string;
  hint: string;
  onBack: () => void;
  backLabel: string;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "animate-in fade-in-0 slide-in-from-bottom-1 space-y-3 rounded-2xl border p-4 duration-150",
        destructive ? "border-destructive/20 bg-destructive/[0.04]" : "bg-muted/20",
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          data-testid="action-back"
          className="text-muted-foreground hover:bg-muted hover:text-foreground -ms-1 rounded-lg p-1 transition-colors"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        </button>
        <Icon
          className={cn(
            "size-4",
            destructive ? "text-destructive/70" : "text-muted-foreground",
          )}
          aria-hidden
        />
        <h3
          className={cn(
            "text-sm font-semibold",
            destructive && "text-destructive",
          )}
        >
          {title}
        </h3>
      </div>
      <p className="text-muted-foreground text-xs">{hint}</p>
      {children}
    </section>
  );
}

/** The reason input. It lives inside the panel that sends it, so it's never ambiguous. */
function ReasonField({
  t,
  value,
  onChange,
}: {
  t: ReturnType<typeof useTranslations>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-muted-foreground text-xs font-medium">
        {t("actions.reason")}
      </span>
      <input
        aria-label={t("actions.reason")}
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
