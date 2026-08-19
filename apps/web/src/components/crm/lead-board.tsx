"use client";

import {
  ArrowRightLeft,
  CalendarClock,
  MessageCircle,
  MoreHorizontal,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  FollowUpChip,
  isClosed,
  SourceBadge,
  STATUS_DOT,
  TrialChip,
  waLink,
} from "@/components/crm/lead-badges";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getLeadBoard,
  LEAD_STATUSES,
  type LeadBoard as LeadBoardData,
  type LeadRow,
  type LeadStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The pipeline board. Drag a card onto another column to move it — or, for touch screens and
 * anyone who'd rather not drag, the exact same moves live under each card's ⋯ menu ("Move to…").
 * Both paths funnel through onMove, where the manager intercepts the stages that need details
 * first (TRIAL → the booking form, SUBSCRIBED → the student form) and LOST (reason prompt).
 * Cards are ordered by follow-up urgency (server-side): overdue first.
 */
export function LeadBoard({
  refreshToken,
  canManage,
  onOpen,
  onMove,
  onBookTrial,
  onConvert,
  onDelete,
}: {
  refreshToken: number;
  canManage: boolean;
  onOpen: (lead: LeadRow) => void;
  onMove: (lead: LeadRow, status: LeadStatus) => void;
  onBookTrial: (lead: LeadRow) => void;
  onConvert: (lead: LeadRow) => void;
  onDelete: (lead: LeadRow) => void;
}) {
  const t = useTranslations("crm");
  const [board, setBoard] = useState<LeadBoardData | null>(null);
  const [error, setError] = useState(false);
  const [dragOver, setDragOver] = useState<LeadStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    void getLeadBoard()
      .then((data) => {
        if (!cancelled) setBoard(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  function findLead(id: string): LeadRow | undefined {
    if (!board) return undefined;
    for (const status of LEAD_STATUSES) {
      const hit = board.columns[status]?.find((l) => l.id === id);
      if (hit) return hit;
    }
    return undefined;
  }

  function handleDrop(e: React.DragEvent, target: LeadStatus) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/plain");
    const lead = id ? findLead(id) : undefined;
    if (lead && lead.status !== target) onMove(lead, target);
  }

  if (error) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed py-12 text-center text-sm">
        {t("board.loadFailed")}
      </p>
    );
  }

  return (
    <div className="flex snap-x gap-3 overflow-x-auto pb-2" data-testid="crm-board">
      {LEAD_STATUSES.map((status) => {
        const leads = board?.columns[status] ?? [];
        const count = board?.counts[status] ?? 0;

        return (
          <section
            key={status}
            data-testid={`crm-column-${status}`}
            onDragOver={
              canManage
                ? (e) => {
                    e.preventDefault();
                    setDragOver(status);
                  }
                : undefined
            }
            onDragLeave={canManage ? () => setDragOver(null) : undefined}
            onDrop={canManage ? (e) => handleDrop(e, status) : undefined}
            className={cn(
              "bg-muted/25 w-72 shrink-0 snap-start overflow-hidden rounded-2xl border transition-all",
              dragOver === status && "ring-primary/40 bg-primary/5 ring-2",
            )}
          >
            {/* Each stage gets a real header — dot, name, count — closed by the frame's gold
                hairline, so a column reads as a panel rather than a grey rectangle. */}
            <header className="bg-card/60 relative flex items-center gap-2 border-b px-3 py-2.5">
              <span className={cn("size-2 rounded-full", STATUS_DOT[status])} aria-hidden />
              <h3 className="min-w-0 truncate text-sm font-bold tracking-tight">
                {t(`status.${status}`)}
              </h3>
              <span className="bg-muted text-muted-foreground ms-auto rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums">
                {count}
              </span>
              <span
                className="via-gold/40 absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent to-transparent"
                aria-hidden
              />
            </header>

            <div className="space-y-2 p-2.5">
              {board === null ? (
                <>
                  <div className="bg-card h-20 animate-pulse rounded-xl border" />
                  <div className="bg-card h-20 animate-pulse rounded-xl border" />
                </>
              ) : leads.length === 0 ? (
                <p className="text-muted-foreground/70 rounded-xl border border-dashed px-3 py-6 text-center text-xs">
                  {t("board.emptyColumn")}
                </p>
              ) : (
                leads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    today={board.today}
                    canManage={canManage}
                    onOpen={onOpen}
                    onMove={onMove}
                    onBookTrial={onBookTrial}
                    onConvert={onConvert}
                    onDelete={onDelete}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

function LeadCard({
  lead,
  today,
  canManage,
  onOpen,
  onMove,
  onBookTrial,
  onConvert,
  onDelete,
}: {
  lead: LeadRow;
  today: string;
  canManage: boolean;
  onOpen: (lead: LeadRow) => void;
  onMove: (lead: LeadRow, status: LeadStatus) => void;
  onBookTrial: (lead: LeadRow) => void;
  onConvert: (lead: LeadRow) => void;
  onDelete: (lead: LeadRow) => void;
}) {
  const t = useTranslations("crm");
  const wa = waLink(lead.whatsapp_phone);
  const closed = isClosed(lead.status);
  const converted = lead.converted_student_id !== null;

  return (
    <article
      draggable={canManage && !converted}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", lead.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onOpen(lead)}
      data-testid="crm-lead-card"
      className={cn(
        "bg-card group cursor-pointer rounded-xl border p-3 shadow-sm transition-shadow hover:shadow-md",
        canManage && !converted && "active:cursor-grabbing",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{lead.full_name}</p>
          {lead.interested_in && (
            <p className="text-muted-foreground mt-0.5 truncate text-xs">{lead.interested_in}</p>
          )}
        </div>

        {/* ⋯ menu — the no-drag path for every action (touch + beginners). */}
        <DropdownMenu>
          <DropdownMenuTrigger>
            <button
              type="button"
              aria-label={t("board.cardMenu")}
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:bg-muted -me-1 -mt-1 rounded-lg p-1.5 opacity-60 transition-opacity group-hover:opacity-100"
              data-testid="crm-card-menu"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {canManage && !converted && (
              <>
                {LEAD_STATUSES.filter((s) => s !== lead.status).map((s) => (
                  <DropdownMenuItem key={s} onClick={() => onMove(lead, s)}>
                    <ArrowRightLeft aria-hidden />
                    {t("board.moveTo", { status: t(`status.${s}`) })}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            {wa && (
              <DropdownMenuItem onClick={() => window.open(wa, "_blank", "noopener")}>
                <MessageCircle aria-hidden />
                {t("whatsapp")}
              </DropdownMenuItem>
            )}
            {canManage && !converted && (
              <DropdownMenuItem onClick={() => onBookTrial(lead)}>
                <CalendarClock aria-hidden />
                {lead.trial_id === null ? t("board.bookTrial") : t("board.rebookTrial")}
              </DropdownMenuItem>
            )}
            {canManage && !converted && (
              <DropdownMenuItem onClick={() => onConvert(lead)}>
                <UserPlus aria-hidden />
                {t("board.convert")}
              </DropdownMenuItem>
            )}
            {canManage && (
              <DropdownMenuItem destructive onClick={() => onDelete(lead)}>
                <Trash2 aria-hidden />
                {t("board.delete")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <SourceBadge source={lead.source} />
        <TrialChip lead={lead} />
        <FollowUpChip date={lead.follow_up_at} today={today} closed={closed} />
        {converted && (
          <span className="bg-primary/10 text-primary ring-primary/20 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1">
            {t("board.convertedTag")}
          </span>
        )}
      </div>

      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-emerald-600 mt-2 inline-flex items-center gap-1.5 text-xs font-medium transition-colors dark:hover:text-emerald-400"
          data-testid="crm-card-whatsapp"
        >
          <MessageCircle className="size-3.5" aria-hidden />
          <span dir="ltr">{lead.whatsapp_phone}</span>
        </a>
      )}
    </article>
  );
}
