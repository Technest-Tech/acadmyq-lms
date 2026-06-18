"use client";

import { ArrowUpCircle, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/**
 * The premium "upgrade" surface (Sprint 9 design mandate) — an UPSELL, never an error. Used
 * wherever a feature is locked by the academy's plan (a 402 `upgrade_required`, distinct from
 * a 403 forbidden). It reads as an invitation: what the plan unlocks + a clear CTA, with the
 * brand gradient and a Sparkles accent — visually distinct from the destructive "forbidden".
 */
export function UpgradePrompt({
  title,
  description,
  unlocks,
  cta,
}: {
  title?: string;
  description?: string;
  unlocks?: ReactNode;
  cta?: ReactNode;
}) {
  const t = useTranslations("entitlements");

  return (
    <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-6 text-center shadow-sm ring-1 ring-foreground/[0.04]">
      <div className="bg-primary/12 text-primary mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl">
        <Sparkles className="size-6" aria-hidden />
      </div>
      <h3 className="text-lg font-bold tracking-tight">
        {title ?? t("upgradeTitle")}
      </h3>
      <p className="text-muted-foreground mx-auto mt-1.5 max-w-md text-sm">
        {description ?? t("upgradeBody")}
      </p>
      {unlocks && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {unlocks}
        </div>
      )}
      <div className="mt-5">
        {cta ?? (
          <span className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium shadow-sm">
            <ArrowUpCircle className="size-4" aria-hidden />
            {t("upgradeCta")}
          </span>
        )}
      </div>
    </div>
  );
}

/** A compact unlock chip used inside an UpgradePrompt's `unlocks` row. */
export function UnlockChip({ children }: { children: ReactNode }) {
  return (
    <span className="bg-card text-foreground/80 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm ring-1 ring-foreground/[0.04]">
      <span className="bg-primary size-1.5 rounded-full" aria-hidden />
      {children}
    </span>
  );
}
