"use client";

import { ExternalLink, MessageCircle, MonitorPlay } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ManageModal } from "@/app/(app)/admin/automation/manage-modal";
import { StatusChip } from "@/components/admin/status-chip";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  getAutomationOverview,
  type AutomationOverviewRow,
} from "@/lib/api";

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
    <div className="bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]" data-testid="client-whatsapp-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <MessageCircle className="text-muted-foreground size-4" aria-hidden />
            {t("waTitle")}
          </h3>
          {error !== null ? (
            <p className="text-destructive mt-1 text-xs">{error}</p>
          ) : row === null ? (
            <p className="text-muted-foreground mt-1 text-xs">{t("waLoading")}</p>
          ) : (
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              <StatusChip tone={connected ? "good" : "warn"} dot>
                {connected ? t("waConnected") : t("waNotConnected")}
              </StatusChip>
              <span className="text-muted-foreground">
                {t("waSummary", {
                  sent: row.sent_count,
                  keys: row.api_key_count,
                })}
              </span>
            </p>
          )}
        </div>
        <Button size="sm" disabled={row === null} onClick={() => setOpen(true)} data-testid="wa-manage">
          {t("waManage")}
        </Button>
      </div>

      {open && row !== null && (
        <ManageModal
          academy={row}
          onClose={() => setOpen(false)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

export function ClientVideoCard({ clientId }: { clientId: string }) {
  const t = useTranslations("clients.detail");

  return (
    <div
      className="bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]"
      data-testid="client-video-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <MonitorPlay className="text-muted-foreground size-4" aria-hidden />
          {t("videoCardTitle")}
        </h3>
        <Link
          href={`/admin/video/${clientId}`}
          className="text-primary inline-flex items-center gap-1 text-xs font-semibold hover:underline"
        >
          {t("videoCardOpen")}
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </div>
      <p className="text-muted-foreground mt-0.5 text-xs">{t("videoCardHint")}</p>
    </div>
  );
}
