"use client";

import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The two surfaces every panel on a student's profile is built from.
 *
 * The profile used to be one tall card holding stacked form sections separated by uppercase
 * captions — everything at the same weight, nothing findable. These give each subject its own
 * bounded card with a named header, so "where do I change the teacher" has a visible answer, and
 * so the page can lay two subjects side by side on a wide screen instead of one long column.
 *
 * Both wear the app's frame: a tinted header wash in the subject's tone, closed by the same gold
 * hairline the sidebar, the sign-in door and the students table use.
 */

export const CARD_TONES = {
  emerald: {
    wash: "from-primary/[0.07]",
    chip: "bg-primary/10 ring-primary/15",
    icon: "text-primary",
  },
  violet: {
    wash: "from-violet-500/[0.08]",
    chip: "bg-violet-500/10 ring-violet-500/20",
    icon: "text-violet-500",
  },
  gold: {
    wash: "from-amber-500/[0.09]",
    chip: "bg-amber-500/10 ring-amber-500/20",
    icon: "text-amber-600 dark:text-amber-400",
  },
  slate: {
    wash: "from-slate-400/[0.08]",
    chip: "bg-slate-400/10 ring-slate-400/20",
    icon: "text-slate-500 dark:text-slate-400",
  },
  danger: {
    wash: "from-destructive/[0.08]",
    chip: "bg-destructive/10 ring-destructive/20",
    icon: "text-destructive",
  },
} as const;

export type CardTone = keyof typeof CARD_TONES;

export function ProfileCard({
  icon: Icon,
  title,
  description,
  action,
  tone = "emerald",
  bodyClassName,
  className,
  testId,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  /** Header-end slot: the one control this card is about (Edit, Add…). */
  action?: ReactNode;
  tone?: CardTone;
  bodyClassName?: string;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  const c = CARD_TONES[tone];

  return (
    <section
      className={cn(
        "bg-card flex flex-col overflow-hidden rounded-2xl border shadow-sm",
        className,
      )}
      data-testid={testId}
    >
      <div className="relative border-b">
        <div
          className={cn(
            "flex items-center gap-3 bg-gradient-to-r to-transparent px-5 py-3.5",
            c.wash,
          )}
        >
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl ring-1",
              c.chip,
            )}
          >
            <Icon className={cn("size-4", c.icon)} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold tracking-tight">{title}</h2>
            {description && (
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {description}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        <span
          className="via-gold/45 absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent to-transparent"
          aria-hidden
        />
      </div>
      <div className={cn("flex-1 p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * One answer, readable without opening a tab. The strip of these under the hero exists because
 * the four questions an academy actually asks about a student — who teaches them, what do they
 * pay, who is the parent, how long have they been here — were each buried one click deep.
 */
export function FactCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "emerald",
  muted = false,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: CardTone;
  /** No value to show — renders the placeholder in a lighter weight. */
  muted?: boolean;
}) {
  const c = CARD_TONES[tone];

  return (
    <div
      className={cn(
        "bg-card flex items-start gap-3 rounded-xl border p-3.5 shadow-sm",
        "bg-gradient-to-br to-transparent",
        c.wash,
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl ring-1",
          c.chip,
        )}
      >
        <Icon className={cn("size-4", c.icon)} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground/80 text-[10px] font-bold uppercase tracking-wider">
          {label}
        </p>
        <p
          className={cn(
            "mt-0.5 truncate text-sm font-semibold",
            muted && "text-muted-foreground/60 font-normal italic",
          )}
        >
          {value}
        </p>
        {sub && (
          <p className="text-muted-foreground mt-0.5 truncate text-[11px]">{sub}</p>
        )}
      </div>
    </div>
  );
}

/** The label/value pair inside a card body — the read-only counterpart of a form field. */
export function DetailRow({
  icon: Icon,
  label,
  value,
  dir,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  dir?: "ltr";
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="bg-muted/60 ring-border/60 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1">
        <Icon className="text-muted-foreground size-3.5" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-muted-foreground/70 text-[10px] font-semibold uppercase tracking-wide">
          {label}
        </p>
        <p className="truncate text-sm font-medium" dir={dir}>
          {value}
        </p>
      </div>
    </div>
  );
}
