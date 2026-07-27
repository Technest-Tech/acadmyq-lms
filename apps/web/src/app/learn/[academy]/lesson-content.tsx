"use client";

import type Hls from "hls.js";
import { Download, FileText, Loader2, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { YoutubePlayer } from "@/components/learn/youtube-player";
import { learnPlayback, type LearnLesson } from "@/lib/learn-api";
import { QuizRunner } from "./quiz-runner";

/**
 * Renders a lesson's content by type. Content is absent when the viewer isn't entitled to it.
 *
 * Playable lessons (uploaded video/audio) also report where the learner got to, so the player can
 * save a resume point and tick the lesson off once it has effectively been watched — the behaviour
 * every course platform has, and the reason `position_seconds` exists in the API.
 */

export interface LessonPlaybackProps {
  /** Resume point in seconds — applied once the media knows its duration. */
  startAt?: number;
  autoPlay?: boolean;
  /** Throttled (~10s) playback position, plus the media's duration. */
  onTime?: (position: number, duration: number) => void;
  onEnded?: () => void;
}

export function LessonContent({
  lesson,
  academy,
  onComplete,
  startAt,
  autoPlay,
  onTime,
  onEnded,
}: {
  lesson: LearnLesson;
  academy: string;
  onComplete?: () => void;
} & LessonPlaybackProps) {
  const t = useTranslations("learn");

  // A quiz carries its own content (the questions) and completes itself on a pass.
  if (lesson.type === "QUIZ") {
    return (
      <QuizRunner
        academy={academy}
        lessonId={lesson.id}
        onPassed={onComplete}
      />
    );
  }

  const uploaded = lesson.has_media === true; // VIDEO_UPLOAD, or an uploaded AUDIO
  const hasContent =
    lesson.youtube_video_id != null ||
    lesson.body != null ||
    lesson.attachment_path != null ||
    uploaded;

  if (!hasContent) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-sm">
        <Lock className="size-5 opacity-50" />
        {t("player.locked")}
      </div>
    );
  }

  // YouTube-hosted lesson: our own chrome, none of YouTube's (see YoutubePlayer).
  if (lesson.type === "YOUTUBE" && lesson.youtube_video_id) {
    return (
      <YoutubePlayer
        videoId={lesson.youtube_video_id}
        title={lesson.title}
        startAt={startAt}
        autoPlay={autoPlay}
        onTime={onTime}
        onEnded={onEnded}
      />
    );
  }

  // Uploaded video / audio (docs/lms/04): fetch a short-lived signed url just in time.
  if (lesson.type === "VIDEO_UPLOAD" || (lesson.type === "AUDIO" && uploaded)) {
    if (lesson.media_status && lesson.media_status !== "READY") {
      return (
        <div className="text-muted-foreground flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t("player.processing")}
        </div>
      );
    }
    return (
      <UploadedMedia
        academy={academy}
        lesson={lesson}
        startAt={startAt}
        autoPlay={autoPlay}
        onTime={onTime}
        onEnded={onEnded}
      />
    );
  }

  if (lesson.type === "AUDIO" && lesson.attachment_path) {
    return (
      <PlainMedia
        kind="AUDIO"
        src={lesson.attachment_path}
        startAt={startAt}
        autoPlay={autoPlay}
        onTime={onTime}
        onEnded={onEnded}
      />
    );
  }

  if (lesson.type === "PDF" && lesson.attachment_path) {
    return (
      <a
        href={lesson.attachment_path}
        target="_blank"
        rel="noreferrer"
        className="border-input hover:border-primary/50 hover:bg-muted/50 flex items-center gap-3 rounded-xl border p-4 text-sm font-medium transition-colors"
      >
        <span className="bg-[var(--brand-soft)] flex size-10 shrink-0 items-center justify-center rounded-xl">
          <FileText className="text-primary size-5" aria-hidden />
        </span>
        <span className="flex-1">{t("player.openPdf")}</span>
        <Download className="text-muted-foreground size-4" aria-hidden />
      </a>
    );
  }

  if (lesson.type === "TEXT" && lesson.body != null) {
    return (
      <div className="prose prose-sm max-w-none text-sm leading-relaxed whitespace-pre-wrap">
        {lesson.body}
      </div>
    );
  }

  return null;
}

type Playback = {
  url: string;
  kind: "VIDEO" | "AUDIO";
  protocol: "hls" | "progressive";
};

/** Resolves the enrollment-gated signed playback URL, then renders the right player for its protocol. */
function UploadedMedia({
  academy,
  lesson,
  ...playbackProps
}: { academy: string; lesson: LearnLesson } & LessonPlaybackProps) {
  const t = useTranslations("learn");
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setPlayback(null);
    setError(null);
    learnPlayback(academy, lesson.id)
      .then((r) => {
        if (active) setPlayback(r);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : t("errors.generic"));
      });
    return () => {
      active = false;
    };
  }, [academy, lesson.id, t]);

  if (error) {
    return (
      <div className="rounded-xl border border-dashed p-4 text-sm text-red-600">
        {error}
      </div>
    );
  }

  if (playback === null) {
    return (
      <div className="text-muted-foreground flex aspect-video w-full items-center justify-center rounded-xl border border-dashed text-sm">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  // A transcoded video streams via hls.js; a progressive-MP4 v0 is a plain <video> source.
  if (playback.protocol === "hls") {
    return <HlsVideo src={playback.url} {...playbackProps} />;
  }

  return (
    <PlainMedia kind={playback.kind} src={playback.url} {...playbackProps} />
  );
}

/**
 * The shared media behaviour: resume where the learner stopped, report the position on a ~10s
 * cadence (often enough to be a useful resume point, rare enough not to hammer the API), and hand
 * the "finished" event up so the player can advance.
 */
function useMediaBehaviour({ startAt, onTime, onEnded }: LessonPlaybackProps) {
  const lastReport = useRef(0);
  const seeked = useRef(false);

  // A fresh lesson gets a fresh seek — the same <video> node is reused across lessons.
  useEffect(() => {
    seeked.current = false;
    lastReport.current = 0;
  }, [startAt]);

  const onLoadedMetadata = useCallback(
    (e: { currentTarget: HTMLMediaElement }) => {
      const el = e.currentTarget;
      // Resuming into the last few seconds would just replay the credits — start over instead.
      if (
        !seeked.current &&
        startAt &&
        startAt > 5 &&
        startAt < el.duration - 10
      ) {
        el.currentTime = startAt;
      }
      seeked.current = true;
    },
    [startAt],
  );

  const onTimeUpdate = useCallback(
    (e: { currentTarget: HTMLMediaElement }) => {
      const el = e.currentTarget;
      if (!onTime || !Number.isFinite(el.duration)) return;
      if (Math.abs(el.currentTime - lastReport.current) < 10) return;
      lastReport.current = el.currentTime;
      onTime(el.currentTime, el.duration);
    },
    [onTime],
  );

  return { onLoadedMetadata, onTimeUpdate, onEnded };
}

function PlainMedia({
  kind,
  src,
  autoPlay,
  ...rest
}: { kind: "VIDEO" | "AUDIO"; src: string } & LessonPlaybackProps) {
  const handlers = useMediaBehaviour(rest);

  if (kind === "AUDIO") {
    return (
      <audio
        controls
        src={src}
        autoPlay={autoPlay}
        className="w-full"
        {...handlers}
      />
    );
  }
  return (
    <video
      controls
      playsInline
      src={src}
      autoPlay={autoPlay}
      className="aspect-video w-full rounded-xl bg-black"
      {...handlers}
    />
  );
}

/**
 * Adaptive HLS playback. Safari/iOS play `.m3u8` natively; every other browser loads hls.js on demand
 * (dynamic import keeps it out of the initial bundle). The signed manifest url already carries its own
 * signed segment urls (rewritten server-side), so hls.js just fetches them.
 */
function HlsVideo({
  src,
  autoPlay,
  ...rest
}: { src: string } & LessonPlaybackProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const handlers = useMediaBehaviour(rest);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    // Native HLS (Safari/iOS): let the browser handle it, no library needed.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }

    let hls: Hls | null = null;
    let cancelled = false;
    void import("hls.js").then(({ default: HlsCtor }) => {
      if (cancelled || !ref.current) return;
      if (!HlsCtor.isSupported()) {
        ref.current.src = src; // last resort — let the browser try directly
        return;
      }
      hls = new HlsCtor({ enableWorker: true });
      hls.loadSource(src);
      hls.attachMedia(ref.current);
    });

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [src]);

  return (
    <video
      ref={ref}
      controls
      playsInline
      autoPlay={autoPlay}
      className="aspect-video w-full rounded-xl bg-black"
      {...handlers}
    />
  );
}
