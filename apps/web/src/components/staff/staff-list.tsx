"use client";

import {
  Building2,
  MessageCircle,
  Pencil,
  Plus,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Octagram } from "@/components/ornaments";
import { Button } from "@/components/ui/button";
import {
  type ColumnDef,
  DataTable,
  type FilterDef,
} from "@/components/ui/data-table";
import {
  listStaff,
  listStaffDepartments,
  type StaffDepartment,
  type StaffRow,
} from "@/lib/api";
import { type ExcelColumn } from "@/lib/export-excel";
import { formatMoney } from "@/lib/money";

// ── Avatar ───────────────────────────────────────────────────────────────────

function nameHue(name: string) {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

function StaffAvatar({ name }: { name: string }) {
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

/** Short, unambiguous date — "12 Mar 2026". Never a bare "12/03", which reads two ways. */
function shortDate(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
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
  filterPreset,
  pendingRowId,
  onPrefetch,
}: {
  onNew: () => void;
  onOpen: (id: string, name: string) => void;
  onDeactivate?: (id: string, name: string) => void;
  refreshToken?: number;
  /** Set by the segment tiles above the table — see `staff-manager`. */
  filterPreset?: { values: Record<string, string>; token: number };
  /** The row whose profile is currently opening — it shows a spinner. */
  pendingRowId?: string | null;
  /** Warm a staff member's profile route on hover so the click lands on a loaded page. */
  onPrefetch?: (id: string) => void;
}) {
  const t = useTranslations("staff");
  const locale = useLocale();
  const { can } = useAuth();
  const [departments, setDepartments] = useState<StaffDepartment[]>([]);

  // The department filter's options come from the platform catalog, not a fixed enum, so an
  // academy that adds "Curriculum" gets it in the filter without a code change.
  useEffect(() => {
    void listStaffDepartments()
      .then((res) => setDepartments(res.departments.filter((d) => d.is_active)))
      .catch(() => setDepartments([]));
  }, []);

  const columns = useMemo<ColumnDef<StaffRow>[]>(
    () => [
      {
        key: "name",
        header: t("colName"),
        sortKey: "name",
        headerClassName: "min-w-56",
        hideOnCard: true,
        render: (r) => (
          <div className="flex items-center gap-3">
            <StaffAvatar name={r.full_name} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{r.full_name}</div>
              {/* Whether this person can sign in is the security-relevant fact about them,
                  so it travels with the name rather than sitting in a column of its own. */}
              {r.user_id ? (
                <div className="text-muted-foreground mt-0.5 inline-flex items-center gap-1 text-[11px]">
                  <ShieldCheck className="text-primary size-3 shrink-0" aria-hidden />
                  {t("detail.hasLogin")}
                </div>
              ) : (
                <div className="text-muted-foreground/50 mt-0.5 inline-flex items-center gap-1 text-[11px]">
                  <ShieldOff className="size-3 shrink-0" aria-hidden />
                  {t("detail.noLogin")}
                </div>
              )}
            </div>
          </div>
        ),
      },
      // The department was in the row payload, sortable and filterable on the server, and had
      // translations sitting unused — it simply was never shown. On a staff list, "who is in
      // accounting?" is the first question anyone asks.
      {
        key: "department",
        header: t("colDepartment"),
        sortKey: "department",
        headerClassName: "min-w-36",
        render: (r) => (
          <span className="bg-muted text-foreground/80 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium">
            <Building2 className="text-muted-foreground size-3 shrink-0" aria-hidden />
            {t.has(`department.${r.department}`)
              ? t(`department.${r.department}`)
              : r.department}
          </span>
        ),
      },
      {
        key: "phone",
        header: t("colPhone"),
        headerClassName: "min-w-40",
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
        headerClassName: "min-w-32",
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
        headerClassName: "min-w-28",
        render: (r) => <StatusBadge active={r.deleted_at == null} />,
      },
      {
        key: "created_at",
        header: t("colAdded"),
        sortKey: "created_at",
        headerClassName: "min-w-28",
        render: (r) => (
          <span className="text-muted-foreground whitespace-nowrap text-xs tabular-nums">
            {shortDate(r.created_at, locale) ?? (
              <span className="text-muted-foreground/35">—</span>
            )}
          </span>
        ),
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
        options: departments.map((d) => ({ value: d.name, label: d.name })),
      },
    ],
    [t, departments],
  );

  const exportColumns = useMemo<ExcelColumn<StaffRow>[]>(
    () => [
      { header: t("colName"), value: (r) => r.full_name, width: 26 },
      {
        header: t("colDepartment"),
        value: (r) =>
          t.has(`department.${r.department}`)
            ? t(`department.${r.department}`)
            : r.department,
      },
      { header: t("colPhone"), value: (r) => r.phone },
      {
        header: t("colSalary"),
        value: (r) =>
          r.salary_minor > 0
            ? formatMoney({ amount: r.salary_minor, currency: r.currency }, locale)
            : "",
      },
      {
        header: t("colStatus"),
        value: (r) => (r.deleted_at == null ? t("stat.active") : t("stat.inactive")),
      },
      { header: t("colAdded"), value: (r) => r.created_at?.slice(0, 10) ?? "" },
    ],
    [t, locale],
  );

  const newButton = can("staff.create") ? (
    <Button
      type="button"
      size="lg"
      onClick={onNew}
      data-testid="new-staff-top"
      className="gap-1.5 shadow-sm shadow-primary/20"
    >
      <Plus className="size-3.5" aria-hidden />
      {t("new")}
    </Button>
  ) : undefined;

  return (
    <section className="bg-card overflow-hidden rounded-2xl border shadow-sm">
      {/* ── Panel header ─────────────────────────────────────────────── */}
      <div className="relative border-b">
        <div className="from-primary/[0.07] via-primary/[0.025] flex items-center justify-between gap-3 bg-gradient-to-r to-transparent px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-primary/10 ring-primary/15 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">
              <Users className="text-primary size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
                {t("list.title")}
                <Octagram className="text-gold/60 size-2 shrink-0" />
              </h2>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {t("list.hint")}
              </p>
            </div>
          </div>
        </div>
        <span
          className="via-gold/45 absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent to-transparent"
          aria-hidden
        />
      </div>

      <div className="p-4">
        <DataTable<StaffRow>
          testId="staff-table"
          fetcher={listStaff}
          columns={columns}
          getRowId={(r) => r.id}
          searchable
          searchPlaceholder={t("list.searchPlaceholder")}
          filters={filters}
          filterPreset={filterPreset}
          showIndex
          defaultSort="name"
          emptyMessage={t("empty")}
          emptyAction={newButton}
          toolbar={newButton}
          exportConfig={{
            fileName: "staff",
            sheetName: t("list.title"),
            columns: exportColumns,
          }}
          refreshToken={refreshToken}
          pendingRowId={pendingRowId}
          onRowHover={(r) => onPrefetch?.(r.id)}
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
    </section>
  );
}
