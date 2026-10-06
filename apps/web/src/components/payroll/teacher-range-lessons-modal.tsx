"use client";

import { Lock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  getPayrollRangeLessons,
  type PayrollRangeLesson,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { formatHours } from "@/lib/time";

export interface TeacherRangeTarget {
  teacherId: string;
  teacherName: string | null;
  currency: string;
}

/**
 * The lessons behind one teacher's "lessons" figure for the chosen window.
 *
 * Owners looked at that figure on the by-teacher summary and asked where the lessons were: they
 * only lived inside each monthly statement further down, and a window can span two of those.
 * This reads the same slice the summary sums (`session_date` inside the window), so the total at
 * the bottom is always the number they tapped.
 */
export function TeacherRangeLessonsModal({
  target,
  from,
  to,
  onClose,
}: {
  target: TeacherRangeTarget | null;
  from: string;
  to: string;
  onClose: () => void;
}) {
  const t = useTranslations("payroll");
  const locale = useLocale();
  const [lessons, setLessons] = useState<PayrollRangeLesson[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target === null) return;
    let cancelled = false;
    setLessons(null);
    setError(null);
    getPayrollRangeLessons(target.teacherId, from, to, target.currency)
      .then((r) => !cancelled && setLessons(r.lessons))
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [target, from, to]);

  // session_date is a plain academy-local date; pin the formatter to UTC so it never shifts a day.
  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
    [locale],
  );

  const totals = useMemo(
    () =>
      (lessons ?? []).reduce(
        (acc, l) => ({
          minutes: acc.minutes + (l.duration_minutes ?? 0),
          amount: acc.amount + l.amount_minor,
        }),
        { minutes: 0, amount: 0 },
      ),
    [lessons],
  );

  const money = (amount: number) =>
    formatMoney({ amount, currency: target?.currency ?? "EGP" }, locale);

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={t("rangeLessonsTitle", { name: target?.teacherName ?? "—" })}
      description={t("rangeLessonsWindow", { from, to })}
      size="lg"
      footer={
        lessons && lessons.length > 0 ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {t("sessionCount", { count: lessons.length })} · {formatHours(totals.minutes, locale)}
            </span>
            <span className="font-bold tabular-nums">{money(totals.amount)}</span>
          </div>
        ) : undefined
      }
    >
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!error && lessons === null && (
        <p className="text-muted-foreground py-6 text-center text-sm">{t("rangeLessonsLoading")}</p>
      )}

      {lessons !== null && lessons.length === 0 && (
        <p className="text-muted-foreground py-6 text-center text-sm">{t("rangeLessonsEmpty")}</p>
      )}

      {lessons !== null && lessons.length > 0 && (
        <ul className="divide-border divide-y rounded-xl border" data-testid="range-lessons">
          {lessons.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{l.student_name ?? "—"}</p>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {l.session_date ? dateFmt.format(new Date(`${l.session_date}T00:00:00Z`)) : "—"}
                  {l.duration_minutes !== null && <> · {formatHours(l.duration_minutes, locale)}</>}
                </p>
              </div>
              {l.finalized && (
                <Lock
                  className="text-muted-foreground size-3.5 shrink-0"
                  aria-label={t("status.FINALIZED")}
                />
              )}
              <span className="shrink-0 font-semibold tabular-nums">{money(l.amount_minor)}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
