"use client";

import {
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  Lock,
  MessageCircle,
  Send,
  StickyNote,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  FollowUpChip,
  isClosed,
  SourceBadge,
  STATUS_TONE,
  TrialChip,
  waLink,
} from "@/components/crm/lead-badges";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  addLeadNote,
  ApiError,
  getLead,
  LEAD_STATUSES,
  updateLead,
  type LeadActivity,
  type LeadRow,
  type LeadStatus,
} from "@/lib/api";
import { formatLocalDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * One lead, fully readable in one glance: contact + source header, the booked trial, the
 * clickable status stepper (TRIAL/SUBSCRIBED/LOST route through the manager's forms), the
 * follow-up date editor, and the activity timeline with an add-note box on top. A converted
 * lead is locked — only notes stay open, mirroring the server rule.
 */
export function LeadDetail({
  leadId,
  canManage,
  refreshToken,
  onChanged,
  onMove,
  onBookTrial,
}: {
  leadId: string;
  canManage: boolean;
  /** Bump from the manager after a move/convert so the open modal re-reads the lead. */
  refreshToken: number;
  onChanged: () => void;
  onMove: (lead: LeadRow, status: LeadStatus) => void;
  onBookTrial: (lead: LeadRow) => void;
}) {
  const t = useTranslations("crm");
  const locale = useLocale();

  const [lead, setLead] = useState<LeadRow | null>(null);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [today, setToday] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [followUpBusy, setFollowUpBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getLead(leadId)
      .then((r) => {
        if (cancelled) return;
        setLead(r.lead);
        setActivities(r.activities);
        setToday(r.today);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [leadId, refreshToken]);

  async function saveFollowUp(value: string) {
    if (!lead) return;
    setFollowUpBusy(true);
    try {
      await updateLead(lead.id, { follow_up_at: value || null });
      setLead({ ...lead, follow_up_at: value || null });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setFollowUpBusy(false);
    }
  }

  async function submitNote() {
    if (!lead || !note.trim()) return;
    setNoteBusy(true);
    try {
      const r = await addLeadNote(lead.id, note.trim());
      setActivities((prev) => [r.activity, ...prev]);
      setNote("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setNoteBusy(false);
    }
  }

  if (lead === null) {
    return (
      <div className="space-y-3 py-2" data-testid="crm-detail-loading">
        {error ? (
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        ) : (
          <>
            <div className="bg-muted h-6 w-1/2 animate-pulse rounded" />
            <div className="bg-muted h-24 animate-pulse rounded-xl" />
            <div className="bg-muted h-40 animate-pulse rounded-xl" />
          </>
        )}
      </div>
    );
  }

  const wa = waLink(lead.whatsapp_phone);
  const converted = lead.converted_student_id !== null;
  const closed = isClosed(lead.status);
  const editable = canManage && !converted;

  return (
    <div className="space-y-5" data-testid="crm-lead-detail">
      {error && (
        <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold">{lead.full_name}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <SourceBadge source={lead.source} />
            <FollowUpChip date={lead.follow_up_at} today={today} closed={closed} />
            {lead.interested_in && (
              <span className="bg-muted text-muted-foreground ring-border inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1">
                <Sparkles className="size-3" aria-hidden />
                {lead.interested_in}
              </span>
            )}
          </div>
        </div>
        {wa && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.open(wa, "_blank", "noopener")}
            className="gap-1.5"
            data-testid="crm-detail-whatsapp"
          >
            <MessageCircle className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            {t("whatsapp")}
          </Button>
        )}
      </div>

      {/* ── Converted lock note ────────────────────────────────────────── */}
      {converted && (
        <div className="border-primary/20 bg-primary/5 flex items-start gap-3 rounded-xl border px-4 py-3">
          <Lock className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="text-muted-foreground text-xs">
            {t.rich("detail.convertedNote", {
              name: lead.student_name ?? "—",
              b: (chunks) => <span className="text-foreground font-semibold">{chunks}</span>,
            })}
          </p>
        </div>
      )}

      {/* ── The booked trial ───────────────────────────────────────────── */}
      {(lead.trial_id !== null || editable) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
          <div className="min-w-0 flex-1 space-y-1">
            <span className="text-sm font-medium">{t("detail.trial")}</span>
            {lead.trial_id === null ? (
              <p className="text-muted-foreground text-xs">{t("detail.noTrial")}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                <TrialChip lead={lead} />
                {lead.trial_notes && (
                  <span className="text-muted-foreground text-xs">· {lead.trial_notes}</span>
                )}
              </div>
            )}
          </div>
          {editable && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onBookTrial(lead)}
              className="shrink-0 gap-1.5"
              data-testid="crm-detail-book-trial"
            >
              <CalendarClock className="size-3.5" aria-hidden />
              {lead.trial_id === null ? t("detail.bookTrial") : t("detail.rebookTrial")}
            </Button>
          )}
        </div>
      )}

      {/* ── Status stepper ─────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t("detail.status")}</span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" data-testid="crm-detail-stepper">
          {LEAD_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={lead.status === s}
              disabled={!editable || lead.status === s}
              onClick={() => onMove(lead, s)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors",
                lead.status === s
                  ? STATUS_TONE[s]
                  : "text-muted-foreground ring-border hover:bg-muted/50",
                (!editable || lead.status === s) && "cursor-default",
                !editable && lead.status !== s && "opacity-40",
              )}
            >
              {t(`status.${s}`)}
            </button>
          ))}
        </div>
        {lead.status === "LOST" && lead.lost_reason && (
          <p className="text-muted-foreground text-xs">
            {t("detail.lostReason")}: {lead.lost_reason}
          </p>
        )}
      </div>

      {/* ── Follow-up editor ───────────────────────────────────────────── */}
      {editable && (
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{t("detail.followUp")}</span>
          <div className="relative max-w-56">
            <CalendarClock className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
            <input
              type="date"
              aria-label={t("detail.followUp")}
              value={lead.follow_up_at ?? ""}
              disabled={followUpBusy}
              onChange={(e) => void saveFollowUp(e.target.value)}
              className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border py-2 ps-10 pe-3.5 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50"
              data-testid="crm-detail-followup"
            />
          </div>
        </div>
      )}

      {/* ── Timeline ───────────────────────────────────────────────────── */}
      <div className="space-y-3 border-t pt-4">
        <span className="text-sm font-medium">{t("timeline.title")}</span>

        {canManage && (
          <div className="flex gap-2">
            <input
              aria-label={t("timeline.addNote")}
              placeholder={t("timeline.notePlaceholder")}
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submitNote();
                }
              }}
              className="border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 flex-1 rounded-xl border px-3.5 py-2 text-sm outline-none transition-colors focus:ring-3"
              data-testid="crm-note-input"
            />
            <Button
              type="button"
              size="sm"
              onClick={() => void submitNote()}
              disabled={noteBusy || !note.trim()}
              className="gap-1.5"
              data-testid="crm-note-submit"
            >
              {noteBusy ? (
                <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
              ) : (
                <Send className="size-3.5" aria-hidden />
              )}
              {t("timeline.addNote")}
            </Button>
          </div>
        )}

        {activities.length === 0 ? (
          <p className="text-muted-foreground/70 rounded-xl border border-dashed px-3 py-6 text-center text-xs">
            {t("timeline.empty")}
          </p>
        ) : (
          <ol className="space-y-3" data-testid="crm-timeline">
            {activities.map((a) => (
              <ActivityItem key={a.id} activity={a} locale={locale} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ── Timeline entry ───────────────────────────────────────────────────────────

function ActivityItem({ activity, locale }: { activity: LeadActivity; locale: string }) {
  const t = useTranslations("crm");

  const meta = (activity.meta ?? {}) as {
    from?: string;
    to?: string;
    lost_reason?: string | null;
    follow_up_at?: string | null;
    teacher_name?: string | null;
    scheduled_at_utc?: string | null;
    rescheduled?: boolean;
    status?: string | null;
  };

  const icon =
    activity.type === "NOTE" ? (
      <StickyNote className="size-3.5" aria-hidden />
    ) : activity.type === "STATUS_CHANGE" ? (
      <ArrowRightLeft className="size-3.5" aria-hidden />
    ) : activity.type === "FOLLOW_UP_SET" ? (
      <CalendarClock className="size-3.5" aria-hidden />
    ) : activity.type === "TRIAL_BOOKED" || activity.type === "TRIAL_OUTCOME" ? (
      <Sparkles className="size-3.5" aria-hidden />
    ) : activity.type === "CONVERTED" ? (
      <CheckCircle2 className="size-3.5" aria-hidden />
    ) : (
      <UserPlus className="size-3.5" aria-hidden />
    );

  const text =
    activity.type === "NOTE"
      ? activity.body
      : activity.type === "STATUS_CHANGE"
        ? t("timeline.statusChange", {
            // The cast belongs on the whole key: `status.${never}` collapses to never and
            // rejects the interpolated status outright.
            from: meta.from ? t(`status.${meta.from}` as never) : "—",
            to: meta.to ? t(`status.${meta.to}` as never) : "—",
          }) + (meta.lost_reason ? ` — ${meta.lost_reason}` : "")
        : activity.type === "FOLLOW_UP_SET"
          ? meta.follow_up_at
            ? t("timeline.followUpSet", { date: meta.follow_up_at })
            : t("timeline.followUpCleared")
          : activity.type === "TRIAL_BOOKED"
            ? t(meta.rescheduled ? "timeline.trialMoved" : "timeline.trialBooked", {
                when: meta.scheduled_at_utc
                  ? formatLocalDateTime(meta.scheduled_at_utc, locale)
                  : "—",
                teacher: meta.teacher_name ?? "—",
              }) + (activity.body ? ` — ${activity.body}` : "")
            : activity.type === "TRIAL_OUTCOME"
              ? t("timeline.trialOutcome", {
                  status: meta.status ? t(`trialStatus.${meta.status}` as never) : "—",
                }) + (activity.body ? ` — ${activity.body}` : "")
              : activity.type === "CONVERTED"
                ? t("timeline.converted")
                : t("timeline.created");

  return (
    <li className="flex items-start gap-3">
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ring-1",
          activity.type === "NOTE"
            ? "bg-muted text-muted-foreground ring-border"
            : activity.type === "CONVERTED"
              ? "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400"
              : activity.type === "TRIAL_BOOKED" || activity.type === "TRIAL_OUTCOME"
                ? "bg-sky-500/10 text-sky-600 ring-sky-500/20 dark:text-sky-400"
                : "bg-primary/10 text-primary ring-primary/20",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm", activity.type === "NOTE" ? "text-foreground" : "text-muted-foreground")}>
          {text}
        </p>
        <p className="text-muted-foreground/70 mt-0.5 text-[11px]">
          {activity.author_name ?? "—"} · {formatLocalDateTime(activity.created_at, locale)}
        </p>
      </div>
    </li>
  );
}
