"use client";

import { Check, MessageCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  type ColumnDef,
  DataTable,
  type FilterDef,
} from "@/components/ui/data-table";
import {
  type ArchiveReportRow,
  type DataTableQuery,
  getStudentReports,
  type ListResult,
} from "@/lib/api";
import { StatusBadge } from "./status-badge";

const STATUS_FILTER_VALUES = [
  "ATTENDED",
  "ABSENT_UNEXCUSED",
  "ABSENT_EXCUSED",
  "CANCELLED_BY_TEACHER",
  "CANCELLED_BY_STUDENT",
] as const;

/**
 * Per-student report archive (Sprint 6 §6.5, AC-6.11): the past sessions + reports that replace
 * the scattered WhatsApp history. Server-driven via the shared premium DataTable — outcome
 * filter, date sort, pagination — all within RLS scope.
 */
export function ReportArchive({ studentId }: { studentId: string }) {
  const t = useTranslations("attendance");
  const ts = useTranslations("scheduling");
  const locale = useLocale();

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  // Adapt the archive endpoint ({ reports, … }) to the DataTable's ListResult ({ rows, … }).
  const fetcher = useMemo(
    () =>
      async (q: DataTableQuery): Promise<ListResult<ArchiveReportRow>> => {
        const res = await getStudentReports(studentId, q);
        return {
          rows: res.reports,
          total: res.total,
          page: res.page,
          pageSize: res.pageSize,
        };
      },
    [studentId],
  );

  const columns = useMemo<ColumnDef<ArchiveReportRow>[]>(
    () => [
      {
        key: "date",
        header: t("date"),
        sortKey: "date",
        render: (r) => (
          <span className="font-medium tabular-nums">
            {dateFmt.format(new Date(r.scheduled_at_utc))}
          </span>
        ),
      },
      {
        key: "status",
        header: t("status"),
        sortKey: "status",
        render: (r) => <StatusBadge status={r.status} />,
      },
      {
        key: "teacher",
        header: t("teacher"),
        render: (r) => (
          <span className="text-muted-foreground">{r.teacher_name ?? "—"}</span>
        ),
      },
      {
        key: "report",
        header: t("reportCol"),
        render: (r) =>
          r.report_values ? (
            <span className="inline-flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                <Check className="size-3" />
                {t("filledBadge")}
              </span>
              {r.whatsapp_sent_at && (
                <MessageCircle
                  className="size-3.5 text-emerald-500"
                  aria-label={t("sentBadge")}
                />
              )}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">
              {t("notFilled")}
            </span>
          ),
      },
    ],
    [t, dateFmt],
  );

  const filters = useMemo<FilterDef[]>(
    () => [
      {
        key: "status",
        label: t("status"),
        options: STATUS_FILTER_VALUES.map((value) => ({
          value,
          label: ts(`status.${value}`),
        })),
      },
    ],
    [t, ts],
  );

  return (
    <DataTable<ArchiveReportRow>
      testId="report-archive-table"
      fetcher={fetcher}
      columns={columns}
      getRowId={(r) => r.id}
      filters={filters}
      defaultSort="-date"
      emptyMessage={t("archiveEmpty")}
    />
  );
}
