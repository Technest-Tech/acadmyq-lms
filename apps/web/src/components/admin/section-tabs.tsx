"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionTab<K extends string> {
  key: K;
  label: string;
  icon?: LucideIcon;
  /** A small count on the tab — "2" live modules, "3" pending bills. */
  badge?: ReactNode;
}

/**
 * The underline tab strip for a Super Admin detail page (superadmin-reorg): icon + label, an
 * optional count, the active one marked in the brand colour. Scrolls sideways on a phone instead
 * of wrapping, so the strip stays one line no matter how many sections a client has.
 */
export function SectionTabs<K extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  tabs: SectionTab<K>[];
  value: K;
  onChange: (key: K) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "no-scrollbar flex gap-1 overflow-x-auto border-b",
        className,
      )}
    >
      {tabs.map(({ key, label, icon: Icon, badge }) => {
        const active = value === key;

        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`tab-${key}`}
            onClick={() => onChange(key)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {Icon && (
              <Icon
                className={cn(
                  "size-4",
                  active ? "text-primary" : "text-muted-foreground/70",
                )}
                aria-hidden
              />
            )}
            {label}
            {badge !== undefined && badge !== null && (
              <span
                className={cn(
                  "ms-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums",
                  active
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
