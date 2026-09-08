import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The form dialect of the finance dialogs — one input look, one label/hint layout. */
export const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/20 h-9 w-full rounded-lg border px-2.5 text-sm focus:ring-2 focus:outline-none disabled:opacity-60";

export const textareaClass =
  "border-input bg-background focus:border-primary focus:ring-primary/20 w-full rounded-lg border px-2.5 py-2 text-sm focus:ring-2 focus:outline-none";

export function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={htmlFor} className="text-xs font-semibold">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint ? (
        <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

/** A two-way toggle rendered as a small segmented control (kind, existing/new client, …). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="bg-muted/60 inline-flex rounded-lg p-0.5" role="group">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60",
            opt.value === value
              ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/[0.06]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
