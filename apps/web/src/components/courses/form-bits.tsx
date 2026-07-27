"use client";

import { Sparkles, Tag } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The shared control styling for the course forms. Taller than a dense data-grid input (36px) so the
 * modals read as forms rather than filters, with a visible focus ring and a muted disabled state for
 * the read-only editor a user without `course.manage` sees.
 */
export const inputClass =
  "border-input bg-background placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-muted/50 disabled:text-muted-foreground h-9 w-full rounded-xl border px-3 text-sm outline-none transition-shadow focus-visible:ring-3 disabled:cursor-not-allowed";

/** A textarea variant of {@link inputClass} (auto height, comfortable line spacing). */
export const textareaClass = cn(inputClass, "h-auto py-2 leading-relaxed");

/** A `<select>` variant of {@link inputClass}. */
export const selectClass = cn(inputClass, "pe-8");

/** Checkbox / radio styling that matches the brand accent in both themes. */
export const checkClass = "accent-primary size-4 shrink-0 cursor-pointer";

/** A labelled form field, optionally with a helper line under the control. */
export function Field({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline gap-1.5">
        <span className="text-sm font-medium">{label}</span>
        {optional && <span className="text-muted-foreground text-xs">{optional}</span>}
      </span>
      {children}
      {hint && <span className="text-muted-foreground block text-xs">{hint}</span>}
    </label>
  );
}

/**
 * A checkbox rendered as a full-width option row — a far bigger hit target than a bare checkbox and
 * clearer about what the toggle actually does.
 */
export function CheckOption({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
        checked ? "border-primary/40 bg-primary/5" : "border-input hover:bg-muted/50",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={cn(checkClass, "mt-0.5")}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="text-muted-foreground mt-0.5 block text-xs">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * The price control for a course: a Free / Paid segmented toggle, revealing a currency-prefixed
 * amount input when Paid. It owns the major↔minor conversion (money is stored in integer minor units,
 * Master Spec §6.3) and reports the resulting minor value up via `onChange` — 0 whenever Free is
 * selected. Seeds once from `defaultMinor`; remount (via a React `key`) to reseed after an external
 * reload.
 */
export function PriceField({
  defaultMinor,
  currency,
  onChange,
  disabled,
  labels,
}: {
  defaultMinor: number;
  currency: string;
  onChange: (minor: number) => void;
  disabled?: boolean;
  labels: { free: string; paid: string; amount: string; placeholder: string; freeHint: string };
}) {
  const [paid, setPaid] = useState(defaultMinor > 0);
  const [text, setText] = useState(defaultMinor > 0 ? String(defaultMinor / 100) : "");

  function emit(nextPaid: boolean, nextText: string) {
    onChange(nextPaid ? Math.max(0, Math.round((Number.parseFloat(nextText) || 0) * 100)) : 0);
  }

  function choose(nextPaid: boolean) {
    if (disabled) return;
    setPaid(nextPaid);
    emit(nextPaid, text);
  }

  return (
    <div className="space-y-2.5">
      <div className="bg-muted/60 grid grid-cols-2 gap-1 rounded-xl p-1">
        <PriceToggle
          active={!paid}
          disabled={disabled}
          onClick={() => choose(false)}
          Icon={Sparkles}
          label={labels.free}
        />
        <PriceToggle
          active={paid}
          disabled={disabled}
          onClick={() => choose(true)}
          Icon={Tag}
          label={labels.paid}
        />
      </div>

      {paid ? (
        <label className="block space-y-1.5">
          <span className="text-muted-foreground text-xs font-medium">{labels.amount}</span>
          <div className="relative">
            <span className="text-muted-foreground pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-sm font-medium">
              {currency}
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              autoFocus
              disabled={disabled}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                emit(true, e.target.value);
              }}
              placeholder={labels.placeholder}
              className={cn(inputClass, "ps-13 text-end tabular-nums")}
            />
          </div>
        </label>
      ) : (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Sparkles className="size-3.5 text-emerald-500" aria-hidden />
          {labels.freeHint}
        </p>
      )}
    </div>
  );
}

function PriceToggle({
  active,
  disabled,
  onClick,
  Icon,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  Icon: typeof Tag;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );
}
