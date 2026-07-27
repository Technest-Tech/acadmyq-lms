"use client";

import {
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LessonPlaybackProps } from "@/app/learn/[academy]/lesson-content";
import { cn } from "@/lib/utils";

/**
 * An unbranded player for a YouTube-hosted lesson (docs/lms/04).
 *
 * A plain `/embed/` iframe puts YouTube's chrome inside a paid course: the channel name and video
 * title over the top, a "Watch on YouTube" button on pause, the logo in the control bar, and
 * related-video end screens — all of them links out of a lesson the learner paid for, and all of
 * them draggable straight into a new tab. This renders the same video with none of that:
 *
 *  1. Playback goes through the IFrame API with YouTube's own UI off — `controls: 0`, `rel: 0`,
 *     `modestbranding: 1`, `iv_load_policy: 3`, `disablekb: 1`, `fs: 0`.
 *  2. The iframe gets `pointer-events: none` the moment it is ready, and a transparent shield sits
 *     over it. Between them the mouse never reaches YouTube's surface, so nothing inside the frame
 *     can be clicked, dragged or right-clicked — not even the parts the player vars don't remove.
 *  3. Everything the learner can actually operate — play/pause, seek, speed, mute, fullscreen — is
 *     ours, below.
 *
 * The API is loaded on first play, not on mount: a course page with twenty lessons should not pull
 * YouTube's script (or hand YouTube twenty impressions) before anyone presses play.
 *
 * It honours the same {@link LessonPlaybackProps} contract as the uploaded-media players, so a
 * YouTube lesson finally records a resume point and completes itself like every other lesson type.
 */

// ── the IFrame API, typed just enough ────────────────────────────────────────

interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}

interface YtNamespace {
  Player: new (
    el: HTMLElement | string,
    options: {
      videoId: string;
      host?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (e: { target: YtPlayer }) => void;
        onStateChange?: (e: { data: number; target: YtPlayer }) => void;
      };
    },
  ) => YtPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
}

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
    __ytApiPromise?: Promise<YtNamespace>;
  }
}

/**
 * Load `iframe_api` once per document. YouTube calls exactly one global callback, so concurrent
 * players must share a single promise rather than each installing their own hook — the second would
 * overwrite the first and that player would wait forever.
 */
function loadYouTubeApi(): Promise<YtNamespace> {
  if (window.__ytApiPromise) return window.__ytApiPromise;

  window.__ytApiPromise = new Promise<YtNamespace>((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });

  return window.__ytApiPromise;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** m:ss, or h:mm:ss once a lesson runs past an hour. */
function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => n.toString().padStart(2, "0");

  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// ── component ────────────────────────────────────────────────────────────────

export function YoutubePlayer({
  videoId,
  title,
  startAt,
  autoPlay,
  onTime,
  onEnded,
}: { videoId: string; title: string } & LessonPlaybackProps) {
  const t = useTranslations("learn.player");

  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const tickRef = useRef<number | null>(null);
  const lastReport = useRef(0);
  // Callbacks come from a parent that re-renders on every tick; holding them in refs keeps the
  // polling effect from tearing the player down and rebuilding it mid-lesson.
  const onTimeRef = useRef(onTime);
  const onEndedRef = useRef(onEnded);
  const startAtRef = useRef(startAt);

  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    onTimeRef.current = onTime;
    onEndedRef.current = onEnded;
    startAtRef.current = startAt;
  }, [onTime, onEnded, startAt]);

  // A new lesson reuses this component: reset to the poster so the previous video can't keep
  // playing under the new lesson's title.
  useEffect(() => {
    setStarted(false);
    setReady(false);
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    lastReport.current = 0;
  }, [videoId]);

  const start = useCallback(() => setStarted(true), []);

  useEffect(() => {
    if (autoPlay) setStarted(true);
  }, [autoPlay, videoId]);

  // Build the player once the learner has asked for it.
  useEffect(() => {
    if (!started) return;

    let cancelled = false;

    void loadYouTubeApi().then((YT) => {
      if (cancelled || !mountRef.current) return;

      playerRef.current = new YT.Player(mountRef.current, {
        videoId,
        // The no-cookie host keeps YouTube from writing tracking cookies for a learner who never
        // chose to visit YouTube.
        host: "https://www.youtube-nocookie.com",
        playerVars: {
          autoplay: 1,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
          iv_load_policy: 3,
        },
        events: {
          onReady: (e) => {
            if (cancelled) return;
            // Belt and braces with the shield: even if the overlay is removed in devtools, the
            // frame itself refuses the mouse, so no YouTube link is reachable.
            e.target.getIframe().style.pointerEvents = "none";

            const total = e.target.getDuration();
            setDuration(total);
            setMuted(e.target.isMuted());

            // Same resume rule as the uploaded players: landing in the last few seconds would just
            // replay the outro, so start over instead.
            const resume = startAtRef.current ?? 0;
            if (resume > 5 && resume < total - 10) {
              e.target.seekTo(resume, true);
            }
            e.target.playVideo();
            setReady(true);
          },
          onStateChange: (e) => {
            if (cancelled) return;
            setPlaying(e.data === YT.PlayerState.PLAYING);
            if (e.data === YT.PlayerState.ENDED) onEndedRef.current?.();
          },
        },
      });
    });

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [started, videoId]);

  // Poll for position: the IFrame API has no timeupdate event. 250ms keeps the scrubber smooth;
  // the parent still only hears about it every ~10s, matching the uploaded-media cadence.
  useEffect(() => {
    if (!ready) return;

    tickRef.current = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;

      const at = player.getCurrentTime();
      const total = player.getDuration() || 0;
      setCurrent(at);
      if (total) setDuration(total);

      if (total && Math.abs(at - lastReport.current) >= 10) {
        lastReport.current = at;
        onTimeRef.current?.(at, total);
      }
    }, 250);

    return () => {
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [ready]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (playing) player.pauseVideo();
    else player.playVideo();
  }, [playing]);

  const seekTo = useCallback((seconds: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.seekTo(seconds, true);
    setCurrent(seconds);
  }, []);

  const seekFromEvent = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.min(
        Math.max((e.clientX - rect.left) / rect.width, 0),
        1,
      );
      seekTo(ratio * duration);
    },
    [duration, seekTo],
  );

  const toggleMute = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (player.isMuted()) {
      player.unMute();
      setMuted(false);
    } else {
      player.mute();
      setMuted(true);
    }
  }, []);

  const changeRate = useCallback((next: number) => {
    setRate(next);
    setRatesOpen(false);
    playerRef.current?.setPlaybackRate(next);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current?.requestFullscreen();
  }, []);

  // Our own keyboard shortcuts, because `disablekb: 1` turned YouTube's off. Scoped to the focused
  // player, so they never steal keys from the notes field beside it.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!ready) return;
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekTo(Math.min(current + 5, duration));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekTo(Math.max(current - 5, 0));
      } else if (e.key === "m") {
        e.preventDefault();
        toggleMute();
      } else if (e.key === "f") {
        e.preventDefault();
        toggleFullscreen();
      }
    },
    [ready, current, duration, toggle, seekTo, toggleMute, toggleFullscreen],
  );

  const progress = duration ? (current / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className="group relative aspect-video w-full overflow-hidden rounded-xl bg-black select-none"
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      {/* Poster. Also the reason nothing loads from YouTube until someone presses play. */}
      {!started && (
        <button
          type="button"
          onClick={start}
          aria-label={t("play")}
          className="absolute inset-0 size-full cursor-pointer"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
            alt={title}
            draggable={false}
            className="size-full object-cover"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/15">
            <span className="bg-primary flex size-16 items-center justify-center rounded-full shadow-xl transition-transform hover:scale-105">
              <Play
                className="size-7 translate-x-0.5 fill-white text-white"
                aria-hidden
              />
            </span>
          </span>
        </button>
      )}

      {started && (
        <>
          <div className="absolute inset-0 size-full">
            <div ref={mountRef} className="size-full" />
          </div>

          {/* The shield. Nothing below it is clickable, which is the whole point. */}
          <div
            className="absolute inset-0 z-10"
            onClick={toggle}
            onDoubleClick={toggleFullscreen}
            onDragStart={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
          />

          {!ready && (
            <span className="absolute inset-0 z-20 flex items-center justify-center text-white">
              <Loader2
                className="size-8 animate-spin"
                aria-label={t("loading")}
              />
            </span>
          )}

          {/* Controls are LTR even in Arabic: a timeline runs with the video, not with the script. */}
          <div
            dir="ltr"
            className={cn(
              "absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 bg-gradient-to-t from-black/85 to-transparent px-3 pt-10 pb-2.5 text-white transition-opacity sm:gap-3 sm:px-4",
              playing
                ? "opacity-0 group-hover:opacity-100 group-focus:opacity-100"
                : "opacity-100",
            )}
          >
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? t("pause") : t("play")}
              className="shrink-0 transition-transform hover:scale-110"
            >
              {playing ? (
                <Pause className="size-6 fill-white" aria-hidden />
              ) : (
                <Play className="size-6 fill-white" aria-hidden />
              )}
            </button>

            <div
              role="slider"
              tabIndex={-1}
              aria-label={t("seek")}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(current)}
              onClick={seekFromEvent}
              className="group/bar relative h-1.5 flex-1 cursor-pointer rounded-full bg-white/30"
            >
              <div
                className="bg-primary absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${progress}%` }}
              />
              <span
                className="bg-primary absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 transition-opacity group-hover/bar:opacity-100"
                style={{ left: `${progress}%` }}
                aria-hidden
              />
            </div>

            <span className="shrink-0 text-xs font-medium tabular-nums">
              {formatTime(current)} / {formatTime(duration)}
            </span>

            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? t("unmute") : t("mute")}
              className="hidden shrink-0 transition-transform hover:scale-110 sm:block"
            >
              {muted ? (
                <VolumeX className="size-5" aria-hidden />
              ) : (
                <Volume2 className="size-5" aria-hidden />
              )}
            </button>

            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setRatesOpen((v) => !v)}
                aria-label={t("speed")}
                className="rounded px-1.5 py-0.5 text-xs font-bold tabular-nums transition-colors hover:bg-white/20"
              >
                {rate}×
              </button>
              {ratesOpen && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-10 cursor-default"
                    aria-hidden
                    tabIndex={-1}
                    onClick={() => setRatesOpen(false)}
                  />
                  <div className="absolute right-0 bottom-full z-20 mb-2 w-20 overflow-hidden rounded-lg bg-neutral-900/95 py-1 text-xs shadow-xl ring-1 ring-white/10">
                    {RATES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => changeRate(r)}
                        className={cn(
                          "block w-full px-3 py-1.5 text-right font-semibold tabular-nums transition-colors hover:bg-white/10",
                          r === rate ? "text-primary" : "text-white",
                        )}
                      >
                        {r}×
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? t("exitFullscreen") : t("fullscreen")}
              className="shrink-0 transition-transform hover:scale-110"
            >
              {fullscreen ? (
                <Minimize className="size-5" aria-hidden />
              ) : (
                <Maximize className="size-5" aria-hidden />
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
