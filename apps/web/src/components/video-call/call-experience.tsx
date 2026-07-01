"use client";

import { useEffect, useState } from "react";
import { DisconnectReason, setLogLevel } from "livekit-client";
import { useTranslations } from "next-intl";
import { WifiOff } from "lucide-react";
import {
  ApiError,
  isKnocking,
  joinRoom,
  joinRoomBySlug,
  type JoinRoomResponse,
  type KnockingResponse,
} from "@/lib/api";
import { BrandBackdrop } from "./brand-backdrop";
import { CallRoom } from "./call-room";
import { KnockControl } from "./knock-control";
import { Lobby, type LobbySettings } from "./lobby";
import { useIsDesktop } from "./use-is-desktop";
import { WaitingScreen } from "./waiting-screen";

// Keep the browser console clean for this premium surface — surface warnings/errors, drop the
// chatty per-track debug logs (e.g. the one-time "silence detected" track-start check).
setLogLevel("warn");

type Phase =
  | "lobby"
  | "waiting"
  | "denied"
  | "expired"
  | "in-call"
  | "left"
  | "lost"
  | "ended"
  | "removed"
  | "dead";

/** A token link (/r/{token}) or a readable per-academy slug link (/r/{academy}/{room}). */
type CallTarget = { token: string } | { academy: string; room: string };

/**
 * Drives the public join-by-link experience: a premium lobby (camera/mic preview, device pickers,
 * host detection) → the public join endpoint → the live CallRoom, with left/dead end-states. Works
 * from a role-separated token link OR a readable academy slug. A logged-in host is detected
 * server-side from the session cookie; the lobby's typed name is only used for guests. A room with a
 * password prompts for one (password_required) and re-prompts on a wrong one (password_incorrect).
 * 404 = a dead link; everything else is a retryable error surfaced in the lobby.
 */
export function CallExperience(target: CallTarget) {
  const t = useTranslations("videoCall");
  const [phase, setPhase] = useState<Phase>("lobby");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | undefined>();
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [creds, setCreds] = useState<JoinRoomResponse | null>(null);
  const [knock, setKnock] = useState<KnockingResponse | null>(null);
  const [settings, setSettings] = useState<LobbySettings | null>(null);
  const isDesktop = useIsDesktop();

  // Desktop app: once the meeting is over for this user (they left, the host ended it, or they were
  // removed), drop back to the native "Join a meeting" lobby so they can paste another link — after a
  // short beat on the status screen so the transition doesn't feel abrupt.
  useEffect(() => {
    if (!isDesktop) return;
    if (phase !== "left" && phase !== "ended" && phase !== "removed") return;
    const id = setTimeout(() => window.academiqDesktop?.returnToLobby?.(), 1500);
    return () => clearTimeout(id);
  }, [isDesktop, phase]);

  async function handleJoin(s: LobbySettings) {
    setJoining(true);
    setJoinError(undefined);
    try {
      const c =
        "token" in target
          ? await joinRoom(target.token, s.name, s.password)
          : await joinRoomBySlug(target.academy, target.room, s.name, s.password);
      setSettings(s);
      if (isKnocking(c)) {
        // Waiting room: no token yet — wait for a host to admit (08-ROOM-ACCESS §13).
        setKnock(c);
        setPhase("waiting");
      } else {
        setCreds(c);
        setPhase("in-call");
      }
    } catch (e) {
      if (e instanceof ApiError) {
        const code = (e.body as { code?: string } | undefined)?.code;
        if (e.status === 404) {
          setPhase("dead");
        } else if (code === "password_required") {
          setPasswordRequired(true);
          setJoinError(t("passwordRequired"));
        } else if (code === "password_incorrect") {
          setPasswordRequired(true);
          setJoinError(t("passwordIncorrect"));
        } else if (code === "host_absent") {
          setJoinError(t("hostAbsent"));
        } else if (code === "room_full") {
          setJoinError(t("roomFull"));
        } else if (e.status === 422) {
          setJoinError(t("nameRequired"));
        } else {
          setJoinError(t("joinError"));
        }
      } else {
        setJoinError(t("joinError"));
      }
    } finally {
      setJoining(false);
    }
  }

  // Distinguish three disconnect shapes: a deliberate Leave (CLIENT_INITIATED) → calm "left";
  // the host ended the call for everyone (ROOM_DELETED/ROOM_CLOSED) → calm "ended"; anything else
  // (network drop, server shutdown, removed mid-call) → "connection lost" with a prominent rejoin.
  function handleDisconnect(reason?: DisconnectReason) {
    if (reason === DisconnectReason.CLIENT_INITIATED) setPhase("left");
    else if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.ROOM_CLOSED)
      setPhase("ended");
    else if (reason === DisconnectReason.PARTICIPANT_REMOVED) setPhase("removed");
    else setPhase("lost");
  }

  if (phase === "in-call" && creds && settings) {
    // The host knock-control (08-ROOM-ACCESS §13) floats beside the call as a sibling — never inside
    // CallRoom — and only when this joiner is a host (manageToken present). Pure REST, no LK context.
    return (
      <>
        <CallRoom creds={creds} settings={settings} onLeave={handleDisconnect} />
        {creds.manageToken && <KnockControl manageToken={creds.manageToken} />}
      </>
    );
  }

  if (phase === "waiting" && knock) {
    return (
      <WaitingScreen
        knockToken={knock.knockToken}
        roomTitle={knock.roomTitle}
        onAdmitted={(c) => {
          setCreds(c);
          setPhase("in-call");
        }}
        onDenied={() => setPhase("denied")}
        onExpired={() => setPhase("expired")}
        onCancel={() => setPhase("lobby")}
      />
    );
  }

  if (phase === "denied") {
    return <StatusScreen title={t("knockDeniedTitle")} body={t("knockDeniedBody")} />;
  }

  if (phase === "expired") {
    return (
      <StatusScreen
        title={t("knockExpiredTitle")}
        body={t("knockExpiredBody")}
        action={{ label: t("rejoin"), onClick: () => setPhase("lobby") }}
      />
    );
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

  if (phase === "ended") {
    return (
      <StatusScreen
        title={t("endedTitle")}
        body={t("endedBody")}
        action={{ label: t("rejoin"), onClick: () => setPhase("lobby") }}
      />
    );
  }

  // Removed by a host — no rejoin affordance (the intent was to remove them).
  if (phase === "removed") {
    return <StatusScreen title={t("removedTitle")} body={t("removedBody")} />;
  }

  return (
    <Lobby
      roomTitle={creds?.roomTitle}
      onJoin={handleJoin}
      joining={joining}
      joinError={joinError}
      passwordRequired={passwordRequired}
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
