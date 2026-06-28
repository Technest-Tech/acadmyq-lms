"use client";

import {
  useConnectionState,
  useParticipants,
  useSpeakingParticipants,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { ConnectionState, Track } from "livekit-client";
import { useTranslations } from "next-intl";
import { Clock, Loader2 } from "lucide-react";
import { formatElapsed, useCallElapsed } from "./call-timer-context";
import { ConnectionPill } from "./connection-pill";
import { DraggablePip } from "./draggable-pip";
import { selectLayout, tileDensity, tileGrid } from "./layout";
import { ParticipantTile } from "./participant-tile";
import { usePin } from "./pin-context";
import { useRecording } from "./recording-context";
import { useElementSize } from "./use-element-size";

function trackKey(ref: TrackReferenceOrPlaceholder): string {
  return `${ref.participant.identity}:${ref.publication?.trackSid ?? ref.source}`;
}

/**
 * The live call stage. Picks a layout from the participant count + screen-share state (pure
 * selectLayout, unit-tested) and renders custom tiles on the @livekit/components-react hooks:
 * spotlight (1:1 → big focus + draggable self-PiP), grid (small group), presenter (screen-share).
 * Audio is played by RoomAudioRenderer in the parent (audio-first, V-AUD-1).
 */
export function CallStage({
  roomTitle,
  suppressRecording = false,
}: {
  roomTitle: string;
  suppressRecording?: boolean;
}) {
  const t = useTranslations("videoCall");
  const state = useConnectionState();
  const participants = useParticipants();
  const cameras = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    {
      onlySubscribed: false,
    },
  );
  const screens = useTracks(
    [{ source: Track.Source.ScreenShare, withPlaceholder: false }],
    {
      onlySubscribed: false,
    },
  );

  const { pinnedId } = usePin();
  const pinnedTrack = pinnedId
    ? cameras.find((c) => c.participant.identity === pinnedId)
    : undefined;

  const hasScreen = screens.length > 0;
  const layout = selectLayout(participants.length, hasScreen, !!pinnedTrack);
  // What we actually render: screen-share keeps presenter even over a pin; otherwise a live pin
  // turns the spotlight into a chosen-person focus. `data-layout` makes this assertable in tests.
  const renderMode =
    layout === "presenter" ? "presenter" : pinnedTrack ? "pinned" : layout;
  const connecting = state === ConnectionState.Connecting;
  const reconnecting =
    state === ConnectionState.Reconnecting ||
    state === ConnectionState.SignalReconnecting;

  return (
    <div
      className="relative flex-1 overflow-hidden p-3 sm:p-4"
      data-layout={renderMode}
    >
      {/* Header */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <h1 className="max-w-[38%] truncate rounded-full bg-black/30 px-3 py-1 text-sm font-semibold text-white/90 ring-1 ring-white/10 backdrop-blur sm:max-w-[45%]">
          {roomTitle}
        </h1>
        <div className="flex items-center gap-2">
          <RecIndicator suppress={suppressRecording} />
          <ConnectionPill />
        </div>
      </div>

      {/* Call duration — top center */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <CallTimer />
      </div>

      {/* Reconnecting banner (V-MOB-2) */}
      {reconnecting && (
        <div className="absolute inset-x-0 top-0 z-20 flex justify-center pt-[calc(env(safe-area-inset-top)+3rem)]">
          <span className="flex items-center gap-2 rounded-full bg-amber-500/20 px-4 py-1.5 text-sm font-medium text-amber-100 ring-1 ring-amber-400/30 backdrop-blur">
            <Loader2 className="size-3.5 animate-spin" />
            {t("reconnecting")}
          </span>
        </div>
      )}

      {connecting && cameras.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-white/70">
          <Loader2 className="size-8 animate-spin text-emerald-400" />
          <p className="text-sm">{t("connecting")}</p>
        </div>
      ) : renderMode === "presenter" ? (
        <FocusLayout focus={screens[0]} others={cameras} youLabel={t("you")} />
      ) : renderMode === "pinned" ? (
        <FocusLayout
          focus={pinnedTrack}
          others={cameras.filter((c) => c.participant.identity !== pinnedId)}
          youLabel={t("you")}
        />
      ) : renderMode === "spotlight" ? (
        <SpotlightLayout
          cameras={cameras}
          youLabel={t("you")}
          waitingTitle={t("waitingTitle")}
          waitingBody={t("waitingBody")}
        />
      ) : (
        <GridLayout cameras={cameras} youLabel={t("you")} />
      )}
    </div>
  );
}

/**
 * A live "REC" badge shown to EVERYONE while the room is being recorded (consent visibility), plus a
 * host-only "Saving…" state while egress tears down after a stop so the host has clear feedback the
 * file is being finalised. In a COVERT-monitored room (08-ROOM-ACCESS §5) `suppress` is set, hiding
 * the indicator entirely — the academy owns that legal call.
 */
function RecIndicator({ suppress = false }: { suppress?: boolean }) {
  const t = useTranslations("videoCall");
  const { phase, isRecording } = useRecording();
  if (suppress) return null;

  // Host-only: the brief window between "stop" and egress actually flipping off → the file is saving.
  if (phase === "stopping") {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-100 ring-1 ring-amber-400/30 backdrop-blur">
        <Loader2 className="size-3 animate-spin" />
        {t("recordingSavingBadge")}
      </span>
    );
  }

  if (!isRecording) return null;
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-1 text-xs font-semibold text-red-200 ring-1 ring-red-400/30 backdrop-blur">
      <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
      {t("recordingBadge")}
    </span>
  );
}

/**
 * A live call-duration counter, top-center. The start time is held by <CallTimerProvider> (mounted
 * above the stage⇄whiteboard swap), so it counts from the real meeting start and survives the stage
 * unmounting while the board is open. Hidden until connected (the reconnecting banner takes its spot).
 */
function CallTimer() {
  const t = useTranslations("videoCall");
  const elapsed = useCallElapsed();
  if (elapsed === null) return null;

  return (
    <span
      aria-label={t("callDuration")}
      className="flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1 text-sm font-semibold tabular-nums text-white/90 ring-1 ring-white/10 backdrop-blur"
    >
      <Clock className="size-3.5 text-white/70" aria-hidden />
      {formatElapsed(elapsed)}
    </span>
  );
}

/**
 * Fit-to-area gallery (Meet/Zoom-style): measures the stage and picks the {cols, rows} that make the
 * tiles as large as possible while ALL of them fit on screen — no overflow, no clipping — at 3, 10 or
 * 20 people. Each tile fills its cell (object-cover) and its chrome scales with the cell size, and it
 * recomputes on resize/rotation, so it stays professional and responsive at any count.
 */
function GridLayout({
  cameras,
  youLabel,
}: {
  cameras: TrackReferenceOrPlaceholder[];
  youLabel: string;
}) {
  const [ref, { width, height }] = useElementSize<HTMLDivElement>();
  const { cols, rows } = tileGrid(cameras.length, width, height);
  const cellWidth = width && cols ? width / cols : 0;
  const density = tileDensity(cellWidth);

  return (
    <div ref={ref} className="h-full w-full">
      <div
        className="grid h-full w-full gap-2 sm:gap-3"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {cameras.map((c) => (
          <div key={trackKey(c)} className="min-h-0 min-w-0">
            <ParticipantTile
              trackRef={c}
              fill
              youLabel={youLabel}
              density={density}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function SpotlightLayout({
  cameras,
  youLabel,
  waitingTitle,
  waitingBody,
}: {
  cameras: TrackReferenceOrPlaceholder[];
  youLabel: string;
  waitingTitle: string;
  waitingBody: string;
}) {
  const speaking = useSpeakingParticipants();
  const local = cameras.find((c) => c.participant.isLocal);
  const remotes = cameras.filter((c) => !c.participant.isLocal);
  const focus =
    remotes.find((r) =>
      speaking.some((s) => s.identity === r.participant.identity),
    ) ??
    remotes[0] ??
    local;
  const showPip =
    focus && local && focus.participant.identity !== local.participant.identity;

  return (
    <div className="relative h-full">
      {focus && <ParticipantTile trackRef={focus} fill youLabel={youLabel} />}
      {showPip && local && (
        <DraggablePip>
          <ParticipantTile trackRef={local} youLabel={youLabel} />
        </DraggablePip>
      )}
      {remotes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-8">
          <div className="rounded-2xl bg-black/50 px-5 py-3 text-center ring-1 ring-white/10 backdrop-blur">
            <p className="text-sm font-semibold text-white">{waitingTitle}</p>
            <p className="mt-0.5 text-xs text-slate-300">{waitingBody}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A big focus tile + a horizontal filmstrip of everyone else. Shared by the screen-share presenter
 * view (focus = the shared screen) and the pinned-spotlight view (focus = the chosen participant).
 */
function FocusLayout({
  focus,
  others,
  youLabel,
}: {
  focus: TrackReferenceOrPlaceholder | undefined;
  others: TrackReferenceOrPlaceholder[];
  youLabel: string;
}) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative min-h-0 flex-1">
        {focus && <ParticipantTile trackRef={focus} fill youLabel={youLabel} />}
      </div>
      {others.length > 0 && (
        <div className="flex shrink-0 gap-2 overflow-x-auto pb-1">
          {others.map((c) => (
            <div key={trackKey(c)} className="w-32 shrink-0 sm:w-40">
              <ParticipantTile
                trackRef={c}
                youLabel={youLabel}
                density="compact"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
