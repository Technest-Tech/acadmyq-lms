"use client";

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
import { formatMoney } from "@/lib/money";

/** The Teachers DataTable: search by name/phone/specialization, sort by name or session rate. */
export function TeachersList({
  onNew,
  onOpen,
}: {
  onNew: () => void;
  onOpen: (id: string) => void;
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
        render: (r) => <span className="font-medium">{r.full_name}</span>,
      },
      {
        key: "specialization",
        header: t("colSpecialization"),
        render: (r) => r.specialization ?? "—",
      },
      {
        key: "rate",
        header: t("colRate"),
        sortKey: "rate",
        className: "text-end",
        render: (r) =>
          formatMoney(
            { amount: r.session_rate_minor, currency: r.currency },
            locale,
          ),
      },
      {
        key: "phone",
        header: t("colPhone"),
        render: (r) => r.phone ?? "—",
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

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <DataTable<TeacherRow>
        testId="teachers-table"
        fetcher={listTeachers}
        columns={columns}
        getRowId={(r) => r.id}
        searchable
        filters={filters}
        defaultSort="name"
        emptyMessage={t("empty")}
        emptyAction={
          can("teacher.create") ? (
            <Button
              type="button"
              size="sm"
              onClick={onNew}
              data-testid="new-teacher"
            >
              {t("new")}
            </Button>
          ) : undefined
        }
        toolbar={
          can("teacher.create") ? (
            <Button
              type="button"
              size="sm"
              onClick={onNew}
              data-testid="new-teacher-top"
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
