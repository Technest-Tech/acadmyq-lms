"use client";

import { ExternalLink, MessageCircle, MonitorPlay } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ManageModal } from "@/app/(app)/admin/automation/manage-modal";
import { SectionCard } from "@/components/admin/section-card";
import { StatusChip } from "@/components/admin/status-chip";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  ApiError,
  getAutomationOverview,
  type AutomationOverviewRow,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The client page's per-module tabs (R4, 04-CLIENT-FIRST-REDESIGN §4) — the ONE home for a
 * client's module configuration, replacing the per-client controls that used to live inside the
 * ops pages (and the legacy Wasender token panel, now deleted):
 *
 *  - ClientWhatsappCard — connection state + the full manage surface (QR connect, toggles,
 *    test-send, API keys, connect link) via the existing ManageModal.
 *  - ClientVideoCard — a signpost to Video Ops (rooms, recordings, logs). It carries no controls:
 *    the module itself is written by the Modules card and its caps by the Features card, so there
 *    is exactly one writer per fact (05-MODULES-NOT-PACKAGES §4).
 */

export function ClientWhatsappCard({ clientId }: { clientId: string }) {
  const t = useTranslations("clients.detail");
  const [row, setRow] = useState<AutomationOverviewRow | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getAutomationOverview();
      setRow(res.academies.find((a) => a.academy_id === clientId) ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Every writer stores this uppercase (the webhook and the status probe both strtoupper it), so a
  // case-sensitive compare against "connected" never matched and the badge always read disconnected.
  const connected = row?.wasender_session_status?.toUpperCase() === "CONNECTED";

  return (
    <SectionCard
      icon={MessageCircle}
      title={t("waTitle")}
      description={t("sections.whatsappHint")}
      action={
        <Button
          size="sm"
          disabled={row === null}
          onClick={() => setOpen(true)}
          data-testid="wa-manage"
        >
          {t("waManage")}
        </Button>
      }
      testId="client-whatsapp-card"
    >
      {error !== null ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : row === null ? (
        <p className="text-muted-foreground text-xs">{t("waLoading")}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <StatusChip tone={connected ? "good" : "warn"} dot>
            {connected ? t("waConnected") : t("waNotConnected")}
          </StatusChip>
          <span className="text-muted-foreground">
            {t("waSummary", { sent: row.sent_count, keys: row.api_key_count })}
          </span>
        </div>
      )}

      {open && row !== null && (
        <ManageModal
          academy={row}
          onClose={() => setOpen(false)}
          onChanged={() => void load()}
        />
      )}
    </SectionCard>
  );
}

export function ClientVideoCard({ clientId }: { clientId: string }) {
  const t = useTranslations("clients.detail");

  return (
    <SectionCard
      icon={MonitorPlay}
      title={t("videoCardTitle")}
      description={t("videoCardHint")}
      action={
        <Link
          href={`/admin/video/${clientId}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          {t("videoCardOpen")}
          <ExternalLink className="size-3.5" aria-hidden />
        </Link>
      }
      testId="client-video-card"
    />
  );
}
