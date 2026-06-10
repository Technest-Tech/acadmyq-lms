"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
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

const OUTCOMES: AttendanceOutcome[] = [
  "ATTENDED",
  "ABSENT_UNEXCUSED",
  "ABSENT_EXCUSED",
  "CANCELLED_BY_TEACHER",
  "CANCELLED_BY_STUDENT",
];

const inputClass =
  "border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm";

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
 * The attendance + custom-report surface (Sprint 6 §2, §6). Pick one of the five outcomes (which
 * fires the billing hook server-side), fill the academy's dynamic report fields (validated by the
 * API, errors shown inline), then compose/mark the manual WhatsApp report. Permission-gated:
 * `session.mark_attendance` for the outcome, `session.write_report` for the report/WhatsApp; the
 * API additionally limits a Teacher to their own sessions and enforces the timing gate.
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
  const [busy, setBusy] = useState(false);
  const [needOverride, setNeedOverride] = useState(false);
  const [whatsapp, setWhatsapp] = useState<WhatsAppMessage | null>(null);
  const [copied, setCopied] = useState(false);

  const label = (f: ReportField) => (locale === "ar" ? f.label_ar : f.label_en);

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
      setNeedOverride(false);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    }
  }, [sessionId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return <p data-testid="attendance-loading">{t("loading")}</p>;
  }

  const canMark = can("session.mark_attendance");
  const canWrite = can("session.write_report");
  const { session, report } = data;

  async function setOutcome(status: AttendanceOutcome, override = false) {
    setBusy(true);
    try {
      await markAttendance(sessionId, { status, override_timing: override });
      await load();
      onChange?.();
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setNeedOverride(true); // the timing gate — an Owner may override
      }
      onError?.(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveReport() {
    setBusy(true);
    setFieldErrors({});
    try {
      await putSessionReport(sessionId, values);
      await load();
      onChange?.();
    } catch (error) {
      const fe = fieldErrorsFrom(error);
      if (Object.keys(fe).length > 0) {
        setFieldErrors(fe);
      } else {
        onError?.(error instanceof Error ? error.message : String(error));
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
      onChange?.();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="attendance-report">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">
          {session.student_name} · {session.teacher_name}
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          <span
            className="bg-secondary rounded px-2 py-0.5"
            data-testid="current-status"
          >
            {ts(`status.${session.status}`)}
          </span>
          {session.classification.billableToStudent && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">
              {t("billsStudent")}
            </span>
          )}
          {session.classification.countsForTeacher && (
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-900">
              {t("paysTeacher")}
            </span>
          )}
        </div>
      </header>

      {/* ── Outcome ─────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t("outcome")}</h3>
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
              {ts(`status.${status}`)}
            </Button>
          ))}
        </div>
        {needOverride && can("session.mark_attendance") && (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => setOutcome("ATTENDED", true)}
            data-testid="override-timing"
          >
            {t("overrideTiming")}
          </Button>
        )}
        {!canMark && (
          <p className="text-muted-foreground text-xs">{t("noPermission")}</p>
        )}
      </section>

      {/* ── Dynamic report ──────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t("reportTitle")}</h3>
        {data.reportFields.map((field) => (
          <div key={field.key} className="space-y-1">
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
            <label className="block text-sm font-medium">
              {label(field)}
            </label>
            <p
              className="bg-muted rounded-md px-2 py-1.5 text-sm"
              data-testid={`readonly-${field.key}`}
            >
              {String(report?.values?.[field.key] ?? "—")}
            </p>
          </div>
        ))}

        {canWrite && data.reportFields.length > 0 && (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={saveReport}
            data-testid="save-report"
          >
            {busy ? t("saving") : t("save")}
          </Button>
        )}
      </section>

      {/* ── Manual WhatsApp ─────────────────────────────────────── */}
      {canWrite && report && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t("whatsappTitle")}</h3>
          {report.whatsapp_sent_at && (
            <p className="text-muted-foreground text-xs" data-testid="wa-sent">
              {t("sentAt", { at: report.whatsapp_sent_at })}
            </p>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={composeWhatsapp}
            data-testid="compose-whatsapp"
          >
            {t("compose")}
          </Button>
          {whatsapp && (
            <div className="space-y-2">
              <textarea
                readOnly
                className={inputClass}
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
                  {copied ? t("copied") : t("copy")}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
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
    className: inputClass,
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
