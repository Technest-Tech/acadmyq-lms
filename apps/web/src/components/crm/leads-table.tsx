"use client";

import { CalendarClock, MessageCircle, Trash2, UserPlus, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  FollowUpChip,
  isClosed,
  SourceBadge,
  StatusBadge,
  TrialChip,
  waLink,
} from "@/components/crm/lead-badges";
import { Octagram } from "@/components/ornaments";
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
 * through the same onMove funnel as a board drag, so the stages that need details first
 * (TRIAL → booking form, SUBSCRIBED → student form) behave identically in both views.
 */
export function LeadsTable({
  refreshToken,
  filterPreset,
  canManage,
  onOpen,
  onMove,
  onBookTrial,
  onConvert,
  onDelete,
}: {
  refreshToken: number;
  /** Set by the pipeline tiles above the table — see `crm-manager`. */
  filterPreset?: { values: Record<string, string>; token: number };
  canManage: boolean;
  onOpen: (lead: LeadRow) => void;
  onMove: (lead: LeadRow, status: LeadStatus) => void;
  onBookTrial: (lead: LeadRow) => void;
  onConvert: (lead: LeadRow) => void;
  onDelete: (lead: LeadRow) => void;
}) {
  const t = useTranslations("crm");
  const locale = useLocale();

  return (
    <section className="bg-card overflow-hidden rounded-2xl border shadow-sm">
      {/* ── Panel header ─────────────────────────────────────────────── */}
      <div className="relative border-b">
        <div className="from-primary/[0.07] via-primary/[0.025] flex items-center gap-3 bg-gradient-to-r to-transparent px-5 py-4">
          <div className="bg-primary/10 ring-primary/15 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">
            <Users className="text-primary size-5" aria-hidden />
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
    <DataTable<LeadRow>
      testId="crm-leads-table"
      refreshToken={refreshToken}
      filterPreset={filterPreset}
      fetcher={(q) => listLeads(q)}
      getRowId={(row) => row.id}
      searchable
      searchPlaceholder={t("table.searchPlaceholder")}
      showIndex
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
          headerClassName: "min-w-56",
          hideOnCard: true,
          render: (row) => (
            <div className="flex items-center gap-3">
              <LeadAvatar name={row.full_name} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{row.full_name}</div>
                {/* What they asked about is what a follow-up call opens with — it belongs
                    beside the name, not in a column nobody scans. */}
                <div className="text-muted-foreground mt-0.5 truncate text-xs">
                  {row.interested_in ?? t("table.noInterest")}
                </div>
              </div>
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
          key: "trial",
          header: t("table.trial"),
          render: (row) =>
            row.trial_id === null ? (
              <span className="text-muted-foreground/40 text-sm">—</span>
            ) : (
              <TrialChip lead={row} />
            ),
        },
        {
          key: "followUp",
          header: t("table.followUp"),
          sortKey: "follow_up",
          render: (row) => <FollowUpChip date={row.follow_up_at} closed={isClosed(row.status)} />,
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
                {row.converted_student_id === null && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => onBookTrial(row)}
                    className="gap-1"
                    data-testid="crm-row-trial"
                  >
                    <CalendarClock className="size-3" aria-hidden />
                    {row.trial_id === null ? t("table.bookTrial") : t("table.rebookTrial")}
                  </Button>
                )}
                {row.converted_student_id === null && (
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
      </div>
    </section>
  );
}

// ── Avatar ─────────────────────────────────────────────────────────────────────

function nameHue(name: string) {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

/** Stable hue per name — a lead becomes recognisable before its name is read. */
function LeadAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  const hue = nameHue(name);
  return (
    <div
      className="ring-gold/25 flex size-10 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold text-white shadow-sm ring-1"
      style={{
        backgroundImage: `linear-gradient(135deg, hsl(${hue} 58% 50%), hsl(${(hue + 32) % 360} 56% 40%))`,
      }}
      aria-hidden
    >
      {initials}
    </div>
  );
}
