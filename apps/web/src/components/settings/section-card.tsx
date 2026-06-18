"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared shell for a settings section: a rounded card with a gradient icon chip,
 * title + description header, and a body. Keeps the three settings sections visually
 * consistent and modern.
 */
export function SectionCard({
  icon: Icon,
  title,
  description,
  iconClassName,
  testId,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Tailwind classes for the icon chip background (gradient per section). */
  iconClassName: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="overflow-hidden rounded-2xl border bg-card shadow-sm ring-1 ring-black/[0.02]"
      data-testid={testId}
    >
      <div className="flex items-center gap-3.5 border-b bg-gradient-to-r from-muted/40 to-transparent px-6 py-5">
        <div
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm",
            iconClassName,
          )}
        >
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
        </div>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}
