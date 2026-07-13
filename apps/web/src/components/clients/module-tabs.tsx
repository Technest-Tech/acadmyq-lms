"use client";

import { ExternalLink, MessageCircle, MonitorPlay } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ManageModal } from "@/app/(app)/admin/automation/manage-modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  getAutomationOverview,
  getVideoAcademy,
  getVideoPlans,
  setVideoAccess,
  type AutomationOverviewRow,
  type VideoMeetOptions,
  type VideoTierPlan,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The client page's per-module tabs (R4, 04-CLIENT-FIRST-REDESIGN §4) — the ONE home for a
 * client's module configuration, replacing the per-client controls that used to live inside the
 * ops pages (and the legacy Wasender token panel, now deleted):
 *
 *  - ClientWhatsappCard — connection state + the full manage surface (QR connect, toggles,
 *    test-send, API keys, connect link) via the existing ManageModal.
 *  - ClientVideoCard — video TIER + per-client limit/flag overrides (the config half; the
 *    lifecycle half — enable/trial/pause — lives in the Subscriptions card above it).
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

  const connected = row?.wasender_session_status === "connected";

  return (
    <div className="bg-card rounded-2xl border p-5 shadow-sm" data-testid="client-whatsapp-card">
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
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold",
                  connected
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                )}
              >
                {connected ? t("waConnected") : t("waNotConnected")}
              </span>
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

const NUMBER_KEYS = ["maxRooms", "maxRoomParticipants", "recordingRetentionDays"] as const;
const FLAG_KEYS = ["recordingAllowed", "monitorAllowed"] as const;

export function ClientVideoCard({ clientId }: { clientId: string }) {
  const t = useTranslations("clients.detail");
  const toast = useToast();

  const [plans, setPlans] = useState<VideoTierPlan[]>([]);
  const [tierId, setTierId] = useState<string>("");
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, tierPlans] = await Promise.all([getVideoAcademy(clientId), getVideoPlans()]);
      setPlans(tierPlans.plans);
      setTierId(detail.academy.video_plan_id ?? "");
      const ov = (detail.academy.video_overrides ?? {}) as Record<string, unknown>;
      setLimits(
        Object.fromEntries(
          NUMBER_KEYS.map((k) => [k, ov[k] !== undefined && ov[k] !== null ? String(ov[k]) : ""]),
        ),
      );
      setFlags(Object.fromEntries(FLAG_KEYS.map((k) => [k, ov[k] !== 0])));
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const overrides: VideoMeetOptions = {};
      for (const k of NUMBER_KEYS) {
        if (limits[k] !== undefined && limits[k] !== "") {
          overrides[k] = Number(limits[k]);
        }
      }
      for (const k of FLAG_KEYS) {
        if (flags[k] === false) overrides[k] = false; // only an explicit OFF constrains (fail open)
      }
      await setVideoAccess(clientId, {
        action: "set_tier",
        video_plan_id: tierId === "" ? null : tierId,
        overrides,
      });
      toast.success(t("videoSaved"));
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = "bg-card h-8 w-full rounded-md border px-2 text-sm";

  return (
    <div className="bg-card rounded-2xl border p-5 shadow-sm" data-testid="client-video-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <MonitorPlay className="text-muted-foreground size-4" aria-hidden />
          {t("videoConfigTitle")}
        </h3>
        <Link
          href={`/admin/video/${clientId}`}
          className="text-primary inline-flex items-center gap-1 text-xs font-semibold hover:underline"
        >
          {t("videoCardOpen")}
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </div>
      <p className="text-muted-foreground mt-0.5 text-xs">{t("videoConfigHint")}</p>

      {loaded && (
        <div className="mt-4 space-y-3">
          <label className="block max-w-xs text-xs font-medium">
            <span className="text-muted-foreground mb-1 block">{t("videoTier")}</span>
            <select
              value={tierId}
              onChange={(e) => setTierId(e.target.value)}
              className={field}
              data-testid="video-tier"
            >
              <option value="">{t("videoTierNone")}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-3">
            {NUMBER_KEYS.map((k) => (
              <label key={k} className="block text-xs font-medium">
                <span className="text-muted-foreground mb-1 block">{t(`videoLimit.${k}`)}</span>
                <input
                  type="number"
                  min={1}
                  value={limits[k] ?? ""}
                  placeholder={t("videoLimitDefault")}
                  onChange={(e) => setLimits((prev) => ({ ...prev, [k]: e.target.value }))}
                  className={cn(field, "tabular-nums")}
                />
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-4">
            {FLAG_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={flags[k] ?? true}
                  onChange={(e) => setFlags((prev) => ({ ...prev, [k]: e.target.checked }))}
                  className="accent-primary size-4"
                />
                {t(`videoFlag.${k}`)}
              </label>
            ))}
          </div>

          <div className="flex justify-end">
            <Button size="sm" disabled={busy} onClick={save} data-testid="video-save">
              {t("save")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
