"use client";

import {
  AlarmClock,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { addedByFilter, useTeamActors } from "@/components/team/done-by";
import { AddTrialForm } from "@/components/trials/add-trial-form";
import { ConvertTrialFlow } from "@/components/trials/convert-trial-flow";
import { RescheduleTrialForm } from "@/components/trials/reschedule-trial-form";
import type { TrialHandlers } from "@/components/trials/trial-card";
import { TrialOutcomeForm } from "@/components/trials/trial-outcome-form";
import { dayIn } from "@/components/trials/trial-time";
import { TrialsTable } from "@/components/trials/trials-table";
import { AlertBanner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import { StatCard } from "@/components/ui/stat-card";
import { academyTimeZone } from "@/lib/academy-clock";
import {
  cancelTrial,
  deleteTrial,
  getTrialAgenda,
  getTrialSummary,
  listTrials,
  listTrialTeachers,
  updateTrial,
  type DataTableQuery,
  type TrialAgenda,
  type TrialRow,
  type TrialStatus,
  type TrialSummary,
} from "@/lib/api";
import { useCapability } from "@/lib/capabilities";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The page's four views — each one is a stat card, and the card's figure counts what the view lists.
 *   • today    — the academy's today, earliest first (the default: what the desk runs on).
 *   • needs    — every trial whose slot ENDED with no outcome, any day, oldest first. The sidebar
 *                badge counts the same thing, and the staff WhatsApp group is reminded until done.
 *   • upcoming — everything still ahead, soonest first, under a row per day.
 *   • all      — the whole record, newest first, searchable and paged.
 */
type View = "today" | "needs" | "upcoming" | "all";

type ModalState =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "outcome"; trial: TrialRow }
  | { kind: "reschedule"; trial: TrialRow }
  | { kind: "convert"; trial: TrialRow }
  | { kind: "cancel"; trial: TrialRow }
  | { kind: "delete"; trial: TrialRow };

type Decision = "COMPLETED" | "NO_SHOW";

/** The page re-reads itself this often, so a trial that just ended turns red without a reload. */
const POLL_MS = 120_000;

/** How long the "marked as attended — undo / convert" strip stays up. */
const DECISION_STRIP_MS = 15_000;

/** The record's page size, and how many upcoming trials one read brings (the server's cap). */
const PAGE_SIZE = 25;
const UPCOMING_CAP = 100;

const STATUSES: TrialStatus[] = [
  "SCHEDULED",
  "COMPLETED",
  "NO_SHOW",
  "CONVERTED",
  "CANCELLED",
];

const FIELD =
  "border-input bg-background focus:border-primary focus:ring-primary/15 h-9 rounded-xl border px-3 text-sm outline-none transition-colors focus:ring-3";

/** Typed search over a short list already in hand: the name, or the digits of the number. */
function matchesSearch(trial: TrialRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  if ((trial.display_name ?? "").toLowerCase().includes(q)) return true;
  const digits = q.replace(/\D/g, "");
  return (
    digits.length > 0 &&
    (trial.contact_whatsapp ?? "").replace(/\D/g, "").includes(digits)
  );
}

/**
 * The Free Trials desk, built for daily use (Ahmed 2026-11-22: "not organised, too many details,
 * redo it properly"). No hero: four coloured stat cards that are also the views, one toolbar, and
 * one compact table. Deciding is one tap (✓ Attended / ✗ No-show) and leaves a strip with Undo —
 * and, for a prospect who came, "convert to student", because that is almost always next. Every
 * write reports back to the lead's CRM timeline server-side.
 */
export function TrialsManager() {
  const t = useTranslations("trials");
  const tDone = useTranslations("doneBy");
  const locale = useLocale();
  const { can, session } = useAuth();
  const canManage = can("trial.manage");
  const hasCrm = useCapability("crm") && can("crm.read");
  const showAddedBy = session?.role !== "TEACHER";
  const addedByDefs = addedByFilter(useTeamActors(), tDone);

  const [view, setView] = useState<View>("today");
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [refreshToken, setRefreshToken] = useState(0);
  const [pollTick, setPollTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [alert, setAlert] = useState<{
    variant: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastDecision, setLastDecision] = useState<{
    trial: TrialRow;
    status: Decision;
  } | null>(null);

  const [summary, setSummary] = useState<TrialSummary | null>(null);
  const [agenda, setAgenda] = useState<TrialAgenda | null>(null);
  const [agendaFailed, setAgendaFailed] = useState(false);
  const [list, setList] = useState<{
    key: string;
    rows: TrialRow[];
    total: number;
    failed: boolean;
  } | null>(null);

  // ── The toolbar ─────────────────────────────────────────────────────────
  const [teachers, setTeachers] = useState<{ id: string; full_name: string }[]>(
    [],
  );
  const [teacherId, setTeacherId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [addedBy, setAddedBy] = useState("");
  const [page, setPage] = useState(1);

  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  function showAlert(variant: "success" | "error" | "info", message: string) {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 4500);
  }

  /** A save that came back with clash warnings is still a success — just one worth reading. */
  function showSaved(message: string, warnings: string[]) {
    if (warnings.length > 0)
      showAlert("info", `${message} ${warnings.join(" ")}`);
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

  // A typed search asks the server on a pause, not on every key.
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    void getTrialSummary()
      .then(setSummary)
      .catch(() => {});
  }, [refreshToken, pollTick]);

  // Today's trials and the needs-a-decision queue, in one read (the academy's today, server-side).
  useEffect(() => {
    let alive = true;
    getTrialAgenda({})
      .then((a) => {
        if (!alive) return;
        setAgenda(a);
        setAgendaFailed(false);
        setNow(Date.now());
      })
      .catch(() => alive && setAgendaFailed(true));
    return () => {
      alive = false;
    };
  }, [refreshToken, pollTick]);

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

  // Upcoming and the record are read from the server, with the search and filters applied there.
  const listQuery = useMemo<DataTableQuery | null>(() => {
    const filter: Record<string, string> = {};
    if (teacherId) filter.teacher_id = teacherId;
    if (view === "upcoming") {
      return {
        search: search || undefined,
        sort: "scheduled",
        pageSize: UPCOMING_CAP,
        filter: { upcoming: "1", ...filter },
      };
    }
    if (view === "all") {
      if (status) filter.status = status;
      if (addedBy) filter.added_by = addedBy;
      return {
        search: search || undefined,
        sort: "-scheduled",
        page,
        pageSize: PAGE_SIZE,
        filter,
      };
    }
    return null;
  }, [view, search, teacherId, status, addedBy, page]);
  const listKey = listQuery ? JSON.stringify(listQuery) : null;

  useEffect(() => {
    if (listQuery === null) return;
    let alive = true;
    const key = JSON.stringify(listQuery);
    listTrials(listQuery)
      .then(
        (r) =>
          alive &&
          setList({ key, rows: r.rows, total: r.total, failed: false }),
      )
      .catch(() => alive && setList({ key, rows: [], total: 0, failed: true }));
    return () => {
      alive = false;
    };
  }, [listQuery, refreshToken, pollTick]);

  async function decide(trial: TrialRow, decision: Decision) {
    setBusyId(trial.id);
    try {
      await updateTrial(trial.id, { status: decision });
      setAlert(null);
      setLastDecision({
        trial: { ...trial, status: decision },
        status: decision,
      });
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
    onDecide: (trial, decision) => void decide(trial, decision),
    onReopen: (trial) => void reopen(trial),
    onReschedule: (trial) => setModal({ kind: "reschedule", trial }),
    onNotes: (trial) => setModal({ kind: "outcome", trial }),
    onConvert: (trial) => setModal({ kind: "convert", trial }),
    onCancel: (trial) => setModal({ kind: "cancel", trial }),
    onDelete: (trial) => setModal({ kind: "delete", trial }),
  };

  /** Cancel keeps the row as CANCELLED; delete takes it off the record. Same confirm, two verbs. */
  async function confirmRemoval(kind: "cancel" | "delete", trial: TrialRow) {
    setConfirmBusy(true);
    try {
      await (kind === "cancel" ? cancelTrial(trial.id) : deleteTrial(trial.id));
      setModal({ kind: "closed" });
      setLastDecision(null);
      refresh();
      showAlert(
        "success",
        t(kind === "cancel" ? "alerts.cancelled" : "alerts.deleted"),
      );
    } catch {
      showAlert(
        "error",
        t(kind === "cancel" ? "alerts.cancelFailed" : "alerts.deleteFailed"),
      );
    } finally {
      setConfirmBusy(false);
    }
  }

  /** Pressing the open card again goes back to today — the page's home. */
  function pickView(next: View) {
    setView((prev) => (prev === next && next !== "today" ? "today" : next));
    setPage(1);
  }

  const close = () => setModal({ kind: "closed" });
  const confirmKind =
    modal.kind === "cancel" || modal.kind === "delete" ? modal.kind : null;
  const confirmCopy = confirmKind === "delete" ? "deleteModal" : "cancelModal";
  const timezone = agenda?.timezone ?? academyTimeZone();
  const today = agenda?.today ?? dayIn(new Date(), timezone);

  // ── What the picked view lists ──────────────────────────────────────────
  const todays = (agenda?.trials ?? []).filter(
    (tr) => tr.status !== "CANCELLED",
  );
  const narrowLocally = (rows: TrialRow[]) =>
    rows.filter(
      (tr) =>
        (!teacherId || tr.teacher_id === teacherId) &&
        matchesSearch(tr, searchInput),
    );

  let rows: TrialRow[] | null;
  let failed = false;
  if (view === "today" || view === "needs") {
    rows =
      agenda === null
        ? null
        : narrowLocally(view === "today" ? todays : agenda.needs_decision);
    failed = agenda === null && agendaFailed;
  } else {
    const ready = list !== null && list.key === listKey;
    rows = ready ? list.rows : null;
    failed = ready && list.failed;
  }
  const listTotal = list !== null && list.key === listKey ? list.total : 0;
  const narrowed =
    searchInput.trim() !== "" ||
    teacherId !== "" ||
    (view === "all" && (status !== "" || addedBy !== ""));

  // ── The cards' figures ──────────────────────────────────────────────────
  const fmt = (n: number | null | undefined) =>
    n === null || n === undefined ? "—" : formatNumber(n, locale);
  const needsCount =
    agenda?.needs_decision_count ?? summary?.needs_decision ?? null;

  const emptyMessage = narrowed
    ? t("list.filteredEmpty")
    : view === "today"
      ? t("list.emptyToday")
      : view === "needs"
        ? t("list.emptyNeeds")
        : view === "upcoming"
          ? t("list.emptyUpcoming")
          : t("table.empty");

  return (
    <div className="space-y-4">
      <h1 className="sr-only">{t("title")}</h1>

      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      {lastDecision && (
        <DecisionStrip
          decision={lastDecision}
          busy={busyId === lastDecision.trial.id}
          onUndo={() => void reopen(lastDecision.trial)}
          onConvert={() =>
            setModal({ kind: "convert", trial: lastDecision.trial })
          }
          onDismiss={() => setLastDecision(null)}
        />
      )}

      {/* ── Four cards: the figures, and the views they count ─────────── */}
      <div
        className="grid grid-cols-2 gap-3 xl:grid-cols-4"
        data-testid="trials-views"
      >
        <StatCard
          tone="sky"
          icon={CalendarDays}
          label={t("views.today")}
          values={[fmt(agenda ? todays.length : null)]}
          onClick={() => pickView("today")}
          active={view === "today"}
          testId="trials-view-today"
        />
        <StatCard
          tone={needsCount ? "rose" : "emerald"}
          icon={needsCount ? AlarmClock : CheckCircle2}
          label={t("views.needs")}
          values={[fmt(needsCount)]}
          onClick={() => pickView("needs")}
          active={view === "needs"}
          testId="trials-view-needs"
        />
        <StatCard
          tone="violet"
          icon={CalendarClock}
          label={t("views.upcoming")}
          values={[fmt(summary?.upcoming)]}
          onClick={() => pickView("upcoming")}
          active={view === "upcoming"}
          testId="trials-view-upcoming"
        />
        <StatCard
          tone="amber"
          icon={ListChecks}
          label={t("views.all")}
          values={[fmt(summary?.total)]}
          hint={
            summary && summary.total > 0
              ? t("views.conversion", {
                  rate: formatNumber(summary.conversion_rate, locale),
                })
              : undefined
          }
          onClick={() => pickView("all")}
          active={view === "all"}
          testId="trials-view-all"
        />
      </div>

      {/* ── One toolbar: find, narrow, add ────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-72">
          <Search
            className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("list.search")}
            aria-label={t("list.search")}
            className={cn(FIELD, "w-full ps-9")}
            data-testid="trials-search"
          />
        </label>
        {teachers.length > 1 && (
          <div className="w-full sm:w-48">
            <Combobox
              options={[
                { value: "", label: t("list.allTeachers") },
                ...teachers.map((tch) => ({
                  value: tch.id,
                  label: tch.full_name,
                })),
              ]}
              value={teacherId}
              onChange={(id) => {
                setTeacherId(id);
                setPage(1);
              }}
              placeholder={t("list.allTeachers")}
              searchPlaceholder={t("add.searchTeacher")}
              data-testid="trials-teacher-filter"
            />
          </div>
        )}
        {view === "all" && (
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label={t("table.status")}
            className={cn(FIELD, "w-full cursor-pointer sm:w-40")}
            data-testid="trials-status-filter"
          >
            <option value="">{t("list.allStatuses")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        )}
        {view === "all" &&
          addedByDefs.map((def) => (
            <select
              key={def.key}
              value={addedBy}
              onChange={(e) => {
                setAddedBy(e.target.value);
                setPage(1);
              }}
              aria-label={def.label}
              className={cn(FIELD, "w-full cursor-pointer sm:w-44")}
              data-testid="trials-added-by-filter"
            >
              <option value="">{def.label}</option>
              {def.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ))}

        <div className="flex w-full items-center justify-end gap-2 sm:ms-auto sm:w-auto">
          {hasCrm && (
            <Link
              href="/crm"
              data-testid="trials-to-crm"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-9 gap-1.5",
              )}
            >
              <UserPlus className="size-4" aria-hidden />
              {t("bookInCrm")}
            </Link>
          )}
          {canManage && (
            <Button
              type="button"
              onClick={() => setModal({ kind: "add" })}
              className="h-9 gap-1.5"
              data-testid="trials-add"
            >
              <Plus className="size-4" aria-hidden />
              {t("add.button")}
            </Button>
          )}
        </div>
      </div>

      {/* ── The list ──────────────────────────────────────────────────── */}
      <div data-testid={`trials-list-${view}`}>
        {failed ? (
          <AlertBanner variant="error" message={t("list.failed")} />
        ) : rows === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-muted h-11 animate-pulse rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div
            className="bg-card flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center"
            data-testid="trials-empty"
          >
            <Sparkles className="text-muted-foreground/60 size-6" aria-hidden />
            <p className="text-muted-foreground text-sm">{emptyMessage}</p>
          </div>
        ) : (
          <TrialsTable
            rows={rows}
            timezone={timezone}
            today={today}
            grouped={view !== "today"}
            now={now}
            handlers={handlers}
            canManage={canManage}
            busyId={busyId}
            showAddedBy={showAddedBy}
          />
        )}

        {/* The record pages; the other lists say when they show only part of what there is. */}
        {view === "all" && rows !== null && listTotal > PAGE_SIZE && (
          <Pager page={page} total={listTotal} onPage={setPage} />
        )}
        {view === "upcoming" && rows !== null && listTotal > rows.length && (
          <p className="text-muted-foreground mt-2 text-xs">
            {t("list.capped", {
              shown: formatNumber(rows.length, locale),
              total: formatNumber(listTotal, locale),
            })}
          </p>
        )}
        {view === "needs" &&
          agenda !== null &&
          agenda.needs_decision_count > agenda.needs_decision.length && (
            <p className="text-muted-foreground mt-2 text-xs">
              {t("list.capped", {
                shown: formatNumber(agenda.needs_decision.length, locale),
                total: formatNumber(agenda.needs_decision_count, locale),
              })}
            </p>
          )}
      </div>

      {/* ── Add a trial ───────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "add"}
        onClose={close}
        title={t("add.title")}
        description={t("add.description")}
        size="md"
      >
        {modal.kind === "add" && (
          <AddTrialForm
            defaultDay={today}
            onCancel={close}
            onBooked={({ day, warnings }) => {
              close();
              setView(day === today ? "today" : "upcoming");
              setPage(1);
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
            onSaved={({ warnings }) => {
              close();
              setLastDecision(null);
              refresh();
              showSaved(t("alerts.rescheduled"), warnings);
            }}
          />
        )}
      </Modal>

      {/* ── Notes & outcome ───────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "outcome"}
        onClose={close}
        title={t("outcome.title")}
        size="sm"
      >
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
        size="xl"
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
      <Modal
        open={confirmKind !== null}
        onClose={close}
        title={t(`${confirmCopy}.title`)}
        size="sm"
      >
        {(modal.kind === "cancel" || modal.kind === "delete") && (
          <div
            className="space-y-4"
            data-testid={`trial-${modal.kind}-confirm`}
          >
            <p className="text-muted-foreground text-sm">
              {t.rich(`${confirmCopy}.body`, {
                name: modal.trial.display_name ?? "",
                b: (chunks) => (
                  <span className="text-foreground font-semibold">
                    {chunks}
                  </span>
                ),
              })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={close}
                disabled={confirmBusy}
              >
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

// ── The record's pager ───────────────────────────────────────────────────────

function Pager({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations("trials.list");
  const locale = useLocale();
  const pages = Math.ceil(total / PAGE_SIZE);
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  return (
    <div
      className="mt-3 flex items-center justify-between gap-3"
      data-testid="trials-pager"
    >
      <p className="text-muted-foreground text-xs tabular-nums">
        {t("showing", {
          from: formatNumber(from, locale),
          to: formatNumber(to, locale),
          total: formatNumber(total, locale),
        })}
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="gap-1"
        >
          <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden />
          {t("prev")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="gap-1"
        >
          {t("next")}
          <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden />
        </Button>
      </div>
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
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-2.5 shadow-sm",
        attended
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30"
          : "border-orange-200 bg-orange-50 dark:border-orange-900/60 dark:bg-orange-950/30",
      )}
    >
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full text-white",
          attended ? "bg-emerald-600" : "bg-orange-500",
        )}
      >
        {attended ? (
          <Check className="size-3.5" aria-hidden />
        ) : (
          <X className="size-3.5" aria-hidden />
        )}
      </span>
      <p className="min-w-0 flex-1 text-sm font-medium">
        {t(attended ? "decided.COMPLETED" : "decided.NO_SHOW", {
          name: decision.trial.display_name ?? "—",
        })}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {attended && decision.trial.is_lead && (
          <Button
            type="button"
            size="sm"
            onClick={onConvert}
            className="gap-1"
            data-testid="trials-strip-convert"
          >
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
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onDismiss}
          aria-label={t("back")}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
