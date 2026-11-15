"use client";

import { useTranslations } from "next-intl";
import { toMajorText, toMinor, todayLocal } from "@/components/accounting/accounting-ui";
import { fieldClass } from "@/components/groups/group-format";
import type { ExpenseCategory, ExpensePatch } from "@/lib/accounting-api";
import { cn } from "@/lib/utils";

/** What an expense looked like when the edit opened, and what it is being changed to. */
export interface ExpenseDraft {
  spent_on: string;
  payee: string;
  description: string;
  amount: string;
  category_id: string;
}

export function draftOf(e: { spent_on: string; payee?: string | null; description?: string | null; amount_minor: number; category_id?: string | null }): ExpenseDraft {
  return { spent_on: e.spent_on, payee: e.payee ?? "", description: e.description ?? "", amount: toMajorText(e.amount_minor), category_id: e.category_id ?? "" };
}

/** Only what changed goes up — the server audits each field before and after. */
export function patchOf(from: ExpenseDraft, to: ExpenseDraft, locks: { amount: boolean; category: boolean }): ExpensePatch {
  const patch: ExpensePatch = {};
  if (to.spent_on && to.spent_on !== from.spent_on) patch.spent_on = to.spent_on;
  if (to.payee.trim() !== from.payee.trim()) patch.payee = to.payee.trim() || null;
  if (to.description.trim() !== from.description.trim()) patch.description = to.description.trim() || null;
  if (!locks.amount && toMinor(to.amount) !== toMinor(from.amount)) patch.amount_minor = toMinor(to.amount);
  if (!locks.category && to.category_id && to.category_id !== from.category_id) patch.category_id = to.category_id;
  return patch;
}

/**
 * Correct an expense instead of voiding it (Lingo 2026-11-15): the day, who received it, what it was
 * for, its category and amount. A refund to a family keeps its amount and category (it is drawn on
 * their receipts); a salary keeps its category.
 */
export function ExpenseEditFields({
  draft,
  onChange,
  currency,
  categories,
  lockAmount,
  lockCategory,
}: {
  draft: ExpenseDraft;
  onChange: (d: ExpenseDraft) => void;
  currency: string;
  /** Pickable categories; none = the category is not offered here. */
  categories?: ExpenseCategory[];
  lockAmount: boolean;
  lockCategory: boolean;
}) {
  const t = useTranslations("accounting");
  const set = (k: keyof ExpenseDraft) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...draft, [k]: ev.target.value });
  const pickable = (categories ?? []).filter((c) => c.is_active && c.key !== "teacher_salaries" && c.key !== "refunds");
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="expense-edit-fields">
      <label className="block text-sm font-medium">
        {t("expenses.spentOn")}
        <input type="date" className={cn(fieldClass, "mt-1.5")} value={draft.spent_on} max={todayLocal()} onChange={set("spent_on")} data-testid="expense-edit-date" />
      </label>
      {!lockAmount && (
        <label className="block text-sm font-medium">
          {t("treasury.account.newAmount", { currency })}
          <input className={cn(fieldClass, "mt-1.5 font-semibold")} inputMode="decimal" dir="ltr" value={draft.amount} onChange={set("amount")} data-testid="expense-edit-amount" />
        </label>
      )}
      <label className="block text-sm font-medium">
        {t("expenses.payee")}
        <input className={cn(fieldClass, "mt-1.5")} maxLength={160} value={draft.payee} onChange={set("payee")} data-testid="expense-edit-payee" />
      </label>
      {!lockCategory && pickable.length > 0 && (
        <label className="block text-sm font-medium">
          {t("expenses.category")}
          <select className={cn(fieldClass, "mt-1.5")} value={draft.category_id} onChange={set("category_id")} data-testid="expense-edit-category">
            {!pickable.some((c) => c.id === draft.category_id) && <option value={draft.category_id}>—</option>}
            {pickable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-sm font-medium sm:col-span-2">
        {t("expenses.description")}
        <input className={cn(fieldClass, "mt-1.5")} maxLength={1000} value={draft.description} onChange={set("description")} data-testid="expense-edit-description" />
      </label>
      {lockAmount && <p className="text-muted-foreground text-xs sm:col-span-2">{t("expenses.refundLocked")}</p>}
    </div>
  );
}
