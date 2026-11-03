"use client";

import { CalendarClock, Check, GraduationCap, MessageCircle, NotebookPen, Phone, RotateCcw, Save, UserCheck, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { waLink } from "@/components/accounting/accounting-ui";
import { fieldClass } from "@/components/groups/group-format";
import { Button } from "@/components/ui/button";
import type { EnrolmentRequest, EnrolmentStatus } from "@/lib/enrolment-api";
import { cn } from "@/lib/utils";

export const STATUS_TONE: Record<EnrolmentStatus, string> = {
  NEW: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30",
  CONTACTED: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
  PLACEMENT_BOOKED: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30",
  ENROLLED: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
  CLOSED: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-500/30",
};

/** Saturday first, as the centre's week runs. */
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", tone)}>{children}</span>;
}

/**
 * One request in the inbox: who, how to reach them (tap to WhatsApp), what they asked for, when it
 * suits them, and what has happened since — then the actions that move it along. The staff note is
 * edited in place; the placement lesson opens the form the inbox owns.
 */
export function RequestCard({
  request,
  canManage,
  pending,
  onStatus,
  onNote,
  onPlacement,
}: {
  request: EnrolmentRequest;
  canManage: boolean;
  pending: boolean;
  onStatus: (status: EnrolmentStatus) => void;
  onNote: (note: string | null) => Promise<void>;
  onPlacement: () => void;
}) {
  const t = useTranslations("enrolment");
  const locale = useLocale();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(request.staff_note ?? "");
  const [savingNote, setSavingNote] = useState(false);

  const created = new Date(request.created_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const trialLive = request.trial !== null && request.trial.status !== "CANCELLED";
  const canBook = canManage && request.status !== "ENROLLED" && !(trialLive && request.trial?.status === "SCHEDULED");
  const days = WEEK_ORDER.filter((d) => request.preferred_days.includes(d));

  async function saveNote() {
    setSavingNote(true);
    try {
      await onNote(note.trim() || null);
      setNoteOpen(false);
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <article className="bg-card rounded-2xl border p-4 shadow-sm sm:p-5" data-testid={`enrolment-request-${request.id}`} data-status={request.status}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold">{request.student_name}</h3>
            {request.age !== null && <span className="text-muted-foreground text-xs">{t("card.age", { n: request.age })}</span>}
            <Pill tone={STATUS_TONE[request.status]}>{t(`status.${request.status}`)}</Pill>
          </div>
          {request.guardian_name && <p className="text-muted-foreground mt-0.5 text-sm">{t("card.guardian", { name: request.guardian_name })}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a
              href={waLink(request.phone, t("card.waMessage", { name: request.student_name }))}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200 ring-inset hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"
              data-testid="enrolment-request-wa"
            >
              <MessageCircle className="size-3.5" aria-hidden />
              <bdi dir="ltr">{request.phone}</bdi>
            </a>
            <a href={`tel:${request.phone}`} className="text-muted-foreground inline-flex items-center gap-1 text-xs hover:underline">
              <Phone className="size-3" aria-hidden />
              {t("card.call")}
            </a>
            {request.email && (
              <a href={`mailto:${request.email}`} className="text-muted-foreground text-xs hover:underline" dir="ltr">
                {request.email}
              </a>
            )}
          </div>
        </div>
        <p className="text-muted-foreground shrink-0 text-xs">{t("card.received", { date: created })}</p>
      </div>

      {/* What they asked for */}
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {(request.subject || request.level) && (
          <div className="flex flex-wrap items-center gap-2">
            {request.subject && (
              <Pill tone="bg-muted text-foreground ring-border">
                <NotebookPen className="me-1 size-3" aria-hidden />
                {request.subject}
              </Pill>
            )}
            {request.level && <Pill tone="bg-muted text-foreground ring-border">{request.level}</Pill>}
          </div>
        )}
        {(days.length > 0 || request.preferred_time) && (
          <div className="flex flex-wrap items-center gap-1.5">
            <CalendarClock className="text-muted-foreground size-3.5" aria-hidden />
            {days.map((d) => (
              <span key={d} className="bg-muted rounded-md px-1.5 py-0.5 text-xs font-medium">
                {t(`weekdays.${d}`)}
              </span>
            ))}
            {request.preferred_time && (
              <span className="text-xs font-semibold" dir="ltr">
                {request.preferred_time}
              </span>
            )}
          </div>
        )}
      </dl>
      {request.message && <p className="bg-muted/40 mt-3 rounded-xl px-3 py-2 text-sm whitespace-pre-line">{request.message}</p>}

      {/* What happened since */}
      {request.trial && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-sm" data-testid="enrolment-request-trial">
          <GraduationCap className="size-4 text-violet-600" aria-hidden />
          <span className="font-medium">{request.trial.status === "CANCELLED" ? t("card.trialCancelled") : t("card.trialBooked")}</span>
          {request.trial.scheduled_at_utc && (
            <span className="text-muted-foreground">
              {new Date(request.trial.scheduled_at_utc).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
              {request.trial.teacher_name ? ` · ${request.trial.teacher_name}` : ""}
            </span>
          )}
        </p>
      )}
      {request.student && (
        <p className="mt-2 flex items-center gap-1.5 text-sm">
          <UserCheck className="size-4 text-emerald-600" aria-hidden />
          <span className="font-medium">{t("card.enrolledAs", { name: request.student.name })}</span>
        </p>
      )}

      {/* The staff note */}
      {noteOpen ? (
        <div className="mt-3 space-y-2">
          <textarea className={cn(fieldClass, "h-auto py-2")} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} aria-label={t("card.note")} data-testid="enrolment-note-input" />
          <div className="flex gap-2">
            <Button type="button" size="sm" className="gap-1" onClick={() => void saveNote()} disabled={savingNote} data-testid="enrolment-note-save">
              <Save className="size-3.5" aria-hidden />
              {t("card.saveNote")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setNoteOpen(false)}>
              {t("card.cancel")}
            </Button>
          </div>
        </div>
      ) : request.staff_note ? (
        <button type="button" onClick={() => canManage && setNoteOpen(true)} className="mt-3 block w-full rounded-xl border border-dashed px-3 py-2 text-start text-sm" data-testid="enrolment-note">
          <span className="text-muted-foreground me-1 text-xs font-semibold uppercase tracking-wide">{t("card.note")}</span>
          <span className="whitespace-pre-line">{request.staff_note}</span>
          {request.handled_by && <span className="text-muted-foreground ms-1 text-xs">— {request.handled_by}</span>}
        </button>
      ) : null}

      {canManage && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
          {request.status === "NEW" && (
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={pending} onClick={() => onStatus("CONTACTED")} data-testid="enrolment-mark-contacted">
              <Check className="size-3.5" aria-hidden />
              {t("card.markContacted")}
            </Button>
          )}
          {canBook && (
            <Button type="button" size="sm" className="gap-1.5" disabled={pending} onClick={onPlacement} data-testid="enrolment-book-placement">
              <GraduationCap className="size-3.5" aria-hidden />
              {t("card.bookPlacement")}
            </Button>
          )}
          {!noteOpen && !request.staff_note && (
            <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={() => setNoteOpen(true)} data-testid="enrolment-add-note">
              <NotebookPen className="size-3.5" aria-hidden />
              {t("card.addNote")}
            </Button>
          )}
          <span className="flex-1" />
          {request.status === "CLOSED" ? (
            <Button type="button" size="sm" variant="ghost" className="gap-1.5" disabled={pending} onClick={() => onStatus("NEW")} data-testid="enrolment-reopen">
              <RotateCcw className="size-3.5" aria-hidden />
              {t("card.reopen")}
            </Button>
          ) : request.status !== "ENROLLED" ? (
            <Button type="button" size="sm" variant="ghost" className="text-muted-foreground gap-1.5" disabled={pending} onClick={() => onStatus("CLOSED")} data-testid="enrolment-close">
              <X className="size-3.5" aria-hidden />
              {t("card.close")}
            </Button>
          ) : null}
        </div>
      )}
    </article>
  );
}
