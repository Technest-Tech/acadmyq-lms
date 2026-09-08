"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ClientFormModal } from "@/components/finance/client-form-modal";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import { formatDay, moneyMap } from "@/components/finance/finance-format";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  listFinanceClients,
  type DataTableQuery,
  type FinanceClientRow,
} from "@/lib/api";

/**
 * The owner's client book: one row per payer with what they have paid and what they still owe,
 * per currency. A row opens the edit dialog; "view deals" jumps to the deals list filtered to
 * that client. New deals are made from the deals screen, where the whole form lives.
 */
export function FinanceClientsScreen() {
  const t = useTranslations("finance");
  const locale = useLocale();
  const [editing, setEditing] = useState<FinanceClientRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const fetcher = useCallback((q: DataTableQuery) => listFinanceClients(q), []);

  const columns: ColumnDef<FinanceClientRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: t("clients.columns.name"),
        sortKey: "name",
        render: (row) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            {row.notes ? (
              <p className="text-muted-foreground truncate text-xs">
                {row.notes}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        key: "contact",
        header: t("clients.columns.contact"),
        hideOnCard: true,
        render: (row) => (
          <div className="min-w-0" dir="ltr">
            <p className="truncate text-sm">{row.phone ?? "—"}</p>
            {row.email ? (
              <p className="text-muted-foreground truncate text-xs">
                {row.email}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        key: "deals_count",
        header: t("clients.columns.deals"),
        sortKey: "deals_count",
        render: (row) => (
          <div>
            <p className="text-sm">
              {t("clients.dealsCount", { count: row.deals_count })}
            </p>
            {row.active_deals > 0 ? (
              <p className="text-muted-foreground text-xs">
                {t("clients.activeCount", { count: row.active_deals })}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        key: "received",
        header: t("clients.columns.received"),
        render: (row) => (
          <span className="text-sm font-semibold tabular-nums" dir="ltr">
            {moneyMap(row.received, locale)}
          </span>
        ),
      },
      {
        key: "outstanding",
        header: t("clients.columns.outstanding"),
        render: (row) => (
          <span className="text-sm tabular-nums" dir="ltr">
            {moneyMap(row.outstanding, locale)}
          </span>
        ),
      },
      {
        key: "last_paid_on",
        header: t("clients.columns.lastPaid"),
        sortKey: "last_paid_on",
        hideOnCard: true,
        render: (row) => (
          <span className="text-muted-foreground text-sm">
            {formatDay(row.last_paid_on, locale)}
          </span>
        ),
      },
    ],
    [t, locale],
  );

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={t("title")}
        subtitle={t("clients.subtitle")}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus data-icon="inline-start" />
            {t("actions.newClient")}
          </Button>
        }
      />
      <FinanceTabs />

      <section className="bg-card overflow-hidden rounded-2xl border p-4 shadow-sm">
        <DataTable<FinanceClientRow>
          fetcher={fetcher}
          columns={columns}
          getRowId={(row) => row.id}
          onRowClick={(row) => setEditing(row)}
          searchPlaceholder={t("clients.searchPlaceholder")}
          emptyMessage={t("clients.empty")}
          emptyAction={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus data-icon="inline-start" />
              {t("actions.newClient")}
            </Button>
          }
          defaultSort="name"
          refreshToken={refreshToken}
          testId="finance-clients-table"
          rowActions={(row) => (
            <Link
              href={`/admin/finance/deals?client=${row.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-primary text-xs font-medium whitespace-nowrap"
            >
              {t("clients.form.viewDeals")}
            </Link>
          )}
          filters={[
            {
              key: "active",
              label: t("clients.filters.active"),
              options: [
                { value: "1", label: t("clients.filters.withActive") },
                { value: "0", label: t("clients.filters.noActive") },
              ],
            },
          ]}
          exportConfig={{
            fileName: t("clients.export.fileName"),
            sheetName: t("clients.export.sheet"),
            columns: [
              { header: t("clients.columns.name"), value: (r) => r.name },
              { header: t("clients.form.phone"), value: (r) => r.phone ?? "" },
              { header: t("clients.form.email"), value: (r) => r.email ?? "" },
              {
                header: t("clients.columns.deals"),
                value: (r) => r.deals_count,
              },
              {
                header: t("clients.columns.received"),
                value: (r) => moneyMap(r.received, "en"),
              },
              {
                header: t("clients.columns.outstanding"),
                value: (r) => moneyMap(r.outstanding, "en"),
              },
              {
                header: t("clients.columns.lastPaid"),
                value: (r) => r.last_paid_on ?? "",
              },
              { header: t("clients.form.notes"), value: (r) => r.notes ?? "" },
            ],
          }}
        />
      </section>

      <ClientFormModal
        open={creating || editing !== null}
        client={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          setRefreshToken((n) => n + 1);
        }}
        onDeleted={() => {
          setEditing(null);
          setRefreshToken((n) => n + 1);
        }}
      />
    </div>
  );
}
