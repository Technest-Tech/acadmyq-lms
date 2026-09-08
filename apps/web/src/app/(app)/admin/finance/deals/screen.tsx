"use client";

import { AlertTriangle, Plus, ReceiptText } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatTile } from "@/components/admin/stat-tile";
import { StatusChip } from "@/components/admin/status-chip";
import {
  DealFormModal,
  type DealFormPreset,
} from "@/components/finance/deal-form-modal";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import {
  DEAL_TONE,
  daysBetween,
  dueTone,
  formatDay,
  money,
  todayIso,
} from "@/components/finance/finance-format";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  FINANCE_CURRENCIES,
  FINANCE_DEAL_STATUSES,
  FINANCE_KINDS,
  FINANCE_SERVICES,
  listFinanceDeals,
  type DataTableQuery,
  type FinanceDealCounts,
  type FinanceDealRow,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";

/**
 * Every deal, server-driven: search, filters, sort, paging and the Excel export all happen in
 * the shared DataTable. The tiles above count the whole book (they ride along with each page)
 * and double as filters. A row opens the deal page; the only thing created here is a new deal.
 */
export function FinanceDealsScreen() {
  const t = useTranslations("finance");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const [counts, setCounts] = useState<FinanceDealCounts | null>(null);
  const [modal, setModal] = useState<DealFormPreset | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const today = useMemo(() => todayIso(), []);

  // Deep links from the overview tiles and the clients screen land as a filter preset.
  const [preset, setPreset] = useState<{
    values: Record<string, string>;
    token: number;
  }>(() => {
    const values: Record<string, string> = {};
    for (const key of ["status", "kind", "service", "currency", "overdue"]) {
      const v = params.get(key);
      if (v) values[key] = v;
    }
    const client = params.get("client");
    if (client) values.client_id = client;
    return { values, token: Object.keys(values).length > 0 ? 1 : 0 };
  });

  const fetcher = useCallback(async (q: DataTableQuery) => {
    const result = await listFinanceDeals(q);
    setCounts(result.counts);
    return result;
  }, []);

  const columns: ColumnDef<FinanceDealRow>[] = useMemo(
    () => [
      {
        key: "title",
        header: t("deals.columns.deal"),
        sortKey: "title",
        render: (row) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.title}</p>
            <p className="text-muted-foreground truncate text-xs">
              {row.client_name}
            </p>
          </div>
        ),
      },
      {
        key: "service",
        header: t("deals.columns.service"),
        hideOnCard: true,
        render: (row) => (
          <div className="min-w-0">
            <p className="truncate text-sm">{t(`service.${row.service}`)}</p>
            <p className="text-muted-foreground truncate text-xs">
              {row.kind === "SUBSCRIPTION" && row.billing_interval
                ? `${t("kind.SUBSCRIPTION")} · ${t(`interval.${row.billing_interval}`)}`
                : t("kind.ONE_TIME")}
            </p>
          </div>
        ),
      },
      {
        key: "amount_minor",
        header: t("deals.columns.amount"),
        sortKey: "amount_minor",
        render: (row) => (
          <span className="text-sm tabular-nums" dir="ltr">
            {row.kind === "SUBSCRIPTION" && row.billing_interval
              ? t("deals.perCycle", {
                  amount: money(row.amount_minor, row.currency, locale),
                  interval: t(`intervalShort.${row.billing_interval}`),
                })
              : money(row.amount_minor, row.currency, locale)}
          </span>
        ),
      },
      {
        key: "paid_minor",
        header: t("deals.columns.paid"),
        sortKey: "paid_minor",
        hideOnCard: true,
        render: (row) => {
          const pct =
            row.scheduled_minor > 0
              ? Math.min(
                  100,
                  Math.round((row.paid_minor / row.scheduled_minor) * 100),
                )
              : 0;
          return (
            <div className="min-w-24">
              <p className="text-sm tabular-nums" dir="ltr">
                {money(row.paid_minor, row.currency, locale)}
              </p>
              <div className="bg-muted mt-1 h-1 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        },
      },
      {
        key: "outstanding_minor",
        header: t("deals.columns.outstanding"),
        sortKey: "outstanding_minor",
        render: (row) => (
          <div>
            <p className="text-sm font-semibold tabular-nums" dir="ltr">
              {money(row.outstanding_minor, row.currency, locale)}
            </p>
            {row.overdue_minor > 0 && row.status === "ACTIVE" ? (
              <p className="text-xs text-rose-600 dark:text-rose-400">
                {t("overview.overdue", {
                  amount: money(row.overdue_minor, row.currency, locale),
                })}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        key: "next_due_on",
        header: t("deals.columns.nextDue"),
        sortKey: "next_due_on",
        render: (row) => {
          if (!row.next_due_on || row.status !== "ACTIVE") {
            return <span className="text-muted-foreground text-sm">—</span>;
          }
          const days = daysBetween(today, row.next_due_on);
          return (
            <div>
              <p className="text-sm">{formatDay(row.next_due_on, locale)}</p>
              <StatusChip tone={dueTone(row.next_due_on, today)} dot>
                {days < 0
                  ? t("common.daysAgo", { count: Math.abs(days) })
                  : t("common.inDays", { count: days })}
              </StatusChip>
            </div>
          );
        },
      },
      {
        key: "status",
        header: t("deals.columns.status"),
        sortKey: "status",
        render: (row) => (
          <StatusChip tone={DEAL_TONE[row.status]} dot>
            {t(`dealStatus.${row.status}`)}
          </StatusChip>
        ),
      },
    ],
    [t, locale, today],
  );

  const tile = (
    label: string,
    value: number | undefined,
    values: Record<string, string>,
    icon?: typeof ReceiptText,
  ) => (
    <button
      type="button"
      className="text-start"
      onClick={() => setPreset((p) => ({ values, token: p.token + 1 }))}
    >
      <StatTile
        label={label}
        value={formatNumber(value ?? 0, locale)}
        icon={icon}
        loading={counts === null}
      />
    </button>
  );

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={t("title")}
        subtitle={t("deals.subtitle")}
        actions={
          <>
            <Button variant="outline" onClick={() => setModal("income")}>
              {t("actions.recordIncome")}
            </Button>
            <Button onClick={() => setModal("deal")}>
              <Plus data-icon="inline-start" />
              {t("actions.newDeal")}
            </Button>
          </>
        }
      />
      <FinanceTabs />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tile(t("deals.tiles.total"), counts?.total, {}, ReceiptText)}
        {FINANCE_DEAL_STATUSES.map((s) => (
          <span key={s} className="contents">
            {tile(t(`dealStatus.${s}`), counts?.[s], { status: s })}
          </span>
        ))}
        {tile(
          t("deals.tiles.overdue"),
          counts?.overdue,
          { overdue: "1" },
          AlertTriangle,
        )}
      </div>

      <section className="bg-card overflow-hidden rounded-2xl border p-4 shadow-sm">
        <DataTable<FinanceDealRow>
          fetcher={fetcher}
          columns={columns}
          getRowId={(row) => row.id}
          onRowClick={(row) => router.push(`/admin/finance/deals/${row.id}`)}
          searchPlaceholder={t("deals.searchPlaceholder")}
          emptyMessage={t("deals.empty")}
          emptyAction={
            <Button size="sm" onClick={() => setModal("deal")}>
              <Plus data-icon="inline-start" />
              {t("actions.newDeal")}
            </Button>
          }
          defaultSort="-created_at"
          refreshToken={refreshToken}
          filterPreset={preset}
          testId="finance-deals-table"
          filters={[
            {
              key: "status",
              label: t("deals.filters.status"),
              options: FINANCE_DEAL_STATUSES.map((s) => ({
                value: s,
                label: t(`dealStatus.${s}`),
              })),
            },
            {
              key: "kind",
              label: t("deals.filters.kind"),
              options: FINANCE_KINDS.map((k) => ({
                value: k,
                label: t(`kind.${k}`),
              })),
            },
            {
              key: "service",
              label: t("deals.filters.service"),
              options: FINANCE_SERVICES.map((s) => ({
                value: s,
                label: t(`service.${s}`),
              })),
            },
            {
              key: "currency",
              label: t("deals.filters.currency"),
              options: FINANCE_CURRENCIES.map((c) => ({ value: c, label: c })),
            },
            {
              key: "overdue",
              label: t("deals.filters.overdue"),
              options: [{ value: "1", label: t("deals.filters.overdueOnly") }],
            },
            {
              key: "client_id",
              label: t("deals.columns.client"),
              options: [],
              hidden: true,
            },
          ]}
          exportConfig={{
            fileName: t("deals.export.fileName"),
            sheetName: t("deals.export.sheet"),
            columns: [
              {
                header: t("deals.columns.client"),
                value: (r) => r.client_name,
              },
              { header: t("deals.columns.deal"), value: (r) => r.title },
              {
                header: t("deals.columns.service"),
                value: (r) => t(`service.${r.service}`),
              },
              {
                header: t("deals.columns.kind"),
                value: (r) => t(`kind.${r.kind}`),
              },
              {
                header: t("deals.columns.interval"),
                value: (r) =>
                  r.billing_interval ? t(`interval.${r.billing_interval}`) : "",
              },
              { header: t("deals.columns.currency"), value: (r) => r.currency },
              {
                header: t("deals.columns.amount"),
                value: (r) => r.amount_minor / 100,
              },
              {
                header: t("deals.columns.paid"),
                value: (r) => r.paid_minor / 100,
              },
              {
                header: t("deals.columns.outstanding"),
                value: (r) => r.outstanding_minor / 100,
              },
              {
                header: t("deals.columns.started"),
                value: (r) => r.started_on,
              },
              {
                header: t("deals.columns.nextDue"),
                value: (r) => r.next_due_on ?? "",
              },
              {
                header: t("deals.columns.status"),
                value: (r) => t(`dealStatus.${r.status}`),
              },
            ],
          }}
        />
      </section>

      <DealFormModal
        open={modal !== null}
        preset={modal ?? "deal"}
        presetClientId={preset.values.client_id}
        onClose={() => setModal(null)}
        onSaved={(payload) => {
          setModal(null);
          setRefreshToken((n) => n + 1);
          router.push(`/admin/finance/deals/${payload.deal.id}`);
        }}
      />
    </div>
  );
}
