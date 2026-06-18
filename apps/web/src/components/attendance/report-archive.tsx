"use client";

import { Check, FileText, MessageCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  type ColumnDef,
  DataTable,
  type FilterDef,
} from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import {
  type ArchiveReportRow,
  type DataTableQuery,
  getStudentReports,
  type ListResult,
} from "@/lib/api";
import { StatusBadge } from "./status-badge";

const STATUS_FILTER_VALUES = [
  "ATTENDED",
  "FREE",
  "ABSENT_UNEXCUSED",
  "ABSENT_EXCUSED",
  "CANCELLED_BY_TEACHER",
  "CANCELLED_BY_STUDENT",
] as const;

type ViewingReport = { date: string; text: string };

/**
 * Per-student report archive (Sprint 6). A "View" button in the report column opens a modal
 * showing the saved free-text report for that session.
 */
export function ReportArchive({ studentId }: { studentId: string }) {
  const t = useTranslations("attendance");
  const ts = useTranslations("scheduling");
  const locale = useLocale();

  const [viewingReport, setViewingReport] = useState<ViewingReport | null>(null);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

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
        render: (r) => {
          const reportText = r.report_values?.report_text as string | undefined;
          if (!r.report_values) {
            return (
              <span className="text-muted-foreground text-xs">{t("notFilled")}</span>
            );
          }
          return (
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
              {reportText && (
                <button
                  type="button"
                  onClick={() =>
                    setViewingReport({
                      date: dateFmt.format(new Date(r.scheduled_at_utc)),
                      text: reportText,
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-muted"
                >
                  <FileText className="size-3" />
                  {t("viewReport")}
                </button>
              )}
            </span>
          );
        },
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
    <>
      <DataTable<ArchiveReportRow>
        testId="report-archive-table"
        fetcher={fetcher}
        columns={columns}
        getRowId={(r) => r.id}
        filters={filters}
        defaultSort="-date"
        emptyMessage={t("archiveEmpty")}
      />

      {/* Report text viewer */}
      <Modal
        open={viewingReport !== null}
        onClose={() => setViewingReport(null)}
        title={t("reportTitle")}
        description={viewingReport?.date}
        size="md"
      >
        {viewingReport && (
          viewingReport.text ? (
            <div
              className={[
                "min-h-[120px] rounded-xl border bg-muted/30 px-4 py-3 text-sm leading-relaxed",
                "[&_ul]:ms-5 [&_ul]:list-disc [&_ul]:space-y-0.5",
                "[&_ol]:ms-5 [&_ol]:list-decimal [&_ol]:space-y-0.5",
                "[&_b]:font-bold [&_strong]:font-bold",
                "[&_em]:italic [&_i]:italic",
                "[&_u]:underline",
                "[&_s]:line-through [&_del]:line-through",
                "[&_h1]:mt-1 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold",
                "[&_h2]:mt-1 [&_h2]:mb-1.5 [&_h2]:text-lg [&_h2]:font-semibold",
                "[&_blockquote]:rounded-md [&_blockquote]:border-s-2 [&_blockquote]:border-primary/40 [&_blockquote]:bg-primary/5 [&_blockquote]:py-1 [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground",
                "[&>*+*]:mt-1.5",
              ].join(" ")}
              /* Report text is written only by authenticated academy staff, sanitized before storage */
              dangerouslySetInnerHTML={{ __html: viewingReport.text }}
            />
          ) : (
            <p className="text-muted-foreground italic text-sm">{t("empty")}</p>
          )
        )}
      </Modal>
    </>
  );
}
