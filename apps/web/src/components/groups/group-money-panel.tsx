"use client";

import { useLocale, useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useState } from "react";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass, hoursText, pricingRuleKey, todayIn } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { getGroupMoney, type GroupDetail, type GroupMoney } from "@/lib/groups-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const PAID_TONE: Record<string, string> = {
  PAID: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  PARTIALLY_PAID: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  OPEN: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  CLOSED: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  VOID: "border-zinc-400/30 bg-zinc-400/10 text-zinc-500",
};

/**
 * One group's month in money (docs/groups §Money): what each member was charged and whether their
 * invoice is paid, what the group cost in teacher pay, and what is left. Owner-side — the server
 * gates it on `invoice.read`, and the teacher-cost half on `payout.read`.
 */
export function GroupMoneyPanel({ group }: { group: GroupDetail }) {
  const t = useTranslations("groups");
  const locale = useLocale();
  const [month, setMonth] = useState(() => todayIn(group.timezone).slice(0, 7));
  const [money, setMoney] = useState<GroupMoney | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMoney(await getGroupMoney(group.id, month));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("moneyTab.loadFailed")));
    }
  }, [group.id, month, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const fmt = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);

  return (
    <div className="space-y-4" data-testid="group-money">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {group.pricing?.price_minor != null && group.pricing.currency
            ? t(`moneyTab.rule.${pricingRuleKey(group.pricing)}`, {
                price: fmt(group.pricing.price_minor, group.pricing.currency),
                hours: hoursText(group.pricing.month_minutes ?? 0, locale),
              })
            : t("moneyTab.noPrice")}
        </p>
        <input
          type="month"
          className={cn(fieldClass, "w-44")}
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          aria-label={t("moneyTab.month")}
        />
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {money && (
        <>
          {money.totals.length === 0 && (money.teacher_cost ?? []).length === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">{t("moneyTab.empty")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {money.totals.map((tot) => (
                <Fragment key={tot.currency}>
                  <Tile label={t("moneyTab.billed")} value={fmt(tot.billed_minor, tot.currency)} />
                  <Tile label={t("moneyTab.paid")} value={fmt(tot.paid_minor, tot.currency)} tone="text-emerald-600 dark:text-emerald-400" />
                  <Tile
                    label={t("moneyTab.outstanding")}
                    value={fmt(tot.outstanding_minor, tot.currency)}
                    tone={tot.outstanding_minor > 0 ? "text-rose-600 dark:text-rose-400" : undefined}
                  />
                </Fragment>
              ))}
              {(money.teacher_cost ?? []).map((c) => {
                const billed = money.totals.find((x) => x.currency === c.currency)?.billed_minor;
                return (
                  <Fragment key={`cost-${c.currency}`}>
                    <Tile label={t("moneyTab.teacherCost", { count: c.lessons })} value={fmt(c.amount_minor, c.currency)} />
                    {billed !== undefined && (
                      <Tile
                        label={t("moneyTab.margin")}
                        value={fmt(billed - c.amount_minor, c.currency)}
                        tone={billed - c.amount_minor < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}
                      />
                    )}
                  </Fragment>
                );
              })}
            </div>
          )}

          {money.lines.length > 0 && (
            <ul className="divide-y overflow-hidden rounded-xl border" data-testid="money-lines">
              {money.lines.map((l) => (
                <li key={l.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{l.student_name ?? "—"}</p>
                    <p className="text-muted-foreground truncate text-xs">{l.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-semibold tabular-nums">{fmt(l.amount_minor, l.currency)}</span>
                    <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", PAID_TONE[l.invoice_status])}>
                      {t(`moneyTab.invoice.${l.invoice_status}`)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      {/* Money is never truncated (mobile conventions): it wraps instead. */}
      <p className={cn("mt-1 text-lg font-bold break-words tabular-nums", tone)}>{value}</p>
    </div>
  );
}
