"use client";

import { Wallet } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useState } from "react";
import { StateChip } from "@/components/accounting/accounting-ui";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass, todayIn } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { PageHero } from "@/components/ui/page-hero";
import { getGroupPayments, type GroupPayments } from "@/lib/groups-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The month's group money (docs/groups §Money), group by group: what was billed, what came in, what
 * is still owed, what the teacher cost and what is left — and every unpaid charge, by name. Money
 * roles only (`invoice.read`); the teacher-cost columns only for `payout.read`.
 */
export function PaymentsBoard() {
  const t = useTranslations("groups");
  const locale = useLocale();
  const [month, setMonth] = useState(() => todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone).slice(0, 7));
  const [data, setData] = useState<GroupPayments | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getGroupPayments(month));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("board.loadFailed")));
    }
  }, [month, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const fmt = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);
  const cost = data?.sees_teacher_cost ?? false;

  return (
    <div className="space-y-5">
      <PageHero icon={Wallet} title={t("board.payments.title")} subtitle={t("board.payments.subtitle")} latticeId="groups-payments-hero" />

      <div className="flex justify-end">
        <input type="month" className={cn(fieldClass, "w-44")} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={t("moneyTab.month")} />
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {data && (
        <>
          {data.totals.length === 0 ? (
            <p className="text-muted-foreground rounded-2xl border border-dashed p-10 text-center text-sm">{t("board.payments.empty")}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="payments-totals">
              {data.totals.map((tot) => (
                <Fragment key={tot.currency}>
                  <Tile label={t("moneyTab.billed")} value={fmt(tot.billed_minor, tot.currency)} />
                  <Tile label={t("moneyTab.paid")} value={fmt(tot.paid_minor, tot.currency)} tone="text-emerald-600 dark:text-emerald-400" />
                  <Tile label={t("moneyTab.outstanding")} value={fmt(tot.outstanding_minor, tot.currency)} tone={tot.outstanding_minor > 0 ? "text-rose-600 dark:text-rose-400" : undefined} />
                  {cost && <Tile label={t("board.payments.teacherCost")} value={fmt(tot.teacher_cost_minor, tot.currency)} />}
                  {cost && (
                    <Tile
                      label={t("moneyTab.margin")}
                      value={fmt(tot.billed_minor - tot.teacher_cost_minor, tot.currency)}
                      tone={tot.billed_minor - tot.teacher_cost_minor < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}
                    />
                  )}
                </Fragment>
              ))}
            </div>
          )}

          {data.groups.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t("board.payments.byGroup")}</h3>
              <ul className="divide-y overflow-hidden rounded-xl border" data-testid="payments-groups">
                {data.groups.map((g) => (
                  <li key={g.id} className="grid grid-cols-1 gap-2 p-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,3fr)] md:items-center">
                    <div className="min-w-0">
                      <Link href={`/groups/${g.id}?tab=${data.accounting ? "accounts" : "money"}`} className="block truncate font-medium hover:underline">
                        {g.name}
                      </Link>
                      <p className="text-muted-foreground truncate text-xs">
                        {[g.level, g.teacher_name].filter(Boolean).join(" · ")}
                        {" · "}
                        {g.price_minor != null && g.currency
                          ? t(`moneyTab.rule.${g.billing_mode}`, { price: fmt(g.price_minor, g.currency) })
                          : t("board.payments.noPrice")}
                      </p>
                    </div>
                    {g.money.length === 0 ? (
                      <p className="text-muted-foreground text-xs md:text-end">{t("board.payments.nothing")}</p>
                    ) : (
                      g.money.map((m) => (
                        <dl key={m.currency} className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-5 md:text-end">
                          <Cell label={t("moneyTab.billed")} value={fmt(m.billed_minor, m.currency)} />
                          <Cell label={t("moneyTab.paid")} value={fmt(m.paid_minor, m.currency)} tone="text-emerald-600 dark:text-emerald-400" />
                          <Cell label={t("moneyTab.outstanding")} value={fmt(m.outstanding_minor, m.currency)} tone={m.outstanding_minor > 0 ? "text-rose-600 dark:text-rose-400" : undefined} />
                          {m.teacher_cost_minor !== null && <Cell label={t("board.payments.teacherCost")} value={fmt(m.teacher_cost_minor, m.currency)} />}
                          {m.teacher_cost_minor !== null && <Cell label={t("moneyTab.margin")} value={fmt(m.billed_minor - m.teacher_cost_minor, m.currency)} />}
                        </dl>
                      ))
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.unpaid.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-300">{t("board.payments.unpaid", { count: data.unpaid.length })}</h3>
              <ul className="divide-y overflow-hidden rounded-xl border border-rose-500/30" data-testid="payments-unpaid">
                {data.unpaid.map((u) => (
                  <li key={u.line_id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{u.student_name ?? "—"}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {u.group_name} · {u.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-end">
                        <span className="block font-semibold tabular-nums">{fmt(u.remaining_minor ?? u.amount_minor, u.currency)}</span>
                        {(u.paid_minor ?? 0) > 0 && (
                          <span className="text-muted-foreground block text-xs tabular-nums">
                            {t("board.payments.leftOf", { of: fmt(u.amount_minor, u.currency) })}
                          </span>
                        )}
                      </span>
                      {data.accounting ? (
                        <StateChip state={(u.paid_minor ?? 0) > 0 ? "PARTIAL" : "UNPAID"} />
                      ) : (
                        <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">
                          {t(`moneyTab.invoice.${u.invoice_status}`)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
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
      <p className={cn("mt-1 text-lg font-bold break-words tabular-nums", tone)}>{value}</p>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-[11px]">{label}</dt>
      <dd className={cn("font-semibold break-words tabular-nums", tone)}>{value}</dd>
    </div>
  );
}
