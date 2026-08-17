import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared table dressing for the Super Admin's client-side tables (superadmin-reorg). The
 * server-driven lists use <DataTable/>; these small pieces give the remaining hand-rolled
 * admin tables the SAME visual dialect (header typography, cell padding, card frame) instead
 * of the five dialects the audit found. Compose them as plain JSX — no data logic here.
 */
export function TableCard({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "bg-card overflow-x-auto rounded-xl shadow-sm ring-1 ring-foreground/[0.06]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Header cell — matches DataTable's header typography exactly. */
export function Th({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "text-muted-foreground px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide",
        className,
      )}
    >
      {children}
    </th>
  );
}

/** The matching `<thead><tr>` classes: `<tr className={TR_HEAD}>`. */
export const TR_HEAD = "bg-muted/30 border-b";

/** Body cell. */
export function Td({
  children,
  className,
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={cn("px-4 py-3", className)}>
      {children}
    </td>
  );
}
