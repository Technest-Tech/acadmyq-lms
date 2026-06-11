"use client";

import {
  Check,
  Clock,
  Copy,
  History,
  MessageCircle,
  Send,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  type AttendanceOutcome,
  getSession,
  markAttendance,
  markWhatsappSent,
  putSessionReport,
  type ReportField,
  type SessionDetailResponse,
  type WhatsAppMessage,
} from "@/lib/api";
import { ReportArchive } from "./report-archive";
import { StatusBadge } from "./status-badge";

const OUTCOMES: AttendanceOutcome[] = [
  "ATTENDED",
  "ABSENT_UNEXCUSED",
  "ABSENT_EXCUSED",
  "CANCELLED_BY_TEACHER",
  "CANCELLED_BY_STUDENT",
];

const fieldClass =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

type Feedback = { variant: "success" | "error"; message: string };

/** Pull Laravel 422 field errors (keyed `values.<key>`) into a flat `{ key: message }` map. */
function fieldErrorsFrom(err: unknown): Record<string, string> {
  if (err instanceof ApiError && err.body && typeof err.body === "object") {
    const errors =
      (err.body as { errors?: Record<string, string[]> }).errors ?? {};
    const out: Record<string, string> = {};
    for (const [key, messages] of Object.entries(errors)) {
      out[key.replace(/^values\./, "")] = messages[0] ?? "";
    }
    return out;
  }
  return {};
}

/**
 * The premium attendance + custom-report surface (Sprint 6 §2, §6). Pick one of the five outcomes
 * (which fires the billing hook server-side), fill the academy's dynamic report fields (validated
 * by the API, errors shown inline), then compose/mark the manual WhatsApp report — with a history
 * popup over the student's archive. Permission-gated: `session.mark_attendance` for the outcome,
 * `session.write_report` for the report/WhatsApp; the API additionally limits a Teacher to their
 * own sessions and enforces the timing gate.
 */
export function AttendanceReport({
  sessionId,
  onError,
  onChange,
}: {
  sessionId: string;
  onError?: (message: string) => void;
  onChange?: () => void;
}) {
  const t = useTranslations("attendance");
  const ts = useTranslations("scheduling");
  const locale = useLocale();
  const { can } = useAuth();

  const [data, setData] = useState<SessionDetailResponse | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<AttendanceOutcome | null>(
    null,
  );
  const [whatsapp, setWhatsapp] = useState<WhatsAppMessage | null>(null);
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const label = (f: ReportField) => (locale === "ar" ? f.label_ar : f.label_en);

  function flash(variant: "success" | "error", message: string) {
    setFeedback({ variant, message });
    if (variant === "success") {
      window.setTimeout(() => setFeedback(null), 4000);
    }
  }

  const load = useCallback(async () => {
    try {
      const detail = await getSession(sessionId);
      setData(detail);
      const init: Record<string, string> = {};
      for (const field of detail.reportFields) {
        const value = detail.report?.values?.[field.key];
        if (value != null) init[field.key] = String(value);
      }
      setValues(init);
      setPendingStatus(null);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    }
  }, [sessionId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return (
      <div
        className="text-muted-foreground flex items-center gap-2 py-10 text-sm"
        data-testid="attendance-loading"
      >
        <Clock className="size-4 animate-pulse" />
        {t("loading")}
      </div>
    );
  }

  const canMark = can("session.mark_attendance");
  const canWrite = can("session.write_report");
  const { session, report } = data;
  const dateText = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(session.scheduled_at_utc));

  async function setOutcome(status: AttendanceOutcome, override = false) {
    setBusy(true);
    setPendingStatus(status);
    try {
      await markAttendance(sessionId, { status, override_timing: override });
      await load();
      flash("success", t("attendanceRecorded"));
      onChange?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      flash("error", message);
      if (!(error instanceof ApiError && error.status === 422)) {
        setPendingStatus(null);
      }
    } finally {
      setBusy(false);
    }
  }

  const needOverride =
    pendingStatus !== null &&
    feedback?.variant === "error" &&
    session.status !== pendingStatus;

  async function saveReport() {
    setBusy(true);
    setFieldErrors({});
    try {
      await putSessionReport(sessionId, values);
      await load();
      flash("success", t("saved"));
      onChange?.();
    } catch (error) {
      const fe = fieldErrorsFrom(error);
      if (Object.keys(fe).length > 0) {
        setFieldErrors(fe);
      } else {
        flash("error", error instanceof Error ? error.message : String(error));
      }
    } finally {
      setBusy(false);
    }
  }

  async function composeWhatsapp() {
    setBusy(true);
    try {
      const res = await markWhatsappSent(sessionId);
      setWhatsapp(res.message);
      await load();
      flash("success", t("markedSent"));
      onChange?.();
    } catch (error) {
      flash("error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="attendance-report">
      {/* ── Header card ─────────────────────────────────────────── */}
      <div className="bg-card rounded-2xl border p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-bold tracking-tight">
              {session.student_name}
            </h2>
            <p className="text-muted-foreground text-sm">
              {session.teacher_name} · {dateText}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span data-testid="current-status">
              <StatusBadge status={session.status} />
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setHistoryOpen(true)}
              data-testid="open-history"
            >
              <History className="size-3.5" />
              {t("viewHistory")}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {session.classification.billableToStudent && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {t("billsStudent")}
            </span>
          )}
          {session.classification.countsForTeacher && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {t("paysTeacher")}
            </span>
          )}
          {session.billed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
              <Check className="size-3" />
              {t("billed")}
            </span>
          )}
        </div>
      </div>

      {feedback && (
        <AlertBanner
          variant={feedback.variant}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {/* ── Outcome ─────────────────────────────────────────────── */}
      <section className="bg-card space-y-3 rounded-2xl border p-5 shadow-sm">
        <h3 className="text-sm font-semibold">{t("outcome")}</h3>
        <div className="flex flex-wrap gap-2">
          {OUTCOMES.map((status) => (
            <Button
              key={status}
              type="button"
              size="sm"
              variant={session.status === status ? "secondary" : "outline"}
              disabled={!canMark || busy}
              onClick={() => setOutcome(status)}
              data-testid={`outcome-${status}`}
            >
              {session.status === status && <Check className="size-3.5" />}
              {ts(`status.${status}`)}
            </Button>
          ))}
        </div>
        {needOverride && canMark && (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => setOutcome(pendingStatus!, true)}
            data-testid="override-timing"
          >
            <Clock className="size-3.5" />
            {t("overrideTiming")}
          </Button>
        )}
        {!canMark && (
          <p className="text-muted-foreground text-xs">{t("noPermission")}</p>
        )}
      </section>

      {/* ── Dynamic report ──────────────────────────────────────── */}
      <section className="bg-card space-y-4 rounded-2xl border p-5 shadow-sm">
        <h3 className="text-sm font-semibold">{t("reportTitle")}</h3>

        {data.reportFields.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("noFields")}</p>
        )}

        {data.reportFields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <label
              className="block text-sm font-medium"
              htmlFor={`rf-${field.key}`}
            >
              {label(field)}
              {field.is_required && (
                <span className="text-destructive"> *</span>
              )}
            </label>
            <ReportInput
              field={field}
              value={values[field.key] ?? ""}
              disabled={!canWrite || busy}
              onChange={(v) =>
                setValues((prev) => ({ ...prev, [field.key]: v }))
              }
            />
            {fieldErrors[field.key] && (
              <p
                className="text-destructive text-xs"
                data-testid={`error-${field.key}`}
              >
                {fieldErrors[field.key]}
              </p>
            )}
          </div>
        ))}

        {/* Deactivated fields that still carry a value → read-only history (AC-6.6). */}
        {data.inactiveReportFields.map((field) => (
          <div key={field.key} className="space-y-1 opacity-70">
            <label className="block text-sm font-medium">{label(field)}</label>
            <p
              className="bg-muted rounded-lg px-3.5 py-2.5 text-sm"
              data-testid={`readonly-${field.key}`}
            >
              {String(report?.values?.[field.key] ?? "—")}
            </p>
          </div>
        ))}

        {canWrite && data.reportFields.length > 0 && (
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={saveReport}
              data-testid="save-report"
            >
              {busy ? t("saving") : t("save")}
            </Button>
          </div>
        )}
      </section>

      {/* ── Manual WhatsApp ─────────────────────────────────────── */}
      {canWrite && report && (
        <section className="bg-card space-y-3 rounded-2xl border p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("whatsappTitle")}</h3>
            {report.whatsapp_sent_at && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                data-testid="wa-sent"
              >
                <Check className="size-3" />
                {t("sentBadge")}
              </span>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={composeWhatsapp}
            data-testid="compose-whatsapp"
          >
            <Send className="size-3.5" />
            {t("compose")}
          </Button>
          {whatsapp && (
            <div className="space-y-2">
              <textarea
                readOnly
                className={fieldClass}
                rows={6}
                value={whatsapp.text}
                data-testid="wa-text"
              />
              <div className="flex gap-2">
                <a
                  href={whatsapp.deeplink}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="wa-link"
                >
                  <Button type="button" size="sm" variant="outline">
                    <MessageCircle className="size-3.5" />
                    {t("openWhatsApp")}
                  </Button>
                </a>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(whatsapp.text);
                    setCopied(true);
                  }}
                  data-testid="wa-copy"
                >
                  <Copy className="size-3.5" />
                  {copied ? t("copied") : t("copy")}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── History popup ───────────────────────────────────────── */}
      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={t("history")}
        description={session.student_name ?? undefined}
        size="xl"
      >
        <ReportArchive studentId={session.student_id} />
      </Modal>
    </div>
  );
}

/** One report-field input, rendered by its declared type (§6.1). */
function ReportInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: ReportField;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = `rf-${field.key}`;
  const common = {
    id,
    className: fieldClass,
    value,
    disabled,
    onChange: (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => onChange(e.target.value),
  };

  if (field.field_type === "TEXTAREA") {
    return <textarea {...common} rows={3} />;
  }
  if (field.field_type === "NUMBER") {
    return <input {...common} type="number" inputMode="decimal" />;
  }
  if (
    field.field_type === "SELECT" ||
    (field.field_type === "RATING" && field.options)
  ) {
    return (
      <select {...common}>
        <option value="" />
        {(field.options ?? []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
  if (field.field_type === "RATING") {
    return <input {...common} type="number" min={1} max={5} />;
  }
  return <input {...common} type="text" />;
}
