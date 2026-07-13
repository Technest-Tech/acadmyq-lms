"use client";

import {
  Activity,
  ArrowLeft,
  CalendarClock,
  Clock,
  Eye,
  Link2,
  Pencil,
  Plus,
  Timer,
  Trash2,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  getRoomLogs,
  type RoomLogEvent,
  type RoomLogs,
  type RoomLogSession,
} from "@/lib/api";

// ── formatters ───────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Compact total for the stat card (no seconds). */
function formatTotal(seconds: number): string {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${Math.max(1, m)}m`;
}

/** Map an audit action (`video_room.create`) to its known suffix key, else `unknown`. */
const KNOWN_EVENTS = [
  "create",
  "update",
  "delete",
  "rotate_link",
  "knock_admit",
  "knock_deny",
  "monitor_join",
] as const;
function eventKey(action: string): string {
  const seg = action.split(".").pop() ?? action;
  return (KNOWN_EVENTS as readonly string[]).includes(seg) ? seg : "unknown";
}
const EVENT_ICON: Record<string, typeof Activity> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  rotate_link: Link2,
  knock_admit: UserCheck,
  knock_deny: UserX,
  monitor_join: Eye,
  unknown: Activity,
};

// ── screen ─────────────────────────────────────────────────────────────────────

/**
 * Per-room access log (08-ROOM-ACCESS §15): who accessed the room, when, for how long, plus every
 * audited action — all timestamped. Permission-gated by room.read; the server strips covert
 * monitor-join events unless the caller holds room.monitor.
 */
export function RoomLogsScreen({ roomId }: { roomId: string }) {
  const t = useTranslations("videoClassroom");
  const locale = useLocale();
  const { can } = useAuth();
  const canRead = can("room.read");

  const [logs, setLogs] = useState<RoomLogs | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!canRead) return;
    setError(null);
    getRoomLogs(roomId)
      .then(setLogs)
      .catch(() => setError(t("logsError")));
  }, [canRead, roomId, t]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canRead) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const fmtDateTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(locale) : t("never");
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale) : t("never");

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div className="space-y-3">
        <Link
          href="/video-classroom"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {t("backToRooms")}
        </Link>

        {logs === null && !error ? (
          <div className="bg-muted h-9 w-64 animate-pulse rounded-lg" aria-hidden />
        ) : logs ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-2xl">
              <Users className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="truncate text-2xl font-bold tracking-tight">{logs.room.name}</h1>
                <StatusBadge status={logs.room.status} label={t(`status.${logs.room.status}`)} />
              </div>
              <p className="text-muted-foreground mt-0.5 text-sm">{t("logsSubtitle")}</p>
            </div>
          </div>
        ) : null}
      </div>

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {logs && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={Users} label={t("statSessions")} value={String(logs.stats.total_sessions)} />
            <StatCard icon={UserCheck} label={t("statParticipants")} value={String(logs.stats.unique_participants)} />
            <StatCard icon={Timer} label={t("statTotalTime")} value={formatTotal(logs.stats.total_seconds)} />
            <StatCard icon={CalendarClock} label={t("statLastAccess")} value={fmtDate(logs.stats.last_access)} />
          </div>

          {logs.truncated && (
            <p className="text-muted-foreground text-xs">{t("truncatedNote")}</p>
          )}

          {/* Access sessions */}
          <section className="space-y-3">
            <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
              {t("sessionsTitle")}
            </h2>
            {logs.sessions.length === 0 ? (
              <EmptyState title={t("noSessions")} />
            ) : (
              <div className="bg-card overflow-x-auto rounded-2xl border shadow-sm" data-testid="room-log-sessions">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 text-muted-foreground border-b text-xs uppercase tracking-wide">
                      <th className="px-4 py-3 text-start font-semibold">{t("colParticipant")}</th>
                      <th className="px-4 py-3 text-start font-semibold">{t("colRole")}</th>
                      <th className="px-4 py-3 text-start font-semibold">{t("colJoined")}</th>
                      <th className="px-4 py-3 text-start font-semibold">{t("colLeft")}</th>
                      <th className="px-4 py-3 text-start font-semibold">{t("colDuration")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {logs.sessions.map((s) => (
                      <SessionRow key={s.id} session={s} fmtDateTime={fmtDateTime} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Activity timeline */}
          <section className="space-y-3">
            <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
              {t("activityTitle")}
            </h2>
            {logs.events.length === 0 ? (
              <EmptyState title={t("noEvents")} />
            ) : (
              <div className="bg-card rounded-2xl border p-5 shadow-sm" data-testid="room-log-activity">
                <ol className="border-border/70 relative ms-3 space-y-5 border-s ps-6">
                  {logs.events.map((e) => (
                    <EventRow key={e.id} event={e} fmtDateTime={fmtDateTime} />
                  ))}
                </ol>
              </div>
            )}
          </section>
        </>
      )}

      {/* Loading skeleton (first paint) */}
      {logs === null && !error && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-card h-20 animate-pulse rounded-2xl border shadow-sm" aria-hidden />
            ))}
          </div>
          <div className="bg-card h-48 animate-pulse rounded-2xl border shadow-sm" aria-hidden />
        </div>
      )}
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────

function StatusBadge({ status, label }: { status: string; label: string }) {
  const cls =
    status === "ACTIVE"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
      : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="bg-card rounded-2xl border p-4 shadow-sm">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      <p className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
    </div>
  );
}

function SessionRow({
  session: s,
  fmtDateTime,
}: {
  session: RoomLogSession;
  fmtDateTime: (iso: string | null) => string;
}) {
  const t = useTranslations("videoClassroom");
  const name = s.display_name || s.user_name || t("guestLabel");
  const roleLabel = t.has(`roles.${s.role}`) ? t(`roles.${s.role}`) : s.role;
  const duration = formatDuration(s.duration_s);
  return (
    <tr className="hover:bg-muted/20 transition-colors" data-testid="session-row">
      <td className="px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold uppercase">
            {name.charAt(0)}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium">{name}</div>
            <div className="text-muted-foreground truncate text-xs" dir="ltr">
              {s.identity}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="bg-muted text-muted-foreground inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium">
          {roleLabel}
        </span>
      </td>
      <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">{fmtDateTime(s.joined_at)}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        {s.ongoing ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
            {t("ongoing")}
          </span>
        ) : (
          <span className="text-muted-foreground">{fmtDateTime(s.left_at)}</span>
        )}
      </td>
      <td className="px-4 py-3 tabular-nums whitespace-nowrap">{duration ?? t("never")}</td>
    </tr>
  );
}

function EventRow({
  event: e,
  fmtDateTime,
}: {
  event: RoomLogEvent;
  fmtDateTime: (iso: string | null) => string;
}) {
  const t = useTranslations("videoClassroom");
  const key = eventKey(e.action);
  const Icon = EVENT_ICON[key] ?? Activity;
  const label = t(`events.${key}`);
  const isMonitor = key === "monitor_join";
  return (
    <li className="relative" data-testid="event-row">
      <span
        className={cn(
          "ring-border bg-card absolute -start-9 top-0 grid size-6 place-items-center rounded-full ring-1",
          isMonitor ? "text-amber-600" : "text-muted-foreground",
        )}
      >
        <Icon className="size-3" aria-hidden />
      </span>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <time className="text-muted-foreground text-xs whitespace-nowrap">{fmtDateTime(e.created_at)}</time>
      </div>
      {(e.actor_name || e.actor_role) && (
        <p className="text-muted-foreground mt-0.5 text-xs">
          {e.actor_name ?? e.actor_role}
          {e.actor_name && e.actor_role ? ` · ${e.actor_role}` : ""}
        </p>
      )}
    </li>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="border-border/60 bg-muted/20 flex flex-col items-center rounded-2xl border border-dashed p-10 text-center">
      <p className="text-muted-foreground text-sm font-medium">{title}</p>
    </div>
  );
}
