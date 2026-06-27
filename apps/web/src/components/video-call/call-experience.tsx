"use client";

import { useState } from "react";
import { DisconnectReason, setLogLevel } from "livekit-client";
import { useTranslations } from "next-intl";
import { WifiOff } from "lucide-react";
import { ApiError, joinRoom, type JoinRoomResponse } from "@/lib/api";
import { BrandBackdrop } from "./brand-backdrop";
import { CallRoom } from "./call-room";
import { Lobby, type LobbySettings } from "./lobby";

// Keep the browser console clean for this premium surface — surface warnings/errors, drop the
// chatty per-track debug logs (e.g. the one-time "silence detected" track-start check).
setLogLevel("warn");

type Phase = "lobby" | "in-call" | "left" | "lost" | "dead";

/**
 * Drives the public join-by-link experience: a premium lobby (camera/mic preview, device pickers,
 * host detection) → POST /api/video/join/{token} → the live CallRoom, with left/dead end-states.
 * A logged-in host is detected server-side from the session cookie; the lobby's typed name is only
 * used for guests. 404 = a dead link; everything else is a retryable error surfaced in the lobby.
 */
export function CallExperience({ token }: { token: string }) {
  const t = useTranslations("videoCall");
  const [phase, setPhase] = useState<Phase>("lobby");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | undefined>();
  const [creds, setCreds] = useState<JoinRoomResponse | null>(null);
  const [settings, setSettings] = useState<LobbySettings | null>(null);

  async function handleJoin(s: LobbySettings) {
    setJoining(true);
    setJoinError(undefined);
    try {
      const c = await joinRoom(token, s.name);
      setCreds(c);
      setSettings(s);
      setPhase("in-call");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setPhase("dead");
      } else if (e instanceof ApiError && e.status === 422) {
        setJoinError(t("nameRequired"));
      } else {
        setJoinError(t("joinError"));
      }
    } finally {
      setJoining(false);
    }
  }

  // A deliberate Leave (room.disconnect → CLIENT_INITIATED) lands on the calm "left" screen;
  // any other disconnect (network drop, server shutdown, removed by host) is an unexpected loss
  // and gets the "connection lost" screen with a prominent rejoin (which re-mints a fresh token).
  function handleDisconnect(reason?: DisconnectReason) {
    setPhase(reason === DisconnectReason.CLIENT_INITIATED ? "left" : "lost");
  }

  if (phase === "in-call" && creds && settings) {
    return <CallRoom creds={creds} settings={settings} onLeave={handleDisconnect} />;
  }

  if (phase === "dead") {
    return <StatusScreen title={t("roomUnavailableTitle")} body={t("roomUnavailableBody")} />;
  }

  if (phase === "left") {
    return (
      <StatusScreen
        title={t("leftTitle")}
        body={t("leftBody")}
        action={{ label: t("rejoin"), onClick: () => setPhase("lobby") }}
      />
    );
  }

  if (phase === "lost") {
    return (
      <StatusScreen
        tone="alert"
        title={t("lostTitle")}
        body={t("lostBody")}
        action={{ label: t("rejoin"), onClick: () => setPhase("lobby") }}
      />
    );
  }

  return (
    <Lobby
      roomTitle={creds?.roomTitle}
      onJoin={handleJoin}
      joining={joining}
      joinError={joinError}
    />
  );
}

function StatusScreen({
  title,
  body,
  action,
  tone = "calm",
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
  tone?: "calm" | "alert";
}) {
  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center p-4 text-white">
      <BrandBackdrop />
      <div className="relative w-full max-w-sm rounded-3xl bg-white/[0.03] p-6 text-center ring-1 ring-white/10 backdrop-blur-sm">
        {tone === "alert" && (
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30">
            <WifiOff className="size-6" />
          </div>
        )}
        <h1 className="text-lg font-semibold text-white">{title}</h1>
        <p className="mt-2 text-sm text-slate-400">{body}</p>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-5 w-full rounded-xl bg-emerald-500 py-3 font-semibold text-white transition hover:bg-emerald-400"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
