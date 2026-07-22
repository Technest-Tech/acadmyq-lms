"use client";

import {
  CalendarClock,
  CheckCircle2,
  LayoutDashboard,
  ListChecks,
  Plus,
  TrendingUp,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ConvertLeadFlow } from "@/components/crm/convert-lead-flow";
import { LeadBoard } from "@/components/crm/lead-board";
import { LeadDetail } from "@/components/crm/lead-detail";
import { LeadForm } from "@/components/crm/lead-form";
import { LeadsTable } from "@/components/crm/leads-table";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
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
  | { kind: "convert"; lead: LeadRow }
  | { kind: "lost"; lead: LeadRow }
  | { kind: "delete"; lead: LeadRow };

const VIEW_KEY = "crmView";

/**
 * The CRM cockpit: headline stats, the pipeline board (drag a lead between columns, or use the
 * per-card Move menu — same thing, built for beginners and touch), a list view for search/filter
 * work, and the modals: new lead, lead detail + timeline, mark-lost reason, convert-to-student,
 * delete. Moving a card to WON routes through the convert flow so "we won them" and "they're now
 * a real student" stay one motion; LOST asks for an optional reason first.
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
   * Every status move funnels through here (drag-drop, card menu, detail stepper, table action):
   * WON opens the convert flow, LOST asks for a reason, anything else saves directly.
   */
  async function requestMove(lead: LeadRow, target: LeadStatus) {
    if (lead.status === target || lead.converted_student_id !== null) return;
    if (target === "WON") {
      setModal({ kind: "convert", lead });
      return;
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

  return (
    <div className="space-y-8">
      {/* ── Page header ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 shadow-lg shadow-primary/30">
          <UserPlus className="size-6 text-white" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{t("subtitle")}</p>
        </div>
        {canManage && (
          <Button
            type="button"
            size="sm"
            onClick={() => setModal({ kind: "create" })}
            className="gap-1.5"
            data-testid="crm-new-lead"
          >
            <Plus className="size-4" aria-hidden />
            {t("newLead")}
          </Button>
        )}
      </div>

      {/* ── Stat cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label={t("stats.open")}
          value={summary?.open ?? null}
          colorClass="text-blue-600 dark:text-blue-400"
          bgClass="bg-blue-500/10"
          ringClass="ring-blue-500/20"
          gradientFrom="from-blue-500/8"
        />
        <StatCard
          icon={CalendarClock}
          label={t("stats.due")}
          value={summary === null ? null : dueCount}
          colorClass="text-amber-600 dark:text-amber-400"
          bgClass="bg-amber-500/10"
          ringClass="ring-amber-500/20"
          gradientFrom="from-amber-500/8"
        />
        <StatCard
          icon={CheckCircle2}
          label={t("stats.won")}
          value={summary?.won ?? null}
          colorClass="text-emerald-600 dark:text-emerald-400"
          bgClass="bg-emerald-500/10"
          ringClass="ring-emerald-500/20"
          gradientFrom="from-emerald-500/8"
        />
        <StatCard
          icon={TrendingUp}
          label={t("stats.conversionRate")}
          value={summary?.conversion_rate ?? null}
          suffix="%"
          colorClass="text-primary"
          bgClass="bg-primary/10"
          ringClass="ring-primary/20"
          gradientFrom="from-primary/8"
        />
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
      <div role="tablist" className="bg-muted/40 flex gap-1 rounded-2xl border p-1.5">
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
          onConvert={(lead) => setModal({ kind: "convert", lead })}
          onDelete={(lead) => setModal({ kind: "delete", lead })}
        />
      ) : (
        <LeadsTable
          refreshToken={refreshToken}
          canManage={canManage}
          onOpen={(lead) => setModal({ kind: "detail", leadId: lead.id })}
          onMove={(lead, status) => void requestMove(lead, status)}
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
            onDone={(converted) => {
              setModal({ kind: "closed" });
              refresh();
              showAlert("success", converted ? t("alerts.converted") : t("alerts.wonOnly"));
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
        "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
        active ? "bg-card shadow-sm ring-1 ring-black/5" : "text-muted-foreground hover:bg-card/50",
      )}
    >
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

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  suffix,
  colorClass,
  bgClass,
  ringClass,
  gradientFrom,
}: {
  icon: LucideIcon;
  label: string;
  value: number | null;
  suffix?: string;
  colorClass: string;
  bgClass: string;
  ringClass: string;
  gradientFrom: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm",
        "bg-gradient-to-r to-transparent",
        gradientFrom,
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl ring-1",
          bgClass,
          ringClass,
        )}
      >
        <Icon className={cn("size-4", colorClass)} aria-hidden />
      </div>
      <div className="min-w-0">
        {value === null ? (
          <div className="h-5 w-10 animate-pulse rounded bg-muted" />
        ) : (
          <div className="text-xl font-bold tabular-nums tracking-tight leading-tight">
            {value.toLocaleString()}
            {suffix}
          </div>
        )}
        <div className="text-muted-foreground truncate text-[11px] font-medium uppercase tracking-wide">
          {label}
        </div>
      </div>
    </div>
  );
}
