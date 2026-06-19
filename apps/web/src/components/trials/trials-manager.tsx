"use client";

import {
  CalendarClock,
  CalendarSearch,
  CheckCircle2,
  ListChecks,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ComponentType } from "react";
import { BookTrialForm } from "@/components/trials/book-trial-form";
import { ConvertTrialFlow } from "@/components/trials/convert-trial-flow";
import { TrialFinder, type TrialSlot } from "@/components/trials/trial-finder";
import { TrialOutcomeForm } from "@/components/trials/trial-outcome-form";
import { TrialsTable } from "@/components/trials/trials-table";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  cancelTrial,
  getTrialSummary,
  type TrialAvailabilityTeacher,
  type TrialRow,
  type TrialSummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type ModalState =
  | { kind: "closed" }
  | { kind: "book"; teacher: TrialAvailabilityTeacher; slot: TrialSlot }
  | { kind: "outcome"; trial: TrialRow }
  | { kind: "convert"; trial: TrialRow }
  | { kind: "cancel"; trial: TrialRow };

type TabKey = "find" | "pipeline";

/**
 * The Free Trials cockpit: headline stats, the availability finder (find a teacher for a slot →
 * book for an existing student or a new lead), and the scheduled-trials pipeline with outcome,
 * cancel and convert-to-student actions.
 */
export function TrialsManager() {
  const t = useTranslations("trials");
  const [tab, setTab] = useState<TabKey>("find");
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [refreshToken, setRefreshToken] = useState(0);
  const [summary, setSummary] = useState<TrialSummary | null>(null);
  const [alert, setAlert] = useState<{ variant: "success" | "error"; message: string } | null>(
    null,
  );
  const [cancelBusy, setCancelBusy] = useState(false);

  function refresh() {
    setRefreshToken((n) => n + 1);
  }

  function showAlert(variant: "success" | "error", message: string) {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 4500);
  }

  useEffect(() => {
    void getTrialSummary()
      .then(setSummary)
      .catch(() => {});
  }, [refreshToken]);

  async function confirmCancel(trial: TrialRow) {
    setCancelBusy(true);
    try {
      await cancelTrial(trial.id);
      setModal({ kind: "closed" });
      refresh();
      showAlert("success", t("alerts.cancelled"));
    } catch {
      showAlert("error", t("alerts.cancelFailed"));
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* ── Page header ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 shadow-lg shadow-primary/30">
            <Sparkles className="size-6 text-white" aria-hidden />
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-background bg-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{t("subtitle")}</p>
        </div>
      </div>

      {/* ── Stat cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={CalendarClock}
          label={t("stats.upcoming")}
          value={summary?.upcoming ?? null}
          colorClass="text-blue-600 dark:text-blue-400"
          bgClass="bg-blue-500/10"
          ringClass="ring-blue-500/20"
          gradientFrom="from-blue-500/8"
        />
        <StatCard
          icon={ListChecks}
          label={t("stats.completed")}
          value={summary?.completed ?? null}
          colorClass="text-emerald-600 dark:text-emerald-400"
          bgClass="bg-emerald-500/10"
          ringClass="ring-emerald-500/20"
          gradientFrom="from-emerald-500/8"
        />
        <StatCard
          icon={CheckCircle2}
          label={t("stats.converted")}
          value={summary?.converted ?? null}
          colorClass="text-primary"
          bgClass="bg-primary/10"
          ringClass="ring-primary/20"
          gradientFrom="from-primary/8"
        />
        <StatCard
          icon={TrendingUp}
          label={t("stats.conversionRate")}
          value={summary?.conversion_rate ?? null}
          suffix="%"
          colorClass="text-amber-600 dark:text-amber-400"
          bgClass="bg-amber-500/10"
          ringClass="ring-amber-500/20"
          gradientFrom="from-amber-500/8"
        />
      </div>

      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <div role="tablist" className="bg-muted/40 flex gap-1 rounded-2xl border p-1.5">
        <TabButton
          tabKey="find"
          icon={CalendarSearch}
          label={t("tabs.find")}
          active={tab === "find"}
          onClick={() => setTab("find")}
        />
        <TabButton
          tabKey="pipeline"
          icon={ListChecks}
          label={t("tabs.pipeline")}
          active={tab === "pipeline"}
          onClick={() => setTab("pipeline")}
          count={summary?.upcoming}
        />
      </div>

      {/* ── Tab panels ────────────────────────────────────────────────── */}
      {tab === "find" ? (
        <TrialFinder onBook={(teacher, slot) => setModal({ kind: "book", teacher, slot })} />
      ) : (
        <TrialsTable
          refreshToken={refreshToken}
          onOutcome={(trial) => setModal({ kind: "outcome", trial })}
          onConvert={(trial) => setModal({ kind: "convert", trial })}
          onCancel={(trial) => setModal({ kind: "cancel", trial })}
        />
      )}

      {/* ── Book modal ────────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "book"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("book.title")}
        description={t("book.description")}
        size="md"
      >
        {modal.kind === "book" && (
          <BookTrialForm
            teacher={modal.teacher}
            slot={modal.slot}
            onCancel={() => setModal({ kind: "closed" })}
            onBooked={() => {
              setModal({ kind: "closed" });
              refresh();
              showAlert("success", t("alerts.booked"));
            }}
          />
        )}
      </Modal>

      {/* ── Outcome modal ─────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "outcome"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("outcome.title")}
        size="sm"
      >
        {modal.kind === "outcome" && (
          <TrialOutcomeForm
            trial={modal.trial}
            onCancel={() => setModal({ kind: "closed" })}
            onSaved={() => {
              setModal({ kind: "closed" });
              refresh();
              showAlert("success", t("alerts.outcomeSaved"));
            }}
          />
        )}
      </Modal>

      {/* ── Convert modal ─────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "convert"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("convert.title")}
        description={t("convert.description")}
        size="md"
      >
        {modal.kind === "convert" && (
          <ConvertTrialFlow
            trial={modal.trial}
            onCancel={() => setModal({ kind: "closed" })}
            onConverted={() => {
              setModal({ kind: "closed" });
              refresh();
              showAlert("success", t("alerts.converted"));
            }}
          />
        )}
      </Modal>

      {/* ── Cancel confirmation ───────────────────────────────────────── */}
      <Modal
        open={modal.kind === "cancel"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("cancelModal.title")}
        size="sm"
      >
        {modal.kind === "cancel" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t.rich("cancelModal.body", {
                name: modal.trial.display_name ?? "",
                b: (chunks) => <span className="font-semibold text-foreground">{chunks}</span>,
              })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setModal({ kind: "closed" })}
                disabled={cancelBusy}
              >
                {t("cancelModal.keep")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={cancelBusy}
                onClick={() => void confirmCancel(modal.trial)}
                className="gap-1.5"
              >
                {cancelBusy && (
                  <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                )}
                {t("cancelModal.confirm")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Tab button ───────────────────────────────────────────────────────────────

function TabButton({
  tabKey,
  icon: Icon,
  label,
  active,
  onClick,
  count,
}: {
  tabKey: TabKey;
  icon: ComponentType<{ className?: string }>;
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
      data-testid={`tab-${tabKey}`}
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
