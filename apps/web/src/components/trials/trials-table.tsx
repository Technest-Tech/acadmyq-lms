"use client";

import { CheckCircle2, Sparkles, Trash2, UserPlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
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
 * The scheduled-trials pipeline. Row actions are status-aware: a SCHEDULED trial can have its
 * outcome recorded or be cancelled; a lead that completed can be converted into a real student.
 */
export function TrialsTable({
  refreshToken,
  onOutcome,
  onConvert,
  onCancel,
}: {
  refreshToken: number;
  onOutcome: (trial: TrialRow) => void;
  onConvert: (trial: TrialRow) => void;
  onCancel: (trial: TrialRow) => void;
}) {
  const t = useTranslations("trials");
  const locale = useLocale();

  const statusLabel = (s: TrialStatus) => t(`status.${s}`);

  return (
    <DataTable<TrialRow>
      testId="trials-table"
      refreshToken={refreshToken}
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
      ]}
      emptyMessage={t("table.empty")}
      columns={[
        {
          key: "name",
          header: t("table.name"),
          render: (row) => (
            <div className="flex items-center gap-2">
              <span className="font-medium">{row.display_name ?? "—"}</span>
              {row.is_lead && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-400">
                  <Sparkles className="size-2.5" aria-hidden />
                  {t("table.leadTag")}
                </span>
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
          render: (row) => (
            <span className="tabular-nums">
              {formatLocalDateTime(row.scheduled_at_utc, locale)}
            </span>
          ),
        },
        {
          key: "duration",
          header: t("table.duration"),
          render: (row) => t("finder.minutes", { count: row.duration_minutes }),
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
  );
}
