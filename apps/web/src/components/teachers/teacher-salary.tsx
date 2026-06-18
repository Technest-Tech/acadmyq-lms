"use client";

import { ChevronRight, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { PayoutDetailModal } from "@/components/payroll/payout-detail-modal";
import { ApiError, listPayouts, type PayoutRow } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

function periodLabel(year: number, month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

/** A teacher's payout statements: per-period totals + status, opening the full ledger
 *  (with reward/deduction-by-reason) on click. */
export function TeacherSalary({ teacherId }: { teacherId: string }) {
  const t = useTranslations("teachers");
  const locale = useLocale();

  const [rows, setRows] = useState<PayoutRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await listPayouts({
        pageSize: 50,
        sort: "-period",
        filter: { teacher_id: teacherId },
      });
      setRows(res.rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setRows([]);
    }
  }, [teacherId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold">{t("salary.title")}</h3>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {rows === null ? (
        <div className="flex items-center justify-center py-12">
          <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed py-12 text-center">
          <Wallet className="size-6 text-muted-foreground/40" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("salary.empty")}</p>
          <p className="text-xs text-muted-foreground/70">{t("salary.hint")}</p>
        </div>
      ) : (
        <ul
          className="divide-y overflow-hidden rounded-2xl border bg-background"
          data-testid="teacher-payouts"
        >
          {rows.map((p) => {
            const finalized = p.finalized_at != null;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(p.id)}
                  data-payout={p.id}
                  className="flex w-full items-center gap-4 px-5 py-4 text-start transition-colors hover:bg-muted/40"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/15">
                    <Wallet className="size-4 text-primary" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">
                      {periodLabel(p.period_year, p.period_month, locale)}
                    </div>
                    <div className="mt-0.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          finalized
                            ? "bg-slate-100 text-slate-600 dark:bg-slate-800/40 dark:text-slate-300"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            finalized ? "bg-slate-400" : "bg-emerald-500",
                          )}
                        />
                        {finalized
                          ? t("salary.finalized")
                          : t("salary.open")}
                      </span>
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="font-bold tabular-nums">
                      {formatMoney(
                        { amount: p.total_minor, currency: p.currency },
                        locale,
                      )}
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 rtl:rotate-180" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <PayoutDetailModal
        payoutId={openId}
        onClose={() => setOpenId(null)}
        onMutated={() => void load()}
      />
    </div>
  );
}
