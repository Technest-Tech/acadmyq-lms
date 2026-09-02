"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  getLessonPackage,
  type LessonPackageCredit,
  type LessonPackageRow,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { formatDateTime, formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * Which lessons ate this package, in order.
 *
 * This is the ledger, and it is the answer to every "why is my balance that number" question a
 * parent will ever ask: one row per lesson, its length, and — for the one that ran past the end
 * — exactly how far past and what it cost. Deliberately NOT the invoice: the bill shows the
 * block as one line, and the breakdown lives here.
 */
export function PackageDetail({
  row,
  timezone,
}: {
  row: LessonPackageRow;
  timezone: string;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const [credits, setCredits] = useState<LessonPackageCredit[] | null>(null);

  useEffect(() => {
    void getLessonPackage(row.id)
      .then((r) => setCredits(r.credits))
      .catch(() => setCredits([]));
  }, [row.id]);

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Fact label={t("detail.sold")} value={formatHours(row.minutes_sold, locale)} />
        <Fact label={t("detail.used")} value={formatHours(row.minutes_consumed, locale)} />
        <Fact
          label={t("detail.remaining")}
          value={formatHours(row.minutes_remaining, locale)}
          strong
        />
        <Fact
          label={t("detail.rate")}
          value={formatMoney({ amount: row.hourly_rate_minor, currency: row.currency }, locale)}
        />
      </dl>

      {row.minutes_overdrawn > 0 && (
        <p className="bg-destructive/8 text-destructive rounded-xl px-3 py-2.5 text-xs font-medium">
          {t("detail.overdraftNote", {
            over: formatHours(row.minutes_overdrawn, locale),
            amount: formatMoney(
              {
                amount: Math.round((row.hourly_rate_minor * row.minutes_overdrawn) / 60),
                currency: row.currency,
              },
              locale,
            ),
          })}
        </p>
      )}

      <div className="space-y-1.5">
        <h4 className="text-sm font-semibold">{t("detail.lessons")}</h4>

        {credits === null && (
          <p className="text-muted-foreground text-xs">{t("detail.loading")}</p>
        )}

        {credits !== null && credits.length === 0 && (
          <p className="text-muted-foreground text-xs">{t("detail.noLessons")}</p>
        )}

        {credits !== null && credits.length > 0 && (
          <ul className="divide-border divide-y rounded-xl border">
            {credits.map((credit) => (
              <li
                key={credit.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs",
                  credit.minutes_overdrawn > 0 && "bg-destructive/5",
                )}
              >
                <span className="text-muted-foreground">
                  {credit.scheduled_at_utc !== null
                    ? formatDateTime(credit.scheduled_at_utc, timezone, locale)
                    : credit.description}
                  {credit.teacher_name !== null && ` · ${credit.teacher_name}`}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{formatHours(credit.minutes, locale)}</span>
                  {credit.minutes_overdrawn > 0 && (
                    <span className="text-destructive font-semibold">
                      {t("detail.overBy", {
                        over: formatHours(credit.minutes_overdrawn, locale),
                        amount: formatMoney(
                          { amount: credit.amount_minor, currency: credit.currency },
                          locale,
                        ),
                      })}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="bg-muted/40 rounded-xl px-3 py-2">
      <dt className="text-muted-foreground text-[11px]">{label}</dt>
      <dd className={cn("mt-0.5 text-sm", strong ? "font-bold" : "font-semibold")}>{value}</dd>
    </div>
  );
}
