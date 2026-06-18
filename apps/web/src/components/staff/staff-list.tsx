"use client";

import {
  Briefcase,
  MessageCircle,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  type ColumnDef,
  DataTable,
  type FilterDef,
} from "@/components/ui/data-table";
import { listStaff, listStaffDepartments, type StaffDepartment, type StaffRow } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

// ── Department badge (hash-based color) ──────────────────────────────────────

function deptHue(name: string): number {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

function DepartmentBadge({ dept }: { dept: string }) {
  const hue = deptHue(dept);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `hsl(${hue} 65% 94%)`,
        color: `hsl(${hue} 55% 35%)`,
      }}
    >
      <Briefcase className="size-3 shrink-0" aria-hidden />
      {dept}
    </span>
  );
}

// ── Avatar ───────────────────────────────────────────────────────────────────

function nameHue(name: string) {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

function StaffAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <div
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm"
      style={{ backgroundColor: `hsl(${nameHue(name)} 48% 42%)` }}
      aria-hidden
    >
      {initials}
    </div>
  );
}

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ active }: { active: boolean }) {
  const t = useTranslations("staff");
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

// ── Component ─────────────────────────────────────────────────────────────────

export function StaffList({
  onNew,
  onOpen,
  onDeactivate,
  refreshToken,
}: {
  onNew: () => void;
  onOpen: (id: string, name: string) => void;
  onDeactivate?: (id: string, name: string) => void;
  refreshToken?: number;
}) {
  const t = useTranslations("staff");
  const locale = useLocale();
  const { can } = useAuth();
  const [deptList, setDeptList] = useState<StaffDepartment[]>([]);

  useEffect(() => {
    listStaffDepartments()
      .then((res) => setDeptList(res.departments))
      .catch(() => {});
  }, []);

  const columns = useMemo<ColumnDef<StaffRow>[]>(
    () => [
      {
        key: "name",
        header: t("colName"),
        sortKey: "name",
        render: (r) => (
          <div className="flex items-center gap-3">
            <StaffAvatar name={r.full_name} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{r.full_name}</div>
              {r.user_id ? (
                <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <ShieldCheck className="size-3 shrink-0 text-primary" />
                  {t("detail.hasLogin")}
                </div>
              ) : (
                <div className="mt-0.5 text-[11px] text-muted-foreground/40">
                  {t("detail.noLogin")}
                </div>
              )}
            </div>
          </div>
        ),
      },
      {
        key: "department",
        header: t("colDepartment"),
        sortKey: "department",
        render: (r) => <DepartmentBadge dept={r.department} />,
      },
      {
        key: "phone",
        header: t("colPhone"),
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
        key: "salary",
        header: t("colSalary"),
        className: "text-end",
        render: (r) =>
          r.salary_minor > 0 ? (
            <span className="font-medium tabular-nums">
              {formatMoney({ amount: r.salary_minor, currency: r.currency }, locale)}
            </span>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          ),
      },
      {
        key: "status",
        header: t("colStatus"),
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
          { value: "active",   label: t("filter.active") },
          { value: "inactive", label: t("filter.inactive") },
          { value: "all",      label: t("filter.all") },
        ],
      },
      {
        key: "department",
        label: t("filter.department"),
        options: deptList.map((d) => ({ value: d.name, label: d.name })),
      },
    ],
    [t, deptList],
  );

  const newButton = can("staff.create") ? (
    <Button
      type="button"
      size="default"
      onClick={onNew}
      data-testid="new-staff-top"
      className="gap-1.5 shadow-sm shadow-primary/20"
    >
      <Plus className="size-3.5" aria-hidden />
      {t("new")}
    </Button>
  ) : undefined;

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b bg-muted/20 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold">{t("list.title")}</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">{t("list.hint")}</p>
        </div>
        <Users className="size-4 text-muted-foreground/40" aria-hidden />
      </div>

      <div className="p-4">
        <DataTable<StaffRow>
          testId="staff-table"
          fetcher={listStaff}
          columns={columns}
          getRowId={(r) => r.id}
          searchable
          filters={filters}
          defaultSort="name"
          emptyMessage={t("empty")}
          emptyAction={newButton}
          toolbar={newButton}
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
              {onDeactivate && can("staff.deactivate") && r.deleted_at == null && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={t("detail.deactivate")}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeactivate(r.id, r.full_name);
                  }}
                  data-testid="deactivate-staff"
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
