"use client";

import {
  AlertTriangle,
  CalendarDays,
  Coins,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatTile } from "@/components/admin/stat-tile";
import { StatusChip } from "@/components/admin/status-chip";
import { TableCard, TR_HEAD, Td, Th } from "@/components/admin/table";
import { DealFormModal } from "@/components/finance/deal-form-modal";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import {
  DEAL_TONE,
  INSTALLMENT_TONE,
  daysBetween,
  errorMessage,
  formatDay,
  fromMinor,
  money,
  todayIso,
} from "@/components/finance/finance-format";
import {
  InstallmentsEditor,
  draftsToInput,
  newDraft,
  type InstallmentDraft,
} from "@/components/finance/installments-editor";
import { PaymentFormModal } from "@/components/finance/payment-form-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  deleteFinanceDeal,
  deleteFinancePayment,
  getFinanceDeal,
  replaceFinanceSchedule,
  type FinanceDealPayload,
} from "@/lib/api";
import { formatLocalDateTime } from "@/lib/time";

/**
 * One deal: the schedule with the waterfall applied (paid / remaining / status per installment),
 * every payment against it, and the verbs — record a payment, edit the deal's facts, rewrite the
 * schedule, delete. The API returns the whole page payload after every write, so the screen
 * never computes money itself; it just re-renders what the ledger says.
 */
export function FinanceDealScreen({ dealId }: { dealId: string }) {
  const t = useTranslations("finance");
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<FinanceDealPayload | null>(null);
  const [error, setError] = useState<"missing" | "failed" | null>(null);
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [confirmDeal, setConfirmDeal] = useState(false);
  const [confirmPayment, setConfirmPayment] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = useMemo(() => todayIso(), []);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getFinanceDeal(dealId));
    } catch (e) {
      setError(
        (e as { status?: number }).status === 404 ? "missing" : "failed",
      );
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeDeal() {
    setBusy(true);
    try {
      await deleteFinanceDeal(dealId);
      toast.success(t("deal.deleted"));
      router.push("/admin/finance/deals");
    } catch (e) {
      toast.error(errorMessage(e, t("form.errors.generic")));
      setBusy(false);
    }
  }

  async function removePayment(id: string) {
    setBusy(true);
    try {
      await deleteFinancePayment(id);
      toast.success(t("deal.paymentDeleted"));
      setConfirmPayment(null);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, t("form.errors.generic")));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-5">
        <AdminPageHeader
          title={t("title")}
          backHref="/admin/finance/deals"
          backLabel={t("deal.back")}
        />
        <EmptyState
          icon={AlertTriangle}
          message={error === "missing" ? t("deal.notFound") : t("deal.error")}
          action={
            error === "failed" ? (
              <Button variant="outline" size="sm" onClick={load}>
                {t("common.retry")}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const deal = data?.deal ?? null;
  const nextDays = deal?.next_due_on
    ? daysBetween(today, deal.next_due_on)
    : null;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        backHref="/admin/finance/deals"
        backLabel={t("deal.back")}
        title={deal?.title ?? "…"}
        subtitle={
          deal ? (
            <>
              {deal.client_name} · {t(`service.${deal.service}`)}
              {deal.kind === "SUBSCRIPTION" && deal.billing_interval
                ? ` · ${t(`interval.${deal.billing_interval}`)}`
                : ""}
            </>
          ) : undefined
        }
        titleExtra={
          deal ? (
            <>
              <StatusChip tone={DEAL_TONE[deal.status]} dot>
                {t(`dealStatus.${deal.status}`)}
              </StatusChip>
              <StatusChip
                tone={deal.kind === "SUBSCRIPTION" ? "accent" : "neutral"}
              >
                {t(`kind.${deal.kind}`)}
              </StatusChip>
            </>
          ) : undefined
        }
        actions={
          deal ? (
            <>
              <Button variant="outline" onClick={() => setScheduling(true)}>
                <CalendarDays data-icon="inline-start" />
                {t("actions.editSchedule")}
              </Button>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil data-icon="inline-start" />
                {t("actions.edit")}
              </Button>
              <Button onClick={() => setPaying(true)}>
                <Coins data-icon="inline-start" />
                {t("actions.recordPayment")}
              </Button>
            </>
          ) : undefined
        }
      />
      <FinanceTabs />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={
            deal?.kind === "SUBSCRIPTION"
              ? t("deal.tiles.cyclePrice")
              : t("deal.tiles.total")
          }
          value={deal ? money(deal.amount_minor, deal.currency, locale) : ""}
          sub={
            deal && deal.kind === "SUBSCRIPTION"
              ? `${t("deal.tiles.total")}: ${money(deal.scheduled_minor, deal.currency, locale)}`
              : undefined
          }
          loading={!deal}
        />
        <StatTile
          label={t("deal.tiles.paid")}
          value={deal ? money(deal.paid_minor, deal.currency, locale) : ""}
          sub={
            deal?.last_paid_on
              ? formatDay(deal.last_paid_on, locale)
              : undefined
          }
          loading={!deal}
        />
        <StatTile
          label={t("deal.tiles.outstanding")}
          value={
            deal ? money(deal.outstanding_minor, deal.currency, locale) : ""
          }
          sub={
            deal && deal.overdue_minor > 0
              ? t("overview.overdue", {
                  amount: money(deal.overdue_minor, deal.currency, locale),
                })
              : undefined
          }
          subTone="crit"
          loading={!deal}
        />
        <StatTile
          label={t("deal.tiles.nextDue")}
          value={
            deal?.next_due_on
              ? formatDay(deal.next_due_on, locale)
              : t("deal.tiles.nothingDue")
          }
          sub={
            deal?.next_due_on && nextDays !== null
              ? `${money(deal.next_due_minor, deal.currency, locale)} · ${
                  nextDays < 0
                    ? t("common.daysAgo", { count: Math.abs(nextDays) })
                    : t("common.inDays", { count: nextDays })
                }`
              : undefined
          }
          subTone={
            nextDays !== null && nextDays < 0
              ? "crit"
              : nextDays !== null && nextDays <= 7
                ? "warn"
                : "neutral"
          }
          loading={!deal}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <section className="space-y-2">
            <div>
              <h2 className="text-sm font-semibold">{t("deal.schedule")}</h2>
              <p className="text-muted-foreground text-xs">
                {t("deal.scheduleHint")}
              </p>
            </div>
            <TableCard testId="finance-schedule">
              <table className="w-full text-sm">
                <thead>
                  <tr className={TR_HEAD}>
                    <Th className="w-10">{t("deal.columns.seq")}</Th>
                    <Th>{t("deal.columns.dueOn")}</Th>
                    <Th>{t("deal.columns.amount")}</Th>
                    <Th>{t("deal.columns.paid")}</Th>
                    <Th>{t("deal.columns.remaining")}</Th>
                    <Th>{t("deal.columns.status")}</Th>
                    <Th>{t("deal.columns.note")}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(data?.schedule ?? []).map((row) => (
                    <tr key={row.id}>
                      <Td className="text-muted-foreground tabular-nums">
                        {row.seq}
                      </Td>
                      <Td>{formatDay(row.due_on, locale)}</Td>
                      <Td className="tabular-nums">
                        <span dir="ltr">
                          {deal
                            ? money(row.amount_minor, deal.currency, locale)
                            : ""}
                        </span>
                      </Td>
                      <Td className="tabular-nums">
                        <span dir="ltr">
                          {deal
                            ? money(row.paid_minor, deal.currency, locale)
                            : ""}
                        </span>
                      </Td>
                      <Td className="font-semibold tabular-nums">
                        <span dir="ltr">
                          {deal
                            ? money(row.remaining_minor, deal.currency, locale)
                            : ""}
                        </span>
                      </Td>
                      <Td>
                        <StatusChip tone={INSTALLMENT_TONE[row.status]} dot>
                          {t(`installmentStatus.${row.status}`)}
                        </StatusChip>
                      </Td>
                      <Td className="text-muted-foreground max-w-48 truncate text-xs">
                        {row.note ?? ""}
                      </Td>
                    </tr>
                  ))}
                  {data && data.schedule.length === 0 ? (
                    <tr>
                      <Td
                        colSpan={7}
                        className="text-muted-foreground text-center"
                      >
                        {t("deal.scheduleEmpty")}
                      </Td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </TableCard>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t("deal.payments")}</h2>
            <TableCard testId="finance-payments">
              <table className="w-full text-sm">
                <thead>
                  <tr className={TR_HEAD}>
                    <Th>{t("deal.columns.paidOn")}</Th>
                    <Th>{t("deal.columns.amount")}</Th>
                    <Th>{t("deal.columns.method")}</Th>
                    <Th>{t("deal.columns.reference")}</Th>
                    <Th>{t("deal.columns.note")}</Th>
                    <Th className="w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(data?.payments ?? []).map((p) => (
                    <tr key={p.id}>
                      <Td>{formatDay(p.paid_on, locale)}</Td>
                      <Td className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                        <span dir="ltr">
                          +
                          {deal
                            ? money(p.amount_minor, deal.currency, locale)
                            : ""}
                        </span>
                      </Td>
                      <Td>{t(`method.${p.method}`)}</Td>
                      <Td className="text-muted-foreground text-xs">
                        <span dir="ltr">{p.reference ?? "—"}</span>
                      </Td>
                      <Td className="text-muted-foreground max-w-48 truncate text-xs">
                        {p.note ?? ""}
                      </Td>
                      <Td>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setConfirmPayment(p.id)}
                          aria-label={t("deal.deletePayment")}
                        >
                          <Trash2 />
                        </Button>
                      </Td>
                    </tr>
                  ))}
                  {data && data.payments.length === 0 ? (
                    <tr>
                      <Td
                        colSpan={6}
                        className="text-muted-foreground text-center"
                      >
                        {t("deal.paymentsEmpty")}
                      </Td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </TableCard>
          </section>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("deal.client")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-medium">{deal?.client_name}</p>
              {data?.client?.phone ? (
                <p className="text-muted-foreground" dir="ltr">
                  {data.client.phone}
                </p>
              ) : null}
              {data?.client?.email ? (
                <p className="text-muted-foreground" dir="ltr">
                  {data.client.email}
                </p>
              ) : null}
              {deal ? (
                <Link
                  href={`/admin/finance/deals?client=${deal.client_id}`}
                  className="text-primary block pt-1 text-xs font-medium"
                >
                  {t("clients.form.viewDeals")}
                </Link>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("deal.notes")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="whitespace-pre-wrap">{deal?.notes ?? "—"}</p>
              <dl className="text-muted-foreground grid grid-cols-2 gap-1 text-xs">
                <dt>{t("deal.started")}</dt>
                <dd>{deal ? formatDay(deal.started_on, locale) : ""}</dd>
                <dt>{t("deal.created")}</dt>
                <dd>
                  {deal ? formatLocalDateTime(deal.created_at, locale) : ""}
                </dd>
              </dl>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => setConfirmDeal(true)}
              >
                <Trash2 data-icon="inline-start" />
                {t("actions.delete")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <PaymentFormModal
        open={paying}
        deal={deal}
        onClose={() => setPaying(false)}
        onSaved={(payload) => {
          setPaying(false);
          setData(payload);
        }}
      />
      <DealFormModal
        open={editing}
        deal={deal}
        onClose={() => setEditing(false)}
        onSaved={(payload) => {
          setEditing(false);
          setData(payload);
        }}
      />
      {data ? (
        <ScheduleModal
          open={scheduling}
          payload={data}
          onClose={() => setScheduling(false)}
          onSaved={(payload) => {
            setScheduling(false);
            setData(payload);
          }}
        />
      ) : null}

      <Modal
        open={confirmDeal}
        onClose={() => setConfirmDeal(false)}
        title={t("deal.confirmTitle")}
        size="sm"
        closeLabel={t("actions.close")}
        footer={
          <div className="flex gap-2">
            <Button variant="destructive" onClick={removeDeal} disabled={busy}>
              {t("actions.delete")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmDeal(false)}
              disabled={busy}
            >
              {t("actions.cancel")}
            </Button>
          </div>
        }
      >
        <p className="text-sm">{t("deal.confirmDelete")}</p>
      </Modal>

      <Modal
        open={confirmPayment !== null}
        onClose={() => setConfirmPayment(null)}
        title={t("deal.confirmTitle")}
        size="sm"
        closeLabel={t("actions.close")}
        footer={
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={() => confirmPayment && removePayment(confirmPayment)}
              disabled={busy}
            >
              {t("deal.deletePayment")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmPayment(null)}
              disabled={busy}
            >
              {t("actions.cancel")}
            </Button>
          </div>
        }
      >
        <p className="text-sm">{t("deal.confirmDeletePayment")}</p>
      </Modal>
    </div>
  );
}

/** Rewrite the installment plan; payments stay and re-flow over the new plan. */
function ScheduleModal({
  open,
  payload,
  onClose,
  onSaved,
}: {
  open: boolean;
  payload: FinanceDealPayload;
  onClose: () => void;
  onSaved: (payload: FinanceDealPayload) => void;
}) {
  const t = useTranslations("finance");
  const [rows, setRows] = useState<InstallmentDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(
      payload.schedule.map((s) =>
        newDraft(s.due_on, fromMinor(s.amount_minor), s.note ?? ""),
      ),
    );
    setError(null);
    setSaving(false);
  }, [open, payload]);

  async function save() {
    const input = draftsToInput(rows);
    if (!input || input.length === 0) {
      setError(t("form.errors.plan"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await replaceFinanceSchedule(payload.deal.id, input));
    } catch (e) {
      setError(errorMessage(e, t("form.errors.generic")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("schedule.title")}
      description={t("schedule.hint")}
      size="lg"
      closeLabel={t("actions.close")}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? t("actions.saving") : t("actions.save")}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("actions.cancel")}
          </Button>
          {error ? (
            <span role="alert" className="text-destructive basis-full text-xs">
              {error}
            </span>
          ) : null}
        </div>
      }
    >
      <InstallmentsEditor
        rows={rows}
        onChange={setRows}
        currency={payload.deal.currency}
        startedOn={payload.deal.started_on}
        totalMinor={
          payload.deal.kind === "ONE_TIME" ? payload.deal.amount_minor : null
        }
      />
    </Modal>
  );
}
