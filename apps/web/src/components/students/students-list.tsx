"use client";

import { SUBSCRIPTION_STATUS } from "@academiq/contracts";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import {
  type ColumnDef,
  DataTable,
  type FilterDef,
} from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";
import {
  listStudents,
  listTeachers,
  type StudentRow,
  type TeacherRow,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";

/**
 * The Students DataTable (§5.4): server-side search (name / guardian / phone), filters
 * (teacher, subscription status, active/inactive), sortable name/price/start-date columns,
 * and row actions gated by capability. The price renders from the active subscription's minor
 * units; an unsubscribed student shows a dash.
 */
export function StudentsList({
  onNew,
  onOpen,
}: {
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("students");
  const locale = useLocale();
  const { can } = useAuth();
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);

  useEffect(() => {
    void listTeachers({ pageSize: 50, filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => setTeachers([]));
  }, []);

  const columns = useMemo<ColumnDef<StudentRow>[]>(
    () => [
      {
        key: "name",
        header: t("colName"),
        sortKey: "name",
        render: (r) => <span className="font-medium">{r.full_name}</span>,
      },
      {
        key: "guardian",
        header: t("colGuardian"),
        render: (r) => r.guardian_name ?? t("none"),
      },
      {
        key: "teacher",
        header: t("colTeacher"),
        render: (r) => r.teacher_name ?? t("none"),
      },
      {
        key: "price",
        header: t("colPrice"),
        sortKey: "price",
        className: "text-end",
        render: (r) =>
          r.price_minor != null && r.price_currency
            ? formatMoney(
                { amount: r.price_minor, currency: r.price_currency },
                locale,
              )
            : t("none"),
      },
      {
        key: "status",
        header: t("colStatus"),
        render: (r) =>
          r.subscription_status
            ? t(`subStatus.${r.subscription_status}`)
            : t("none"),
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
      {
        key: "teacher_id",
        label: t("filter.teacher"),
        options: teachers.map((tch) => ({
          value: tch.id,
          label: tch.full_name,
        })),
      },
      {
        key: "subscription_status",
        label: t("filter.subscriptionStatus"),
        options: SUBSCRIPTION_STATUS.map((s) => ({
          value: s,
          label: t(`subStatus.${s}`),
        })),
      },
    ],
    [t, teachers],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
      </div>
      <DataTable<StudentRow>
        testId="students-table"
        fetcher={listStudents}
        columns={columns}
        getRowId={(r) => r.id}
        searchable
        filters={filters}
        defaultSort="name"
        emptyMessage={t("empty")}
        emptyAction={
          can("student.create") ? (
            <Button
              type="button"
              size="sm"
              onClick={onNew}
              data-testid="new-student"
            >
              {t("new")}
            </Button>
          ) : undefined
        }
        toolbar={
          can("student.create") ? (
            <Button
              type="button"
              size="sm"
              onClick={onNew}
              data-testid="new-student-top"
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
