"use client";

import {
  ArrowLeft,
  CalendarClock,
  CreditCard,
  Film,
  HardDrive,
  Loader2,
  MonitorPlay,
  Power,
  PowerOff,
  RotateCcw,
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
  getVideoPlans,
  setVideoAccess,
  type VideoAcademyDetail,
  type VideoAcademyRoom,
  type VideoAccessPayload,
  type VideoAdminRoomLog,
  type VideoTierPlan,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";
import { daysUntil, fmtBytes, fmtHours } from "../video-format";
import { VideoStatusBadge } from "../video-status";

const FLAG_KEYS = new Set(["recordingAllowed", "monitorAllowed"]);

export function AdminVideoAcademyScreen({ academyId }: { academyId: string }) {
  const t = useTranslations("adminVideo");
  const locale = useLocale();
  const { can } = useAuth();

  const [detail, setDetail] = useState<VideoAcademyDetail | null>(null);
  const [plans, setPlans] = useState<VideoTierPlan[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [trialDays, setTrialDays] = useState(14);
  const [logRoom, setLogRoom] = useState<VideoAcademyRoom | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [d, p] = await Promise.all([getVideoAcademy(academyId), getVideoPlans().catch(() => ({ plans: [] }))]);
      setDetail(d);
      setPlans(p.plans);
    } catch {
      setNotFound(true);
    }
  }, [academyId]);

  useEffect(() => {
    if (!can("platform.manage")) return;
    void load();
  }, [can, load]);

  const act = useCallback(
    async (payload: VideoAccessPayload) => {
      setBusy(true);
      setError(false);
      try {
        await setVideoAccess(academyId, payload);
        await load();
      } catch {
        setError(true);
      } finally {
        setBusy(false);
      }
    },
    [academyId, load],
  );

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

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Access controls */}
            <section className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
              <h2 className="mb-1 text-sm font-semibold">{t("detail.accessTitle")}</h2>
              <p className="text-muted-foreground mb-4 text-xs">{t("detail.accessSubtitle")}</p>

              {detail.academy.video_status === "TRIAL" && detail.academy.video_trial_ends_at && (
                <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50/60 p-3 text-xs text-amber-800">
                  {t("detail.trialEnds", {
                    date: fmtDate(detail.academy.video_trial_ends_at),
                    days: Math.max(0, daysUntil(detail.academy.video_trial_ends_at) ?? 0),
                  })}
                </div>
              )}

              {/* Tier */}
              <div className="mb-4">
                <label className="text-muted-foreground mb-1 block text-xs font-medium">{t("detail.videoTier")}</label>
                <select
                  value={detail.academy.video_plan_id ?? ""}
                  disabled={busy}
                  onChange={(e) => void act({ action: "set_tier", video_plan_id: e.target.value || null })}
                  className="bg-background w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                  data-testid="tier-select"
                >
                  <option value="">{t("detail.tierFromPlan")}</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <EffectiveLimits limits={detail.academy.video_limits} t={t} />
              </div>

              {/* Trial days + actions */}
              <div className="mb-3 flex items-end gap-2">
                <div className="w-28">
                  <label className="text-muted-foreground mb-1 block text-xs font-medium">{t("detail.trialDays")}</label>
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={Number.isFinite(trialDays) ? trialDays : 1}
                    onChange={(e) => setTrialDays(Math.max(1, parseInt(e.target.value || "1", 10)))}
                    className="bg-background w-full rounded-lg border px-3 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                {detail.academy.video_status === "TRIAL" ? (
                  <ActionButton busy={busy} onClick={() => void act({ action: "extend_trial", trial_days: trialDays })} icon={CalendarClock} label={t("detail.extendTrial")} />
                ) : (
                  <ActionButton busy={busy} onClick={() => void act({ action: "trial", trial_days: trialDays })} icon={CalendarClock} label={t("detail.startTrial")} />
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {detail.academy.video_status !== "ENABLED" && (
                  <ActionButton busy={busy} primary onClick={() => void act({ action: "enable" })} icon={Power}
                    label={detail.academy.video_status === "TRIAL" ? t("detail.makePermanent") : t("detail.activate")} testid="activate" />
                )}
                {(["ENABLED", "TRIAL", "PLAN"] as const).includes(detail.academy.video_status as "ENABLED" | "TRIAL" | "PLAN") && (
                  <ActionButton busy={busy} danger onClick={() => void act({ action: "disable" })} icon={PowerOff} label={t("detail.deactivate")} testid="deactivate" />
                )}
                {detail.academy.video_access !== null && (
                  <ActionButton busy={busy} onClick={() => void act({ action: "follow_plan" })} icon={RotateCcw} label={t("detail.revertPlan")} />
                )}
              </div>
            </section>

            {/* Subscription */}
            <section className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
              <div className="mb-3 flex items-center gap-2">
                <CreditCard className="text-primary size-4" aria-hidden />
                <h2 className="text-sm font-semibold">{t("detail.subscription")}</h2>
              </div>
              {detail.subscription === null ? (
                <p className="text-muted-foreground text-sm">{t("detail.noSubscription")}</p>
              ) : (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <Row label={t("detail.subPlan")} value={detail.subscription.plan_name ?? "—"} />
                  <Row label={t("detail.subStatus")} value={detail.subscription.status} />
                  <Row label={t("detail.subTrialEnds")} value={fmtDate(detail.subscription.trial_end)} />
                  <Row label={t("detail.subPeriodEnds")} value={fmtDate(detail.subscription.current_period_end)} />
                  <Row label={t("detail.subCurrency")} value={detail.subscription.currency ?? "—"} />
                  <Row label={t("detail.subIsTrial")} value={detail.subscription.is_trial ? t("detail.yes") : t("detail.no")} />
                </dl>
              )}
            </section>
          </div>

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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-[11px]">{label}</dt>
      <dd className="font-medium">{value}</dd>
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

function ActionButton({ busy, onClick, icon: Icon, label, primary, danger, testid }: {
  busy: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  primary?: boolean;
  danger?: boolean;
  testid?: string;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      data-testid={testid}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-40",
        primary ? "bg-primary text-primary-foreground" : danger ? "bg-rose-600 text-white" : "text-muted-foreground border",
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Icon className="size-4" aria-hidden />}
      {label}
    </button>
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
