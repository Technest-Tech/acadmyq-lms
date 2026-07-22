"use client";

import { Bot, ClipboardCheck, TrendingDown, TrendingUp, User } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AdjustmentSource, AdjustmentType } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Who moved the money, and which way.
 *
 * Provenance is not decoration here. The teacher reads this ledger, so "the system docked you for
 * an unmarked lesson" and "your manager docked you" must never look alike — one is a rule they can
 * avoid triggering, the other is a judgement they might want to discuss. The badge is the only
 * thing carrying that difference, so it renders on every surface that lists an adjustment.
 */

const SOURCE_META: Record<
  AdjustmentSource,
  { icon: typeof Bot; chip: string }
> = {
  MANUAL: {
    icon: User,
    chip: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300",
  },
  QUALITY: {
    icon: ClipboardCheck,
    chip: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  },
  AUTO_UNREPORTED: {
    icon: Bot,
    chip: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  },
};

export function SourceBadge({ source }: { source: AdjustmentSource }) {
  const t = useTranslations("adjustments");
  const meta = SOURCE_META[source];
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        meta.chip,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {t(`source.${source}`)}
    </span>
  );
}

/** A reward or a deduction, with the sign spelled out rather than implied by colour alone. */
export function TypeBadge({ type }: { type: AdjustmentType }) {
  const t = useTranslations("adjustments");
  const isReward = type === "REWARD";
  const Icon = isReward ? TrendingUp : TrendingDown;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        isReward
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {t(`type.${type}`)}
    </span>
  );
}

/**
 * The reason a row exists, in the reader's language.
 *
 * System rows store an English reason for the audit trail — the sweep has no idea who will read it
 * — so a derived row's copy is rebuilt here from `source` and the lesson's date. Hand-typed rows
 * show exactly what the human wrote, untranslated, because that IS the reason.
 */
export function AdjustmentReason({
  source,
  reason,
  sessionLocal,
}: {
  source: AdjustmentSource;
  reason: string;
  sessionLocal?: string | null;
}) {
  const t = useTranslations("adjustments");

  if (source === "AUTO_UNREPORTED") {
    return (
      <span className="text-sm">
        {sessionLocal
          ? t("autoReason", { date: sessionLocal })
          : t("autoReasonNoDate")}
      </span>
    );
  }

  if (source === "QUALITY") {
    return <span className="text-sm">{t("qualityReason")}</span>;
  }

  return <span className="text-sm">{reason}</span>;
}
