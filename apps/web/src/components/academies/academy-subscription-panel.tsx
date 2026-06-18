"use client";

import {
  CalendarClock,
  CreditCard,
  Hourglass,
  ImageIcon,
  Receipt,
  Send,
  Sparkles,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  activateAcademySubscription,
  extendAcademyTrial,
  fetchPaymentScreenshot,
  generateAcademyBill,
  getAcademySubscription,
  listAcademyBills,
  listBillSubmissions,
  markAcademyBillPaid,
  reviewPaymentSubmission,
  sendAcademyBill,
  setAcademyBillStatus,
  type AcademyBill,
  type AcademyPaymentSubmission,
  type AcademySubscriptionView,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";

const BILL_STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  OVERDUE: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  VOID: "bg-muted text-muted-foreground",
};

const cardClass =
  "bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]";

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

/**
 * Per-academy SaaS subscription panel (Super Admin). Shows the trial window + countdown, the
 * activation/period dates, and the snapshot total cost (plan base + active add-ons), with actions
 * to extend the trial or convert it to a paid subscription. Gated by `academy_billing.manage`
 * (the server Gate is the real control; this is UX only).
 */
export function AcademySubscriptionPanel({
  academyId,
  onChanged,
}: {
  academyId: string;
  onChanged?: () => void;
}) {
  const t = useTranslations("academySubscription");
  const locale = useLocale();
  const { can } = useAuth();
  const toast = useToast();

  const [data, setData] = useState<AcademySubscriptionView | null>(null);
  const [bills, setBills] = useState<AcademyBill[]>([]);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(14);
  const [openBill, setOpenBill] = useState<string | null>(null);
  const [subs, setSubs] = useState<Record<string, AcademyPaymentSubmission[]>>(
    {},
  );

  const load = useCallback(async () => {
    const [view, billList] = await Promise.all([
      getAcademySubscription(academyId),
      listAcademyBills(academyId),
    ]);
    setData(view);
    setBills(billList.bills);
  }, [academyId]);

  useEffect(() => {
    if (can("academy_billing.manage")) void load();
  }, [load, can]);

  if (!can("academy_billing.manage")) return null;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      await load();
      onChanged?.();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function send(billId: string) {
    setBusy(true);
    try {
      const res = await sendAcademyBill(academyId, billId);
      // No Wasender token yet → open the wa.me deep link for the operator to send manually.
      if (res.transport === "DEEPLINK" && res.deeplink) {
        window.open(res.deeplink, "_blank", "noopener");
        toast.info(t("bill.deeplinkOpened"));
      } else {
        toast.success(t("bill.sent"));
      }
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleProofs(billId: string) {
    if (openBill === billId) {
      setOpenBill(null);
      return;
    }
    setOpenBill(billId);
    try {
      const res = await listBillSubmissions(academyId, billId);
      setSubs((s) => ({ ...s, [billId]: res.submissions }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function review(
    billId: string,
    subId: string,
    decision: "approve" | "reject",
  ) {
    await run(
      () => reviewPaymentSubmission(academyId, subId, decision),
      decision === "approve" ? t("proof.approved") : t("proof.rejected"),
    );
    const res = await listBillSubmissions(academyId, billId);
    setSubs((s) => ({ ...s, [billId]: res.submissions }));
  }

  async function viewShot(subId: string) {
    try {
      const url = await fetchPaymentScreenshot(academyId, subId);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    }
  }

  if (data === null) {
    return (
      <section className={cardClass} data-testid="academy-subscription-panel">
        <div className="bg-muted h-40 animate-pulse rounded-xl" aria-hidden />
      </section>
    );
  }

  const sub = data.subscription;
  const money = (minor: number) =>
    formatMoney({ amount: minor, currency: sub.currency }, locale);
  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(locale === "ar" ? "ar" : locale, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "—";
  const trialDays = sub.is_trial ? daysUntil(sub.trial_end) : null;

  return (
    <section className={cardClass} data-testid="academy-subscription-panel">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <CreditCard className="text-muted-foreground size-4" aria-hidden />
        {t("title")}
      </h2>

      {/* Status / trial banner */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span
          data-testid="sub-state"
          className={
            sub.is_trial
              ? "inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300"
              : "inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300"
          }
        >
          {sub.is_trial ? (
            <Hourglass className="size-3" aria-hidden />
          ) : (
            <Sparkles className="size-3" aria-hidden />
          )}
          {sub.is_trial ? t("trial") : t(`status.${sub.status}`)}
        </span>
        {trialDays !== null && (
          <span
            data-testid="trial-countdown"
            className="text-muted-foreground text-xs"
          >
            {trialDays > 0
              ? t("trialDaysLeft", { days: trialDays })
              : t("trialExpired")}
          </span>
        )}
      </div>

      {/* Cost breakdown */}
      <dl className="mb-4 space-y-1.5 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">{t("plan")}</dt>
          <dd className="font-medium">
            {data.plan ? data.plan.name : t("noPlan")}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">{t("basePrice")}</dt>
          <dd className="font-medium" dir="ltr">
            {money(sub.base_price_minor)}
          </dd>
        </div>
        {sub.addons_price_minor > 0 && (
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">{t("addOns")}</dt>
            <dd className="font-medium" dir="ltr">
              {money(sub.addons_price_minor)}
            </dd>
          </div>
        )}
        <div className="flex items-center justify-between border-t pt-1.5">
          <dt className="font-semibold">{t("totalCost")}</dt>
          <dd className="text-primary font-bold" dir="ltr" data-testid="total-cost">
            {money(sub.total_cost_minor)}
            <span className="text-muted-foreground ms-1 text-xs font-normal">
              /{t(`interval.${sub.billing_interval}`)}
            </span>
          </dd>
        </div>
      </dl>

      {/* Dates */}
      <div className="mb-4 grid grid-cols-2 gap-3 border-t pt-4 text-sm">
        <div>
          <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
            {sub.is_trial ? t("trialEnds") : t("activatedAt")}
          </p>
          <p className="flex items-center gap-1 font-semibold">
            <CalendarClock className="text-muted-foreground size-3.5" aria-hidden />
            {fmtDate(sub.is_trial ? sub.trial_end : sub.activated_at)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
            {t("periodEnds")}
          </p>
          <p className="flex items-center gap-1 font-semibold">
            <CalendarClock className="text-muted-foreground size-3.5" aria-hidden />
            {fmtDate(sub.current_period_end)}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-end gap-3 border-t pt-4">
        <label className="space-y-1">
          <span className="text-muted-foreground text-xs">{t("extendDays")}</span>
          <input
            type="number"
            min={1}
            max={365}
            aria-label={t("extendDays")}
            className="border-input bg-background w-20 rounded-md border px-2 py-1.5 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(() => extendAcademyTrial(academyId, days), t("trialExtended"))
          }
          data-testid="extend-trial"
        >
          {t("extendTrial")}
        </Button>
        {sub.is_trial && (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(
                () => activateAcademySubscription(academyId),
                t("activated"),
              )
            }
            data-testid="activate-subscription"
          >
            {t("activate")}
          </Button>
        )}
      </div>

      {/* Bills */}
      <div className="mt-5 border-t pt-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Receipt className="text-muted-foreground size-4" aria-hidden />
            {t("bill.title")}
          </h3>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={busy || sub.is_trial}
            title={sub.is_trial ? t("bill.trialHint") : undefined}
            onClick={() =>
              void run(
                () => generateAcademyBill(academyId),
                t("bill.generated"),
              )
            }
            data-testid="generate-bill"
          >
            {t("bill.generate")}
          </Button>
        </div>

        {bills.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("bill.none")}</p>
        ) : (
          <ul className="space-y-2" data-testid="bills-list">
            {bills.map((b) => (
              <li
                key={b.id}
                className="bg-muted/30 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2"
                data-bill={b.id}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span dir="ltr">
                      {formatMoney({ amount: b.total_minor, currency: b.currency }, locale)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BILL_STATUS_STYLE[b.status] ?? "bg-muted"}`}
                    >
                      {t(`bill.status.${b.status}`)}
                    </span>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {b.period_start} → {b.period_end} · {t("bill.due")}{" "}
                    {b.due_date}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void send(b.id)}
                    data-testid={`send-bill-${b.id}`}
                  >
                    <Send className="size-3" aria-hidden />
                    {t("bill.send")}
                  </Button>
                  {b.status !== "PAID" && b.status !== "VOID" && (
                    <Button
                      type="button"
                      size="xs"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            markAcademyBillPaid(academyId, b.id, {
                              method: "MANUAL",
                            }),
                          t("bill.markedPaid"),
                        )
                      }
                      data-testid={`mark-paid-${b.id}`}
                    >
                      {t("bill.markPaid")}
                    </Button>
                  )}
                  {b.status !== "VOID" && b.status !== "PAID" && (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => setAcademyBillStatus(academyId, b.id, "VOID"),
                          t("bill.voided"),
                        )
                      }
                    >
                      {t("bill.void")}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => void toggleProofs(b.id)}
                    data-testid={`proofs-${b.id}`}
                  >
                    {t("proof.title")}
                  </Button>
                </div>

                {openBill === b.id && (
                  <div className="mt-1 w-full border-t pt-2">
                    {(subs[b.id] ?? []).length === 0 ? (
                      <p className="text-muted-foreground text-xs">
                        {t("proof.none")}
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {(subs[b.id] ?? []).map((s) => (
                          <li
                            key={s.id}
                            className="flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <span className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void viewShot(s.id)}
                                className="text-primary inline-flex items-center gap-1 hover:underline"
                              >
                                <ImageIcon className="size-3" aria-hidden />
                                {s.method}
                              </button>
                              <span className="text-muted-foreground">
                                {t(`proof.status.${s.review_status}`)}
                              </span>
                            </span>
                            {s.review_status === "PENDING" && (
                              <span className="flex items-center gap-1.5">
                                <Button
                                  type="button"
                                  size="xs"
                                  disabled={busy}
                                  onClick={() =>
                                    void review(b.id, s.id, "approve")
                                  }
                                >
                                  {t("proof.approve")}
                                </Button>
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="ghost"
                                  disabled={busy}
                                  onClick={() =>
                                    void review(b.id, s.id, "reject")
                                  }
                                >
                                  {t("proof.reject")}
                                </Button>
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
