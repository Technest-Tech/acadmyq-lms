"use client";

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

/** The Guardians DataTable: search by name/phone, active/inactive filter, name sort. */
export function GuardiansList({
  onNew,
  onOpen,
}: {
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("guardians");
  const { can } = useAuth();

  const columns = useMemo<ColumnDef<GuardianRow>[]>(
    () => [
      {
        key: "name",
        header: t("colName"),
        sortKey: "name",
        render: (r) => <span className="font-medium">{r.full_name}</span>,
      },
      {
        key: "phone",
        header: t("colPhone"),
        render: (r) => r.whatsapp_phone,
      },
      {
        key: "country",
        header: t("colCountry"),
        render: (r) => r.country ?? "—",
      },
      {
        key: "currency",
        header: t("colCurrency"),
        render: (r) => r.currency,
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

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <DataTable<GuardianRow>
        testId="guardians-table"
        fetcher={listGuardians}
        columns={columns}
        getRowId={(r) => r.id}
        searchable
        filters={filters}
        defaultSort="name"
        emptyMessage={t("empty")}
        emptyAction={
          can("guardian.create") ? (
            <Button
              type="button"
              size="sm"
              onClick={onNew}
              data-testid="new-guardian"
            >
              {t("new")}
            </Button>
          ) : undefined
        }
        toolbar={
          can("guardian.create") ? (
            <Button
              type="button"
              size="sm"
              onClick={onNew}
              data-testid="new-guardian-top"
            >
              {t("new")}
            </Button>
          ) : undefined
        }
        onRowClick={(r) => onOpen(r.id)}
        rowActions={(r) => (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onOpen(r.id)}
          >
            {t("manage")}
          </Button>
        )}
      />
    </div>
  );
}
