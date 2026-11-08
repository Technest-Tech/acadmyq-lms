"use client";

import { Hourglass, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { getMySubscription, type AcademySubscription } from "@/lib/api";
import { formatMoney } from "@/lib/money";

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

type MyAccount = NonNullable<Awaited<ReturnType<typeof getMySubscription>>["account"]>;

/**
 * Slim dashboard banner reflecting the academy's own standing with the platform (GET
 * /my-subscription): a free-trial countdown or an expired-trial notice, and — for the academy's
 * OWNER only (the API sends nothing to anyone else) — the subscription payment due within a week
 * or late, with the academy's one pay link. Renders nothing for a healthy, paid-up academy.
 */
export function SubscriptionBanner() {
  const t = useTranslations("academySubscription");
  const locale = useLocale();
  const [sub, setSub] = useState<AcademySubscription | null>(null);
  const [account, setAccount] = useState<MyAccount | null>(null);

  useEffect(() => {
    void getMySubscription()
      .then((r) => {
        setSub(r.subscription);
        setAccount(r.account ?? null);
      })
      .catch(() => setSub(null));
  }, []);

  const due = (account?.due_now ?? []).filter((d) => d.amount_minor > 0);
  if (account && due.length > 0 && account.pay_token) {
    const amount = due.map((d) => formatMoney({ amount: d.amount_minor, currency: d.currency }, locale, { trimZeroDecimals: true })).join(" + ");
    const tone = account.overdue
      ? "border-rose-300/50 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
      : "border-amber-300/50 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200";
    return (
      <div
        data-testid="dashboard-subscription-banner"
        className={`flex flex-wrap items-center gap-2.5 rounded-xl border px-4 py-2.5 text-sm font-medium ${tone}`}
      >
        <Wallet className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          {account.pending_proof
            ? t("proofPending")
            : account.overdue
              ? t("paymentLate", { amount })
              : t("paymentDue", { amount, date: account.next_due_on ?? "" })}
        </span>
        {!account.pending_proof && (
          <a href={`/a/${account.pay_token}`} className="font-semibold underline" data-testid="banner-pay">
            {t("pay")}
          </a>
        )}
      </div>
    );
  }

  if (sub === null) return null;

  const expired = sub.status === "PAUSED";
  const trialDays = sub.is_trial ? daysUntil(sub.trial_end) : null;

  if (!sub.is_trial && !expired) return null;

  const tone = expired
    ? "border-rose-300/50 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
    : "border-amber-300/50 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200";

  return (
    <div
      data-testid="dashboard-subscription-banner"
      className={`flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-sm font-medium ${tone}`}
    >
      <Hourglass className="size-4 shrink-0" aria-hidden />
      <span>
        {expired
          ? t("trialExpired")
          : trialDays !== null && trialDays > 0
            ? `${t("trial")} — ${t("trialDaysLeft", { days: trialDays })}`
            : t("trialExpired")}
      </span>
    </div>
  );
}
