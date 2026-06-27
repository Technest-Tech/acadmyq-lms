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
import { Loader2 } from "lucide-react";
import { ConnectionPill } from "./connection-pill";
import { DraggablePip } from "./draggable-pip";
import { gridColumns, selectLayout } from "./layout";
import { ParticipantTile } from "./participant-tile";

function trackKey(ref: TrackReferenceOrPlaceholder): string {
  return `${ref.participant.identity}:${ref.publication?.trackSid ?? ref.source}`;
}

/**
 * The live call stage. Picks a layout from the participant count + screen-share state (pure
 * selectLayout, unit-tested) and renders custom tiles on the @livekit/components-react hooks:
 * spotlight (1:1 → big focus + draggable self-PiP), grid (small group), presenter (screen-share).
 * Audio is played by RoomAudioRenderer in the parent (audio-first, V-AUD-1).
 */
export function CallStage({ roomTitle }: { roomTitle: string }) {
  const t = useTranslations("videoCall");
  const state = useConnectionState();
  const participants = useParticipants();
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  const screens = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }], {
    onlySubscribed: false,
  });

  const hasScreen = screens.length > 0;
  const layout = selectLayout(participants.length, hasScreen);
  const connecting = state === ConnectionState.Connecting;
  const reconnecting =
    state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;

  return (
    <div className="relative flex-1 overflow-hidden p-3 sm:p-4">
      {/* Header */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <h1 className="truncate rounded-full bg-black/30 px-3 py-1 text-sm font-semibold text-white/90 ring-1 ring-white/10 backdrop-blur">
          {roomTitle}
        </h1>
        <ConnectionPill />
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
      ) : layout === "presenter" ? (
        <PresenterLayout screen={screens[0]} cameras={cameras} youLabel={t("you")} />
      ) : layout === "spotlight" ? (
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

function GridLayout({
  cameras,
  youLabel,
}: {
  cameras: TrackReferenceOrPlaceholder[];
  youLabel: string;
}) {
  return (
    <div className={`grid h-full content-center gap-3 ${gridColumns(cameras.length)}`}>
      {cameras.map((c) => (
        <ParticipantTile key={trackKey(c)} trackRef={c} youLabel={youLabel} />
      ))}
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
    remotes.find((r) => speaking.some((s) => s.identity === r.participant.identity)) ??
    remotes[0] ??
    local;
  const showPip = focus && local && focus.participant.identity !== local.participant.identity;

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

function PresenterLayout({
  screen,
  cameras,
  youLabel,
}: {
  screen: TrackReferenceOrPlaceholder | undefined;
  cameras: TrackReferenceOrPlaceholder[];
  youLabel: string;
}) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative min-h-0 flex-1">
        {screen && <ParticipantTile trackRef={screen} fill youLabel={youLabel} />}
      </div>
      <div className="flex shrink-0 gap-2 overflow-x-auto pb-1">
        {cameras.map((c) => (
          <div key={trackKey(c)} className="w-32 shrink-0 sm:w-40">
            <ParticipantTile trackRef={c} youLabel={youLabel} />
          </div>
        ))}
      </div>
    </div>
  );
}
