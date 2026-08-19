"use client";

import {
  Building2,
  ChevronRight,
  Clock,
  Database,
  Eye,
  Film,
  Gauge,
  HardDrive,
  Radio,
  RefreshCw,
  Server,
  Video,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatTile } from "@/components/admin/stat-tile";
import { Th, TR_HEAD } from "@/components/admin/table";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import {
  getVideoCompliance,
  getVideoHealth,
  getVideoUsage,
  type VideoComplianceRow,
  type VideoHealth,
  type VideoUsageRow,
  type VideoUsageTotals,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";
import { fmtBytes, fmtHours } from "./video-format";
import { VideoStatusBadge } from "./video-status";

const KNOWN_ACTIONS = new Set([
  "video_room.create",
  "video_room.update",
  "video_room.delete",
  "video_room.rotate_link",
  "video_room.monitor_join",
  "video_room.knock_admit",
  "video_room.knock_deny",
  "video_recording.start",
  "video_recording.delete",
  "video.participant_muted",
  "video.participant_video_muted",
  "video.participant_removed",
  "video.call_ended",
]);

/** Colour the action label by severity so the sensitive entries (supervision, removals) read fast. */
function actionTone(action: string): string {
  if (action === "video_room.monitor_join") return "text-amber-600";
  if (action === "video_recording.start") return "text-indigo-600";
  if (action === "video_recording.delete" || action === "video_room.knock_deny" || action === "video.participant_removed" || action === "video.call_ended")
    return "text-rose-600";
  if (action === "video_room.knock_admit") return "text-emerald-600";
  if (action.startsWith("video.participant")) return "text-slate-500";
  return "text-muted-foreground";
}

export function AdminVideoScreen() {
  const t = useTranslations("adminVideo");
  const tc = useTranslations("clients");
  const locale = useLocale();
  const { can } = useAuth();
  const router = useRouter();

  const [usage, setUsage] = useState<{ academies: VideoUsageRow[]; totals: VideoUsageTotals } | null>(null);
  const [feed, setFeed] = useState<VideoComplianceRow[] | null>(null);
  const [health, setHealth] = useState<VideoHealth | null>(null);
  const [error, setError] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRef = useRef(autoRefresh);
  autoRef.current = autoRefresh;

  const loadData = useCallback(async () => {
    try {
      const [u, c] = await Promise.all([getVideoUsage(), getVideoCompliance(100)]);
      setUsage(u);
      setFeed(c.rows);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      setHealth(await getVideoHealth());
    } catch {
      // A health probe failure shouldn't blank the dashboard — leave the last reading.
    }
  }, []);

  useEffect(() => {
    if (!can("platform.manage")) return;
    void loadData();
    void loadHealth();
    const iv = setInterval(() => {
      if (!autoRef.current) return;
      void loadData();
      void loadHealth();
    }, 15000);
    return () => clearInterval(iv);
  }, [can, loadData, loadHealth]);

  if (!can("platform.manage")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const totals = usage?.totals;
  const fmtTime = (s: string) => new Date(s).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="w-full space-y-5">
      <AdminPageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="accent-primary" />
              {t("autoRefresh")}
            </label>
            <button
              type="button"
              onClick={() => {
                void loadData();
                void loadHealth();
              }}
              className="text-muted-foreground hover:text-foreground rounded-lg border p-2 transition-colors"
              aria-label={t("refresh")}
            >
              <RefreshCw className="size-3.5" aria-hidden />
            </button>
          </>
        }
      />

      {error && <AlertBanner variant="error" message={t("loadError")} />}

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile icon={Building2} label={t("totals.academies")} value={totals ? formatNumber(totals.academies, locale) : null} loading={!totals} />
        <StatTile icon={Video} label={t("totals.activeRooms")} value={totals ? <span className="text-emerald-600">{formatNumber(totals.active_rooms, locale)}</span> : null} loading={!totals} />
        <StatTile icon={Film} label={t("totals.recordings")} value={totals ? formatNumber(totals.recordings_count, locale) : null} loading={!totals} />
        <StatTile icon={HardDrive} label={t("totals.storage")} value={totals ? fmtBytes(totals.storage_bytes) : null} loading={!totals} />
        <StatTile icon={Clock} label={t("totals.recordingHours")} value={totals ? fmtHours(totals.recording_seconds) : null} loading={!totals} />
        <StatTile icon={Radio} label={t("totals.concurrent")} value={totals ? <span className={totals.active_recordings > 0 ? "text-rose-600" : undefined}>{formatNumber(totals.active_recordings, locale)}</span> : null} loading={!totals} />
      </div>

      {/* Service health */}
      <HealthCard health={health} fmtTime={fmtTime} />

      {/* Usage by academy */}
      <section className="bg-card rounded-xl shadow-sm ring-1 ring-foreground/[0.06]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{t("usage.title")}</h2>
            <p className="text-muted-foreground text-xs">{t("usage.subtitle")}</p>
          </div>
          {/* R4: granting video to a client happens on the client page's Subscriptions card —
              this page is platform-wide monitoring only. */}
          <Link
            href="/admin/clients"
            className="text-primary inline-flex items-center gap-1 text-xs font-semibold hover:underline"
          >
            {t("usage.manageOnClients")}
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={TR_HEAD}>
                <Th>{t("usage.colAcademy")}</Th>
                <Th>{t("usage.colStatus")}</Th>
                <Th>{t("usage.colPlan")}</Th>
                <Th>{t("usage.colRooms")}</Th>
                <Th className="text-end">{t("usage.colRecordings")}</Th>
                <Th className="text-end">{t("usage.colStorage")}</Th>
                <Th className="text-end">{t("usage.colRecordingTime")}</Th>
                <Th className="text-end">{t("usage.colLive")}</Th>
                <th className="w-8 px-2 py-2.5" aria-hidden />
              </tr>
            </thead>
            <tbody className="divide-y">
              {usage === null ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={9} className="px-4 py-3">
                      <div className="bg-muted h-5 animate-pulse rounded" aria-hidden />
                    </td>
                  </tr>
                ))
              ) : usage.academies.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-muted-foreground px-4 py-10 text-center">{t("usage.empty")}</td>
                </tr>
              ) : (
                usage.academies.map((a) => (
                  <tr
                    key={a.academy_id}
                    onClick={() => router.push(`/admin/video/${a.academy_id}`)}
                    className="hover:bg-muted/40 cursor-pointer transition-colors"
                    data-testid={`video-academy-row-${a.academy_id}`}
                  >
                    <td className="px-4 py-2.5 font-medium">
                      <Link href={`/admin/video/${a.academy_id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                        {a.academy_name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5"><VideoStatusBadge status={a.video_status} /></td>
                    <td className="text-muted-foreground px-4 py-2.5 text-xs">{tc(`type.${a.client_type ?? "MANAGEMENT"}`)}</td>
                    <td className="px-4 py-2.5">
                      <RoomsCell used={a.active_rooms} cap={a.max_rooms} label={t("usage.roomsOf", { used: formatNumber(a.active_rooms, locale), cap: a.max_rooms === null ? t("usage.unlimited") : formatNumber(a.max_rooms, locale) })} />
                    </td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{formatNumber(a.recordings_count, locale)}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{fmtBytes(a.storage_bytes)}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{fmtHours(a.recording_seconds)}</td>
                    <td className="px-4 py-2.5 text-end">
                      {a.active_recordings > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-600/20">
                          <span className="size-1.5 animate-pulse rounded-full bg-rose-500" />
                          {t("usage.liveRecording")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-end"><ChevronRight className="text-muted-foreground size-4 rtl:rotate-180" aria-hidden /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Compliance feed */}
      <section className="bg-card rounded-xl shadow-sm ring-1 ring-foreground/[0.06]">
        <div className="border-b px-5 py-4">
          <h2 className="text-sm font-semibold">{t("compliance.title")}</h2>
          <p className="text-muted-foreground text-xs">{t("compliance.subtitle")}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={TR_HEAD}>
                <Th>{t("compliance.colAcademy")}</Th>
                <Th>{t("compliance.colAction")}</Th>
                <Th>{t("compliance.colActor")}</Th>
                <Th className="text-end">{t("compliance.colTime")}</Th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {feed === null ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={4} className="px-4 py-3">
                      <div className="bg-muted h-5 animate-pulse rounded" aria-hidden />
                    </td>
                  </tr>
                ))
              ) : feed.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-muted-foreground px-4 py-10 text-center">{t("compliance.empty")}</td>
                </tr>
              ) : (
                feed.map((r) => {
                  const isMonitor = r.action === "video_room.monitor_join";
                  return (
                    <tr key={r.id} className={cn("hover:bg-muted/30 transition-colors", isMonitor && "bg-amber-50/50 dark:bg-amber-950/20")}>
                      <td className="px-4 py-2.5 font-medium">{r.academy_name ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          {isMonitor && <Eye className="size-3.5 text-amber-600" aria-hidden />}
                          <span className={cn("text-xs font-medium", actionTone(r.action))}>
                            {KNOWN_ACTIONS.has(r.action) ? t(`action.${r.action.replace(/\./g, "_")}`) : r.action}
                          </span>
                          {isMonitor && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-600/20">
                              {t("compliance.monitorBadge")}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="text-muted-foreground px-4 py-2.5 text-xs">{r.actor_name ?? t("compliance.system")}</td>
                      <td className="px-4 py-2.5 text-end text-xs tabular-nums">{fmtTime(r.created_at)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}

function RoomsCell({ used, cap, label }: { used: number; cap: number | null; label: string }) {
  const pct = cap && cap > 0 ? Math.min(100, (used / cap) * 100) : null;
  const tone =
    cap !== null && used >= cap ? "bg-rose-500" : pct !== null && pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="min-w-[7rem]">
      <p className="mb-1 text-xs font-medium tabular-nums">{label}</p>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div className={cn("h-full rounded-full", pct === null ? "bg-muted-foreground/30" : tone)} style={{ width: `${pct ?? (used > 0 ? 100 : 0)}%` }} />
      </div>
    </div>
  );
}

function HealthCard({ health, fmtTime }: { health: VideoHealth | null; fmtTime: (s: string) => string }) {
  const t = useTranslations("adminVideo");
  const locale = useLocale();

  const livekitState = health === null ? null : health.livekit.ok ? "online" : "offline";
  const egressState = health === null ? null : health.egress.ok ? "online" : "offline";
  const storageState = health === null ? null : !health.storage.configured ? "notConfigured" : health.storage.ok ? "online" : "offline";

  const level = health?.capacity.level ?? "unknown";
  const active = health?.capacity.active_recordings ?? null;
  const limit = health?.capacity.soft_limit ?? 2;

  return (
    <section className="bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">{t("health.title")}</h2>
          <p className="text-muted-foreground text-xs">{t("health.subtitle")}</p>
        </div>
        {health !== null && (
          <span className="text-muted-foreground hidden text-[11px] sm:inline">{t("health.checkedAt", { time: fmtTime(health.checked_at) })}</span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ProbeRow icon={Server} label={t("health.livekit")} state={livekitState} detail={health && health.livekit.ok ? t("health.liveRooms", { count: formatNumber(health.livekit.rooms ?? 0, locale) }) : undefined} />
        <ProbeRow icon={Film} label={t("health.egress")} state={egressState} />
        <ProbeRow icon={Database} label={t("health.storage")} state={storageState} detail={health?.storage.bucket ? t("health.bucket", { bucket: health.storage.bucket }) : undefined} />

        {/* Capacity hint */}
        <div className={cn("rounded-xl border p-3", level === "at_capacity" ? "border-rose-300 bg-rose-50/60" : level === "busy" ? "border-amber-300 bg-amber-50/60" : "bg-muted/30")}>
          <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[11px] font-medium">
            <Gauge className="size-3.5" aria-hidden />
            {t("health.capacityTitle")}
          </div>
          <p className={cn("text-sm font-semibold", level === "at_capacity" ? "text-rose-700" : level === "busy" ? "text-amber-700" : "text-foreground")}>
            {t(`health.level.${level}`)}
          </p>
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            {active === null ? t("health.capacityUnknown") : t("health.capacityActive", { count: formatNumber(active, locale), limit: formatNumber(limit, locale) })}
          </p>
        </div>
      </div>
    </section>
  );
}

function ProbeRow({ icon: Icon, label, state, detail }: { icon: LucideIcon; label: string; state: "online" | "offline" | "notConfigured" | null; detail?: string }) {
  const t = useTranslations("adminVideo");
  const ok = state === "online";
  const off = state === "offline";
  return (
    <div className="bg-muted/30 flex items-center gap-3 rounded-xl border p-3">
      <div className={cn("flex size-9 items-center justify-center rounded-lg text-white", ok ? "bg-emerald-500" : off ? "bg-rose-500" : "bg-slate-400")}>
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">{label}</p>
        <p className={cn("flex items-center gap-1 text-[11px]", ok ? "text-emerald-600" : off ? "text-rose-600" : "text-muted-foreground")}>
          {state !== null && <span className={cn("size-1.5 rounded-full", ok ? "bg-emerald-500" : off ? "bg-rose-500" : "bg-slate-400")} />}
          {state === null ? "…" : t(`health.${state === "notConfigured" ? "notConfigured" : state}`)}
        </p>
        {detail && <p className="text-muted-foreground truncate text-[10px]">{detail}</p>}
      </div>
    </div>
  );
}
