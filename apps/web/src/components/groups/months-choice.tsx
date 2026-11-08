"use client";

import { useLocale, useTranslations } from "next-intl";
import type { GroupPricing, MonthsPerCharge } from "@/lib/groups-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * One month or two (lingo, 2026-11-08): a monthly group's member pays a month at a time, or two
 * together at the group's two-month offer. Shown only for a MONTHLY group; each side names its
 * price when the viewer may see prices (`pricing` is null otherwise).
 */
export function MonthsChoice({
  pricing,
  value,
  onChange,
  disabled,
  testId = "months-choice",
  compact,
}: {
  pricing: GroupPricing | null | undefined;
  value: MonthsPerCharge;
  onChange: (months: MonthsPerCharge) => void;
  disabled?: boolean;
  testId?: string;
  compact?: boolean;
}) {
  const t = useTranslations("groups.months");
  const locale = useLocale();
  const money = (minor: number | null | undefined) =>
    minor != null && pricing?.currency ? formatMoney({ amount: minor, currency: pricing.currency }, locale) : null;
  const one = money(pricing?.price_minor);
  const two = money(pricing?.two_month_price_minor ?? (pricing?.price_minor != null ? 2 * pricing.price_minor : null));

  const option = (months: MonthsPerCharge, label: string, price: string | null) => (
    <button
      key={months}
      type="button"
      role="radio"
      aria-checked={value === months}
      disabled={disabled}
      onClick={() => onChange(months)}
      className={cn(
        "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
        value === months ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
      )}
      data-testid={`${testId}-${months}`}
    >
      {label}
      {price && !compact && <span className="ms-1 font-normal opacity-80">· {price}</span>}
    </button>
  );

  return (
    <div role="radiogroup" aria-label={t("label")} className="inline-flex flex-wrap items-center gap-1.5" data-testid={testId}>
      {option(1, t("one"), one)}
      {option(2, pricing?.two_month_price_minor != null ? t("twoOffer") : t("two"), two)}
    </div>
  );
}
