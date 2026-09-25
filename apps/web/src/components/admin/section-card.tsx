import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * THE titled panel for Super Admin detail pages (superadmin-reorg): an icon, a title, one line
 * saying what the panel is for, an action slot on the end, and a body that is either padded
 * (forms, facts) or flush (lists that draw their own dividers). Every panel on the client page
 * wears this one frame, so the eye reads "section, section, section" instead of the four card
 * dialects the page had grown — uppercase-strip headers, h3-with-icon headers, bare sections and
 * a form with no frame at all.
 */
export function SectionCard({
  icon: Icon,
  title,
  description,
  action,
  tone = "default",
  flush = false,
  className,
  bodyClassName,
  testId,
  children,
}: {
  icon?: LucideIcon;
  title?: ReactNode;
  description?: ReactNode;
  /** Buttons or a link rendered on the header's end side. */
  action?: ReactNode;
  tone?: "default" | "danger";
  /** No body padding — for lists that carry their own dividers and row padding. */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  testId?: string;
  children?: ReactNode;
}) {
  const danger = tone === "danger";

  return (
    <section
      data-testid={testId}
      className={cn(
        "bg-card overflow-hidden rounded-xl shadow-sm ring-1 ring-foreground/[0.06]",
        danger && "ring-destructive/25 bg-destructive/[0.02]",
        className,
      )}
    >
      {(title !== undefined || action !== undefined) && (
        <header
          className={cn(
            "flex flex-wrap items-start justify-between gap-3 px-5 py-4",
            children !== undefined && "border-b",
          )}
        >
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <span
                className={cn(
                  "mt-px flex size-8 shrink-0 items-center justify-center rounded-lg",
                  danger
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              <h2
                className={cn(
                  "text-sm leading-5 font-semibold",
                  danger && "text-destructive",
                )}
              >
                {title}
              </h2>
              {description && (
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  {description}
                </p>
              )}
            </div>
          </div>
          {action !== undefined && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {action}
            </div>
          )}
        </header>
      )}
      {children !== undefined && (
        <div className={cn(!flush && "p-5", bodyClassName)}>{children}</div>
      )}
    </section>
  );
}

/** A save bar under a SectionCard's form: muted strip, buttons on the end. */
export function SectionCardFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-muted/30 -mx-5 -mb-5 mt-5 flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
