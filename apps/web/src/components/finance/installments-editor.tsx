"use client";

import { Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { FinanceInstallmentInput } from "@/lib/api";
import { inputClass } from "./finance-fields";
import {
  addMonths,
  fromMinor,
  money,
  parseDay,
  toMinor,
} from "./finance-format";

/** A row of the plan as the user types it — amounts stay text until submit. */
export interface InstallmentDraft {
  key: string;
  due_on: string;
  amount: string;
  note: string;
}

let seq = 0;

export function newDraft(
  due_on: string,
  amount = "",
  note = "",
): InstallmentDraft {
  seq += 1;

  return { key: `inst-${seq}-${Date.now()}`, due_on, amount, note };
}

/** Rows → API input, or null if any row is missing a date or a positive amount. */
export function draftsToInput(
  rows: InstallmentDraft[],
): FinanceInstallmentInput[] | null {
  const out: FinanceInstallmentInput[] = [];
  for (const row of rows) {
    const minor = toMinor(row.amount);
    if (!row.due_on || minor === null || minor <= 0) return null;
    out.push({
      due_on: row.due_on,
      amount_minor: minor,
      note: row.note.trim() || null,
    });
  }

  return out;
}

export function planTotal(rows: InstallmentDraft[]): number {
  return rows.reduce((sum, row) => sum + (toMinor(row.amount) ?? 0), 0);
}

/**
 * The installment plan editor: a list of (due date, amount, note) rows plus a "split evenly"
 * helper that turns a total into N equal parts, one every M months from the start date. Odd
 * cents land on the first parts so the plan always adds up to the total exactly.
 */
export function InstallmentsEditor({
  rows,
  onChange,
  currency,
  startedOn,
  totalMinor,
}: {
  rows: InstallmentDraft[];
  onChange: (rows: InstallmentDraft[]) => void;
  currency: string;
  startedOn: string;
  /** The total the split helper divides; null disables the helper. */
  totalMinor: number | null;
}) {
  const t = useTranslations("finance.form");
  const locale = useLocale();
  const [parts, setParts] = useState(2);
  const [every, setEvery] = useState(1);

  function update(key: string, patch: Partial<InstallmentDraft>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function add() {
    const last = rows[rows.length - 1];
    const due = last?.due_on ? addMonths(last.due_on, 1) : startedOn;
    onChange([...rows, newDraft(due)]);
  }

  function split() {
    const total = totalMinor ?? planTotal(rows);
    const n = Math.max(1, Math.min(120, Math.floor(parts)));
    const step = Math.max(1, Math.min(24, Math.floor(every)));
    if (total <= 0 || !startedOn) return;
    const base = Math.floor(total / n);
    const remainder = total - base * n;
    const anchor = parseDay(startedOn).getDate();
    onChange(
      Array.from({ length: n }, (_, i) =>
        newDraft(
          addMonths(startedOn, i * step, anchor),
          fromMinor(base + (i < remainder ? 1 : 0)),
        ),
      ),
    );
  }

  const total = planTotal(rows);

  return (
    <div className="space-y-3">
      {rows.length > 0 ? (
        <ol className="space-y-2">
          {rows.map((row, i) => (
            <li
              key={row.key}
              className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2 sm:grid-cols-[auto_1fr_1fr_1.4fr_auto]"
            >
              <span className="text-muted-foreground w-5 text-center text-xs tabular-nums">
                {i + 1}
              </span>
              <input
                type="date"
                value={row.due_on}
                onChange={(e) => update(row.key, { due_on: e.target.value })}
                className={inputClass}
                dir="ltr"
                aria-label={t("startedOn")}
              />
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={row.amount}
                onChange={(e) => update(row.key, { amount: e.target.value })}
                className={inputClass}
                dir="ltr"
                placeholder="0.00"
                aria-label={t("amount")}
              />
              <input
                value={row.note}
                onChange={(e) => update(row.key, { note: e.target.value })}
                className={`${inputClass} col-span-4 sm:col-span-1`}
                placeholder={t("notes")}
                aria-label={t("notes")}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive col-start-4 row-start-1 sm:col-start-5"
                onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                aria-label={t("removeInstallment")}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus data-icon="inline-start" />
          {t("addInstallment")}
        </Button>
        <span className="bg-border mx-1 hidden h-5 w-px sm:block" aria-hidden />
        <input
          type="number"
          min={1}
          max={120}
          value={parts}
          onChange={(e) => setParts(Number(e.target.value))}
          className={`${inputClass} h-7 w-16 text-xs`}
          dir="ltr"
          aria-label={t("parts")}
        />
        <span className="text-muted-foreground text-xs">{t("parts")}</span>
        <input
          type="number"
          min={1}
          max={24}
          value={every}
          onChange={(e) => setEvery(Number(e.target.value))}
          className={`${inputClass} h-7 w-14 text-xs`}
          dir="ltr"
          aria-label={t("everyMonths")}
        />
        <span className="text-muted-foreground text-xs">
          {t("everyMonths")}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={split}
          disabled={(totalMinor ?? total) <= 0}
        >
          {t("splitEvenly")}
        </Button>
        {rows.length > 0 ? (
          <span className="text-muted-foreground ms-auto text-xs">
            {t("planTotal")}:{" "}
            <span
              className="text-foreground font-semibold tabular-nums"
              dir="ltr"
            >
              {money(total, currency, locale)}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
