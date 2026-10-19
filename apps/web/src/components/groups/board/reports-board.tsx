"use client";

import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass, percent, todayIn } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { PageHero } from "@/components/ui/page-hero";
import { getGroupReports, type GroupReports } from "@/lib/groups-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

/**
 * How the groups are doing (docs/groups §Statistics) over a month: seats used, lessons held /
 * cancelled / still owed, attendance — per group and per teacher. Money roles also see what each
 * group billed. A rate under 75 % and an owed sheet are what the colours point at.
 */
export function ReportsBoard() {
  const t = useTranslations("groups");
  const locale = useLocale();
  const [month, setMonth] = useState(() => todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone).slice(0, 7));
  const [data, setData] = useState<GroupReports | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getGroupReports(monthBounds(month)));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("board.loadFailed")));
    }
  }, [month, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const hours = (minutes: number) => t("board.reports.hours", { count: Math.round((minutes / 60) * 10) / 10 });
  const low = (rate: number | null) => rate !== null && rate < 0.75;

  return (
    <div className="space-y-5">
      <PageHero icon={BarChart3} title={t("board.reports.title")} subtitle={t("board.reports.subtitle")} latticeId="groups-reports-hero" />

      <div className="flex justify-end">
        <input type="month" className={cn(fieldClass, "w-44")} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={t("moneyTab.month")} />
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="reports-totals">
            <Tile label={t("board.reports.groups")} value={String(data.totals.groups)} />
            <Tile
              label={t("board.reports.students")}
              value={data.totals.capacity ? `${data.totals.members} / ${data.totals.capacity}` : String(data.totals.members)}
            />
            <Tile label={t("overview.held")} value={String(data.totals.lessons.held)} />
            <Tile label={t("overview.overdue")} value={String(data.totals.lessons.owed)} tone={data.totals.lessons.owed > 0 ? "text-rose-600 dark:text-rose-400" : undefined} />
            <Tile label={t("overview.attendance")} value={percent(data.totals.attendance.rate)} tone={low(data.totals.attendance.rate) ? "text-rose-600 dark:text-rose-400" : undefined} />
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t("board.reports.byGroup")}</h3>
            {data.groups.length === 0 ? (
              <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">{t("board.reports.empty")}</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[44rem] text-sm" data-testid="reports-groups">
                  <thead className="bg-muted/40 text-muted-foreground text-xs">
                    <tr>
                      <th className="px-3 py-2 text-start font-medium">{t("form.name")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("seats")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("overview.held")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("board.reports.cancelled")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("overview.overdue")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("overview.attendance")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("board.reports.absences")}</th>
                      {data.groups[0]?.billed !== null && <th className="px-3 py-2 text-end font-medium">{t("moneyTab.billed")}</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.groups.map((g) => (
                      <tr key={g.id}>
                        <td className="px-3 py-2">
                          <Link href={`/groups/${g.id}`} className="font-medium hover:underline">
                            {g.name}
                          </Link>
                          <span className="text-muted-foreground block text-xs">{[g.level, g.teacher_name].filter(Boolean).join(" · ")}</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="tabular-nums">{g.capacity !== null ? `${g.members} / ${g.capacity}` : g.members}</span>
                          {g.occupancy !== null && (
                            <span className="bg-muted mt-1 block h-1.5 w-20 overflow-hidden rounded-full">
                              <span className={cn("block h-full rounded-full", g.occupancy >= 1 ? "bg-amber-500" : "bg-primary")} style={{ width: `${Math.min(100, Math.round(g.occupancy * 100))}%` }} />
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums">{g.lessons.held}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{g.lessons.cancelled}</td>
                        <td className={cn("px-3 py-2 text-end tabular-nums", g.lessons.owed > 0 && "font-semibold text-rose-600 dark:text-rose-400")}>{g.lessons.owed}</td>
                        <td className={cn("px-3 py-2 text-end font-semibold tabular-nums", low(g.attendance.rate) && "text-rose-600 dark:text-rose-400")}>{percent(g.attendance.rate)}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{g.attendance.absent}</td>
                        {g.billed !== null && (
                          <td className="px-3 py-2 text-end tabular-nums">
                            {g.billed.length === 0 ? "—" : g.billed.map((b) => formatMoney({ amount: b.amount_minor, currency: b.currency }, locale)).join(" · ")}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {data.teachers.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t("board.reports.byTeacher")}</h3>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[36rem] text-sm" data-testid="reports-teachers">
                  <thead className="bg-muted/40 text-muted-foreground text-xs">
                    <tr>
                      <th className="px-3 py-2 text-start font-medium">{t("form.teacher")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("board.reports.groups")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("overview.held")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("board.reports.taught")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("overview.overdue")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("overview.attendance")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.teachers.map((te) => (
                      <tr key={te.id}>
                        <td className="px-3 py-2 font-medium">{te.name ?? "—"}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{te.groups}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{te.lessons.held}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{hours(te.lessons.minutes)}</td>
                        <td className={cn("px-3 py-2 text-end tabular-nums", te.lessons.owed > 0 && "font-semibold text-rose-600 dark:text-rose-400")}>{te.lessons.owed}</td>
                        <td className={cn("px-3 py-2 text-end font-semibold tabular-nums", low(te.attendance.rate) && "text-rose-600 dark:text-rose-400")}>{percent(te.attendance.rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
      <p className={cn("mt-1 text-xl font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}
