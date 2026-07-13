"use client";

import { History, Lock, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import {
  actorInitials,
  auditTone,
  TONE_AVATAR,
  TONE_DOT,
  TONE_PILL,
} from "@/components/audit/audit-action-style";
import { AuditDetailModal } from "@/components/audit/audit-detail-modal";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  getAudit,
  type AuditEntry,
  type AuditResult,
  type DataTableQuery,
} from "@/lib/api";
import { type ExcelColumn } from "@/lib/export-excel";
import { formatNumber } from "@/lib/money";
import { formatRelativeTime } from "@/lib/time";

// Curated filter option lists (the server validates the values independently).
const ACTIONS = [
  "auth.login",
  "academy.configure",
  "academy.plan_changed",
  "academy.addon_changed",
  "role.assign",
  "student.create",
  "student.teacher_reassigned",
  "subscription.price_changed",
  "schedule.updated",
  "session.attendance_override",
  "invoice.closed",
  "invoice.marked_paid",
  "payout.finalized",
];

const ENTITIES = [
  "academy",
  "student",
  "teacher",
  "guardian",
  "subscription",
  "schedule",
  "session",
  "invoice",
  "payout",
  "user",
  "add_on",
];

/**
 * Audit log read UI (Sprint 9 §5). A clean, scannable trail over the append-only audit_log:
 * relative timestamps, actor avatars, colour-coded action pills, filter chips, and an
 * expandable before/after diff per row. Owner sees their academy, Super Admin sees the whole
 * platform (server-scoped). BASIC plans are depth-limited to 30 days, with an upsell banner.
 */
export function AuditLogScreen() {
  const t = useTranslations("audit");
  const locale = useLocale();
  const { can, session } = useAuth();

  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [depthDays, setDepthDays] = useState<number | null>(null);

  const filterKey = `${action}|${entity}|${from}|${to}`;

  const fetcher = useCallback(
    async (q: DataTableQuery): Promise<AuditResult> => {
      const res = await getAudit({
        action: action || undefined,
        entity: entity || undefined,
        from: from || undefined,
        to: to || undefined,
        page: q.page,
        pageSize: q.pageSize,
      });
      setDepthDays(res.depthLimitedDays);
      return res;
    },
    [action, entity, from, to],
  );

  const columns: ColumnDef<AuditEntry>[] = useMemo(
    () => [
      {
        key: "time",
        header: t("colTime"),
        render: (row) => (
          <span className="text-muted-foreground tabular-nums whitespace-nowrap">
            {formatRelativeTime(row.created_at, locale)}
          </span>
        ),
      },
      {
        key: "actor",
        header: t("colActor"),
        render: (row) => {
          const tone = auditTone(row.action);
          return (
            <div className="flex items-center gap-2.5">
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${TONE_AVATAR[tone]}`}
                aria-hidden
              >
                {actorInitials(row.actor_name)}
              </span>
              <div className="min-w-0">
                <span className="block truncate font-medium">
                  {row.actor_name ?? t("systemActor")}
                </span>
                {row.academy_name && (
                  <span className="text-muted-foreground block truncate text-xs">
                    {row.academy_name}
                  </span>
                )}
              </div>
            </div>
          );
        },
      },
      {
        key: "action",
        header: t("colAction"),
        render: (row) => {
          const tone = auditTone(row.action);
          return (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${TONE_PILL[tone]}`}
            >
              <span
                className={`size-1.5 rounded-full ${TONE_DOT[tone]}`}
                aria-hidden
              />
              {row.action}
            </span>
          );
        },
      },
      {
        key: "entity",
        header: t("colEntity"),
        render: (row) => (
          <span className="text-muted-foreground">{row.entity_type}</span>
        ),
      },
    ],
    [t, locale],
  );

  const exportColumns = useMemo<ExcelColumn<AuditEntry>[]>(() => {
    const dateFmt = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    return [
      {
        header: t("colTime"),
        value: (row) => dateFmt.format(new Date(row.created_at)),
        width: 22,
      },
      {
        header: t("colActor"),
        value: (row) => row.actor_name ?? t("systemActor"),
        width: 22,
      },
      { header: t("colAction"), value: (row) => row.action, width: 24 },
      { header: t("colEntity"), value: (row) => row.entity_type },
    ];
  }, [t, locale]);

  if (!can("audit.read")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const inputClass =
    "border-input bg-background focus:border-primary focus:ring-primary/15 h-8 rounded-lg border px-3 text-sm outline-none transition-colors focus:ring-3";

  return (
    <div className="space-y-6">
      {/* Premium hero header */}
      <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex items-center gap-3.5">
          <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
            <History className="size-5.5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {session?.role === "SUPER_ADMIN"
                ? t("subtitlePlatform")
                : t("subtitle")}
            </p>
          </div>
          <span className="text-muted-foreground ms-auto hidden items-center gap-1.5 text-xs font-medium sm:inline-flex">
            <ShieldCheck className="size-3.5 text-emerald-500" aria-hidden />
            {t("appendOnly")}
          </span>
        </div>
      </div>

      {/* Plan-depth upsell (BASIC) */}
      {depthDays !== null && (
        <AlertBanner
          variant="info"
          message={t("depthLimited", { days: formatNumber(depthDays, locale) })}
        />
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t("filterAction")}
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className={inputClass}
        >
          <option value="">{t("filterAction")}</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          aria-label={t("filterEntity")}
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          className={inputClass}
        >
          <option value="">{t("filterEntity")}</option>
          {ENTITIES.map((en) => (
            <option key={en} value={en}>
              {en}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label={t("filterFrom")}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={inputClass}
        />
        <input
          type="date"
          aria-label={t("filterTo")}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className={inputClass}
        />
        {(action || entity || from || to) && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-xs font-medium transition-colors"
            onClick={() => {
              setAction("");
              setEntity("");
              setFrom("");
              setTo("");
            }}
          >
            {t("clearFilters")}
          </button>
        )}
      </div>

      <DataTable<AuditEntry>
        key={filterKey}
        fetcher={fetcher}
        columns={columns}
        getRowId={(row) => row.id}
        onRowClick={(row) => setSelected(row)}
        emptyMessage={t("empty")}
        testId="audit-table"
        exportConfig={{
          fileName: "audit-log",
          sheetName: t("title"),
          columns: exportColumns,
        }}
      />

      <AuditDetailModal entry={selected} onClose={() => setSelected(null)} />

      {/* Subtle footer reaffirming the append-only guarantee */}
      <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-xs">
        <Lock className="size-3" aria-hidden />
        {t("appendOnlyNote")}
      </p>
    </div>
  );
}
