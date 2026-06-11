"use client";

import { Coins, Globe, MessageCircle, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  type ColumnDef,
  DataTable,
  type FilterDef,
} from "@/components/ui/data-table";
import { type GuardianRow, listGuardians } from "@/lib/api";

// Deterministic hue from a string so each guardian gets a consistent colour.
function nameHue(name: string) {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

function GuardianAvatar({ name }: { name: string }) {
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

export function GuardiansList({
  onNew,
  onOpen,
  refreshToken,
}: {
  onNew: () => void;
  onOpen: (id: string, name: string) => void;
  refreshToken?: number;
}) {
  const t = useTranslations("guardians");
  const { can } = useAuth();

  const columns = useMemo<ColumnDef<GuardianRow>[]>(
    () => [
      {
        key: "name",
        header: t("colName"),
        sortKey: "name",
        render: (r) => (
          <div className="flex items-center gap-3">
            <GuardianAvatar name={r.full_name} />
            <span className="font-semibold">{r.full_name}</span>
          </div>
        ),
      },
      {
        key: "phone",
        header: t("colPhone"),
        render: (r) => (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <MessageCircle className="size-3 shrink-0 text-emerald-500" aria-hidden />
            {r.whatsapp_phone}
          </span>
        ),
      },
      {
        key: "country",
        header: t("colCountry"),
        render: (r) =>
          r.country ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
              <Globe className="size-3 text-muted-foreground" aria-hidden />
              {r.country}
            </span>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          ),
      },
      {
        key: "currency",
        header: t("colCurrency"),
        render: (r) => (
          <span className="inline-flex items-center gap-1 rounded-md bg-primary/8 px-2 py-0.5 text-xs font-semibold text-primary">
            <Coins className="size-3" aria-hidden />
            {r.currency}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        render: (r) =>
          r.deleted_at == null ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              {t("filter.active")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
              <span className="size-1.5 rounded-full bg-slate-400" />
              {t("filter.inactive")}
            </span>
          ),
      },
    ],
    [t],
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

  const newButton = can("guardian.create") ? (
    <Button
      type="button"
      size="default"
      onClick={onNew}
      data-testid="new-guardian-top"
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
          <h2 className="text-sm font-semibold">All Guardians</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Click any row to view profile or edit details
          </p>
        </div>
      </div>

      {/* Table body */}
      <div className="p-4">
        <DataTable<GuardianRow>
          testId="guardians-table"
          fetcher={listGuardians}
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
    </div>
  );
}
