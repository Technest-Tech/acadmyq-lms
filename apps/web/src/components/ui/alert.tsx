"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type AlertVariant = "success" | "error" | "info";

const VARIANT_STYLES: Record<
  AlertVariant,
  { wrapper: string; iconClass: string; Icon: typeof CheckCircle2 }
> = {
  success: {
    wrapper:
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-200",
    iconClass: "text-emerald-500 dark:text-emerald-400",
    Icon: CheckCircle2,
  },
  error: {
    wrapper:
      "border-destructive/25 bg-destructive/8 text-destructive dark:border-destructive/30 dark:bg-destructive/10",
    iconClass: "text-destructive",
    Icon: AlertCircle,
  },
  info: {
    wrapper:
      "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/40 dark:bg-blue-950/40 dark:text-blue-200",
    iconClass: "text-blue-500 dark:text-blue-400",
    Icon: Info,
  },
};

export interface AlertBannerProps {
  variant: AlertVariant;
  message: string;
  onDismiss?: () => void;
  className?: string;
}

/**
 * Dismissible inline alert banner — success (green), error (red), info (blue).
 * Used in modals and page-level feedback.
 */
export function AlertBanner({
  variant,
  message,
  onDismiss,
  className,
}: AlertBannerProps) {
  const { wrapper, iconClass, Icon } = VARIANT_STYLES[variant];

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-xl border p-3.5", wrapper, className)}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", iconClass)} aria-hidden />
      <p className="flex-1 text-sm leading-relaxed">{message}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 opacity-50 transition-opacity hover:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
