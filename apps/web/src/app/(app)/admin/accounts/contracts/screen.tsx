"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatusChip } from "@/components/admin/status-chip";
import { accountHref, discountPct, PLAN_TONE, recurringOf, sumLabel } from "@/components/finance/account-format";
import { AccountsTabs } from "@/components/finance/accounts-tabs";
import { AgreementFormModal } from "@/components/finance/agreement-form-modal";
import { dueTone, formatDay, money, todayIso } from "@/components/finance/finance-format";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { ACCOUNT_PLANS, listFinanceClients, type DataTableQuery, type FinanceClientRow } from "@/lib/api";
import { cn } from "@/lib/utils";

const NEW_CLIENT = { kind: "new" } as const;

/**
 * Accounts → Contracts: every client that pays, one row each — on our servers or not — with the
 * agreement as one chip, what it costs per cycle (and the discount), the next due date and what is
 * late. A row opens where that client's money lives: the client page's Subscription tab for a
 * platform client, the account page for anyone else.
 */
export function AccountsContractsScreen() {
  const t = useTranslations("accounts.contracts");
  const ta = useTranslations("accounts");
  const tg = useTranslations("accounts.agreement");
  const tf = useTranslations("finance");
  const locale = useLocale();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const today = todayIso();

  const fetcher = useCallback((q: DataTableQuery) => listFinanceClients(q), []);

  const columns: ColumnDef<FinanceClientRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: t("columns.client"),
        sortKey: "name",
        render: (row) => (
          <div className="min-w-0">
            <p className="font-semibold break-words">{row.academy_name ?? row.name}</p>
            <p className="text-muted-foreground text-xs">{row.academy_id ? t("hosted") : t("external")}</p>
          </div>
        ),
      },
      {
        key: "plan",
        header: t("columns.agreement"),
        render: (row) =>
          row.plan ? (
            <StatusChip tone={PLAN_TONE[row.plan]}>{tg(`plan.${row.plan}`)}</StatusChip>
          ) : (
            <span className="text-muted-foreground text-xs">{t("noAgreement")}</span>
          ),
      },
      {
        key: "rec_amount_minor",
        header: t("columns.pays"),
        sortKey: "rec_amount_minor",
        render: (row) => {
          const rec = recurringOf(row);
          if (!rec) return <span className="text-muted-foreground text-sm">—</span>;
          const pct = discountPct(rec.amount, rec.list);
          return (
            <div>
              <p className="text-sm font-semibold tabular-nums">
                {money(rec.amount, rec.currency, locale)} / {tf(`intervalShort.${rec.interval}`)}
              </p>
              {pct !== null && <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{t("off", { pct })}</p>}
            </div>
          );
        },
      },
      {
        key: "next_due_on",
        header: t("columns.next"),
        sortKey: "next_due_on",
        render: (row) => {
          if (!row.next_due_on) return <span className="text-muted-foreground text-sm">—</span>;
          const tone = dueTone(row.next_due_on, today);
          return (
            <div>
              <p className={cn("text-sm tabular-nums", tone === "crit" && "text-rose-600 dark:text-rose-400", tone === "warn" && "text-amber-600 dark:text-amber-400")}>
                {formatDay(row.next_due_on, locale)}
              </p>
              {row.next_due_minor ? (
                <p className="text-muted-foreground text-xs tabular-nums">{money(row.next_due_minor, row.next_due_currency ?? "EGP", locale)}</p>
              ) : null}
            </div>
          );
        },
      },
      {
        key: "overdue",
        header: t("columns.late"),
        render: (row) => {
          const late = sumLabel(row.overdue, locale);
          return late ? (
            <span className="text-sm font-semibold text-rose-600 tabular-nums dark:text-rose-400">{late}</span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          );
        },
      },
      {
        key: "received",
        header: t("columns.received"),
        hideOnCard: true,
        render: (row) => <span className="text-sm tabular-nums">{sumLabel(row.received, locale) || "—"}</span>,
      },
    ],
    [t, tg, tf, locale, today],
  );

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={ta("title")}
        subtitle={t("subtitle")}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus data-icon="inline-start" />
            {ta("newExternal")}
          </Button>
        }
      />
      <AccountsTabs />

      <section className="bg-card overflow-hidden rounded-2xl border p-4 shadow-sm">
        <DataTable<FinanceClientRow>
          fetcher={fetcher}
          columns={columns}
          getRowId={(row) => row.id}
          onRowClick={(row) => router.push(accountHref(row))}
          searchPlaceholder={t("search")}
          emptyMessage={t("empty")}
          defaultSort="name"
          refreshToken={refreshToken}
          testId="contracts-table"
          filters={[
            {
              key: "plan",
              label: t("filters.plan"),
              options: ACCOUNT_PLANS.map((p) => ({ value: p, label: tg(`plan.${p}`) })),
            },
            {
              key: "hosted",
              label: t("filters.where"),
              options: [
                { value: "1", label: t("hosted") },
                { value: "0", label: t("external") },
              ],
            },
            {
              key: "overdue",
              label: t("filters.late"),
              options: [{ value: "1", label: t("filters.lateOnly") }],
            },
          ]}
          exportConfig={{
            fileName: t("export.file"),
            sheetName: t("export.sheet"),
            columns: [
              { header: t("columns.client"), value: (r) => r.academy_name ?? r.name },
              { header: t("columns.agreement"), value: (r) => (r.plan ? tg(`plan.${r.plan}`) : "") },
              {
                header: t("columns.pays"),
                value: (r) => {
                  const rec = recurringOf(r);
                  return rec ? `${rec.amount / 100} ${rec.currency} / ${tf(`intervalShort.${rec.interval}`)}` : "";
                },
              },
              { header: t("columns.next"), value: (r) => r.next_due_on ?? "" },
              { header: t("columns.late"), value: (r) => sumLabel(r.overdue, "en") },
              { header: t("columns.received"), value: (r) => sumLabel(r.received, "en") },
              { header: tf("clients.form.phone"), value: (r) => r.phone ?? "" },
            ],
          }}
        />
      </section>

      <AgreementFormModal
        open={creating}
        target={NEW_CLIENT}
        onClose={() => setCreating(false)}
        onSaved={(p) => {
          setCreating(false);
          setRefreshToken((n) => n + 1);
          router.push(accountHref(p.account));
        }}
      />
    </div>
  );
}
