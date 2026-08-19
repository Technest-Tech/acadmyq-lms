"use client";

import { Coins, MapPin, MessageCircle, Plus, UserCog } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { useAuth } from "@/components/auth-provider";
import { Octagram } from "@/components/ornaments";
import { Button } from "@/components/ui/button";
import {
  type ColumnDef,
  DataTable,
  type FilterDef,
} from "@/components/ui/data-table";
import { type GuardianRow, listGuardians } from "@/lib/api";
import { COUNTRIES, CURRENCIES } from "@/lib/countries";
import { type ExcelColumn } from "@/lib/export-excel";
import { cn } from "@/lib/utils";

function countryCell(code: string | null) {
  if (!code) return null;
  const c = COUNTRIES.find((x) => x.code === code);
  return c ?? { flag: "", code, name: code };
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

// ── Avatar ─────────────────────────────────────────────────────────────────────

function nameHue(name: string) {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

/** Stable hue per name, so the same face is the same colour on every visit. */
function GuardianAvatar({ name }: { name: string }) {
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

// ── Component ──────────────────────────────────────────────────────────────────

export function GuardiansList({
  onNew,
  onOpen,
  refreshToken,
  filterPreset,
}: {
  onNew: () => void;
  onOpen: (id: string, name: string) => void;
  refreshToken?: number;
  /** Set by the segment tiles above the table — see `guardian-manager`. */
  filterPreset?: { values: Record<string, string>; token: number };
}) {
  const t = useTranslations("guardians");
  const locale = useLocale();
  const { can } = useAuth();

  const columns = useMemo<ColumnDef<GuardianRow>[]>(
    () => [
      {
        key: "name",
        header: t("colName"),
        sortKey: "name",
        headerClassName: "min-w-56",
        hideOnCard: true,
        render: (r) => {
          const c = countryCell(r.country);
          return (
            <div className="flex items-center gap-3">
              <GuardianAvatar name={r.full_name} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{r.full_name}</div>
                {/* The country lives with the name, not in a column of its own: it is part of
                    knowing who this person is, and it was previously a bare "EG" code. */}
                <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
                  {c ? (
                    <>
                      {c.flag ? (
                        <span aria-hidden>{c.flag}</span>
                      ) : (
                        <MapPin className="size-3 shrink-0" aria-hidden />
                      )}
                      <span className="truncate">{c.name}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        key: "phone",
        header: t("colPhone"),
        headerClassName: "min-w-40",
        render: (r) =>
          r.whatsapp_phone ? (
            <span
              dir="ltr"
              className="inline-flex items-center gap-1.5 text-sm tabular-nums"
            >
              <MessageCircle
                className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
              {r.whatsapp_phone}
            </span>
          ) : (
            <span className="text-muted-foreground/35">—</span>
          ),
      },
      {
        key: "currency",
        header: t("colCurrency"),
        headerClassName: "min-w-28",
        render: (r) => (
          <span className="bg-primary/8 text-primary ring-primary/15 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1">
            <Coins className="size-3" aria-hidden />
            {r.currency}
          </span>
        ),
      },
      {
        key: "status",
        header: t("colStatus"),
        headerClassName: "min-w-28",
        render: (r) =>
          r.deleted_at == null ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/15 dark:bg-emerald-950/40 dark:text-emerald-300">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              {t("filter.active")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-500/15 dark:bg-slate-800/40 dark:text-slate-400">
              <span className="size-1.5 rounded-full bg-slate-400" />
              {t("filter.inactive")}
            </span>
          ),
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
          { value: "active", label: t("filter.active") },
          { value: "inactive", label: t("filter.inactive") },
          { value: "all", label: t("filter.all") },
        ],
      },
      // The API has always accepted a currency filter; the UI never offered it. On an academy
      // billing in three currencies, "show me everyone I invoice in USD" is the whole question.
      {
        key: "currency",
        label: t("filter.currency"),
        options: CURRENCIES.map((c) => ({ value: c.code, label: c.code })),
      },
    ],
    [t],
  );

  const exportColumns = useMemo<ExcelColumn<GuardianRow>[]>(
    () => [
      { header: t("colName"), value: (r) => r.full_name, width: 26 },
      { header: t("colPhone"), value: (r) => r.whatsapp_phone },
      { header: t("colCountry"), value: (r) => countryCell(r.country)?.name ?? "" },
      { header: t("colCurrency"), value: (r) => r.currency },
      {
        header: t("colStatus"),
        value: (r) =>
          r.deleted_at == null ? t("filter.active") : t("filter.inactive"),
      },
      { header: t("colAdded"), value: (r) => r.created_at?.slice(0, 10) ?? "" },
      { header: t("form.notes"), value: (r) => r.notes, width: 32 },
    ],
    [t],
  );

  const newButton = can("guardian.create") ? (
    <Button
      type="button"
      size="lg"
      onClick={onNew}
      data-testid="new-guardian-top"
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
        <div
          className={cn(
            "from-primary/[0.07] via-primary/[0.025] flex items-center justify-between gap-3",
            "bg-gradient-to-r to-transparent px-5 py-4",
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-primary/10 ring-primary/15 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">
              <UserCog className="text-primary size-5" aria-hidden />
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
        <DataTable<GuardianRow>
          testId="guardians-table"
          fetcher={listGuardians}
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
            fileName: "guardians",
            sheetName: t("list.title"),
            columns: exportColumns,
          }}
          refreshToken={refreshToken}
          onRowClick={(r) => onOpen(r.id, r.full_name)}
          rowActions={(r) => (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onOpen(r.id, r.full_name)}
            >
              {t("manage")}
            </Button>
          )}
        />
      </div>
    </section>
  );
}
