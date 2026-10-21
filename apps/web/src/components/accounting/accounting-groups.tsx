"use client";

import { AlarmClock, Hourglass, Layers, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RateBar, Tile, pct, todayLocal } from "@/components/accounting/accounting-ui";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { PageHero } from "@/components/ui/page-hero";
import { getAccountingGroups, type AccountingGroups, type GroupMoney } from "@/lib/accounting-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Sort = "name" | "rate" | "remaining" | "net";

/**
 * Every group's money for a month (docs/groups/01-ACCOUNTING.md): what it was due, what came in,
 * what is left and still owed from before, its collection rate — and, for whoever reads payroll,
 * what the teacher cost and what the group left the academy (net on money actually received). Then
 * the same per teacher. A group opens its own Accounts tab.
 */
export function AccountingGroupsScreen({ hero = true }: { hero?: boolean }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [month, setMonth] = useState(() => todayLocal().slice(0, 7));
  const [data, setData] = useState<AccountingGroups | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("remaining");

  const load = useCallback(async () => {
    try {
      setData(await getAccountingGroups(month));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("groupsPage.loadFailed")));
    }
  }, [month, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (amount: number | null, currency: string) => (amount === null ? "—" : formatMoney({ amount, currency }, locale));
  const cost = data?.sees_teacher_cost ?? false;

  const rows = useMemo(() => {
    const list = (data?.groups ?? []).flatMap((g) => (g.money.length > 0 ? g.money.map((m) => ({ g, m })) : [{ g, m: null as GroupMoney | null }]));
    const key = (r: (typeof list)[number]) =>
      sort === "name" ? 0 : sort === "rate" ? (r.m?.rate ?? 2) : sort === "remaining" ? -(r.m?.remaining_minor ?? 0) - (r.m?.arrears_minor ?? 0) : -(r.m?.net_minor ?? 0);
    return [...list].sort((a, b) => key(a) - key(b) || a.g.name.localeCompare(b.g.name));
  }, [data, sort]);

  return (
    <div className="space-y-5" data-testid="accounting-groups">
      {hero && <PageHero icon={Layers} title={t("groupsPage.title")} subtitle={t("groupsPage.subtitle")} latticeId="accounting-groups-hero" />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          {t("groupsPage.sortBy")}
          <select className={cn(fieldClass, "w-48")} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="remaining">{t("groupsPage.sort.remaining")}</option>
            <option value="rate">{t("groupsPage.sort.rate")}</option>
            {cost && <option value="net">{t("groupsPage.sort.net")}</option>}
            <option value="name">{t("groupsPage.sort.name")}</option>
          </select>
        </label>
        <input type="month" className={cn(fieldClass, "w-44")} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={t("sheet.month")} />
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {data?.totals.map((tot) => (
        <section key={tot.currency} className="space-y-3" data-testid={`groups-totals-${tot.currency}`}>
          <div className="from-primary/[0.08] via-card to-card bg-card rounded-2xl border bg-gradient-to-br p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-muted-foreground text-xs">{t("sheet.collectionRate")}</p>
                <p className="text-3xl font-bold tabular-nums">{pct(tot.rate)}</p>
              </div>
              <p className="text-muted-foreground text-sm">{t("overview.billedPaid", { paid: money(tot.collected_minor, tot.currency), billed: money(tot.expected_minor, tot.currency) })}</p>
            </div>
            <div className="mt-3">
              <RateBar rate={tot.rate} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label={t("sheet.remaining")} icon={AlarmClock} accent="rose" value={money(tot.remaining_minor, tot.currency)} tone={tot.remaining_minor > 0 ? "text-rose-600 dark:text-rose-400" : undefined} />
            <Tile label={t("sheet.arrears")} icon={Hourglass} accent="amber" value={money(tot.arrears_minor, tot.currency)} tone={tot.arrears_minor > 0 ? "text-amber-600 dark:text-amber-400" : undefined} hint={t("sheet.arrearsHint")} />
            <Tile label={t("sheet.receivedInMonth")} icon={Wallet} accent="emerald" value={money(tot.received_in_month_minor, tot.currency)} tone="text-emerald-600 dark:text-emerald-400" hint={t("sheet.receivedHint")} />
            {cost && (
              <Tile
                label={t("groupsPage.netAfterTeacher")} icon={TrendingUp} accent="violet"
                value={money(tot.net_minor, tot.currency)}
                tone={(tot.net_minor ?? 0) < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}
                hint={t("groupsPage.netHint", { cost: money(tot.teacher_cost_minor, tot.currency), margin: pct(tot.margin) })}
              />
            )}
          </div>
        </section>
      ))}

      {data && rows.length === 0 && <p className="text-muted-foreground rounded-2xl border border-dashed bg-card/60 p-10 text-center text-sm">{t("groupsPage.empty")}</p>}

      {data && rows.length > 0 && (
        <>
          <div className="hidden bg-card overflow-x-auto rounded-xl border shadow-sm lg:block">
            <table className="w-full text-sm" data-testid="groups-table">
              <thead className="bg-muted/70 text-muted-foreground border-b text-xs font-semibold">
                <tr>
                  <th className="p-3 text-start font-medium">{t("groupsPage.col.group")}</th>
                  <th className="p-3 text-end font-medium">{t("groupsPage.col.students")}</th>
                  <th className="p-3 text-end font-medium">{t("groupsPage.col.expected")}</th>
                  <th className="p-3 text-end font-medium">{t("groupsPage.col.collected")}</th>
                  <th className="p-3 text-end font-medium">{t("groupsPage.col.remaining")}</th>
                  <th className="p-3 text-end font-medium">{t("groupsPage.col.arrears")}</th>
                  <th className="w-32 p-3 text-start font-medium">{t("groupsPage.col.rate")}</th>
                  {cost && <th className="p-3 text-end font-medium">{t("groupsPage.col.cost")}</th>}
                  {cost && <th className="p-3 text-end font-medium">{t("groupsPage.col.net")}</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(({ g, m }) => (
                  <tr key={`${g.id}-${m?.currency ?? "none"}`} className="hover:bg-muted/30">
                    <td className="p-3">
                      <Link href={`/groups/${g.id}?tab=accounts`} className="font-medium hover:underline">
                        {g.name}
                      </Link>
                      <p className="text-muted-foreground text-xs">
                        {[g.level, g.teacher_name].filter(Boolean).join(" · ")}
                        {g.status === "ARCHIVED" && ` · ${t("groupsPage.archived")}`}
                      </p>
                    </td>
                    <td className="p-3 text-end tabular-nums">{g.students}</td>
                    {m ? (
                      <>
                        <td className="p-3 text-end tabular-nums">{money(m.expected_minor, m.currency)}</td>
                        <td className="p-3 text-end text-emerald-700 tabular-nums dark:text-emerald-300">{money(m.collected_minor, m.currency)}</td>
                        <td className={cn("p-3 text-end font-semibold tabular-nums", m.remaining_minor > 0 && "text-rose-600 dark:text-rose-400")}>{money(m.remaining_minor, m.currency)}</td>
                        <td className={cn("p-3 text-end tabular-nums", m.arrears_minor > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                          {m.arrears_minor > 0 ? money(m.arrears_minor, m.currency) : "—"}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <RateBar rate={m.rate} />
                            </div>
                            <span className="w-10 text-end text-xs tabular-nums">{pct(m.rate)}</span>
                          </div>
                        </td>
                        {cost && <td className="p-3 text-end tabular-nums">{money(m.teacher_cost_minor, m.currency)}</td>}
                        {cost && (
                          <td className={cn("p-3 text-end font-semibold tabular-nums", (m.net_minor ?? 0) < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-300")}>
                            {money(m.net_minor, m.currency)}
                          </td>
                        )}
                      </>
                    ) : (
                      <td className="text-muted-foreground p-3 text-center text-xs" colSpan={cost ? 7 : 5}>
                        {g.price_minor === null ? t("sheet.noPrice") : t("groupsPage.nothingThisMonth")}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 lg:hidden">
            {rows.map(({ g, m }) => (
              <li key={`${g.id}-${m?.currency ?? "none"}`} className="space-y-3 bg-card rounded-xl border p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/groups/${g.id}?tab=accounts`} className="font-medium break-words hover:underline">
                      {g.name}
                    </Link>
                    <p className="text-muted-foreground text-xs">{[g.teacher_name, t("groupsPage.studentsCount", { count: g.students })].filter(Boolean).join(" · ")}</p>
                  </div>
                  <span className="text-sm font-bold tabular-nums">{pct(m?.rate)}</span>
                </div>
                {m ? (
                  <>
                    <RateBar rate={m.rate} />
                    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <Cell label={t("groupsPage.col.expected")} value={money(m.expected_minor, m.currency)} />
                      <Cell label={t("groupsPage.col.collected")} value={money(m.collected_minor, m.currency)} tone="text-emerald-700 dark:text-emerald-300" />
                      <Cell label={t("groupsPage.col.remaining")} value={money(m.remaining_minor, m.currency)} tone={m.remaining_minor > 0 ? "text-rose-600 dark:text-rose-400" : undefined} />
                      <Cell label={t("groupsPage.col.arrears")} value={money(m.arrears_minor, m.currency)} />
                      {cost && <Cell label={t("groupsPage.col.cost")} value={money(m.teacher_cost_minor, m.currency)} />}
                      {cost && <Cell label={t("groupsPage.col.net")} value={money(m.net_minor, m.currency)} />}
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground text-xs">{g.price_minor === null ? t("sheet.noPrice") : t("groupsPage.nothingThisMonth")}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {data?.teachers && data.teachers.length > 0 && (
        <section className="space-y-2" data-testid="groups-teachers">
          <h3 className="text-sm font-semibold">{t("groupsPage.byTeacher")}</h3>
          <div className="bg-card overflow-x-auto rounded-xl border shadow-sm">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/70 text-muted-foreground border-b text-xs font-semibold">
                <tr>
                  <th className="p-3 text-start font-medium">{t("groupsPage.col.teacher")}</th>
                  <th className="p-3 text-end font-medium">{t("groupsPage.col.groups")}</th>
                  <th className="p-3 text-end font-medium">{t("groupsPage.col.expected")}</th>
                  <th className="p-3 text-end font-medium">{t("groupsPage.col.collected")}</th>
                  <th className="p-3 text-end font-medium">{t("groupsPage.col.rate")}</th>
                  <th className="p-3 text-end font-medium">{t("groupsPage.col.cost")}</th>
                  <th className="p-3 text-end font-medium">{t("groupsPage.col.net")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.teachers.map((tr) => (
                  <tr key={`${tr.teacher_id}-${tr.currency}`}>
                    <td className="p-3 font-medium">{tr.teacher_name ?? "—"}</td>
                    <td className="p-3 text-end tabular-nums">{tr.groups}</td>
                    <td className="p-3 text-end tabular-nums">{money(tr.expected_minor, tr.currency)}</td>
                    <td className="p-3 text-end tabular-nums">{money(tr.collected_minor, tr.currency)}</td>
                    <td className="p-3 text-end tabular-nums">{pct(tr.rate)}</td>
                    <td className="p-3 text-end tabular-nums">{money(tr.teacher_cost_minor, tr.currency)}</td>
                    <td className={cn("p-3 text-end font-semibold tabular-nums", (tr.net_minor ?? 0) < 0 && "text-rose-600 dark:text-rose-400")}>{money(tr.net_minor, tr.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-muted/40 rounded-lg p-2">
      <p className="text-muted-foreground">{label}</p>
      <p className={cn("font-semibold break-words tabular-nums", tone)}>{value}</p>
    </div>
  );
}
