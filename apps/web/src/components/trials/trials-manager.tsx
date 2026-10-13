"use client";

import {
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ListChecks,
  Plus,
  RotateCcw,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AddTrialForm } from "@/components/trials/add-trial-form";
import { ConvertTrialFlow } from "@/components/trials/convert-trial-flow";
import { RescheduleTrialForm } from "@/components/trials/reschedule-trial-form";
import { TrialAgendaBoard, type AgendaFilter } from "@/components/trials/trial-agenda";
import type { TrialHandlers } from "@/components/trials/trial-card";
import { TrialOutcomeForm } from "@/components/trials/trial-outcome-form";
import { addDays, dayIn, weekStart } from "@/components/trials/trial-time";
import { TrialsNeedsDecisionPanel } from "@/components/trials/trials-needs-decision";
import { TrialsTable } from "@/components/trials/trials-table";
import { AlertBanner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import { SegmentTile } from "@/components/ui/segment-tile";
import {
  cancelTrial,
  deleteTrial,
  getTrialAgenda,
  getTrialSummary,
  listTrialTeachers,
  updateTrial,
  type TrialAgenda,
  type TrialRow,
  type TrialSummary,
} from "@/lib/api";
import { useCapability } from "@/lib/capabilities";
import { cn } from "@/lib/utils";

/**
 * The record, cut four ways (the "All trials" tab). Each tile carries the server filter behind its
 * own count, so the number and the rows below it can never drift apart.
 */
type SegmentKey = "all" | "upcoming" | "completed" | "converted";

const SEGMENT_FILTERS: Record<SegmentKey, Record<string, string>> = {
  all: {},
  upcoming: { upcoming: "1" },
  completed: { status: "COMPLETED" },
  converted: { status: "CONVERTED" },
};

type Tab = "agenda" | "all";

type ModalState =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "outcome"; trial: TrialRow }
  | { kind: "reschedule"; trial: TrialRow }
  | { kind: "convert"; trial: TrialRow }
  | { kind: "cancel"; trial: TrialRow }
  | { kind: "delete"; trial: TrialRow };

type Decision = "COMPLETED" | "NO_SHOW";

/** The board re-reads itself this often, so a trial that just ended turns red without a reload. */
const POLL_MS = 120_000;

/** How long the "marked as attended — undo / convert" strip stays up. */
const DECISION_STRIP_MS = 15_000;

/**
 * The Free Trials desk: what is on today, what is still waiting for a decision, and every trial on
 * record.
 *
 *   • A red panel on top lists every trial whose slot ENDED with no outcome — any day, oldest
 *     first — with the decision buttons on each row. The sidebar badge counts the same thing, and
 *     the staff WhatsApp group is reminded about each one (TRIAL_NOT_MARKED) until it is decided.
 *   • The Agenda tab (default) opens on the academy's today: a week strip to move between days and
 *     the picked day as a time rail of trial cards. Filters narrow it to the waiting or the decided,
 *     or to one teacher.
 *   • The All trials tab is the full record — the stat tiles, the outcome split, and the
 *     searchable table.
 *
 * Deciding is one tap (✓ Attended / ✗ No-show) and shows a strip with Undo — and, for a prospect
 * who attended, "convert to student" — because the next step after "she came" is almost always
 * enrolling her. Every write reports back to the lead's CRM timeline server-side.
 */
export function TrialsManager() {
  const t = useTranslations("trials");
  const { can } = useAuth();
  const canManage = can("trial.manage");
  const hasCrm = useCapability("crm") && can("crm.read");

  const [tab, setTab] = useState<Tab>("agenda");
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [refreshToken, setRefreshToken] = useState(0);
  const [pollTick, setPollTick] = useState(0);
  const [summary, setSummary] = useState<TrialSummary | null>(null);
  const [alert, setAlert] = useState<{ variant: "success" | "error" | "info"; message: string } | null>(
    null,
  );
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [segment, setSegment] = useState<SegmentKey>("all");
  const [presetToken, setPresetToken] = useState(0);

  // ── The board ───────────────────────────────────────────────────────────
  // Opens on the browser's today; the first answer carries the ACADEMY's today and the board
  // snaps to it if the two differ (an owner abroad, near midnight).
  const [selectedDay, setSelectedDay] = useState(() =>
    dayIn(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone),
  );
  const syncedToday = useRef(false);
  const [agenda, setAgenda] = useState<TrialAgenda | null>(null);
  const [agendaLoading, setAgendaLoading] = useState(true);
  const [filter, setFilter] = useState<AgendaFilter>("all");
  const [teacherId, setTeacherId] = useState("");
  const [teachers, setTeachers] = useState<{ id: string; full_name: string }[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastDecision, setLastDecision] = useState<{ trial: TrialRow; status: Decision } | null>(
    null,
  );

  const weekFrom = weekStart(selectedDay);

  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  function showAlert(variant: "success" | "error" | "info", message: string) {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 4500);
  }

  /** A save that came back with clash warnings is still a success — just one worth reading. */
  function showSaved(message: string, warnings: string[]) {
    if (warnings.length > 0) showAlert("info", `${message} ${warnings.join(" ")}`);
    else showAlert("success", message);
  }

  // The clock the phases run on (upcoming → live → needs a decision), and a slow re-read.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const poll = setInterval(() => setPollTick((n) => n + 1), POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    void getTrialSummary()
      .then(setSummary)
      .catch(() => {});
  }, [refreshToken, pollTick]);

  useEffect(() => {
    let alive = true;
    setAgendaLoading(true);
    getTrialAgenda({
      date: selectedDay,
      from: weekFrom,
      to: addDays(weekFrom, 6),
      teacher_id: teacherId || undefined,
    })
      .then((a) => {
        if (!alive) return;
        setAgenda(a);
        setNow(Date.now());
        if (!syncedToday.current) {
          syncedToday.current = true;
          if (a.today !== selectedDay) setSelectedDay(a.today);
        }
      })
      .catch(() => {})
      .finally(() => alive && setAgendaLoading(false));
    return () => {
      alive = false;
    };
  }, [selectedDay, weekFrom, teacherId, refreshToken, pollTick]);

  useEffect(() => {
    if (!canManage) return;
    void listTrialTeachers()
      .then((r) => setTeachers(r.teachers))
      .catch(() => {});
  }, [canManage]);

  useEffect(() => {
    if (lastDecision === null) return;
    const id = setTimeout(() => setLastDecision(null), DECISION_STRIP_MS);
    return () => clearTimeout(id);
  }, [lastDecision]);

  async function decide(trial: TrialRow, status: Decision) {
    setBusyId(trial.id);
    try {
      await updateTrial(trial.id, { status });
      setAlert(null);
      setLastDecision({ trial: { ...trial, status }, status });
      refresh();
    } catch {
      showAlert("error", t("alerts.decisionFailed"));
    } finally {
      setBusyId(null);
    }
  }

  /** Clear a decision: the trial is waiting again (and red again, if its slot is over). */
  async function reopen(trial: TrialRow) {
    setBusyId(trial.id);
    try {
      await updateTrial(trial.id, { status: "SCHEDULED" });
      setLastDecision(null);
      refresh();
      showAlert("success", t("alerts.reopened"));
    } catch {
      showAlert("error", t("alerts.decisionFailed"));
    } finally {
      setBusyId(null);
    }
  }

  const handlers: TrialHandlers = {
    onDecide: (trial, status) => void decide(trial, status),
    onReopen: (trial) => void reopen(trial),
    onReschedule: (trial) => setModal({ kind: "reschedule", trial }),
    onNotes: (trial) => setModal({ kind: "outcome", trial }),
    onConvert: (trial) => setModal({ kind: "convert", trial }),
    onCancel: (trial) => setModal({ kind: "cancel", trial }),
    onDelete: (trial) => setModal({ kind: "delete", trial }),
  };

  /** Pressing the active tile returns to the whole record — a toggle, not a one-way trip. */
  function selectSegment(key: SegmentKey) {
    setSegment((prev) => (prev === key ? "all" : key));
    setPresetToken((n) => n + 1);
  }

  /** Cancel keeps the row as CANCELLED; delete takes it off the record. Same confirm, two verbs. */
  async function confirmRemoval(kind: "cancel" | "delete", trial: TrialRow) {
    setConfirmBusy(true);
    try {
      await (kind === "cancel" ? cancelTrial(trial.id) : deleteTrial(trial.id));
      setModal({ kind: "closed" });
      setLastDecision(null);
      refresh();
      showAlert("success", t(kind === "cancel" ? "alerts.cancelled" : "alerts.deleted"));
    } catch {
      showAlert("error", t(kind === "cancel" ? "alerts.cancelFailed" : "alerts.deleteFailed"));
    } finally {
      setConfirmBusy(false);
    }
  }

  const close = () => setModal({ kind: "closed" });
  const confirmKind = modal.kind === "cancel" || modal.kind === "delete" ? modal.kind : null;
  const confirmCopy = confirmKind === "delete" ? "deleteModal" : "cancelModal";
  const timezone = agenda?.timezone ?? "UTC";
  const today = agenda?.today ?? selectedDay;
  const needsDecision = agenda?.needs_decision_count ?? summary?.needs_decision ?? 0;

  const pct = (value: number | null) =>
    summary && summary.total > 0 && value !== null
      ? Math.round((value / summary.total) * 100)
      : null;

  return (
    <div className="space-y-5">
      <PageHero
        latticeId="trials-hero-lattice"
        icon={Sparkles}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            {needsDecision > 0 && (
              <span
                data-testid="trials-hero-needs-decision"
                className="inline-flex items-center gap-1.5 rounded-full border border-rose-300/60 bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm"
              >
                <TriangleAlert className="size-3.5" aria-hidden />
                {t("hero.needsDecision", { count: needsDecision })}
              </span>
            )}
            {summary !== null && (
              <HeroPill>
                <TrendingUp className="size-3.5" aria-hidden />
                {t("stats.conversionRate")} {summary.conversion_rate}%
              </HeroPill>
            )}
            {hasCrm && (
              <Link
                href="/crm"
                data-testid="trials-to-crm"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "gap-2 border-white/25 bg-white/15 text-white backdrop-blur-sm hover:bg-white/25 hover:text-white",
                )}
              >
                <UserPlus className="size-4" aria-hidden />
                {t("bookInCrm")}
              </Link>
            )}
            {canManage && (
              <Button
                type="button"
                size="lg"
                onClick={() => setModal({ kind: "add" })}
                className="text-primary gap-2 bg-white font-semibold shadow-sm hover:bg-white/90"
                data-testid="trials-add"
              >
                <Plus className="size-4" aria-hidden />
                {t("add.button")}
              </Button>
            )}
          </>
        }
      />

      {alert && (
        <AlertBanner variant={alert.variant} message={alert.message} onDismiss={() => setAlert(null)} />
      )}

      {lastDecision && (
        <DecisionStrip
          decision={lastDecision}
          busy={busyId === lastDecision.trial.id}
          onUndo={() => void reopen(lastDecision.trial)}
          onConvert={() => setModal({ kind: "convert", trial: lastDecision.trial })}
          onDismiss={() => setLastDecision(null)}
        />
      )}

      {/* ── The red queue — every day, not just the one on the board ──── */}
      <TrialsNeedsDecisionPanel
        trials={agenda?.needs_decision ?? []}
        count={agenda?.needs_decision_count ?? 0}
        timezone={timezone}
        now={now}
        handlers={handlers}
        canManage={canManage}
        busyId={busyId}
      />

      {/* ── Agenda | All trials ───────────────────────────────────────── */}
      <div className="no-scrollbar flex w-full overflow-x-auto rounded-xl border bg-card p-1 shadow-sm sm:w-fit" role="tablist">
        {(
          [
            ["agenda", CalendarDays, t("tabs.agenda")],
            ["all", ListChecks, t("tabs.all")],
          ] as const
        ).map(([key, Icon, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            data-testid={`trials-tab-${key}`}
            className={cn(
              "inline-flex flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none sm:px-4",
              tab === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/60",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
            {key === "all" && summary !== null && (
              <span className="text-[11px] tabular-nums opacity-75">{summary.total}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "agenda" ? (
        <TrialAgendaBoard
          agenda={agenda}
          loading={agendaLoading}
          selectedDay={selectedDay}
          weekFrom={weekFrom}
          onSelectDay={setSelectedDay}
          filter={filter}
          onFilter={setFilter}
          teachers={teachers}
          teacherId={teacherId}
          onTeacher={setTeacherId}
          now={now}
          handlers={handlers}
          canManage={canManage}
          busyId={busyId}
        />
      ) : (
        <>
          <div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SegmentTile
                testKey="all"
                icon={ListChecks}
                label={t("stats.total")}
                hint={t("stats.totalSub")}
                value={summary?.total ?? null}
                share={null}
                tone="emerald"
                selected={segment === "all"}
                onSelect={() => selectSegment("all")}
              />
              <SegmentTile
                testKey="upcoming"
                icon={CalendarClock}
                label={t("stats.upcoming")}
                hint={t("stats.upcomingSub")}
                value={summary?.upcoming ?? null}
                share={pct(summary?.upcoming ?? null)}
                tone="violet"
                selected={segment === "upcoming"}
                onSelect={() => selectSegment("upcoming")}
              />
              <SegmentTile
                testKey="completed"
                icon={ClipboardCheck}
                label={t("stats.completed")}
                hint={t("stats.completedSub")}
                value={summary?.completed ?? null}
                share={pct(summary?.completed ?? null)}
                tone="gold"
                selected={segment === "completed"}
                onSelect={() => selectSegment("completed")}
              />
              <SegmentTile
                testKey="converted"
                icon={CheckCircle2}
                label={t("stats.converted")}
                hint={t("stats.convertedSub")}
                value={summary?.converted ?? null}
                share={pct(summary?.converted ?? null)}
                tone="teal"
                selected={segment === "converted"}
                onSelect={() => selectSegment("converted")}
              />
            </div>
            <p className="text-muted-foreground/80 mt-2 text-[11px]">{t("stats.filterHint")}</p>
          </div>

          <OutcomeBreakdown summary={summary} />

          <TrialsTable
            refreshToken={refreshToken}
            filterPreset={{ values: SEGMENT_FILTERS[segment], token: presetToken }}
            onOutcome={(trial) => setModal({ kind: "outcome", trial })}
            onReschedule={(trial) => setModal({ kind: "reschedule", trial })}
            onConvert={(trial) => setModal({ kind: "convert", trial })}
            onCancel={(trial) => setModal({ kind: "cancel", trial })}
            onDelete={(trial) => setModal({ kind: "delete", trial })}
          />
        </>
      )}

      {/* ── Add a trial ───────────────────────────────────────────────── */}
      <Modal open={modal.kind === "add"} onClose={close} title={t("add.title")} description={t("add.description")} size="md">
        {modal.kind === "add" && (
          <AddTrialForm
            defaultDay={selectedDay < today ? today : selectedDay}
            onCancel={close}
            onBooked={({ day, warnings }) => {
              close();
              setTab("agenda");
              setSelectedDay(day);
              refresh();
              showSaved(t("alerts.booked"), warnings);
            }}
          />
        )}
      </Modal>

      {/* ── Reschedule / book again ───────────────────────────────────── */}
      <Modal
        open={modal.kind === "reschedule"}
        onClose={close}
        title={
          modal.kind === "reschedule" && modal.trial.status !== "SCHEDULED"
            ? t("reschedule.rebookTitle")
            : t("reschedule.title")
        }
        size="sm"
      >
        {modal.kind === "reschedule" && (
          <RescheduleTrialForm
            trial={modal.trial}
            timezone={timezone}
            onCancel={close}
            onSaved={({ day, warnings }) => {
              close();
              setLastDecision(null);
              if (tab === "agenda") setSelectedDay(day);
              refresh();
              showSaved(t("alerts.rescheduled"), warnings);
            }}
          />
        )}
      </Modal>

      {/* ── Notes & outcome ───────────────────────────────────────────── */}
      <Modal open={modal.kind === "outcome"} onClose={close} title={t("outcome.title")} size="sm">
        {modal.kind === "outcome" && (
          <TrialOutcomeForm
            trial={modal.trial}
            onCancel={close}
            onSaved={() => {
              close();
              refresh();
              showAlert("success", t("alerts.outcomeSaved"));
            }}
          />
        )}
      </Modal>

      {/* ── Convert ───────────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "convert"}
        onClose={close}
        title={t("convert.title")}
        description={t("convert.description")}
        size="md"
      >
        {modal.kind === "convert" && (
          <ConvertTrialFlow
            trial={modal.trial}
            onCancel={close}
            onConverted={() => {
              close();
              setLastDecision(null);
              refresh();
              showAlert("success", t("alerts.converted"));
            }}
          />
        )}
      </Modal>

      {/* ── Cancel / delete confirmation ──────────────────────────────── */}
      <Modal open={confirmKind !== null} onClose={close} title={t(`${confirmCopy}.title`)} size="sm">
        {(modal.kind === "cancel" || modal.kind === "delete") && (
          <div className="space-y-4" data-testid={`trial-${modal.kind}-confirm`}>
            <p className="text-muted-foreground text-sm">
              {t.rich(`${confirmCopy}.body`, {
                name: modal.trial.display_name ?? "",
                b: (chunks) => <span className="text-foreground font-semibold">{chunks}</span>,
              })}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={close} disabled={confirmBusy}>
                {t(`${confirmCopy}.keep`)}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={confirmBusy}
                onClick={() => void confirmRemoval(modal.kind, modal.trial)}
                className="gap-1.5"
              >
                {confirmBusy && (
                  <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                )}
                {t(`${confirmCopy}.confirm`)}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── The "just decided" strip ─────────────────────────────────────────────────

/**
 * What a one-tap decision leaves behind: the receipt, an Undo for the slipped finger, and — for a
 * prospect who attended — the obvious next step, enrolling them.
 */
function DecisionStrip({
  decision,
  busy,
  onUndo,
  onConvert,
  onDismiss,
}: {
  decision: { trial: TrialRow; status: Decision };
  busy: boolean;
  onUndo: () => void;
  onConvert: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("trials");
  const attended = decision.status === "COMPLETED";

  return (
    <div
      role="status"
      data-testid="trials-decision-strip"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3 shadow-sm",
        attended
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30"
          : "border-orange-200 bg-orange-50 dark:border-orange-900/60 dark:bg-orange-950/30",
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-white",
          attended ? "bg-emerald-600" : "bg-orange-500",
        )}
      >
        {attended ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
      </span>
      <p className="min-w-0 flex-1 text-sm font-medium">
        {t(attended ? "decided.COMPLETED" : "decided.NO_SHOW", {
          name: decision.trial.display_name ?? "—",
        })}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {attended && decision.trial.is_lead && (
          <Button type="button" size="sm" onClick={onConvert} className="gap-1" data-testid="trials-strip-convert">
            <UserPlus className="size-3.5" aria-hidden />
            {t("decided.convertNow")}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onUndo}
          disabled={busy}
          className="gap-1"
          data-testid="trials-strip-undo"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          {t("decided.undo")}
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" onClick={onDismiss} aria-label={t("back")}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

// ── Outcome breakdown ────────────────────────────────────────────────────────

const BAR_TONE: Record<string, string> = {
  scheduled: "bg-sky-500",
  completed: "bg-emerald-500",
  converted: "bg-primary",
  no_show: "bg-red-500",
  cancelled: "bg-slate-400",
};

/**
 * Every trial ever booked, split by where it ended up — one bar, because the useful question is
 * proportional ("how many no-shows are we running?"), not absolute. The footnote says how many
 * came from the CRM pipeline, which is the honest measure of whether the pipeline is feeding it.
 */
function OutcomeBreakdown({ summary }: { summary: TrialSummary | null }) {
  const t = useTranslations("trials");

  if (summary === null) {
    return <div className="bg-muted h-24 animate-pulse rounded-2xl" />;
  }
  if (summary.total === 0) {
    return null;
  }

  const parts = (["scheduled", "completed", "converted", "no_show", "cancelled"] as const).map(
    (key) => ({ key, value: summary[key] }),
  );

  return (
    <section className="bg-card space-y-3 rounded-2xl border p-4 shadow-sm" data-testid="trials-breakdown">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("breakdown.title")}</h2>
        <p className="text-muted-foreground text-xs">
          {t("breakdown.total", { count: summary.total })}
          {summary.from_crm > 0 && (
            <>
              <span className="mx-1.5 opacity-50">·</span>
              {t("breakdown.fromCrm", { count: summary.from_crm })}
            </>
          )}
        </p>
      </div>

      <div className="bg-muted flex h-2.5 w-full overflow-hidden rounded-full">
        {parts.map(
          ({ key, value }) =>
            value > 0 && (
              <span
                key={key}
                className={cn("h-full", BAR_TONE[key])}
                style={{ width: `${(value / summary.total) * 100}%` }}
                title={`${t(`breakdown.${key}`)}: ${value}`}
              />
            ),
        )}
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {parts.map(({ key, value }) => (
          <li key={key} className="flex items-center gap-1.5 text-xs">
            <span className={cn("size-2 rounded-full", BAR_TONE[key])} aria-hidden />
            <span className="text-muted-foreground">{t(`breakdown.${key}`)}</span>
            <span className="font-semibold tabular-nums">{value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
