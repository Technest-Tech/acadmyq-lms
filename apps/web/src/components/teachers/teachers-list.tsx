"use client";

import {
  BadgeCheck,
  Clock,
  MessageCircle,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { useAuth } from "@/components/auth-provider";
import { Octagram } from "@/components/ornaments";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  type ColumnDef,
  DataTable,
  type FilterDef,
} from "@/components/ui/data-table";
import {
  type AvailabilityWindow,
  listTeachers,
  type TeacherRow,
} from "@/lib/api";
import { type ExcelColumn } from "@/lib/export-excel";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * `availability` is a json column. The API now decodes it for the list too, but a row can still
 * arrive as a raw JSON string from a cached response or an older deploy — and calling an array
 * method on a string takes the whole table down with it. Normalise before touching it.
 */
function availabilityOf(value: unknown): AvailabilityWindow[] {
  if (Array.isArray(value)) return value as AvailabilityWindow[];
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as AvailabilityWindow[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Total teaching hours a week across the availability windows. */
function weeklyHours(windows: AvailabilityWindow[]): number {
  const minutes = windows.reduce((sum, w) => {
    const [sh, sm] = w.start_local.split(":").map(Number);
    const [eh, em] = w.end_local.split(":").map(Number);
    return sum + Math.max(0, (eh ?? 0) * 60 + (em ?? 0) - ((sh ?? 0) * 60 + (sm ?? 0)));
  }, 0);
  return Math.round((minutes / 60) * 10) / 10;
}

/** Digits-only wa.me deep link for a teacher's phone (drops +, spaces, dashes). */
function waLink(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

// ── Avatar ─────────────────────────────────────────────────────────────────────

function nameHue(name: string) {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

function TeacherAvatar({ name }: { name: string }) {
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
  filterPreset,
  pendingRowId,
  onPrefetch,
}: {
  onNew: () => void;
  onOpen: (id: string, name: string) => void;
  onDelete?: (id: string, name: string) => void;
  refreshToken?: number;
  /** Set by the segment tiles above the table — see `teacher-manager`. */
  filterPreset?: { values: Record<string, string>; token: number };
  /** The row whose workspace is currently opening — it shows a spinner. */
  pendingRowId?: string | null;
  /** Warm a teacher's workspace route on hover so the click lands on a loaded page. */
  onPrefetch?: (id: string) => void;
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
        headerClassName: "min-w-56",
        hideOnCard: true,
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
        headerClassName: "min-w-28",
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
        key: "status",
        header: t("colStatus"),
        headerClassName: "min-w-28",
        render: (r) => <StatusBadge active={r.deleted_at == null} />,
      },
      {
        key: "availability",
        header: t("detail.availability"),
        headerClassName: "min-w-32",
        render: (r) => {
          const windows = availabilityOf(r.availability);
          if (windows.length === 0) {
            return (
              <span className="text-muted-foreground/70 inline-flex items-center gap-1.5 text-xs italic">
                <Clock className="size-3.5 shrink-0 opacity-50" aria-hidden />
                {t("fact.noAvailability")}
              </span>
            );
          }
          return (
            <span className="inline-flex items-center gap-1.5 text-sm tabular-nums">
              <Clock className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              {t("fact.hoursWeek", { hours: weeklyHours(windows) })}
            </span>
          );
        },
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
        header: t("colStatus"),
        value: (r) => (r.deleted_at == null ? t("stat.active") : t("stat.inactive")),
      },
    ],
    [t, locale],
  );

  const newButton = can("teacher.create") ? (
    <Button
      type="button"
      size="lg"
      onClick={onNew}
      data-testid="new-teacher-top"
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

      {/* Table body */}
      <div className="p-4">
        <DataTable<TeacherRow>
          testId="teachers-table"
          fetcher={listTeachers}
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
            fileName: "teachers",
            sheetName: t("list.title"),
            columns: exportColumns,
          }}
          refreshToken={refreshToken}
          pendingRowId={pendingRowId}
          onRowHover={(r) => onPrefetch?.(r.id)}
          onRowClick={(r) => onOpen(r.id, r.full_name)}
          rowActions={(r) => (
            <div className="flex items-center justify-end gap-1.5">
              {/* Open a WhatsApp chat with the teacher via a wa.me deep link (own-tab, new window). */}
              {r.phone && (
                <a
                  href={waLink(r.phone)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  aria-label={t("whatsapp")}
                  title={t("whatsapp")}
                  data-testid="teacher-whatsapp"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "xs" }),
                    "gap-1 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  <MessageCircle className="size-3.5" />
                  {t("whatsapp")}
                </a>
              )}
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(r.id, r.full_name);
                }}
                className="gap-1"
                data-testid="teacher-view"
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
    </section>
  );
}
