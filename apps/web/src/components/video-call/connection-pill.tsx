"use client";

import { useConnectionQualityIndicator, useLocalParticipant } from "@livekit/components-react";
import { ConnectionQuality } from "livekit-client";
import { useTranslations } from "next-intl";

/**
 * A small connection-quality pill for the local participant (top of the call stage). Maps the
 * LiveKit ConnectionQuality to a calm coloured dot + label; hidden while quality is unknown.
 */
export function ConnectionPill() {
  const t = useTranslations("videoCall");
  const { localParticipant } = useLocalParticipant();
  const { quality } = useConnectionQualityIndicator({ participant: localParticipant });

  const config: Record<string, { label: string; text: string; dot: string } | undefined> = {
    [ConnectionQuality.Excellent]: { label: t("qualityExcellent"), text: "text-emerald-300", dot: "bg-emerald-400" },
    [ConnectionQuality.Good]: { label: t("qualityGood"), text: "text-emerald-300", dot: "bg-emerald-400" },
    [ConnectionQuality.Poor]: { label: t("qualityPoor"), text: "text-amber-300", dot: "bg-amber-400" },
    [ConnectionQuality.Lost]: { label: t("qualityLost"), text: "text-red-300", dot: "bg-red-400" },
  };
  const c = config[quality];
  if (!c) return null;

  return (
    <span
      className={`flex items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-1 text-xs font-medium ring-1 ring-white/10 backdrop-blur ${c.text}`}
    >
      <span className={`size-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}
