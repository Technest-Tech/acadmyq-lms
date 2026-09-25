"use client";

import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * A toggle switch.
 *
 * Underneath it is a real checkbox: `checked`, `disabled`, `onChange`, `data-testid` and form
 * semantics all land on the input, so tests read it with `toBeChecked()` and assistive tech gets
 * a `switch` — while the visible track and thumb are plain CSS driven by `:checked`. The input
 * sits invisibly over the whole control, which is what makes the track itself clickable without a
 * wrapping `<label>` (so a Switch can live inside a row that is already a label).
 */
export function Switch({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role">) {
  return (
    <span className={cn("relative inline-flex h-5 w-9 shrink-0", className)}>
      <input
        type="checkbox"
        role="switch"
        className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-not-allowed"
        {...props}
      />
      <span
        aria-hidden
        className="bg-muted-foreground/25 peer-checked:bg-primary peer-focus-visible:ring-ring/50 peer-focus-visible:ring-offset-background absolute inset-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-disabled:opacity-50"
      />
      <span
        aria-hidden
        className="absolute start-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4 rtl:peer-checked:-translate-x-4"
      />
    </span>
  );
}
