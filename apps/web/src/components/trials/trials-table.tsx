"use client";

import { CheckCircle2, Sparkles, Trash2, UserPlus, UserRoundSearch } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Octagram } from "@/components/ornaments";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { listTrials, type TrialRow, type TrialStatus } from "@/lib/api";
import { formatLocalDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<TrialStatus, string> = {
  SCHEDULED: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-400",
  COMPLETED:
    "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
  NO_SHOW: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
  CANCELLED: "bg-slate-400/10 text-slate-600 ring-slate-400/20 dark:text-slate-400",
  CONVERTED:
    "bg-primary/10 text-primary ring-primary/20",
};

/**
 * Every trial, newest slot first. Row actions are status-aware: a SCHEDULED trial can have its
 * outcome recorded or be cancelled; a prospect who completed one can be converted into a real
 * student (which also subscribes their CRM lead). A trial whose slot has passed with no outcome
 * is called out, because that row is someone's unanswered question.
 */
export function TrialsTable({
  refreshToken,
  filterPreset,
  onOutcome,
  onConvert,
  onCancel,
}: {
  refreshToken: number;
  /** Set by the segment tiles above the table — see `trials-manager`. */
  filterPreset?: { values: Record<string, string>; token: number };
  onOutcome: (trial: TrialRow) => void;
  onConvert: (trial: TrialRow) => void;
  onCancel: (trial: TrialRow) => void;
}) {
  const t = useTranslations("trials");
  const locale = useLocale();

  const statusLabel = (s: TrialStatus) => t(`status.${s}`);

  return (
    <section className="bg-card overflow-hidden rounded-2xl border shadow-sm">
      {/* ── Panel header ─────────────────────────────────────────────── */}
      <div className="relative border-b">
        <div className="from-primary/[0.07] via-primary/[0.025] flex items-center gap-3 bg-gradient-to-r to-transparent px-5 py-4">
          <div className="bg-primary/10 ring-primary/15 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">
            <Sparkles className="text-primary size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
              {t("table.title")}
              <Octagram className="text-gold/60 size-2 shrink-0" />
            </h2>
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              {t("table.hint")}
            </p>
          </div>
        </div>
        <span
          className="via-gold/45 absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent to-transparent"
          aria-hidden
        />
      </div>

      <div className="p-4">
    <DataTable<TrialRow>
      testId="trials-table"
      refreshToken={refreshToken}
      filterPreset={filterPreset}
      showIndex
      fetcher={(q) => listTrials(q)}
      getRowId={(row) => row.id}
      searchable
      defaultSort="-scheduled"
      filters={[
        {
          key: "status",
          label: t("filters.status"),
          options: (
            ["SCHEDULED", "COMPLETED", "NO_SHOW", "CANCELLED", "CONVERTED"] as const
          ).map((s) => ({ value: s, label: statusLabel(s) })),
        },
        {
          key: "origin",
          label: t("filters.origin"),
          options: [
            { value: "crm", label: t("filters.originCrm") },
            { value: "direct", label: t("filters.originDirect") },
          ],
        },
        {
          key: "upcoming",
          label: t("filters.when"),
          options: [{ value: "1", label: t("filters.upcomingOnly") }],
        },
      ]}
      emptyMessage={t("table.empty")}
      columns={[
        {
          key: "name",
          header: t("table.name"),
          render: (row) => (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{row.display_name ?? "—"}</span>
              {row.from_crm ? (
                <span className="bg-primary/10 text-primary ring-primary/20 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1">
                  <UserRoundSearch className="size-2.5" aria-hidden />
                  {t("table.crmTag")}
                </span>
              ) : (
                row.is_lead && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-400">
                    <Sparkles className="size-2.5" aria-hidden />
                    {t("table.leadTag")}
                  </span>
                )
              )}
            </div>
          ),
        },
        {
          key: "teacher",
          header: t("table.teacher"),
          render: (row) => row.teacher_name ?? "—",
        },
        {
          key: "when",
          header: t("table.when"),
          sortKey: "scheduled",
          render: (row) => {
            const awaiting =
              row.status === "SCHEDULED" && new Date(row.scheduled_at_utc) < new Date();
            return (
              <div className="flex flex-col">
                <span className="tabular-nums">
                  {formatLocalDateTime(row.scheduled_at_utc, locale)}
                </span>
                {awaiting && (
                  <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    {t("table.awaitingOutcome")}
                  </span>
                )}
              </div>
            );
          },
        },
        {
          key: "duration",
          header: t("table.duration"),
          render: (row) => t("table.minutes", { count: row.duration_minutes }),
        },
        {
          key: "status",
          header: t("table.status"),
          sortKey: "status",
          render: (row) => (
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                STATUS_TONE[row.status],
              )}
            >
              {statusLabel(row.status)}
            </span>
          ),
        },
      ]}
      rowActions={(row) => (
        <div className="flex items-center justify-end gap-1">
          {row.status === "SCHEDULED" && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onOutcome(row)}
              className="gap-1"
              data-testid="trial-outcome"
            >
              <CheckCircle2 className="size-3" aria-hidden />
              {t("table.recordOutcome")}
            </Button>
          )}
          {row.is_lead &&
            row.status !== "CONVERTED" &&
            row.status !== "CANCELLED" && (
              <Button
                type="button"
                size="xs"
                onClick={() => onConvert(row)}
                className="gap-1"
                data-testid="trial-convert"
              >
                <UserPlus className="size-3" aria-hidden />
                {t("table.convert")}
              </Button>
            )}
          {row.status !== "CONVERTED" && row.status !== "CANCELLED" && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => onCancel(row)}
              aria-label={t("table.cancel")}
              data-testid="trial-cancel"
            >
              <Trash2 className="size-3.5 text-destructive" aria-hidden />
            </Button>
          )}
        </div>
      )}
      />
      </div>
    </section>
  );
}
