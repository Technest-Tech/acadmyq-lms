"use client";

import { Hourglass } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { getMySubscription, type AcademySubscription } from "@/lib/api";

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

/**
 * Slim dashboard banner reflecting the academy's SaaS subscription state — a free-trial countdown
 * or an expired-trial notice. Reads the owner's OWN subscription (GET /my-subscription). Renders
 * nothing for a healthy paid subscription (the plan badge already lives in the header). Phase 2
 * extends this with an outstanding-bill notice + pay CTA.
 */
export function SubscriptionBanner() {
  const t = useTranslations("academySubscription");
  const [sub, setSub] = useState<AcademySubscription | null>(null);

  useEffect(() => {
    void getMySubscription()
      .then((r) => setSub(r.subscription))
      .catch(() => setSub(null));
  }, []);

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
