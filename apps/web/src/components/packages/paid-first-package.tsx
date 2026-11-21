"use client";

import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { listPaidBills, type PaidBill, type StudentInput } from "@/lib/api";
import { formatMoney } from "@/lib/money";

const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3";

type PaidMethod = NonNullable<NonNullable<StudentInput["package"]>["paid_method"]>;

/** "No, a new bill" in the picker. */
const NEW_BILL = "new";

/**
 * The bill the form picks by itself: one typed under the student's (or parent's) name, else one of
 * the chosen parent's own bills for exactly the package's price. A family bill for another amount
 * may be something else entirely (a sibling's books), so it is offered, never picked.
 */
function autoPick(bills: PaidBill[], priceMinor: number): PaidBill | null {
  return bills.find((b) => !b.from_family) ?? bills.find((b) => b.total_minor === priceMinor) ?? null;
}

/**
 * "The first package is already paid" on the new-student form (Ahmed 2026-11-17, by name
 * 2026-11-22).
 *
 * The desk raises a hand-made bill under the family's name, the family pays, and only then is the
 * student added. Ticked, the form looks for that bill under the student's or the parent's name and
 * the package opens ON it, marked paid. Nothing found: the package raises its own bill, marked
 * paid. Either way the block never reaches the Due page.
 */
export function usePaidFirstPackage({
  name,
  parentName,
  guardianId,
  currency,
  priceMinor,
}: {
  name: string;
  parentName: string;
  /** The parent already chosen (empty while a new parent is being typed). */
  guardianId: string;
  currency: string;
  priceMinor: number;
}) {
  const [checked, setChecked] = useState(false);
  const [choice, setChoice] = useState("");
  const [method, setMethod] = useState<PaidMethod>("CASH");
  const [bills, setBills] = useState<PaidBill[] | null>(null);

  const hasName = name.trim() !== "" || parentName.trim() !== "" || guardianId !== "";

  useEffect(() => {
    if (!checked) return;
    let live = true;
    setBills(null);
    // Typed letter by letter: ask once the name settles.
    const timer = setTimeout(() => {
      listPaidBills({ name, parentName, guardianId: guardianId || undefined, currency: currency || undefined })
        .then((res) => {
          if (live) setBills(res.bills);
        })
        .catch(() => {
          if (live) setBills([]);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [checked, name, parentName, guardianId, currency]);

  // A bill picked by hand stands while it is still on offer; otherwise the form's own pick.
  const picked = choice !== "" && choice !== NEW_BILL ? (bills?.find((b) => b.id === choice) ?? null) : null;
  const chosen = !checked || bills === null || choice === NEW_BILL ? null : (picked ?? autoPick(bills, priceMinor));
  const owes = chosen === null || chosen.amount_paid_minor < chosen.total_minor;

  return {
    checked,
    setChecked,
    bills,
    hasName,
    chosen,
    /** What the picker shows: the chosen bill, or "a new bill". */
    value: chosen?.id ?? NEW_BILL,
    setChoice,
    method,
    setMethod,
    /** A payment is recorded (a new bill, or a found one nobody marked paid): say how it came in. */
    needsMethod: checked && owes,
    /** Still looking: saving now would raise a new bill while a matching one may be on its way. */
    loading: checked && bills === null,
    /** The `package` fields this adds to the create-student request. */
    toPayload(): Partial<NonNullable<StudentInput["package"]>> {
      if (!checked) return {};
      return {
        paid_first: true,
        ...(chosen !== null ? { paid_invoice_id: chosen.id } : {}),
        ...(owes ? { paid_method: method } : {}),
      };
    },
  };
}

export type PaidFirstPackage = ReturnType<typeof usePaidFirstPackage>;

export function PaidFirstPackageField({
  state,
  priceMinor,
  idPrefix = "pkg",
}: {
  state: PaidFirstPackage;
  /** The package's price, to say so when the found bill is for another amount. */
  priceMinor: number;
  idPrefix?: string;
}) {
  const t = useTranslations("packages");
  const tInv = useTranslations("invoices");
  const locale = useLocale();
  const money = (b: PaidBill) => formatMoney({ amount: b.total_minor, currency: b.currency }, locale);
  const { chosen, bills } = state;

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

      {state.checked && (
        <div className="space-y-2 rounded-xl border border-dashed px-3 py-2.5">
          {!state.hasName ? (
            <p className="text-muted-foreground text-xs" data-testid="paid-first-no-name">
              {t("form.paidFirstNoName")}
            </p>
          ) : bills === null ? (
            <p className="text-muted-foreground text-xs">{t("form.paidFirstLoading")}</p>
          ) : bills.length === 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="paid-first-none">
              {t("form.paidFirstNone")}
            </p>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor={`${idPrefix}-paid-bill`} className="text-sm font-medium">
                {t("form.paidFirstBill")}
              </label>
              <select
                id={`${idPrefix}-paid-bill`}
                value={state.value}
                onChange={(e) => state.setChoice(e.target.value)}
                className={inputClass}
                data-testid="paid-first-bill"
              >
                {bills.map((b) => (
                  <option key={b.id} value={b.id}>
                    {[
                      b.payer_name,
                      money(b),
                      b.raised_on,
                      b.description,
                      t(b.amount_paid_minor >= b.total_minor ? "form.paidFirstStatusPaid" : "form.paidFirstStatusUnpaid"),
                    ]
                      .filter(Boolean)
                      .join(" — ")}
                  </option>
                ))}
                <option value={NEW_BILL}>{t("form.paidFirstNew")}</option>
              </select>
              <p className="text-muted-foreground text-xs" data-testid="paid-first-outcome">
                {chosen === null
                  ? t("form.paidFirstNewBill")
                  : chosen.amount_paid_minor >= chosen.total_minor
                    ? t("form.paidFirstPaid")
                    : t("form.paidFirstUnpaid")}
              </p>
              {chosen !== null && priceMinor > 0 && chosen.total_minor !== priceMinor && (
                <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="paid-first-differs">
                  {t("form.paidFirstDiffers", { amount: money(chosen) })}
                </p>
              )}
            </div>
          )}

          {state.needsMethod && (
            <div className="space-y-1.5">
              <label htmlFor={`${idPrefix}-paid-method`} className="text-sm font-medium">
                {t("form.paidFirstMethod")}
              </label>
              <select
                id={`${idPrefix}-paid-method`}
                value={state.method}
                onChange={(e) => state.setMethod(e.target.value as PaidMethod)}
                className={inputClass}
                data-testid="paid-first-method"
              >
                <option value="CASH">{tInv("methodCash")}</option>
                <option value="BANK_TRANSFER">{tInv("methodBankTransfer")}</option>
                <option value="OTHER">{tInv("methodOther")}</option>
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
