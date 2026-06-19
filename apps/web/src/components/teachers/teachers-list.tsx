"use client";

import {
  BadgeCheck,
  MessageCircle,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  type ColumnDef,
  DataTable,
  type FilterDef,
} from "@/components/ui/data-table";
import { listTeachers, type TeacherRow } from "@/lib/api";
import { type ExcelColumn } from "@/lib/export-excel";
import { formatMoney } from "@/lib/money";

// ── Avatar ─────────────────────────────────────────────────────────────────────

function nameHue(name: string) {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

function TeacherAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <div
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm"
      style={{ backgroundColor: `hsl(${nameHue(name)} 52% 44%)` }}
      aria-hidden
    >
      {initials}
    </div>
  );
}

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ active }: { active: boolean }) {
  const t = useTranslations("teachers");
  return active ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
      <span className="size-1.5 rounded-full bg-emerald-500" />
      {t("stat.active")}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
      <span className="size-1.5 rounded-full bg-slate-400" />
      {t("stat.inactive")}
    </span>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

/** The Teachers DataTable: search by name/phone/specialization, sort by name or session rate. */
export function TeachersList({
  onNew,
  onOpen,
  onDelete,
  refreshToken,
}: {
  onNew: () => void;
  onOpen: (id: string, name: string) => void;
  onDelete?: (id: string, name: string) => void;
  refreshToken?: number;
}) {
  const t = useTranslations("teachers");
  const locale = useLocale();
  const { can } = useAuth();

  const columns = useMemo<ColumnDef<TeacherRow>[]>(
    () => [
      {
        key: "name",
        header: t("colName"),
        sortKey: "name",
        render: (r) => (
          <div className="flex items-center gap-3">
            <TeacherAvatar name={r.full_name} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{r.full_name}</div>
              {r.specialization ? (
                <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <BadgeCheck className="size-3 shrink-0 text-violet-500" />
                  {r.specialization}
                </div>
              ) : (
                <div className="mt-0.5 text-[11px] text-muted-foreground/50">
                  {t("detail.noSpecialization")}
                </div>
              )}
            </div>
          </div>
        ),
      },
      {
        key: "rate",
        header: t("colRate"),
        sortKey: "rate",
        className: "text-end",
        render: (r) => (
          <span className="font-medium tabular-nums">
            {formatMoney(
              { amount: r.session_rate_minor, currency: r.currency },
              locale,
            )}
          </span>
        ),
      },
      {
        key: "phone",
        header: t("colWhatsapp"),
        render: (r) =>
          r.phone ? (
            <span
              dir="ltr"
              className="inline-flex items-center gap-1.5 text-sm tabular-nums"
            >
              <MessageCircle
                className="size-3.5 shrink-0 text-emerald-500"
                aria-hidden
              />
              {r.phone}
            </span>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          ),
      },
      {
        key: "status",
        header: t("filter.status"),
        render: (r) => <StatusBadge active={r.deleted_at == null} />,
      },
    ],
    [t, locale],
  );

  const filters = useMemo<FilterDef[]>(
    () => [
      {
        key: "status",
        label: t("filter.status"),
        options: [
          { value: "active", label: t("filter.active") },
          { value: "inactive", label: t("filter.inactive") },
          { value: "all", label: t("filter.all") },
        ],
      },
    ],
    [t],
  );

  const exportColumns = useMemo<ExcelColumn<TeacherRow>[]>(
    () => [
      { header: t("colName"), value: (r) => r.full_name, width: 26 },
      { header: t("colSpecialization"), value: (r) => r.specialization },
      {
        header: t("colRate"),
        value: (r) =>
          formatMoney(
            { amount: r.session_rate_minor, currency: r.currency },
            locale,
          ),
      },
      { header: t("colWhatsapp"), value: (r) => r.phone },
      {
        header: t("filter.status"),
        value: (r) => (r.deleted_at == null ? t("stat.active") : t("stat.inactive")),
      },
    ],
    [t, locale],
  );

  const newButton = can("teacher.create") ? (
    <Button
      type="button"
      size="default"
      onClick={onNew}
      data-testid="new-teacher-top"
      className="gap-1.5 shadow-sm shadow-primary/20"
    >
      <Plus className="size-3.5" aria-hidden />
      {t("new")}
    </Button>
  ) : undefined;

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      {/* Card header */}
      <div className="flex items-center justify-between border-b bg-muted/20 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold">{t("list.title")}</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t("list.hint")}
          </p>
        </div>
        <Users className="size-4 text-muted-foreground/40" aria-hidden />
      </div>

      {/* Table body */}
      <div className="p-4">
        <DataTable<TeacherRow>
          testId="teachers-table"
          fetcher={listTeachers}
          columns={columns}
          getRowId={(r) => r.id}
          searchable
          filters={filters}
          defaultSort="name"
          emptyMessage={t("empty")}
          emptyAction={newButton}
          toolbar={newButton}
          exportConfig={{
            fileName: "teachers",
            sheetName: t("list.title"),
            columns: exportColumns,
          }}
          refreshToken={refreshToken}
          onRowClick={(r) => onOpen(r.id, r.full_name)}
          rowActions={(r) => (
            <div className="flex items-center justify-end gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(r.id, r.full_name);
                }}
                className="gap-1"
              >
                <Pencil className="size-3" />
                {t("edit")}
              </Button>
              {onDelete && can("teacher.deactivate") && r.deleted_at == null && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={t("detail.delete")}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(r.id, r.full_name);
                  }}
                  data-testid="delete-teacher"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          )}
        />
      </div>
    </div>
  );
}
