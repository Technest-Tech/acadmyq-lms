"use client";

import type React from "react";
import { cn } from "@/lib/utils";

/** The shared text-input styling used across the course forms. */
export const inputClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-3";

/** A labelled form field wrapper. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

/** A textarea variant of {@link inputClass} (auto height). */
export const textareaClass = cn(inputClass, "h-auto py-2");
