"use client";

import { useTranslations } from "next-intl";
import type { ClientModuleChip, ClientType, ModuleCode } from "@/lib/api";
import { CLIENT_TYPE_MODULES, MODULE_CODES } from "@/lib/api";
import { daysUntil } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * The module chips a client row carries (05-MODULES-NOT-PACKAGES §2): one per module the client's
 * TYPE can hold — colored when it holds a live subscription, muted when it doesn't. A trial shows
 * its countdown in the tooltip; a paused module renders struck. This is the at-a-glance answer to
 * "what does this client have?".
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
  LMS: {
    on: "bg-rose-100 text-rose-700 ring-rose-300/50 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-800/50",
    label: "L",
  },
};


export function ModuleChips({
  modules,
  clientType,
  size = "sm",
}: {
  modules: ClientModuleChip[];
  /** Show the slots this client type can fill; without it, only what it actually holds. */
  clientType?: ClientType;
  size?: "sm" | "md";
}) {
  const t = useTranslations("clients");
  const byModule = new Map(modules.map((m) => [m.module, m]));
  const slots: readonly ModuleCode[] =
    clientType !== undefined
      ? CLIENT_TYPE_MODULES[clientType]
      : MODULE_CODES.filter((code) => byModule.has(code));

  return (
    <div className="flex items-center gap-1.5">
      {slots.map((code) => {
        const sub = byModule.get(code);
        const style = MODULE_STYLE[code];
        const paused = sub?.status === "PAUSED";
        const trialDays = sub?.is_trial ? daysUntil(sub.trial_end) : null;

        const title = sub
          ? paused
            ? `${t(`modules.${code}`)} — ${t("chip.paused")}`
            : sub.is_trial
              ? `${t(`modules.${code}`)} — ${t("chip.trialDays", { days: trialDays ?? 0 })}`
              : `${t(`modules.${code}`)} — ${t("chip.active")}`
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
