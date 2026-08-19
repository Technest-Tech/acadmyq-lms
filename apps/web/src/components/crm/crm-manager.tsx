"use client";

import {
  CalendarClock,
  CheckCircle2,
  LayoutDashboard,
  ListChecks,
  Plus,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { BookLeadTrialForm } from "@/components/crm/book-lead-trial-form";
import { ConvertLeadFlow } from "@/components/crm/convert-lead-flow";
import { LeadBoard } from "@/components/crm/lead-board";
import { LeadDetail } from "@/components/crm/lead-detail";
import { LeadForm } from "@/components/crm/lead-form";
import { LeadsTable } from "@/components/crm/leads-table";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import { SegmentTile } from "@/components/ui/segment-tile";
import {
  deleteLead,
  getLeadSummary,
  updateLead,
  type LeadRow,
  type LeadStatus,
  type LeadSummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type ViewKey = "board" | "list";

type ModalState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "detail"; leadId: string }
  | { kind: "trial"; lead: LeadRow }
  | { kind: "convert"; lead: LeadRow }
  | { kind: "lost"; lead: LeadRow }
  | { kind: "delete"; lead: LeadRow };

const VIEW_KEY = "crmView";

/**
 * The pipeline, cut four ways. Each tile carries the server filter that produced its own count,
 * so pressing one narrows the list to exactly the leads behind the number — and, because the
 * BOARD cannot take a filter, pressing a tile also switches to the list view rather than
 * silently doing nothing.
 *
 * "Due" maps to the `due` filter's default branch (`follow_up_at <= today`), which is precisely
 * `due_today + overdue` — the same arithmetic the tile shows.
 *
 * Conversion rate and the open count are NOT tiles: neither is a slice of the list, so neither
 * could honestly filter it. They sit in the hero as readouts.
 */
type SegmentKey = "all" | "due" | "trial" | "subscribed";

const SEGMENT_FILTERS: Record<SegmentKey, Record<string, string>> = {
  all: {},
  due: { due: "all" },
  trial: { status: "TRIAL" },
  subscribed: { status: "SUBSCRIBED" },
};

/**
 * The CRM cockpit: headline stats, the pipeline board (drag a lead between columns, or use the
 * per-card Move menu — same thing, built for beginners and touch), a list view for search/filter
 * work, and the modals behind the stages.
 *
 * Two columns ask a question before they accept a card, because behind each is a real record the
 * rest of the system reads:
 *
 *   • TRIAL      → the trial form (teacher, day, time, duration). Saving books the trial, which
 *                  is what puts it on the calendar. A lead that already holds a live trial moves
 *                  straight across — the booking is already there.
 *   • SUBSCRIBED → the student form. Saving creates the student record, which is what puts them
 *                  on the Students page; only then does the lead reach the column.
 *
 * LOST asks for an optional reason. Everything else saves on the drop.
 */
export function CrmManager() {
  const t = useTranslations("crm");
  const { can } = useAuth();
  const canManage = can("crm.manage");

  const [view, setView] = useState<ViewKey>("board");
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [refreshToken, setRefreshToken] = useState(0);
  const [summary, setSummary] = useState<LeadSummary | null>(null);
  const [alert, setAlert] = useState<{ variant: "success" | "error"; message: string } | null>(
    null,
  );
  const [lostReason, setLostReason] = useState("");
  const [segment, setSegment] = useState<SegmentKey>("all");
  const [presetToken, setPresetToken] = useState(0);
  const [busy, setBusy] = useState(false);

  // Remember which view the user prefers — beginners tend to settle on one.
  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_KEY);
    if (stored === "board" || stored === "list") setView(stored);
  }, []);

  function switchView(next: ViewKey) {
    setView(next);
    window.localStorage.setItem(VIEW_KEY, next);
  }

  function refresh() {
    setRefreshToken((n) => n + 1);
  }

  /** Pressing the active tile returns to the whole pipeline — a toggle, not a one-way trip. */
  function selectSegment(key: SegmentKey) {
    setSegment((prev) => (prev === key ? "all" : key));
    setPresetToken((n) => n + 1);
    // The board has no filter rail; a tile press that left it on the board would look broken.
    switchView("list");
  }

  function showAlert(variant: "success" | "error", message: string) {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 4500);
  }

  useEffect(() => {
    void getLeadSummary()
      .then(setSummary)
      .catch(() => {});
  }, [refreshToken]);

  /**
   * Every status move funnels through here (drag-drop, card menu, detail stepper, table action).
   * The two backed stages open their form first — the server refuses a bare status write to
   * either, so this is the UI honouring the same rule rather than guessing at it.
   */
  async function requestMove(lead: LeadRow, target: LeadStatus) {
    if (lead.status === target || lead.converted_student_id !== null) return;
    if (target === "SUBSCRIBED") {
      setModal({ kind: "convert", lead });
      return;
    }
    if (target === "TRIAL") {
      // A live trial already satisfies the stage — asking for the details again would be
      // asking the user to re-book a lesson that exists.
      const hasLiveTrial = lead.trial_id !== null && lead.trial_status !== "CANCELLED";
      if (!hasLiveTrial) {
        setModal({ kind: "trial", lead });
        return;
      }
    }
    if (target === "LOST") {
      setLostReason("");
      setModal({ kind: "lost", lead });
      return;
    }
    try {
      await updateLead(lead.id, { status: target });
      refresh();
      showAlert("success", t("alerts.moved", { status: t(`status.${target}`) }));
    } catch {
      showAlert("error", t("alerts.failed"));
      refresh();
    }
  }

  async function confirmLost(lead: LeadRow) {
    setBusy(true);
    try {
      await updateLead(lead.id, { status: "LOST", lost_reason: lostReason.trim() || null });
      setModal({ kind: "closed" });
      refresh();
      showAlert("success", t("alerts.moved", { status: t("status.LOST") }));
    } catch {
      showAlert("error", t("alerts.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(lead: LeadRow) {
    setBusy(true);
    try {
      await deleteLead(lead.id);
      setModal({ kind: "closed" });
      refresh();
      showAlert("success", t("alerts.deleted"));
    } catch {
      showAlert("error", t("alerts.failed"));
    } finally {
      setBusy(false);
    }
  }

  const dueCount = (summary?.due_today ?? 0) + (summary?.overdue ?? 0);
  const pct = (value: number | null) =>
    summary && summary.total > 0 && value !== null
      ? Math.round((value / summary.total) * 100)
      : null;

  return (
    <div className="space-y-5">
      <PageHero
        latticeId="crm-hero-lattice"
        icon={UserPlus}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            {summary && (
              <HeroPill>
                <Users className="size-3.5" aria-hidden />
                {t("hero.openCount", { count: summary.open })}
              </HeroPill>
            )}
            {summary && (
              <HeroPill>
                <TrendingUp className="size-3.5" aria-hidden />
                {t("stats.conversionRate")} {summary.conversion_rate}%
              </HeroPill>
            )}
            {canManage && (
              <Button
                type="button"
                size="lg"
                onClick={() => setModal({ kind: "create" })}
                className="gap-2 border-transparent bg-white px-4 text-emerald-800 shadow-md hover:bg-white/90"
                data-testid="crm-new-lead"
              >
                <Plus className="size-4" aria-hidden />
                {t("newLead")}
              </Button>
            )}
          </>
        }
      />

      {/* ── Segment tiles ─────────────────────────────────────────────── */}
      <div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SegmentTile
            testKey="all"
            icon={Users}
            label={t("stats.total")}
            hint={t("stats.totalSub")}
            value={summary?.total ?? null}
            share={null}
            tone="emerald"
            selected={segment === "all"}
            onSelect={() => selectSegment("all")}
          />
          <SegmentTile
            testKey="due"
            icon={CalendarClock}
            label={t("stats.due")}
            hint={t("stats.dueSub")}
            value={summary === null ? null : dueCount}
            share={pct(summary === null ? null : dueCount)}
            tone="gold"
            selected={segment === "due"}
            onSelect={() => selectSegment("due")}
          />
          <SegmentTile
            testKey="trial"
            icon={Sparkles}
            label={t("stats.trial")}
            hint={t("stats.trialSub")}
            value={summary?.trial ?? null}
            share={pct(summary?.trial ?? null)}
            tone="violet"
            selected={segment === "trial"}
            onSelect={() => selectSegment("trial")}
          />
          <SegmentTile
            testKey="subscribed"
            icon={CheckCircle2}
            label={t("stats.subscribed")}
            hint={t("stats.subscribedSub")}
            value={summary?.subscribed ?? null}
            share={pct(summary?.subscribed ?? null)}
            tone="teal"
            selected={segment === "subscribed"}
            onSelect={() => selectSegment("subscribed")}
          />
        </div>
        <p className="text-muted-foreground/80 mt-2 text-[11px]">
          {t("stats.filterHint")}
        </p>
      </div>

      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      {/* ── Follow-ups due banner ─────────────────────────────────────── */}
      {dueCount > 0 && (
        <div
          className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-950/20"
          data-testid="crm-due-banner"
        >
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            {t("dueBanner", { count: dueCount })}
          </p>
        </div>
      )}

      {/* ── View toggle ───────────────────────────────────────────────── */}
      <div role="tablist" className="bg-card flex gap-1 rounded-2xl border p-1.5 shadow-sm">
        <ViewButton
          viewKey="board"
          icon={LayoutDashboard}
          label={t("view.board")}
          active={view === "board"}
          onClick={() => switchView("board")}
        />
        <ViewButton
          viewKey="list"
          icon={ListChecks}
          label={t("view.list")}
          active={view === "list"}
          onClick={() => switchView("list")}
          count={summary?.open}
        />
      </div>

      {/* ── Board / list ──────────────────────────────────────────────── */}
      {view === "board" ? (
        <LeadBoard
          refreshToken={refreshToken}
          canManage={canManage}
          onOpen={(lead) => setModal({ kind: "detail", leadId: lead.id })}
          onMove={(lead, status) => void requestMove(lead, status)}
          onBookTrial={(lead) => setModal({ kind: "trial", lead })}
          onConvert={(lead) => setModal({ kind: "convert", lead })}
          onDelete={(lead) => setModal({ kind: "delete", lead })}
        />
      ) : (
        <LeadsTable
          refreshToken={refreshToken}
          filterPreset={{ values: SEGMENT_FILTERS[segment], token: presetToken }}
          canManage={canManage}
          onOpen={(lead) => setModal({ kind: "detail", leadId: lead.id })}
          onMove={(lead, status) => void requestMove(lead, status)}
          onBookTrial={(lead) => setModal({ kind: "trial", lead })}
          onConvert={(lead) => setModal({ kind: "convert", lead })}
          onDelete={(lead) => setModal({ kind: "delete", lead })}
        />
      )}

      {/* ── New lead ──────────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "create"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("form.title")}
        description={t("form.description")}
        size="md"
      >
        {modal.kind === "create" && (
          <LeadForm
            onCancel={() => setModal({ kind: "closed" })}
            onCreated={() => {
              setModal({ kind: "closed" });
              refresh();
              showAlert("success", t("alerts.created"));
            }}
          />
        )}
      </Modal>

      {/* ── Lead detail + timeline ────────────────────────────────────── */}
      <Modal
        open={modal.kind === "detail"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("detail.title")}
        size="md"
      >
        {modal.kind === "detail" && (
          <LeadDetail
            leadId={modal.leadId}
            canManage={canManage}
            refreshToken={refreshToken}
            onChanged={refresh}
            onMove={(lead, status) => void requestMove(lead, status)}
            onBookTrial={(lead) => setModal({ kind: "trial", lead })}
          />
        )}
      </Modal>

      {/* ── Book the trial (the TRIAL stage) ──────────────────────────── */}
      <Modal
        open={modal.kind === "trial"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("trial.title")}
        description={t("trial.description")}
        size="md"
      >
        {modal.kind === "trial" && (
          <BookLeadTrialForm
            lead={modal.lead}
            onCancel={() => setModal({ kind: "closed" })}
            onBooked={(warnings) => {
              setModal({ kind: "closed" });
              refresh();
              // A clash never blocks the booking, but it must not pass silently either.
              showAlert(
                "success",
                warnings.length > 0
                  ? `${t("alerts.trialBooked")} ${warnings.join(" · ")}`
                  : t("alerts.trialBooked"),
              );
            }}
          />
        )}
      </Modal>

      {/* ── Convert to student ────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "convert"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("convert.title")}
        description={t("convert.description")}
        size="md"
      >
        {modal.kind === "convert" && (
          <ConvertLeadFlow
            lead={modal.lead}
            onCancel={() => setModal({ kind: "closed" })}
            onDone={(created) => {
              setModal({ kind: "closed" });
              refresh();
              showAlert("success", created ? t("alerts.converted") : t("alerts.linked"));
            }}
          />
        )}
      </Modal>

      {/* ── Mark lost (reason) ────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "lost"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("lost.title")}
        size="sm"
      >
        {modal.kind === "lost" && (
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t("lost.reasonLabel")}</span>
              <textarea
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder={t("lost.reasonPlaceholder")}
                className="border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3"
                data-testid="crm-lost-reason"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setModal({ kind: "closed" })}
                disabled={busy}
              >
                {t("lost.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => void confirmLost(modal.lead)}
                className="gap-1.5"
                data-testid="crm-lost-confirm"
              >
                {busy && (
                  <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                )}
                {t("lost.confirm")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Delete confirmation ───────────────────────────────────────── */}
      <Modal
        open={modal.kind === "delete"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("deleteModal.title")}
        size="sm"
      >
        {modal.kind === "delete" && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              {t.rich("deleteModal.body", {
                name: modal.lead.full_name,
                b: (chunks) => <span className="font-semibold text-foreground">{chunks}</span>,
              })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setModal({ kind: "closed" })}
                disabled={busy}
              >
                {t("deleteModal.keep")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => void confirmDelete(modal.lead)}
                className="gap-1.5"
                data-testid="crm-delete-confirm"
              >
                {busy && (
                  <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                )}
                {t("deleteModal.confirm")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── View toggle button ───────────────────────────────────────────────────────

function ViewButton({
  viewKey,
  icon: Icon,
  label,
  active,
  onClick,
  count,
}: {
  viewKey: ViewKey;
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      role="tab"
      type="button"
      aria-selected={active}
      data-testid={`crm-view-${viewKey}`}
      onClick={onClick}
      className={cn(
        "relative flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all",
        active
          ? "bg-primary/10 text-primary ring-primary/20 ring-1"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {/* The gold thread marks the open view — the frame's own way of saying "here". */}
      {active && (
        <span
          className="via-gold absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent to-transparent"
          aria-hidden
        />
      )}
      <Icon className="size-4" />
      <span>{label}</span>
      {count != null && count > 0 && (
        <span className="bg-primary text-primary-foreground ms-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
}
