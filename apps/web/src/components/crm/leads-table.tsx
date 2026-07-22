"use client";

import { MessageCircle, Trash2, UserPlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  FollowUpChip,
  SourceBadge,
  StatusBadge,
  waLink,
} from "@/components/crm/lead-badges";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  listLeads,
  type LeadRow,
  type LeadStatus,
} from "@/lib/api";
import { formatLocalDateTime } from "@/lib/time";

/**
 * The list view — the search/filter workhorse next to the board. A status change here goes
 * through the same onMove funnel as a board drag (WON → convert flow, LOST → reason prompt).
 */
export function LeadsTable({
  refreshToken,
  canManage,
  onOpen,
  onMove,
  onConvert,
  onDelete,
}: {
  refreshToken: number;
  canManage: boolean;
  onOpen: (lead: LeadRow) => void;
  onMove: (lead: LeadRow, status: LeadStatus) => void;
  onConvert: (lead: LeadRow) => void;
  onDelete: (lead: LeadRow) => void;
}) {
  const t = useTranslations("crm");
  const locale = useLocale();

  return (
    <DataTable<LeadRow>
      testId="crm-leads-table"
      refreshToken={refreshToken}
      fetcher={(q) => listLeads(q)}
      getRowId={(row) => row.id}
      searchable
      defaultSort="-created_at"
      onRowClick={onOpen}
      filters={[
        {
          key: "status",
          label: t("filters.status"),
          options: LEAD_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
        },
        {
          key: "source",
          label: t("filters.source"),
          options: LEAD_SOURCES.map((s) => ({ value: s, label: t(`source.${s}`) })),
        },
        {
          key: "due",
          label: t("filters.due"),
          options: [
            { value: "today", label: t("filters.dueToday") },
            { value: "overdue", label: t("filters.dueOverdue") },
          ],
        },
      ]}
      emptyMessage={t("table.empty")}
      columns={[
        {
          key: "name",
          header: t("table.name"),
          sortKey: "name",
          render: (row) => (
            <div className="min-w-0">
              <span className="font-medium">{row.full_name}</span>
              {row.interested_in && (
                <span className="text-muted-foreground block truncate text-xs">
                  {row.interested_in}
                </span>
              )}
            </div>
          ),
        },
        {
          key: "phone",
          header: t("table.phone"),
          render: (row) => {
            const wa = waLink(row.whatsapp_phone);
            return wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="hover:text-emerald-600 inline-flex items-center gap-1.5 transition-colors dark:hover:text-emerald-400"
              >
                <MessageCircle className="size-3.5 shrink-0" aria-hidden />
                <span dir="ltr" className="tabular-nums">
                  {row.whatsapp_phone}
                </span>
              </a>
            ) : (
              "—"
            );
          },
        },
        {
          key: "source",
          header: t("table.source"),
          render: (row) => <SourceBadge source={row.source} />,
        },
        {
          key: "status",
          header: t("table.status"),
          sortKey: "status",
          render: (row) => <StatusBadge status={row.status} />,
        },
        {
          key: "followUp",
          header: t("table.followUp"),
          sortKey: "follow_up",
          render: (row) => (
            <FollowUpChip
              date={row.follow_up_at}
              closed={row.status === "WON" || row.status === "LOST"}
            />
          ),
        },
        {
          key: "created",
          header: t("table.created"),
          sortKey: "created_at",
          render: (row) => (
            <span className="tabular-nums">{formatLocalDateTime(row.created_at, locale)}</span>
          ),
        },
      ]}
      rowActions={
        canManage
          ? (row) => (
              <div className="flex items-center justify-end gap-1">
                {row.converted_student_id === null && row.status !== "WON" && (
                  <Button
                    type="button"
                    size="xs"
                    onClick={() => onConvert(row)}
                    className="gap-1"
                    data-testid="crm-row-convert"
                  >
                    <UserPlus className="size-3" aria-hidden />
                    {t("table.convert")}
                  </Button>
                )}
                {row.converted_student_id === null && (
                  <select
                    aria-label={t("table.moveTo")}
                    value={row.status}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onMove(row, e.target.value as LeadStatus)}
                    className="border-input bg-background h-7 rounded-lg border px-1.5 text-xs outline-none"
                    data-testid="crm-row-status"
                  >
                    {LEAD_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(`status.${s}`)}
                      </option>
                    ))}
                  </select>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onDelete(row)}
                  aria-label={t("table.delete")}
                  data-testid="crm-row-delete"
                >
                  <Trash2 className="size-3.5 text-destructive" aria-hidden />
                </Button>
              </div>
            )
          : undefined
      }
    />
  );
}
