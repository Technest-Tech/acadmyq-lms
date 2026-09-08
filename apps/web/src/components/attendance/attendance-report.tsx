"use client";

import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Gift,
  History,
  ImageDown,
  Loader2,
  MessageCircle,
  Pencil,
  Sparkles,
  UserX,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { useAuth } from "@/components/auth-provider";
import { ReportCardModal } from "@/components/reports/report-card-modal";
import { AlertBanner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  type AttendanceOutcome,
  getSession,
  markAttendance,
  markWhatsappSent,
  putSessionReport,
  requestCancellation,
  requestFree,
  type SessionDetailResponse,
  type WhatsAppMessage,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  CancellationBillingModal,
  type CancellationBillingValues,
} from "./cancellation-billing-modal";
import { ReportArchive } from "./report-archive";
import { ReportEditor } from "./report-editor";
import { StatusBadge } from "./status-badge";
import { DurationCorrectionModal } from "./duration-correction-modal";

// FREE is a real backend outcome (non-billable, non-paying) — see SessionClassifier.
type LocalOutcome = AttendanceOutcome;

const OUTCOMES: LocalOutcome[] = [
  "ATTENDED",
  "FREE",
  "CANCELLED_BY_TEACHER",
  "CANCELLED_BY_STUDENT",
];

type OutcomeConfig = {
  icon: ComponentType<{ className?: string }>;
  activeClass: string;
  idleIconClass: string;
  hoverClass: string;
};

const OUTCOME_CONFIG: Record<LocalOutcome, OutcomeConfig> = {
  ATTENDED: {
    icon: CheckCircle2,
    activeClass:
      "border-emerald-500 bg-emerald-500 text-white shadow-md shadow-emerald-200/60 dark:shadow-emerald-900/40",
    idleIconClass: "text-emerald-500",
    hoverClass:
      "hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20",
  },
  FREE: {
    icon: Gift,
    activeClass:
      "border-teal-500 bg-teal-500 text-white shadow-md shadow-teal-200/60 dark:shadow-teal-900/40",
    idleIconClass: "text-teal-500",
    hoverClass:
      "hover:border-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/20",
  },
  CANCELLED_BY_TEACHER: {
    icon: XCircle,
    activeClass:
      "border-indigo-500 bg-indigo-500 text-white shadow-md shadow-indigo-200/60 dark:shadow-indigo-900/40",
    idleIconClass: "text-indigo-500",
    hoverClass:
      "hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/20",
  },
  CANCELLED_BY_STUDENT: {
    icon: UserX,
    activeClass:
      "border-rose-500 bg-rose-500 text-white shadow-md shadow-rose-200/60 dark:shadow-rose-900/40",
    idleIconClass: "text-rose-500",
    hoverClass:
      "hover:border-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20",
  },
};

type Feedback = { variant: "success" | "error"; message: string };

/**
 * Attendance + session-report form. Status cards are visual-only selection; clicking Save
 * applies both the selected outcome and the report text in a single round-trip.
 *
 * "FREE" is a real outcome: the lesson was delivered but is on the house (non-billable,
 * non-paying). It still owes a report and supports the WhatsApp send like an attended lesson.
 */
export function AttendanceReport({
  sessionId,
  onError,
  onChange,
  readOnly = false,
}: {
  sessionId: string;
  onError?: (message: string) => void;
  onChange?: (newStatus: string) => void;
  /** Display-only: show the outcome + report but disable every action (no marking, editing, or
   *  sending). Used when viewing an already-recorded session from the student timetable. */
  readOnly?: boolean;
}) {
  const t = useTranslations("attendance");
  const ts = useTranslations("scheduling");
  const locale = useLocale();
  const { can, session: auth } = useAuth();

  // The four selectable outcomes are the same for everyone now (attended / free / the two
  // cancellations). A teacher's cancel still routes through approval; an owner's opens the
  // billing popup. Absence outcomes were retired in favour of a cancellation billing override.
  const isTeacher = auth?.role === "TEACHER";
  const visibleOutcomes = OUTCOMES;
  const outcomeGridClass = "grid grid-cols-2 gap-2 sm:grid-cols-4";

  const [data, setData] = useState<SessionDetailResponse | null>(null);
  const [reportText, setReportText] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  // What the user has selected (not yet saved). null = no change from server.
  const [selectedStatus, setSelectedStatus] = useState<LocalOutcome | null>(
    null,
  );
  // null = hidden, "ar" | "en" = picker open
  const [formatLangPicker, setFormatLangPicker] = useState<"ar" | "en" | null>(
    null,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  // The guardian-facing report card (the branded, downloadable image).
  const [cardOpen, setCardOpen] = useState(false);
  // Editor visibility: collapsed to read-only text once a report has been saved.
  const [editing, setEditing] = useState(false);
  // An owner-initiated cancellation awaiting the billing decision (charge student / pay teacher).
  const [cancelModal, setCancelModal] = useState<{
    status: LocalOutcome;
    type: "teacher" | "student";
  } | null>(null);
  // An owner marking a lesson FREE awaiting the same billing decision.
  const [freeModalOpen, setFreeModalOpen] = useState(false);
  // The composed WhatsApp report (deep link + text) after the admin taps Send WhatsApp.
  const [waResult, setWaResult] = useState<WhatsAppMessage | null>(null);
  const [waBusy, setWaBusy] = useState(false);
  const [waCopied, setWaCopied] = useState(false);
  const [durationOpen, setDurationOpen] = useState(false);

  function flash(variant: "success" | "error", message: string) {
    setFeedback({ variant, message });
    if (variant === "success") window.setTimeout(() => setFeedback(null), 4000);
  }

  const load = useCallback(async () => {
    try {
      const detail = await getSession(sessionId);
      setData(detail);
      setReportText((detail.report?.values?.report_text as string) ?? "");
      setSelectedStatus(null);
      // Start in read-only view when a report already exists; otherwise open the editor.
      setEditing(!detail.report?.filled_at);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    }
  }, [sessionId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return (
      <div className="space-y-4" data-testid="attendance-loading">
        <div className="bg-muted h-[72px] animate-pulse rounded-2xl" />
        <div className={outcomeGridClass}>
          {Array.from({ length: visibleOutcomes.length }).map((_, i) => (
            <div
              key={i}
              className="bg-muted h-16 animate-pulse rounded-xl"
              aria-hidden
            />
          ))}
        </div>
      </div>
    );
  }

  const canMark = can("session.mark_attendance");
  const canWrite = can("session.write_report");
  // A teacher can't cancel a class directly — picking a "cancelled" outcome here raises a
  // cancellation request for the owner to approve instead of applying the cancel. Owners
  // (session.cancel) still cancel immediately. Mirrors session-actions.tsx.
  const requestMode = !can("session.cancel") && can("session.cancel_request");
  // Same split for FREE: a teacher (session.free_request, not session.free) can't apply it directly
  // — picking FREE raises a request for the owner to approve. Owners open the billing popup.
  const freeRequestMode = !can("session.free") && can("session.free_request");
  const { session, report } = data;
  const dateText = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(session.scheduled_at_utc));

  // FREE is its own status now. Legacy rows stored a trial as ATTENDED + is_free_trial=true —
  // keep surfacing those as FREE so historical data reads correctly until it's re-saved.
  const serverIsFreeLegacy =
    session.status === "ATTENDED" && report?.values?.is_free_trial === true;
  const serverStatus: LocalOutcome = serverIsFreeLegacy
    ? "FREE"
    : (session.status as LocalOutcome);
  // Effective status: what the user has selected, falling back to server status
  const effectiveStatus: LocalOutcome = selectedStatus ?? serverStatus;
  // ATTENDED and FREE are both "attended" outcomes
  const isAttended =
    effectiveStatus === "ATTENDED" || effectiveStatus === "FREE";

  /** Select a status card. Owner-cancels open the billing popup; everything else is local state. */
  function selectOutcome(status: LocalOutcome) {
    const isCancel =
      status === "CANCELLED_BY_TEACHER" || status === "CANCELLED_BY_STUDENT";
    // An owner cancelling here must decide the billing (charge student / pay teacher) in a popup
    // before it's applied. A teacher's pick stays a staged approval request handled in save().
    if (isCancel && !requestMode && canMark) {
      setCancelModal({
        status,
        type: status === "CANCELLED_BY_TEACHER" ? "teacher" : "student",
      });
      return;
    }
    // Marking FREE carries the same billing decision. Owner → free billing popup; a teacher's pick
    // is staged and turned into a free request in save().
    if (status === "FREE" && !freeRequestMode && canMark) {
      setFreeModalOpen(true);
      return;
    }
    setSelectedStatus(status);
    // Changing the outcome is an edit — reopen the editor so the change can be saved.
    setEditing(true);
  }

  /** Apply an owner cancellation with its billing decision, then persist any report text. */
  async function confirmCancelBilling(values: CancellationBillingValues) {
    if (!cancelModal) return;
    setBusy(true);
    try {
      await markAttendance(sessionId, {
        status: cancelModal.status,
        override_timing: true,
        charge_student: values.charge_student,
        pay_teacher: values.pay_teacher,
        reason: values.reason || undefined,
      });
      await putSessionReport(sessionId, {
        report_text: reportText,
        is_free_trial: false,
      });
      const applied = cancelModal.status;
      setCancelModal(null);
      await load();
      flash("success", t("saved"));
      onChange?.(applied);
    } catch (error) {
      flash("error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  /** Apply an owner's FREE outcome with its billing decision, then persist any report text. */
  async function confirmFreeBilling(values: CancellationBillingValues) {
    setBusy(true);
    try {
      await markAttendance(sessionId, {
        status: "FREE",
        override_timing: true,
        charge_student: values.charge_student,
        pay_teacher: values.pay_teacher,
        reason: values.reason || undefined,
      });
      await putSessionReport(sessionId, { report_text: reportText });
      setFreeModalOpen(false);
      await load();
      flash("success", t("saved"));
      onChange?.("FREE");
    } catch (error) {
      flash("error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  /** Applies the selected outcome + report in one round-trip. */
  async function save() {
    setBusy(true);
    try {
      const target = selectedStatus;

      // Teacher chose a cancel outcome: route through the approval flow instead of cancelling.
      // The session stays SCHEDULED until the owner approves, so don't mark attendance or report.
      if (
        requestMode &&
        (target === "CANCELLED_BY_TEACHER" || target === "CANCELLED_BY_STUDENT")
      ) {
        await requestCancellation(sessionId, {
          cancelled_by:
            target === "CANCELLED_BY_TEACHER" ? "teacher" : "student",
        });
        await load();
        flash("success", t("cancelRequestSent"));
        return;
      }

      // Teacher chose FREE: route through the free-request approval flow (session stays SCHEDULED
      // until the owner approves and decides the billing).
      if (freeRequestMode && target === "FREE") {
        await requestFree(sessionId, {});
        await load();
        flash("success", t("freeRequestSent"));
        return;
      }

      // FREE is a real backend outcome — send it as-is.
      const backendStatus: AttendanceOutcome | null = target;

      // Mark attendance only if the outcome changed.
      // Always bypass the backend timing window — admins mark sessions at any time of day.
      if (backendStatus !== null && backendStatus !== session.status) {
        await markAttendance(sessionId, {
          status: backendStatus,
          override_timing: true,
        });
      }

      // Save report (always, so notes are persisted)
      const reportValues: Record<string, unknown> = { report_text: reportText };
      // The FREE status now owns "this lesson is free" — the legacy is_free_trial report flag
      // no longer does. Clear that flag when a billable outcome is chosen so a legacy trial
      // (stored as ATTENDED + is_free_trial=true) re-prices correctly when switched to ATTENDED.
      if (target !== null && target !== "FREE")
        reportValues.is_free_trial = false;
      await putSessionReport(sessionId, reportValues);

      // Saved with no outcome chosen on a still-scheduled session: persist the report
      // anyway, but nudge the user to also record attendance (drives billing/payroll).
      const noOutcome = target === null && session.status === "SCHEDULED";
      await load();
      flash("success", noOutcome ? t("savedNoOutcome") : t("saved"));
      // A teacher who has just recorded a delivered lesson gets the card straight away — that
      // moment is the only one where they have the lesson in mind, and chasing a button after
      // the save is how the card went unsent. Admins keep their own pacing: they usually mark a
      // batch of lessons and dispatch the cards afterwards, so a modal per save would fight them.
      if (
        isTeacher &&
        (backendStatus === "ATTENDED" || backendStatus === "FREE")
      ) {
        setCardOpen(true);
      }
      // Tell parent the effective backend status
      onChange?.(backendStatus ?? session.status);
    } catch (error) {
      flash("error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  /** Compose the WhatsApp report, record it as sent, and surface the deep link to open/copy. */
  async function handleSendWhatsapp() {
    setWaBusy(true);
    setWaCopied(false);
    try {
      const res = await markWhatsappSent(sessionId);
      setWaResult(res.message);
      await load(); // refresh the report so the "Sent" badge reflects whatsapp_sent_at
    } catch (error) {
      flash("error", error instanceof Error ? error.message : String(error));
    } finally {
      setWaBusy(false);
    }
  }

  async function copyWaMessage() {
    if (!waResult) return;
    try {
      await navigator.clipboard.writeText(waResult.text);
      setWaCopied(true);
      window.setTimeout(() => setWaCopied(false), 1800);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  /** Builds a structured icon-based professional report in the chosen language. */
  function formatReport(lang: "ar" | "en") {
    setFormatLangPicker(null);

    const isAr = lang === "ar";
    const dir = isAr ? "rtl" : "ltr";

    const statusLabel = ts(`status.${effectiveStatus}`);

    // Strip existing tags to get plain notes text, then re-wrap
    const plainNotes = reportText
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();

    const labels = isAr
      ? {
          heading: "📋 تقرير الحصة",
          academy: "🏫 الأكاديمية",
          student: "👤 الطالب",
          teacher: "🎓 المعلم",
          date: "📅 التاريخ",
          duration: "⏱ المدة",
          outcome: "✅ النتيجة",
          notes: "📝 ملاحظات الحصة",
          minLabel: "دقيقة",
        }
      : {
          heading: "📋 Session Report",
          academy: "🏫 Academy",
          student: "👤 Student",
          teacher: "🎓 Teacher",
          date: "📅 Date",
          duration: "⏱ Duration",
          outcome: "✅ Outcome",
          notes: "📝 Session Notes",
          minLabel: "min",
        };

    const lines = [
      `<div dir="${dir}">`,
      `<h1>${labels.heading}</h1>`,
      session.academy_name
        ? `<p>${labels.academy} &nbsp; ${session.academy_name}</p>`
        : "",
      `<p>${labels.student} &nbsp; ${session.student_name ?? "—"}</p>`,
      `<p>${labels.teacher} &nbsp; ${session.teacher_name ?? "—"}</p>`,
      `<p>${labels.date} &nbsp; ${dateText}</p>`,
      `<p>${labels.duration} &nbsp; ${session.duration_minutes} ${labels.minLabel}</p>`,
      `<p>${labels.outcome} &nbsp; ${statusLabel}</p>`,
      `<h2>${labels.notes}</h2>`,
      plainNotes
        ? plainNotes
            .split("\n")
            .filter(Boolean)
            .map((line) => `<p>${line}</p>`)
            .join("")
        : "<p>—</p>",
      `</div>`,
    ]
      .filter(Boolean)
      .join("");

    setReportText(lines);
  }

  return (
    <div className="space-y-5" data-testid="attendance-report">
      {/* ── Session info header ───────────────────────────────────────── */}
      <div className="bg-muted/30 flex flex-wrap items-start justify-between gap-3 rounded-2xl border p-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold">
            {session.student_name}
          </h2>
          <p className="text-muted-foreground text-sm">
            {session.teacher_name} · {dateText} · {session.duration_minutes}{" "}
            {t("min")}
          </p>
          {/* Billing tags */}
          {(session.classification.billableToStudent ||
            session.classification.countsForTeacher ||
            session.billed) && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
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
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span data-testid="current-status">
            <StatusBadge status={serverStatus} />
          </span>
          {!readOnly &&
            session.status === "ATTENDED" &&
            can("student.set_price") && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDurationOpen(true)}
                data-testid="edit-session-duration"
              >
                <Clock className="size-3.5" />
                {t("durationEdit.action")}
              </Button>
            )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setHistoryOpen(true)}
            data-testid="open-history"
          >
            <History className="size-3.5" />
            {t("viewHistory")}
          </Button>
        </div>
      </div>

      {feedback && (
        <AlertBanner
          variant={feedback.variant}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {durationOpen && (
        <DurationCorrectionModal
          sessionId={sessionId}
          currentDuration={session.duration_minutes}
          onClose={() => setDurationOpen(false)}
          onSaved={() => {
            setDurationOpen(false);
            void load();
            flash("success", t("durationEdit.saved"));
            onChange?.(session.status);
          }}
        />
      )}

      {/* A teacher's cancel is a request, not an action — surface the PENDING state persistently
          (survives reload, unlike the transient toast) so it's clear the owner must still approve. */}
      {session.pending_cancellation && (
        <div
          role="status"
          data-testid="pending-cancellation"
          className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-200"
        >
          <Clock
            className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
          <div className="space-y-0.5">
            <p className="font-medium">{t("pendingCancellationTitle")}</p>
            <p className="text-xs text-amber-800 dark:text-amber-300">
              {t("pendingCancellationHint", {
                by: ts(
                  session.pending_cancellation.cancel_type === "teacher"
                    ? "status.CANCELLED_BY_TEACHER"
                    : "status.CANCELLED_BY_STUDENT",
                ),
              })}
            </p>
          </div>
        </div>
      )}

      {/* A teacher's request to mark the lesson FREE is pending the owner's approval + billing call. */}
      {session.pending_free && (
        <div
          role="status"
          data-testid="pending-free"
          className="flex items-start gap-2.5 rounded-xl border border-teal-300 bg-teal-50 px-3.5 py-2.5 text-sm text-teal-900 dark:border-teal-800/50 dark:bg-teal-950/20 dark:text-teal-200"
        >
          <Clock
            className="mt-0.5 size-4 shrink-0 text-teal-600 dark:text-teal-400"
            aria-hidden
          />
          <div className="space-y-0.5">
            <p className="font-medium">{t("pendingFreeTitle")}</p>
            <p className="text-xs text-teal-800 dark:text-teal-300">
              {t("pendingFreeHint")}
            </p>
          </div>
        </div>
      )}

      {/* ── Outcome picker ────────────────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">{t("outcome")}</h3>
        <div className={outcomeGridClass}>
          {visibleOutcomes.map((status) => {
            const cfg = OUTCOME_CONFIG[status];
            const Icon = cfg.icon;
            const isActive = effectiveStatus === status;
            // Block re-raising a cancel while one is already awaiting approval (the server rejects
            // a duplicate PENDING request anyway).
            const isCancelOutcome =
              status === "CANCELLED_BY_TEACHER" ||
              status === "CANCELLED_BY_STUDENT";
            const blockedByPending =
              (requestMode &&
                isCancelOutcome &&
                session.pending_cancellation !== null) ||
              (freeRequestMode &&
                status === "FREE" &&
                session.pending_free !== null);
            return (
              <button
                key={status}
                type="button"
                disabled={!canMark || busy || readOnly || blockedByPending}
                onClick={() => selectOutcome(status)}
                data-testid={`outcome-${status}`}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border-2 px-2 py-3 text-center transition-all duration-150",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  isActive
                    ? cfg.activeClass
                    : cn("border-border bg-background", cfg.hoverClass),
                )}
              >
                <Icon
                  className={cn(
                    "size-5",
                    isActive ? "opacity-100" : cfg.idleIconClass,
                  )}
                />
                <span
                  className={cn(
                    "text-[10px] font-semibold leading-tight",
                    !isActive && "text-foreground",
                  )}
                >
                  {ts(`status.${status}`)}
                </span>
              </button>
            );
          })}
        </div>

        {!canMark && !readOnly && (
          <p className="text-muted-foreground mt-2 text-xs">
            {t("noPermission")}
          </p>
        )}
      </section>

      {/* ── Report text editor ────────────────────────────────────────── */}
      {canWrite && (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("reportTitle")}</h3>
            <div className="flex items-center gap-2">
              {report?.filled_at && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <Check className="size-3" />
                  {t("filledBadge")}
                </span>
              )}
              {readOnly ? null : !editing ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                  data-testid="edit-report"
                >
                  <Pencil className="size-3.5" />
                  {t("edit")}
                </Button>
              ) : formatLangPicker === null ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setFormatLangPicker("ar")}
                  title={t("magicFormatTitle")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 transition-all hover:border-violet-300 hover:from-violet-100 hover:to-purple-100 hover:shadow-sm disabled:opacity-50 dark:border-violet-800/50 dark:from-violet-950/30 dark:to-purple-950/30 dark:text-violet-300"
                >
                  <Sparkles className="size-3 text-violet-500" />
                  {t("magicFormat")}
                </button>
              ) : (
                <div className="flex items-center gap-1 rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50 p-0.5 dark:border-violet-800/50 dark:from-violet-950/30 dark:to-purple-950/30">
                  <span className="px-1.5 text-[10px] font-semibold text-violet-500">
                    <Sparkles className="size-3" />
                  </span>
                  <button
                    type="button"
                    onClick={() => formatReport("ar")}
                    className="rounded-md px-2 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900/40"
                  >
                    ع
                  </button>
                  <span className="text-violet-300 text-[10px]">|</span>
                  <button
                    type="button"
                    onClick={() => formatReport("en")}
                    className="rounded-md px-2 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900/40"
                  >
                    EN
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormatLangPicker(null)}
                    className="rounded-md px-1.5 py-0.5 text-[11px] text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/40"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          </div>

          {editing && !readOnly ? (
            <ReportEditor
              value={reportText}
              onChange={(v) => setReportText(v)}
              disabled={busy}
              placeholder={t("reportPlaceholder")}
            />
          ) : (
            <div
              data-testid="report-readonly"
              className={cn(
                "rounded-xl border border-input bg-muted/20 px-4 py-3 text-sm",
                // Mirror the editor's prose styling so saved formatting renders identically
                "[&_ul]:ms-5 [&_ul]:list-disc [&_ul]:space-y-0.5",
                "[&_ol]:ms-5 [&_ol]:list-decimal [&_ol]:space-y-0.5",
                "[&_b]:font-bold [&_strong]:font-bold",
                "[&_em]:italic [&_i]:italic",
                "[&_u]:underline",
                "[&_s]:line-through [&_del]:line-through [&_strike]:line-through",
                "[&_h1]:mt-1 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold",
                "[&_h2]:mt-1 [&_h2]:mb-1.5 [&_h2]:text-lg [&_h2]:font-semibold",
                "[&_blockquote]:rounded-md [&_blockquote]:border-s-2 [&_blockquote]:border-primary/40 [&_blockquote]:bg-primary/5 [&_blockquote]:py-1 [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground",
                "[&>*+*]:mt-1.5",
              )}
            >
              {reportText.trim() ? (
                <div dangerouslySetInnerHTML={{ __html: reportText }} />
              ) : (
                <p className="text-muted-foreground">{t("notFilled")}</p>
              )}
            </div>
          )}

          <div className="mt-3">
            <div className="flex items-center justify-end gap-2">
              {/* Report card — the branded image the guardian actually receives. The teacher who
                  taught the lesson gets it too: they write the report, and the card is how a
                  family sees that work, so making them ask an admin for a PNG helped nobody.
                  Dispatching it (the WhatsApp button below) stays an academy-admin action.
                  Allowed in readOnly as well: producing the card changes nothing, and looking
                  back at a past lesson to re-send its card is the common case. */}
              {canWrite && isAttended && report && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCardOpen(true)}
                  data-testid="open-report-card"
                  className="gap-1.5"
                >
                  <ImageDown className="size-3.5" aria-hidden />
                  {t("reportCard")}
                </Button>
              )}

              {/* WhatsApp button — only after the session is attended and a report exists.
                  Sending the report to the guardian is an academy-admin action; teachers write
                  the report but don't dispatch it. */}
              {!readOnly && !isTeacher && canWrite && isAttended && report && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={waBusy}
                  onClick={() => void handleSendWhatsapp()}
                  data-testid="compose-whatsapp"
                  className={cn(
                    "gap-1.5",
                    report.whatsapp_sent_at &&
                      "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400",
                  )}
                >
                  {waBusy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <MessageCircle className="size-3.5" />
                  )}
                  {report.whatsapp_sent_at ? t("sentBadge") : t("sendWhatsapp")}
                </Button>
              )}
              {editing && !readOnly && (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => void save()}
                  data-testid="save-report"
                >
                  {busy ? t("saving") : t("save")}
                </Button>
              )}
            </div>

            {/* WhatsApp deep-link result — preview the message, copy it, or open WhatsApp directly. */}
            {waResult && (
              <div
                data-testid="whatsapp-result"
                className="mt-3 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800/40 dark:bg-emerald-950/30"
              >
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                  {t("whatsappReady")}
                </p>
                <pre className="bg-card/60 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border p-2.5 text-xs leading-relaxed">
                  {waResult.text}
                </pre>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyWaMessage()}
                  >
                    {waCopied ? (
                      <Check
                        className="size-3.5 text-emerald-600"
                        aria-hidden
                      />
                    ) : (
                      <Copy className="size-3.5" aria-hidden />
                    )}
                    {waCopied ? t("copied") : t("copyMessage")}
                  </Button>
                  {waResult.phone ? (
                    <a
                      href={waResult.deeplink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(buttonVariants({ size: "sm" }))}
                    >
                      <MessageCircle className="size-3.5" aria-hidden />
                      {t("openWhatsApp")}
                    </a>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      {t("noPhone")}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── History modal ─────────────────────────────────────────────── */}
      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={t("history")}
        description={session.student_name ?? undefined}
        size="xl"
      >
        <ReportArchive studentId={session.student_id} />
      </Modal>

      {/* ── Report card ───────────────────────────────────────────────── */}
      {cardOpen && (
        <ReportCardModal
          open={cardOpen}
          onClose={() => setCardOpen(false)}
          detail={data}
          uiLocale={locale}
        />
      )}

      {/* Owner cancellation → billing decision (charge student / pay teacher + reason). */}
      <CancellationBillingModal
        open={cancelModal !== null}
        onClose={() => setCancelModal(null)}
        cancelType={cancelModal?.type ?? "teacher"}
        busy={busy}
        onConfirm={confirmCancelBilling}
      />

      {/* Owner FREE lesson → same billing decision (every academy prices free lessons differently). */}
      <CancellationBillingModal
        variant="free"
        open={freeModalOpen}
        onClose={() => setFreeModalOpen(false)}
        busy={busy}
        onConfirm={confirmFreeBilling}
      />
    </div>
  );
}
