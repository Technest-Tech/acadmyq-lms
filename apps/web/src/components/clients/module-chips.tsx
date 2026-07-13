"use client";

import { useTranslations } from "next-intl";
import type { ClientModuleChip, ModuleCode } from "@/lib/api";
import { MODULE_CODES } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The three module chips a client row carries (R2, 04-CLIENT-FIRST-REDESIGN §3): one per product —
 * Management / Video / WhatsApp — colored when the client has a live subscription for it, muted
 * when it doesn't. A trial shows its countdown in the tooltip; a paused module renders struck.
 * This is the at-a-glance answer to "what does this client have?".
 */

export const MODULE_STYLE: Record<
  ModuleCode,
  { on: string; label: string }
> = {
  MANAGEMENT: {
    on: "bg-sky-100 text-sky-700 ring-sky-300/50 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-800/50",
    label: "M",
  },
  VIDEO: {
    on: "bg-violet-100 text-violet-700 ring-violet-300/50 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-800/50",
    label: "V",
  },
  WHATSAPP: {
    on: "bg-emerald-100 text-emerald-700 ring-emerald-300/50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50",
    label: "W",
  },
};

/** Whole days from now until an ISO date (negative once past), or null when unset. */
export function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function ModuleChips({
  modules,
  size = "sm",
}: {
  modules: ClientModuleChip[];
  size?: "sm" | "md";
}) {
  const t = useTranslations("clients");
  const byModule = new Map(modules.map((m) => [m.module, m]));

  return (
    <div className="flex items-center gap-1.5">
      {MODULE_CODES.map((code) => {
        const sub = byModule.get(code);
        const style = MODULE_STYLE[code];
        const paused = sub?.status === "PAUSED";
        const trialDays = sub?.is_trial ? daysLeft(sub.trial_end) : null;

        const title = sub
          ? paused
            ? `${t(`modules.${code}`)} — ${t("chip.paused")}`
            : sub.is_trial
              ? `${t(`modules.${code}`)} — ${t("chip.trialDays", { days: trialDays ?? 0 })}`
              : `${t(`modules.${code}`)} — ${sub.plan_name ?? t("chip.active")}`
          : `${t(`modules.${code}`)} — ${t("chip.off")}`;

        return (
          <span
            key={code}
            title={title}
            data-module={code}
            data-state={sub ? (paused ? "paused" : sub.is_trial ? "trial" : "active") : "off"}
            className={cn(
              "inline-flex items-center justify-center rounded-full font-bold ring-1",
              size === "sm" ? "h-5 min-w-5 px-1 text-[10px]" : "h-6 min-w-6 px-1.5 text-[11px]",
              sub
                ? cn(style.on, paused && "line-through opacity-50")
                : "text-muted-foreground/50 ring-border bg-transparent",
            )}
          >
            {style.label}
            {sub?.is_trial && !paused && trialDays !== null && (
              <span className="ms-0.5 font-semibold">{Math.max(trialDays, 0)}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
