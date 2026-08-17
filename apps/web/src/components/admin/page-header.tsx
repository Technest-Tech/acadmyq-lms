import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * THE Super Admin page header (superadmin-reorg): every /admin screen opens with this flat
 * block — optional back link, `h1` + subtitle on the start side, actions on the end. It
 * replaces the five copy-pasted gradient-hero cards and the three ad-hoc header layouts the
 * audit found, so "which era is this screen from?" stops being a question.
 */
export function AdminPageHeader({
  title,
  subtitle,
  titleExtra,
  actions,
  backHref,
  backLabel,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Chips rendered inline after the title (status, deal type…). */
  titleExtra?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {backHref && (
        <Link
          href={backHref}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
          {backLabel}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-xl font-bold tracking-tight">{title}</h1>
            {titleExtra}
          </div>
          {subtitle && (
            <p className="text-muted-foreground mt-0.5 text-sm">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  );
}
