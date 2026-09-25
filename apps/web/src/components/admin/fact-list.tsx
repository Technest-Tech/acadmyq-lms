import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A key → value list for a detail page's "Details" panel: label on the start side, value on the
 * end, one hairline between rows. The value column is free-form so it can hold a link, a chip or
 * a two-line owner (name over email) without the list changing shape.
 */
export function FactList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <dl className={cn("divide-y", className)}>{children}</dl>;
}

export function Fact({
  label,
  children,
  mono = false,
  testId,
}: {
  label: ReactNode;
  children: ReactNode;
  /** Codes and addresses: monospace, left-to-right regardless of the UI direction. */
  mono?: boolean;
  testId?: string;
}) {
  return (
    <div
      className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
      data-testid={testId}
    >
      <dt className="text-muted-foreground shrink-0 pt-px text-xs font-medium">
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 text-end text-sm font-medium break-words",
          mono && "font-mono text-xs",
        )}
        dir={mono ? "ltr" : undefined}
      >
        {children}
      </dd>
    </div>
  );
}
