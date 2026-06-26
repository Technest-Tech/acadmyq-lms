"use client";

import { useState } from "react";
import { Loader2, Video } from "lucide-react";
import { ApiError, joinRoom, type JoinRoomResponse } from "@/lib/api";
import { CallRoom } from "./call-room";

type Phase =
  | { step: "prejoin"; error?: string }
  | { step: "connecting" }
  | { step: "in-call"; creds: JoinRoomResponse }
  | { step: "left" }
  | { step: "dead"; message: string };

/**
 * Drives the public join-by-link experience (W2 — functional; W3 makes the lobby premium):
 * a minimal pre-join (display name) → POST /api/video/join/{token} → the live CallRoom. A
 * logged-in host is detected server-side from the session cookie, so the typed name is only used
 * for guests. 404 = the link is dead; everything else is a retryable error.
 */
export function CallExperience({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<Phase>({ step: "prejoin" });

  async function handleJoin() {
    const trimmed = name.trim();
    if (!trimmed) {
      setPhase({ step: "prejoin", error: "Please enter your name to join." });
      return;
    }
    setPhase({ step: "connecting" });
    try {
      const creds = await joinRoom(token, trimmed);
      setPhase({ step: "in-call", creds });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setPhase({ step: "dead", message: "This room link is invalid or the room has ended." });
      } else if (e instanceof ApiError && e.status === 422) {
        setPhase({ step: "prejoin", error: "Please enter your name to join." });
      } else {
        setPhase({ step: "prejoin", error: "Couldn't join the room. Please try again." });
      }
    }
  }

  if (phase.step === "in-call") {
    return <CallRoom creds={phase.creds} onLeave={() => setPhase({ step: "left" })} />;
  }

  if (phase.step === "dead") {
    return (
      <Shell>
        <Card>
          <h1 className="text-lg font-semibold text-white">Room unavailable</h1>
          <p className="mt-2 text-sm text-slate-400">{phase.message}</p>
        </Card>
      </Shell>
    );
  }

  if (phase.step === "left") {
    return (
      <Shell>
        <Card>
          <h1 className="text-lg font-semibold text-white">You left the call</h1>
          <p className="mt-2 text-sm text-slate-400">Thanks for joining.</p>
          <button
            type="button"
            onClick={() => setPhase({ step: "prejoin" })}
            className="mt-5 w-full rounded-xl bg-emerald-500 py-3 font-medium text-white transition hover:bg-emerald-400"
          >
            Rejoin
          </button>
        </Card>
      </Shell>
    );
  }

  const connecting = phase.step === "connecting";

  return (
    <Shell>
      <Card>
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-400/20">
            <Video className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-white">Join the call</h1>
            <p className="text-xs text-slate-400">You&apos;ll be asked for camera &amp; mic access.</p>
          </div>
        </div>

        <label className="mt-6 block text-sm font-medium text-slate-300" htmlFor="display-name">
          Your name
        </label>
        <input
          id="display-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !connecting) void handleJoin();
          }}
          maxLength={80}
          autoFocus
          disabled={connecting}
          placeholder="e.g. Sara"
          className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-800 px-4 py-3 text-white placeholder:text-slate-500 outline-none focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20 disabled:opacity-50"
        />

        {phase.step === "prejoin" && phase.error && (
          <p className="mt-2 text-sm text-red-400">{phase.error}</p>
        )}

        <button
          type="button"
          onClick={() => void handleJoin()}
          disabled={connecting}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 font-medium text-white transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {connecting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Joining…
            </>
          ) : (
            "Join now"
          )}
        </button>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-900 px-4">
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-3xl bg-slate-800/60 p-6 ring-1 ring-white/10 backdrop-blur">
      {children}
    </div>
  );
}
