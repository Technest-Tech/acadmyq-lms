"use client";

import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { listPaidBills, type PaidBill } from "@/lib/api";
import { formatMoney } from "@/lib/money";

const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3";

/**
 * "The first package is already paid" on the new-student form.
 *
 * The desk raises a hand-made bill under the family's name, the family pays, and only then is the
 * student added. Opening the package used to raise a second bill, which then sat on the Due page.
 * Ticking this and choosing the paid bill makes THAT bill the package's bill: one bill, one
 * payment, nothing due.
 *
 * `guardianId` is the parent already chosen (empty while a new parent is being typed): bills
 * raised on that family are offered beside the ones raised under a typed name.
 */
export function usePaidFirstPackage(guardianId: string) {
  const [checked, setChecked] = useState(false);
  const [billId, setBillId] = useState("");
  const [bills, setBills] = useState<PaidBill[] | null>(null);

  useEffect(() => {
    if (!checked) return;
    let live = true;
    setBills(null);
    listPaidBills(guardianId || undefined)
      .then((res) => {
        if (live) setBills(res.bills);
      })
      .catch(() => {
        if (live) setBills([]);
      });
    return () => {
      live = false;
    };
  }, [checked, guardianId]);

  // Another parent was picked and the chosen bill was that family's: it is no longer on offer.
  const chosen = bills?.find((b) => b.id === billId) ?? null;
  const paidInvoiceId = checked && chosen !== null ? chosen.id : null;

  return {
    checked,
    setChecked,
    billId: chosen !== null ? billId : "",
    setBillId,
    bills,
    chosen,
    /** Ticked means a bill must be named: a package with no bill at all would be billed later. */
    valid: !checked || paidInvoiceId !== null,
    paidInvoiceId,
  };
}

export type PaidFirstPackage = ReturnType<typeof usePaidFirstPackage>;

export function PaidFirstPackageField({
  state,
  priceMinor,
  idPrefix = "pkg",
}: {
  state: PaidFirstPackage;
  /** The package's price, to say so when the paid bill is for another amount. */
  priceMinor: number;
  idPrefix?: string;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const money = (b: PaidBill) => formatMoney({ amount: b.total_minor, currency: b.currency }, locale);

  return (
    <div className="space-y-2" data-testid="paid-first-package">
      <label className="border-input hover:bg-muted/30 flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors">
        <input
          type="checkbox"
          checked={state.checked}
          onChange={(e) => state.setChecked(e.target.checked)}
          className="mt-0.5"
          data-testid="paid-first-toggle"
        />
        <span>
          <span className="flex items-center gap-1.5 font-medium">
            <Receipt className="size-3.5" aria-hidden />
            {t("form.paidFirst")}
          </span>
          <span className="text-muted-foreground/80 block text-[11px]">{t("form.paidFirstHint")}</span>
        </span>
      </label>

      {state.checked &&
        (state.bills === null ? (
          <p className="text-muted-foreground text-xs">{t("form.paidFirstLoading")}</p>
        ) : state.bills.length === 0 ? (
          <p className="rounded-xl border border-dashed px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400" data-testid="paid-first-none">
            {t("form.paidFirstNone")}
          </p>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor={`${idPrefix}-paid-bill`} className="text-sm font-medium">
              {t("form.paidFirstBill")}
            </label>
            <select
              id={`${idPrefix}-paid-bill`}
              value={state.billId}
              onChange={(e) => state.setBillId(e.target.value)}
              className={inputClass}
              data-testid="paid-first-bill"
            >
              <option value="">{t("form.paidFirstChoose")}</option>
              {state.bills.map((b) => (
                <option key={b.id} value={b.id}>
                  {[b.payer_name, money(b), b.raised_on, b.description].filter(Boolean).join(" — ")}
                </option>
              ))}
            </select>
            {state.chosen !== null && priceMinor > 0 && state.chosen.total_minor !== priceMinor && (
              <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="paid-first-differs">
                {t("form.paidFirstDiffers", { amount: money(state.chosen) })}
              </p>
            )}
          </div>
        ))}
    </div>
  );
}
