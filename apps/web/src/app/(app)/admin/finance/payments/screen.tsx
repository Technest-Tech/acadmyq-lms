"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import {
  errorMessage,
  formatDay,
  formatMonth,
  money,
  recentMonths,
} from "@/components/finance/finance-format";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  FINANCE_CURRENCIES,
  FINANCE_KINDS,
  FINANCE_METHODS,
  FINANCE_SERVICES,
  deleteFinancePayment,
  listFinancePayments,
  type DataTableQuery,
  type FinanceLedgerRow,
  type FinanceSum,
} from "@/lib/api";

/**
 * The cross-deal ledger. Recording happens on a deal (a payment IS money against a deal); this
 * screen answers "what came in this month / by InstaPay / for course sites" and lets a mistaken
 * entry be removed from the same list it was spotted on. The sums under the table cover the whole
 * filtered set, not the visible page.
 */
export function FinancePaymentsScreen() {
  const t = useTranslations("finance");
  const locale = useLocale();
  const toast = useToast();
  const [sums, setSums] = useState<FinanceSum[] | null>(null);
  const [confirm, setConfirm] = useState<FinanceLedgerRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const months = useMemo(() => recentMonths(24), []);

  const fetcher = useCallback(async (q: DataTableQuery) => {
    const result = await listFinancePayments(q);
    setSums(result.sums);
    return result;
  }, []);

  async function remove() {
    if (!confirm) return;
    setBusy(true);
    try {
      await deleteFinancePayment(confirm.id);
      toast.success(t("deal.paymentDeleted"));
      setConfirm(null);
      setRefreshToken((n) => n + 1);
    } catch (e) {
      toast.error(errorMessage(e, t("form.errors.generic")));
    } finally {
      setBusy(false);
    }
  }

  const columns: ColumnDef<FinanceLedgerRow>[] = useMemo(
    () => [
      {
        key: "paid_on",
        header: t("payments.columns.paidOn"),
        sortKey: "paid_on",
        render: (row) => (
          <span className="text-sm">{formatDay(row.paid_on, locale)}</span>
        ),
      },
      {
        key: "client_name",
        header: t("payments.columns.client"),
        sortKey: "client_name",
        render: (row) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.client_name}</p>
            <Link
              href={`/admin/finance/deals/${row.deal_id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:text-primary block truncate text-xs"
            >
              {row.deal_title}
            </Link>
          </div>
        ),
      },
      {
        key: "service",
        header: t("payments.columns.service"),
        hideOnCard: true,
        render: (row) => (
          <span className="text-sm">{t(`service.${row.service}`)}</span>
        ),
      },
      {
        key: "amount_minor",
        header: t("payments.columns.amount"),
        sortKey: "amount_minor",
        render: (row) => (
          <span
            className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
            dir="ltr"
          >
            +{money(row.amount_minor, row.currency, locale)}
          </span>
        ),
      },
      {
        key: "method",
        header: t("payments.columns.method"),
        sortKey: "method",
        render: (row) => (
          <span className="text-sm">{t(`method.${row.method}`)}</span>
        ),
      },
      {
        key: "reference",
        header: t("payments.columns.reference"),
        hideOnCard: true,
        render: (row) => (
          <span className="text-muted-foreground text-xs" dir="ltr">
            {row.reference ?? "—"}
          </span>
        ),
      },
      {
        key: "note",
        header: t("payments.columns.note"),
        hideOnCard: true,
        render: (row) => (
          <span className="text-muted-foreground block max-w-56 truncate text-xs">
            {row.note ?? ""}
          </span>
        ),
      },
    ],
    [t, locale],
  );

  const totalCount = (sums ?? []).reduce((n, s) => n + s.payments, 0);

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t("title")} subtitle={t("payments.subtitle")} />
      <FinanceTabs />

      <section className="bg-card overflow-hidden rounded-2xl border p-4 shadow-sm">
        <DataTable<FinanceLedgerRow>
          fetcher={fetcher}
          columns={columns}
          getRowId={(row) => row.id}
          searchPlaceholder={t("payments.searchPlaceholder")}
          emptyMessage={t("payments.empty")}
          defaultSort="-paid_on"
          refreshToken={refreshToken}
          testId="finance-payments-table"
          rowActions={(row) => (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                setConfirm(row);
              }}
              aria-label={t("deal.deletePayment")}
            >
              <Trash2 />
            </Button>
          )}
          filters={[
            {
              key: "month",
              label: t("payments.filters.month"),
              options: months.map((m) => ({
                value: m,
                label: formatMonth(m, locale),
              })),
            },
            {
              key: "method",
              label: t("payments.filters.method"),
              options: FINANCE_METHODS.map((m) => ({
                value: m,
                label: t(`method.${m}`),
              })),
            },
            {
              key: "service",
              label: t("payments.filters.service"),
              options: FINANCE_SERVICES.map((s) => ({
                value: s,
                label: t(`service.${s}`),
              })),
            },
            {
              key: "kind",
              label: t("payments.filters.kind"),
              options: FINANCE_KINDS.map((k) => ({
                value: k,
                label: t(`kind.${k}`),
              })),
            },
            {
              key: "currency",
              label: t("payments.filters.currency"),
              options: FINANCE_CURRENCIES.map((c) => ({ value: c, label: c })),
            },
          ]}
          exportConfig={{
            fileName: t("payments.export.fileName"),
            sheetName: t("payments.export.sheet"),
            columns: [
              { header: t("payments.columns.paidOn"), value: (r) => r.paid_on },
              {
                header: t("payments.columns.client"),
                value: (r) => r.client_name,
              },
              {
                header: t("payments.columns.deal"),
                value: (r) => r.deal_title,
              },
              {
                header: t("payments.columns.service"),
                value: (r) => t(`service.${r.service}`),
              },
              {
                header: t("deals.columns.kind"),
                value: (r) => t(`kind.${r.kind}`),
              },
              { header: t("deals.columns.currency"), value: (r) => r.currency },
              {
                header: t("payments.columns.amount"),
                value: (r) => r.amount_minor / 100,
              },
              {
                header: t("payments.columns.method"),
                value: (r) => t(`method.${r.method}`),
              },
              {
                header: t("payments.columns.reference"),
                value: (r) => r.reference ?? "",
              },
              {
                header: t("payments.columns.note"),
                value: (r) => r.note ?? "",
              },
            ],
          }}
        />
        {sums ? (
          <p
            className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
            data-testid="finance-sums"
          >
            <span>{t("payments.sums", { count: totalCount })}</span>
            {sums.map((s) => (
              <span
                key={s.currency}
                className="text-foreground font-semibold tabular-nums"
                dir="ltr"
              >
                {money(s.amount_minor, s.currency, locale)}
              </span>
            ))}
          </p>
        ) : null}
      </section>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={t("deal.confirmTitle")}
        size="sm"
        closeLabel={t("actions.close")}
        footer={
          <div className="flex gap-2">
            <Button variant="destructive" onClick={remove} disabled={busy}>
              {t("deal.deletePayment")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirm(null)}
              disabled={busy}
            >
              {t("actions.cancel")}
            </Button>
          </div>
        }
      >
        <p className="text-sm">{t("deal.confirmDeletePayment")}</p>
        {confirm ? (
          <p className="text-muted-foreground mt-2 text-xs">
            {confirm.client_name} · {confirm.deal_title} ·{" "}
            <span dir="ltr">
              {money(confirm.amount_minor, confirm.currency, locale)}
            </span>{" "}
            · {formatDay(confirm.paid_on, locale)}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
