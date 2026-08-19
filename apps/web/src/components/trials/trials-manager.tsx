"use client";

import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  ListChecks,
  Sparkles,
  TrendingUp,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConvertTrialFlow } from "@/components/trials/convert-trial-flow";
import { TrialOutcomeForm } from "@/components/trials/trial-outcome-form";
import { TrialsTable } from "@/components/trials/trials-table";
import { AlertBanner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import { SegmentTile } from "@/components/ui/segment-tile";
import { cancelTrial, getTrialSummary, type TrialRow, type TrialSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The record, cut four ways. Each tile carries the server filter behind its own count, so the
 * number and the rows below it can never drift apart.
 *
 * Two figures are deliberately NOT tiles. "Awaiting outcome" (scheduled, slot already passed)
 * and the conversion rate have no single server filter that reproduces them — offering either as
 * a tile would mean a count that the table cannot show. They read out in the hero instead, and
 * awaiting-outcome wears gold because it is the one number that is actually a work queue.
 */
type SegmentKey = "all" | "upcoming" | "completed" | "converted";

const SEGMENT_FILTERS: Record<SegmentKey, Record<string, string>> = {
  all: {},
  upcoming: { upcoming: "1" },
  completed: { status: "COMPLETED" },
  converted: { status: "CONVERTED" },
};

type ModalState =
  | { kind: "closed" }
  | { kind: "outcome"; trial: TrialRow }
  | { kind: "convert"; trial: TrialRow }
  | { kind: "cancel"; trial: TrialRow };

/**
 * The Free Trials overview: every trial the academy has run, what came of it, and the numbers
 * over them.
 *
 * Booking is not here. A trial exists because a lead reached the TRIAL stage of the CRM, so the
 * teacher-and-slot form lives next to the person it is for — this page is the record and the
 * scoreboard: who is coming, whose result is still missing, and how many of them subscribe.
 * Recording an outcome, cancelling and converting all stay here, and each one reports back to
 * the lead's CRM timeline so the two screens never disagree.
 */
export function TrialsManager() {
  const t = useTranslations("trials");
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [refreshToken, setRefreshToken] = useState(0);
  const [summary, setSummary] = useState<TrialSummary | null>(null);
  const [alert, setAlert] = useState<{ variant: "success" | "error"; message: string } | null>(
    null,
  );
  const [cancelBusy, setCancelBusy] = useState(false);
  const [segment, setSegment] = useState<SegmentKey>("all");
  const [presetToken, setPresetToken] = useState(0);

  /** Pressing the active tile returns to the whole record — a toggle, not a one-way trip. */
  function selectSegment(key: SegmentKey) {
    setSegment((prev) => (prev === key ? "all" : key));
    setPresetToken((n) => n + 1);
  }

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
            {summary !== null && summary.awaiting_outcome > 0 && (
              <span className="border-gold/50 bg-gold text-gold-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold shadow-sm">
                <ClipboardCheck className="size-3.5" aria-hidden />
                {t("hero.awaiting", { count: summary.awaiting_outcome })}
              </span>
            )}
            {summary !== null && (
              <HeroPill>
                <TrendingUp className="size-3.5" aria-hidden />
                {t("stats.conversionRate")} {summary.conversion_rate}%
              </HeroPill>
            )}
            {/* Booking lives in the CRM — say where, rather than offering a button that
                isn't here. */}
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
          </>
        }
      />

      {/* ── Segment tiles ─────────────────────────────────────────────── */}
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

      {/* ── Where the outcomes landed ─────────────────────────────────── */}
      <OutcomeBreakdown summary={summary} />

      {/* ── The trials themselves ─────────────────────────────────────── */}
      <TrialsTable
        refreshToken={refreshToken}
        filterPreset={{ values: SEGMENT_FILTERS[segment], token: presetToken }}
        onOutcome={(trial) => setModal({ kind: "outcome", trial })}
        onConvert={(trial) => setModal({ kind: "convert", trial })}
        onCancel={(trial) => setModal({ kind: "cancel", trial })}
      />

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
            <p className="text-muted-foreground text-sm">
              {t.rich("cancelModal.body", {
                name: modal.trial.display_name ?? "",
                b: (chunks) => <span className="text-foreground font-semibold">{chunks}</span>,
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
