"use client";

import {
  ArrowLeft,
  CalendarClock,
  Film,
  HardDrive,
  Loader2,
  MonitorPlay,
  ScrollText,
  Users,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import {
  getVideoAcademy,
  getVideoAcademyRoomLog,
  type VideoAcademyDetail,
  type VideoAcademyRoom,
  type VideoAdminRoomLog,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";
import { fmtBytes, fmtHours } from "../video-format";
import { VideoStatusBadge } from "../video-status";

const FLAG_KEYS = new Set(["recordingAllowed", "monitorAllowed"]);

export function AdminVideoAcademyScreen({ academyId }: { academyId: string }) {
  const t = useTranslations("adminVideo");
  const locale = useLocale();
  const { can } = useAuth();

  const [detail, setDetail] = useState<VideoAcademyDetail | null>(null);
  const [error, setError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [logRoom, setLogRoom] = useState<VideoAcademyRoom | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      setDetail(await getVideoAcademy(academyId));
    } catch {
      setNotFound(true);
    }
  }, [academyId]);

  useEffect(() => {
    if (!can("platform.manage")) return;
    void load();
  }, [can, load]);

  if (!can("platform.manage")) {
    return <p className="text-muted-foreground p-6 text-sm">{t("noPermission")}</p>;
  }

  const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(locale, { dateStyle: "medium" }) : "—");

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <Link href="/admin/video" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("detail.back")}
      </Link>

      {notFound ? (
        <AlertBanner variant="error" message={t("detail.notFound")} />
      ) : detail === null ? (
        <div className="bg-muted h-40 animate-pulse rounded-2xl" aria-hidden />
      ) : (
        <>
          {/* Header */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-gradient-to-br from-indigo-500 to-violet-600 flex size-11 items-center justify-center rounded-xl text-white">
              <MonitorPlay className="size-5.5" aria-hidden />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold">{detail.academy.name}</h1>
                <VideoStatusBadge status={detail.academy.video_status} />
              </div>
              <p className="text-muted-foreground text-xs">
                {detail.academy.plan_name ?? t("usage.noPlan")} · {t("detail.createdAt", { date: fmtDate(detail.academy.created_at) })}
              </p>
            </div>
          </div>

          {error && <AlertBanner variant="error" message={t("loadError")} />}

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat icon={Video} label={t("totals.activeRooms")} value={formatNumber(detail.stats.active_rooms, locale)} tone="text-emerald-600" />
            <Stat icon={Video} label={t("detail.statTotalRooms")} value={formatNumber(detail.stats.total_rooms, locale)} />
            <Stat icon={Film} label={t("totals.recordings")} value={formatNumber(detail.stats.recordings_count, locale)} />
            <Stat icon={HardDrive} label={t("totals.storage")} value={fmtBytes(detail.stats.storage_bytes)} />
            <Stat icon={CalendarClock} label={t("totals.recordingHours")} value={fmtHours(detail.stats.recording_seconds)} />
            <Stat icon={Users} label={t("detail.statSessions")} value={formatNumber(detail.stats.participant_sessions, locale)} />
          </div>

          {/* R4 (one writer per fact): access/trial/tier controls and the duplicated subscription
              block moved to the client page — Subscriptions card + Video tab. This page keeps the
              per-client video USAGE: rooms, logs, effective limits. */}
          <section className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{t("detail.manageTitle")}</h2>
              <p className="text-muted-foreground mt-0.5 text-xs">{t("detail.manageHint")}</p>
              <EffectiveLimits limits={detail.academy.video_limits} t={t} />
            </div>
            <Link
              href={`/admin/clients/${academyId}`}
              className="text-primary text-sm font-semibold whitespace-nowrap hover:underline"
              data-testid="open-client"
            >
              {t("detail.openClient")}
            </Link>
          </section>

          {/* Rooms */}
          <section className="bg-card rounded-2xl border shadow-sm ring-1 ring-foreground/[0.04]">
            <div className="border-b px-5 py-4">
              <h2 className="text-sm font-semibold">{t("detail.roomsTitle")}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-muted-foreground text-xs">
                    <th className="px-4 py-2.5 text-start font-medium">{t("detail.colRoom")}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t("detail.colStatus")}</th>
                    <th className="px-4 py-2.5 text-end font-medium">{t("detail.colRecordings")}</th>
                    <th className="px-4 py-2.5 text-end font-medium">{t("detail.colParticipants")}</th>
                    <th className="px-4 py-2.5 text-end font-medium">{t("detail.colLastActivity")}</th>
                    <th className="px-4 py-2.5 text-end font-medium">{t("detail.colLogs")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {detail.rooms.length === 0 ? (
                    <tr><td colSpan={6} className="text-muted-foreground px-4 py-10 text-center">{t("detail.roomsEmpty")}</td></tr>
                  ) : (
                    detail.rooms.map((r) => (
                      <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 font-medium">{r.name}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", r.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20" : "bg-muted text-muted-foreground ring-foreground/10")}>
                            {t(`detail.roomStatus.${r.status}`)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-end tabular-nums">{formatNumber(r.recordings_count, locale)}</td>
                        <td className="px-4 py-2.5 text-end tabular-nums">{formatNumber(r.participant_sessions, locale)}</td>
                        <td className="text-muted-foreground px-4 py-2.5 text-end text-xs tabular-nums">{r.last_activity ? fmtDate(r.last_activity) : t("detail.never")}</td>
                        <td className="px-4 py-2.5 text-end">
                          <button type="button" onClick={() => setLogRoom(r)} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs" data-testid={`room-logs-${r.id}`}>
                            <ScrollText className="size-3.5" aria-hidden />
                            {t("detail.viewLogs")}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {logRoom && <RoomLogModal academyId={academyId} room={logRoom} onClose={() => setLogRoom(null)} />}
    </div>
  );
}

function EffectiveLimits({ limits, t }: { limits: Record<string, number>; t: ReturnType<typeof useTranslations> }) {
  const keys = Object.keys(limits);
  if (keys.length === 0) {
    return <p className="text-muted-foreground mt-2 text-[11px]">{t("detail.limitsNone")}</p>;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {keys.map((k) => (
        <span key={k} className="bg-muted/60 text-muted-foreground rounded-md px-2 py-0.5 text-[11px]">
          {t(`detail.limit.${k}`)}: {FLAG_KEYS.has(k) ? (limits[k] === 0 ? t("detail.no") : t("detail.yes")) : limits[k]}
        </span>
      ))}
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone?: string }) {
  return (
    <div className="bg-card rounded-xl border p-3.5 shadow-sm ring-1 ring-foreground/[0.04]">
      <div className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-[11px] font-medium">
        <Icon className="size-3.5" aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <p className={cn("text-2xl font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}


function RoomLogModal({ academyId, room, onClose }: { academyId: string; room: VideoAcademyRoom; onClose: () => void }) {
  const t = useTranslations("adminVideo");
  const locale = useLocale();
  const [log, setLog] = useState<VideoAdminRoomLog | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void getVideoAcademyRoomLog(academyId, room.id).then(setLog).catch(() => setFailed(true));
  }, [academyId, room.id]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const fmtTime = (s: string | null) => (s ? new Date(s).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) : "—");
  const fmtDur = (s: number | null) => (s === null ? null : s >= 60 ? `${Math.round(s / 60)}m` : `${s}s`);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card max-h-[85dvh] w-full max-w-2xl overflow-hidden rounded-2xl border shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{room.name}</h2>
            <p className="text-muted-foreground text-xs">{t("roomLog.title")}</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground rounded-lg p-1.5" aria-label={t("add.close")}>
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="max-h-[70dvh] space-y-5 overflow-y-auto p-5">
          {failed ? (
            <AlertBanner variant="error" message={t("loadError")} />
          ) : log === null ? (
            <div className="bg-muted h-32 animate-pulse rounded-xl" aria-hidden />
          ) : (
            <>
              <div>
                <h3 className="text-muted-foreground mb-2 text-xs font-semibold">{t("roomLog.sessions")}</h3>
                {log.sessions.length === 0 ? (
                  <p className="text-muted-foreground text-xs">{t("roomLog.sessionsEmpty")}</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-start font-medium">{t("roomLog.colWho")}</th>
                          <th className="px-3 py-2 text-start font-medium">{t("roomLog.colRole")}</th>
                          <th className="px-3 py-2 text-start font-medium">{t("roomLog.colJoined")}</th>
                          <th className="px-3 py-2 text-end font-medium">{t("roomLog.colDuration")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {log.sessions.map((s) => (
                          <tr key={s.id}>
                            <td className="px-3 py-2 font-medium">{s.user_name ?? s.display_name ?? s.identity}</td>
                            <td className="text-muted-foreground px-3 py-2">{s.role}</td>
                            <td className="text-muted-foreground px-3 py-2 tabular-nums">{fmtTime(s.joined_at)}</td>
                            <td className="px-3 py-2 text-end tabular-nums">
                              {s.ongoing ? (
                                <span className="inline-flex items-center gap-1 text-emerald-600">
                                  <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                                  {t("roomLog.ongoing")}
                                </span>
                              ) : (
                                fmtDur(s.duration_s)
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-muted-foreground mb-2 text-xs font-semibold">{t("roomLog.events")}</h3>
                {log.events.length === 0 ? (
                  <p className="text-muted-foreground text-xs">{t("roomLog.eventsEmpty")}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {log.events.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs">
                        <span className="font-medium">{e.action}</span>
                        <span className="text-muted-foreground tabular-nums">{fmtTime(e.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
