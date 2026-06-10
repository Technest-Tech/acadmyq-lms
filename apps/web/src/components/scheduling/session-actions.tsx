"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  type CalendarSession,
  cancelSession,
  rescheduleSession,
  type SchedulingWarning,
} from "@/lib/api";

const inputClass =
  "border-input bg-background rounded-md border px-2 py-1.5 text-sm";

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
}: {
  session: CalendarSession;
  timeZone: string;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("scheduling");
  const { can } = useAuth();
  const [when, setWhen] = useState(() =>
    toLocalInput(session.scheduled_at_utc, timeZone),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<SchedulingWarning[]>([]);

  async function doReschedule() {
    setBusy(true);
    try {
      const res = await rescheduleSession(session.id, {
        local_datetime: when.replace("T", " "),
        timezone: timeZone,
        reason: reason || undefined,
      });
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
      await cancelSession(session.id, {
        cancelled_by: by,
        reason: reason || undefined,
      });
      onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="space-y-3 rounded-md border p-4"
      data-testid="session-actions"
    >
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

      {warnings.length > 0 && (
        <ul className="space-y-1" data-testid="action-warnings">
          {warnings.map((w, i) => (
            <li
              key={i}
              role="alert"
              className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800"
              data-warning={w.type}
            >
              {w.message}
            </li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <Button
          type="button"
          size="xs"
          variant="outline"
          data-testid="confirm-after-warning"
          onClick={onDone}
        >
          {t("actions.acknowledge")}
        </Button>
      )}

      <label className="block space-y-1">
        <span className="text-xs">{t("actions.reason")}</span>
        <input
          aria-label={t("actions.reason")}
          className={`${inputClass} w-full`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>

      {can("session.reschedule") && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="text-xs">{t("actions.newTime")}</span>
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
            disabled={busy}
            data-testid="do-reschedule"
            onClick={() => void doReschedule()}
          >
            {t("actions.reschedule")}
          </Button>
        </div>
      )}

      {can("session.cancel") && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            data-testid="cancel-by-teacher"
            onClick={() => void doCancel("teacher")}
          >
            {t("actions.cancelByTeacher")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            data-testid="cancel-by-student"
            onClick={() => void doCancel("student")}
          >
            {t("actions.cancelByStudent")}
          </Button>
        </div>
      )}
    </div>
  );
}
