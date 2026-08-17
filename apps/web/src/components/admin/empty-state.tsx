import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared empty state for admin screens that don't go through <DataTable/> (which carries its
 * own). Same dashed-border look as DataTable's, so "nothing here yet" reads identically
 * everywhere (superadmin-reorg — before this, one screen had a designed empty state and the
 * rest showed bare centered text).
 */
export function EmptyState({
  icon: Icon = Inbox,
  message,
  action,
  className,
  testId,
}: {
  icon?: LucideIcon;
  message: ReactNode;
  action?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "border-border/60 bg-muted/20 flex flex-col items-center rounded-xl border border-dashed p-10 text-center",
        className,
      )}
    >
      <div className="bg-muted mb-3 flex size-12 items-center justify-center rounded-full">
        <Icon className="text-muted-foreground size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
