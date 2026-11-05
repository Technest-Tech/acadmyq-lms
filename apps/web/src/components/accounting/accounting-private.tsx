"use client";

import { AlarmClock, Hourglass, TrendingUp, UserRound, Wallet } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Cell } from "@/components/accounting/accounting-groups";
import { RateBar, Tile, pct, todayLocal } from "@/components/accounting/accounting-ui";
import { ExportButton } from "@/components/accounting/export-button";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { PageHero } from "@/components/ui/page-hero";
import { getAccountingPrivate, type AccountingPrivate } from "@/lib/accounting-api";
import type { SheetColumn } from "@/lib/accounting-export";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Row = AccountingPrivate["rows"][number];

/**
 * The private side of the month (docs/groups/01-ACCOUNTING.md), the way the groups report reads the
 * group side: what each student's private lessons were due, what came in, what is left, and for
 * whoever reads payroll what the teacher cost. Then every teacher whole, private and groups together.
 */
export function AccountingPrivateScreen({ hero = true }: { hero?: boolean }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [month, setMonth] = useState(() => todayLocal().slice(0, 7));
  const [data, setData] = useState<AccountingPrivate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getAccountingPrivate(month));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("privatePage.loadFailed")));
    }
  }, [month, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (amount: number | null, currency: string) => (amount === null ? "—" : formatMoney({ amount, currency }, locale));
  const cost = data?.sees_teacher_cost ?? false;
  const rows = data?.rows ?? [];

  const columns: SheetColumn<Row>[] = [
    { header: t("privatePage.col.student"), width: 26, value: (r) => r.student_name },
    { header: t("privatePage.col.teacher"), width: 24, value: (r) => r.teacher_name },
    { header: t("exportCurrency"), width: 10, value: (r) => r.currency },
    { header: t("groupsPage.col.expected"), kind: "money", value: (r) => r.expected_minor },
    { header: t("groupsPage.col.collected"), kind: "money", value: (r) => r.collected_minor },
    { header: t("groupsPage.col.remaining"), kind: "money", value: (r) => r.remaining_minor },
    { header: t("groupsPage.col.arrears"), kind: "money", value: (r) => r.arrears_minor },
    { header: t("sheet.receivedInMonth"), kind: "money", value: (r) => r.received_in_month_minor },
    ...(cost
      ? ([
          { header: t("groupsPage.col.cost"), kind: "money", value: (r) => r.teacher_cost_minor },
          { header: t("groupsPage.col.net"), kind: "money", value: (r) => r.net_minor },
        ] as SheetColumn<Row>[])
      : []),
  ];

  return (
    <div className="space-y-5" data-testid="accounting-private">
      {hero && <PageHero icon={UserRound} title={t("privatePage.title")} subtitle={t("privatePage.subtitle")} latticeId="accounting-private-hero" />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <input type="month" className={cn(fieldClass, "w-44")} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={t("sheet.month")} />
        <ExportButton name={`private-lessons-${month}`} sheetName={t("privatePage.title")} columns={columns} rows={rows} />
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {data?.totals.map((tot) => (
        <section key={tot.currency} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid={`private-totals-${tot.currency}`}>
          <Tile label={t("sheet.remaining")} icon={AlarmClock} accent="rose" value={money(tot.remaining_minor, tot.currency)} tone={tot.remaining_minor > 0 ? "text-rose-600 dark:text-rose-400" : undefined} />
          <Tile label={t("sheet.arrears")} icon={Hourglass} accent="amber" value={money(tot.arrears_minor, tot.currency)} tone={tot.arrears_minor > 0 ? "text-amber-600 dark:text-amber-400" : undefined} hint={t("sheet.arrearsHint")} />
          <Tile label={t("sheet.receivedInMonth")} icon={Wallet} accent="emerald" value={money(tot.received_in_month_minor, tot.currency)} tone="text-emerald-600 dark:text-emerald-400" hint={t("sheet.receivedHint")} />
          {cost && (
            <Tile
              label={t("groupsPage.netAfterTeacher")}
              icon={TrendingUp}
              accent="violet"
              value={money(tot.net_minor, tot.currency)}
              tone={(tot.net_minor ?? 0) < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}
              hint={t("groupsPage.netHint", { cost: money(tot.teacher_cost_minor, tot.currency), margin: pct(tot.margin) })}
            />
          )}
        </section>
      ))}

      {data && rows.length === 0 && <p className="text-muted-foreground bg-card/60 rounded-2xl border border-dashed p-10 text-center text-sm">{t("privatePage.empty")}</p>}

      {rows.length > 0 && (
        <>
          <div className="bg-card hidden overflow-x-auto rounded-xl border shadow-sm lg:block">
            <table className="w-full text-sm" data-testid="private-table">
              <thead className="bg-muted/70 text-muted-foreground border-b text-xs font-semibold">
                <tr>
                  <th className="p-3 text-start font-medium">{t("privatePage.col.student")}</th>
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
                {rows.map((r) => (
                  <tr key={`${r.student_id}-${r.teacher_id ?? "none"}-${r.currency}`} className="hover:bg-muted/30">
                    <td className="p-3">
                      <Link href={`/students/${r.student_id}`} className="font-medium hover:underline">
                        {r.student_name ?? "—"}
                      </Link>
                      <p className="text-muted-foreground text-xs">{r.teacher_name ?? t("privatePage.noTeacher")}</p>
                    </td>
                    <td className="p-3 text-end tabular-nums">{money(r.expected_minor, r.currency)}</td>
                    <td className="p-3 text-end text-emerald-700 tabular-nums dark:text-emerald-300">{money(r.collected_minor, r.currency)}</td>
                    <td className={cn("p-3 text-end font-semibold tabular-nums", r.remaining_minor > 0 && "text-rose-600 dark:text-rose-400")}>{money(r.remaining_minor, r.currency)}</td>
                    <td className={cn("p-3 text-end tabular-nums", r.arrears_minor > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{r.arrears_minor > 0 ? money(r.arrears_minor, r.currency) : "—"}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <RateBar rate={r.rate} />
                        </div>
                        <span className="w-10 text-end text-xs tabular-nums">{pct(r.rate)}</span>
                      </div>
                    </td>
                    {cost && <td className="p-3 text-end tabular-nums">{money(r.teacher_cost_minor, r.currency)}</td>}
                    {cost && <td className={cn("p-3 text-end font-semibold tabular-nums", (r.net_minor ?? 0) < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-300")}>{money(r.net_minor, r.currency)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 lg:hidden">
            {rows.map((r) => (
              <li key={`${r.student_id}-${r.teacher_id ?? "none"}-${r.currency}`} className="bg-card space-y-3 rounded-xl border p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/students/${r.student_id}`} className="font-medium break-words hover:underline">
                      {r.student_name ?? "—"}
                    </Link>
                    <p className="text-muted-foreground text-xs">{r.teacher_name ?? t("privatePage.noTeacher")}</p>
                  </div>
                  <span className="text-sm font-bold tabular-nums">{pct(r.rate)}</span>
                </div>
                <RateBar rate={r.rate} />
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <Cell label={t("groupsPage.col.expected")} value={money(r.expected_minor, r.currency)} />
                  <Cell label={t("groupsPage.col.collected")} value={money(r.collected_minor, r.currency)} tone="text-emerald-700 dark:text-emerald-300" />
                  <Cell label={t("groupsPage.col.remaining")} value={money(r.remaining_minor, r.currency)} tone={r.remaining_minor > 0 ? "text-rose-600 dark:text-rose-400" : undefined} />
                  <Cell label={t("groupsPage.col.arrears")} value={money(r.arrears_minor, r.currency)} />
                  {cost && <Cell label={t("groupsPage.col.cost")} value={money(r.teacher_cost_minor, r.currency)} />}
                  {cost && <Cell label={t("groupsPage.col.net")} value={money(r.net_minor, r.currency)} />}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {data?.teachers && data.teachers.length > 0 && (
        <section className="space-y-2" data-testid="private-teachers">
          <h3 className="text-sm font-semibold">{t("privatePage.wholeTeacher")}</h3>
          <p className="text-muted-foreground text-xs">{t("privatePage.wholeTeacherHint")}</p>
          <div className="bg-card overflow-x-auto rounded-xl border shadow-sm">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/70 text-muted-foreground border-b text-xs font-semibold">
                <tr>
                  <th className="p-3 text-start font-medium">{t("groupsPage.col.teacher")}</th>
                  <th className="p-3 text-end font-medium">{t("privatePage.col.privateStudents")}</th>
                  <th className="p-3 text-end font-medium">{t("privatePage.col.privateReceived")}</th>
                  <th className="p-3 text-end font-medium">{t("privatePage.col.groupsReceived")}</th>
                  <th className="p-3 text-end font-medium">{t("groupsPage.col.cost")}</th>
                  <th className="p-3 text-end font-medium">{t("groupsPage.col.expenses")}</th>
                  <th className="p-3 text-end font-medium">{t("groupsPage.col.net")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.teachers.map((tr) => (
                  <tr key={`${tr.teacher_id ?? "none"}-${tr.currency}`}>
                    <td className="p-3 font-medium">{tr.teacher_name ?? t("privatePage.noTeacher")}</td>
                    <td className="p-3 text-end tabular-nums">{tr.students}</td>
                    <td className="p-3 text-end tabular-nums">{money(tr.private_received_minor, tr.currency)}</td>
                    <td className="p-3 text-end tabular-nums">{money(tr.groups_received_minor, tr.currency)}</td>
                    <td className="p-3 text-end tabular-nums">{money(tr.teacher_cost_minor, tr.currency)}</td>
                    <td className="p-3 text-end tabular-nums">{tr.expenses_minor > 0 ? money(tr.expenses_minor, tr.currency) : "—"}</td>
                    <td className={cn("p-3 text-end font-semibold tabular-nums", tr.net_minor < 0 && "text-rose-600 dark:text-rose-400")}>{money(tr.net_minor, tr.currency)}</td>
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
