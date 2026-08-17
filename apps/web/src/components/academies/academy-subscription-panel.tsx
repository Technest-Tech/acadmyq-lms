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
  type ModuleCode,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { daysUntil } from "@/lib/time";

/** Decode a bill's per-module composition (jsonb arrives as a string). */
function billBreakdown(
  raw: AcademyBill["module_breakdown"],
): { module: ModuleCode; total_minor: number; currency: string }[] {
  const decoded = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(decoded) ? decoded : [];
}

const BILL_STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  OVERDUE: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  VOID: "bg-muted text-muted-foreground",
};

const cardClass =
  "bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]";

/**
 * Per-academy billing panel (Super Admin): the trial window + countdown, activation/period
 * dates, the snapshot total cost (plan base + active add-ons), and the academy's bill history
 * with payment proofs. READ-ONLY over subscription state — the extend/convert actions moved to
 * the client page's Subscriptions card (one writer per fact). Gated by
 * `academy_billing.manage` (the server Gate is the real control; this is UX only).
 */
export function AcademySubscriptionPanel({
  academyId,
  onChanged,
}: {
  academyId: string;
  onChanged?: () => void;
}) {
  const t = useTranslations("academySubscription");
  const tm = useTranslations("clients.modules");
  const locale = useLocale();
  const { can } = useAuth();
  const toast = useToast();

  const [data, setData] = useState<AcademySubscriptionView | null>(null);
  const [bills, setBills] = useState<AcademyBill[]>([]);
  const [busy, setBusy] = useState(false);
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
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CreditCard className="text-muted-foreground size-4" aria-hidden />
          {t("title")}
        </h2>
        <span
          data-testid="sub-state"
          className={
            sub.is_trial
              ? "inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300"
              : "inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300"
          }
        >
          {sub.is_trial ? (
            <Hourglass className="size-3" aria-hidden />
          ) : (
            <Sparkles className="size-3" aria-hidden />
          )}
          {sub.is_trial ? t("trial") : t(`status.${sub.status}`)}
        </span>
      </div>

      {/* Trial banner — only while on the free trial */}
      {sub.is_trial && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/25">
          <Hourglass
            className="size-5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {t("trial")}
            </p>
            <p
              data-testid="trial-countdown"
              className="text-xs text-amber-700 dark:text-amber-300"
            >
              {trialDays !== null && trialDays > 0
                ? t("trialDaysLeft", { days: trialDays })
                : t("trialExpired")}
            </p>
          </div>
        </div>
      )}

      {/* Cost hero — plan + EGP total */}
      <div className="from-primary/[0.07] via-card to-card mb-4 rounded-xl border bg-gradient-to-br p-4 ring-1 ring-foreground/[0.03]">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
              {t("plan")}
            </p>
            <p className="truncate text-lg font-bold">
              {data.plan ? data.plan.name : t("noPlan")}
            </p>
          </div>
          <div className="text-end">
            <p
              className="text-primary text-2xl font-bold tabular-nums"
              dir="ltr"
              data-testid="total-cost"
            >
              {money(sub.total_cost_minor)}
            </p>
            <p className="text-muted-foreground text-xs">
              /{t(`interval.${sub.billing_interval}`)}
            </p>
          </div>
        </div>
        <dl className="mt-3 space-y-1 border-t pt-3 text-xs">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">{t("basePrice")}</dt>
            <dd className="font-medium tabular-nums" dir="ltr">
              {money(sub.base_price_minor)}
            </dd>
          </div>
          {sub.addons_price_minor > 0 && (
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">{t("addOns")}</dt>
              <dd className="font-medium tabular-nums" dir="ltr">
                {money(sub.addons_price_minor)}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Dates */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="bg-muted/30 rounded-lg px-3 py-2.5">
          <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
            {sub.is_trial ? t("trialEnds") : t("activatedAt")}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-sm font-semibold">
            <CalendarClock className="text-muted-foreground size-3.5" aria-hidden />
            {fmtDate(sub.is_trial ? sub.trial_end : sub.activated_at)}
          </p>
        </div>
        <div className="bg-muted/30 rounded-lg px-3 py-2.5">
          <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
            {t("periodEnds")}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-sm font-semibold">
            <CalendarClock className="text-muted-foreground size-3.5" aria-hidden />
            {fmtDate(sub.current_period_end)}
          </p>
        </div>
      </div>

      {/* One writer per fact (R3): trial extend / activate moved to the client page's
          Subscriptions card — this panel is the client's LEDGER (costs, bills, proofs) only. */}

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
                  {/* Per-module composition snapshot (R3, M-BILL-1) — chips, oldest bills have none. */}
                  {billBreakdown(b.module_breakdown).length > 0 && (
                    <p className="mt-1 flex flex-wrap items-center gap-1.5">
                      {billBreakdown(b.module_breakdown).map((line) => (
                        <span
                          key={line.module}
                          className="bg-card text-muted-foreground inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                          data-bill-module={line.module}
                        >
                          {tm(line.module)}
                          <span className="font-semibold tabular-nums" dir="ltr">
                            {formatMoney({ amount: line.total_minor, currency: line.currency }, locale)}
                          </span>
                        </span>
                      ))}
                    </p>
                  )}
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
