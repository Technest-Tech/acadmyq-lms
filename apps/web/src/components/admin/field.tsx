import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one text-input skin for Super Admin forms (superadmin-reorg): the client page alone had
 * three — `h-9 rounded-lg`, `py-2 rounded-md`, and `h-8 rounded-md` — which read as three eras
 * side by side on the Settings tab.
 */
export const fieldClass =
  "border-input bg-background h-9 w-full rounded-lg border px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60";

/** Label over control, with either a hint or an error underneath — never both. */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-xs font-medium">{label}</span>
      {children}
      {error ? (
        <span className="text-destructive mt-1 block text-xs">{error}</span>
      ) : hint ? (
        <span className="text-muted-foreground mt-1 block text-xs">{hint}</span>
      ) : null}
    </label>
  );
}
