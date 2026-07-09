"use client";

import { Eye, Mic, MicOff, MonitorUp, Video, VideoOff } from "lucide-react";
import { useTranslations } from "next-intl";
import type { RoomOccupant, RoomPresence } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Up to two initials from a display name (falls back to a dot). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** A pulsing "Live • N in room" pill for the card header. Renders nothing when the room is empty. */
export function LiveBadge({ presence }: { presence: RoomPresence | undefined }) {
  const t = useTranslations("videoClassroom");
  if (!presence || presence.count === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300"
      data-testid="room-live-badge"
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      {t("presence.live")}
    </span>
  );
}

/** One aggregate tally chip (icon + count), e.g. "3 cameras on". Hidden when the count is zero. */
function StatChip({
  icon: Icon,
  count,
  title,
  tone,
}: {
  icon: typeof Video;
  count: number;
  title: string;
  tone: "emerald" | "sky" | "muted";
}) {
  if (count <= 0) return null;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
        tone === "emerald" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "sky" && "bg-sky-500/10 text-sky-700 dark:text-sky-300",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {count}
    </span>
  );
}

/** Camera / mic / screen state icons for one occupant. */
function DeviceState({ occupant }: { occupant: RoomOccupant }) {
  const t = useTranslations("videoClassroom");
  return (
    <div className="flex shrink-0 items-center gap-1" aria-hidden={false}>
      {occupant.screen && (
        <span
          title={t("presence.sharing")}
          aria-label={t("presence.sharing")}
          className="grid size-5 place-items-center rounded-md bg-sky-500/15 text-sky-600 dark:text-sky-300"
        >
          <MonitorUp className="size-3" />
        </span>
      )}
      <span
        title={occupant.mic ? t("presence.micOn") : t("presence.micOff")}
        aria-label={occupant.mic ? t("presence.micOn") : t("presence.micOff")}
        className={cn(
          "grid size-5 place-items-center rounded-md",
          occupant.mic
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
            : "bg-muted text-muted-foreground/70",
        )}
      >
        {occupant.mic ? <Mic className="size-3" /> : <MicOff className="size-3" />}
      </span>
      <span
        title={occupant.camera ? t("presence.camOn") : t("presence.camOff")}
        aria-label={occupant.camera ? t("presence.camOn") : t("presence.camOff")}
        className={cn(
          "grid size-5 place-items-center rounded-md",
          occupant.camera
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
            : "bg-muted text-muted-foreground/70",
        )}
      >
        {occupant.camera ? <Video className="size-3" /> : <VideoOff className="size-3" />}
      </span>
    </div>
  );
}

/** One occupant row: avatar + name + role chip + device state. */
function OccupantRow({ occupant }: { occupant: RoomOccupant }) {
  const t = useTranslations("videoClassroom");
  const isHost = occupant.role === "host";
  return (
    <li className="flex items-center gap-2">
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
          isHost
            ? "bg-primary/15 text-primary ring-1 ring-primary/30"
            : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        {initials(occupant.name)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{occupant.name}</span>
      {isHost && (
        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
          {t("hostRole")}
        </span>
      )}
      <DeviceState occupant={occupant} />
    </li>
  );
}

/** How many occupant rows to render before collapsing into "+N more". */
const MAX_ROWS = 4;

/**
 * The live-presence block shown on a room card while someone is connected: a summary line (count +
 * camera/mic/screen tallies + a "watching" count for supervisors) over a short occupant list. Hosts
 * sort first (server-ordered). Renders nothing for an empty room so the card stays compact.
 */
export function RoomLivePresence({ presence }: { presence: RoomPresence | undefined }) {
  const t = useTranslations("videoClassroom");

  // Always render an occupancy row so the card answers "is anyone in here?" — a muted "empty" state
  // when nobody's connected, the full live block otherwise.
  if (!presence || (presence.count === 0 && presence.monitors === 0)) {
    return (
      <div
        className="border-border/60 bg-muted/20 text-muted-foreground flex items-center gap-2 rounded-xl border border-dashed px-2.5 py-2 text-xs"
        data-testid="room-presence-empty"
      >
        <span className="bg-muted-foreground/40 size-1.5 rounded-full" aria-hidden />
        {t("presence.empty")}
      </div>
    );
  }

  const shown = presence.participants.slice(0, MAX_ROWS);
  const overflow = presence.count - shown.length;

  return (
    <div
      className="space-y-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-2.5"
      data-testid="room-presence"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          {t("presence.inRoom", { count: presence.count })}
        </span>
        <div className="ms-auto flex items-center gap-1">
          <StatChip icon={MonitorUp} count={presence.screenSharing} title={t("presence.screensTitle", { count: presence.screenSharing })} tone="sky" />
          <StatChip icon={Video} count={presence.camerasOn} title={t("presence.camerasTitle", { count: presence.camerasOn })} tone="emerald" />
          <StatChip icon={Mic} count={presence.micsOn} title={t("presence.micsTitle", { count: presence.micsOn })} tone="emerald" />
        </div>
      </div>

      {presence.count > 0 && (
        <ul className="space-y-1.5">
          {shown.map((o) => (
            <OccupantRow key={o.identity} occupant={o} />
          ))}
          {overflow > 0 && (
            <li className="text-muted-foreground ps-8 text-[11px] font-medium">
              {t("presence.more", { count: overflow })}
            </li>
          )}
        </ul>
      )}

      {presence.monitors > 0 && (
        <p className="text-muted-foreground flex items-center gap-1 text-[11px]">
          <Eye className="size-3" aria-hidden />
          {t("presence.watching", { count: presence.monitors })}
        </p>
      )}
    </div>
  );
}

/** Compact occupancy indicator for the table view: a live dot + count, or a muted dash. */
export function PresenceCell({ presence }: { presence: RoomPresence | undefined }) {
  const t = useTranslations("videoClassroom");
  if (!presence || presence.count === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
      title={t("presence.inRoom", { count: presence.count })}
    >
      <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
      {presence.count}
      {presence.screenSharing > 0 && <MonitorUp className="size-3 text-sky-500" aria-hidden />}
    </span>
  );
}
