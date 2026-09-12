"use client";

import { Layers, Plus } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { listLessonPackages, type LessonPackageRow } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * The student's hour balance, on their own profile.
 *
 * "Live track for each student's package as lessons are added" is the whole point of the feature,
 * and the profile is where an owner actually looks when a parent rings up — so the balance has to
 * be here and not only on the packages screen. This is a READ: opening, closing and billing all
 * live on /packages, so there is exactly one place those actions can be taken.
 *
 * The buttons here are therefore links, not forms. `?open=<studentId>` lands on the packages
 * screen with the "open a package" form already showing this student — the shortcut an owner
 * wants when a parent has just asked for another block, without a second form existing to
 * maintain or to disagree with the first.
 */
export function StudentPackagePanel({ studentId }: { studentId: string }) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const [rows, setRows] = useState<LessonPackageRow[] | null>(null);

  useEffect(() => {
    void listLessonPackages({ student_id: studentId })
      .then((r) => setRows(r.packages))
      .catch(() => setRows([]));
  }, [studentId]);

  if (rows === null) return null;

  const active = rows.find((r) => r.status === "ACTIVE") ?? null;
  const history = rows.filter((r) => r.status !== "ACTIVE").slice(0, 4);
  const owed = rows
    .filter((r) => r.status === "COMPLETED")
    .reduce((sum, r) => sum + r.outstanding_minor, 0);

  return (
    <div className="bg-card rounded-2xl border p-4" data-testid="student-packages">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="bg-primary/10 ring-primary/20 flex size-9 items-center justify-center rounded-xl ring-1">
            <Layers className="text-primary size-4" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-semibold">{t("panel.title")}</p>
            <p className="text-muted-foreground text-xs">{t("panel.subtitle")}</p>
          </div>
        </div>
        <Link
          href="/packages"
          className="text-primary text-xs font-semibold hover:underline"
        >
          {t("panel.manage")}
        </Link>
      </div>

      {active === null ? (
        <div className="mt-3.5 rounded-xl border border-dashed p-4 text-center">
          <p className="text-muted-foreground text-xs">{t("panel.noActive")}</p>
          <Link
            href={`/packages?open=${studentId}`}
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-3 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors"
            data-testid="open-package-for-student"
          >
            <Plus className="size-3.5" aria-hidden />
            {t("panel.openOne")}
          </Link>
        </div>
      ) : (
        <div className="mt-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">{active.label}</span>
            <span className="text-muted-foreground text-xs">
              {t("card.used", {
                used: formatHours(active.minutes_consumed, locale),
                total: formatHours(active.minutes_sold, locale),
              })}
            </span>
          </div>
          <div className="bg-muted mt-2 h-2 overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full",
                active.minutes_remaining <= 60 ? "bg-amber-500" : "bg-primary",
              )}
              style={{ width: `${Math.min(100, active.percent_used)}%` }}
            />
          </div>
          <p className="mt-2 text-xs font-semibold">
            {t("card.remaining", {
              left: formatHours(active.minutes_remaining, locale),
            })}
          </p>
        </div>
      )}

      {owed > 0 && (
        <p className="bg-destructive/8 text-destructive mt-3 rounded-xl px-3 py-2 text-xs font-semibold">
          {t("panel.owed", {
            amount: formatMoney(
              { amount: owed, currency: rows[0]?.currency ?? "EGP" },
              locale,
            ),
          })}
        </p>
      )}

      {history.length > 0 && (
        <ul className="text-muted-foreground mt-3 space-y-1 border-t pt-3 text-xs">
          {history.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2">
              <span className="truncate">
                #{row.sequence_no} {row.label}
              </span>
              <span className="shrink-0">
                {row.outstanding_minor > 0
                  ? formatMoney(
                      { amount: row.outstanding_minor, currency: row.currency },
                      locale,
                    )
                  : t("panel.settled")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
