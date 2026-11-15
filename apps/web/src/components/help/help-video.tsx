"use client";

import { Clapperboard, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { videoPlayer, type HelpVideo } from "@/lib/help-api";
import { cn } from "@/lib/utils";

/**
 * A help video's place on the page, in its three states:
 *
 *  - not recorded yet → a quiet "coming soon" card (only where `soon` is given: the page tour shows
 *    it, a single task simply has no video button until one exists);
 *  - recorded → a poster with a play button. Nothing loads from YouTube or storage until it is
 *    pressed, so opening the help costs no video bandwidth on a phone;
 *  - playing → the player itself, YouTube / Vimeo embedded and a file in a plain <video>.
 */
export function HelpVideoCard({
  video,
  label,
  hint,
  soon,
  compact = false,
}: {
  video: HelpVideo | undefined;
  /** What the poster says ("Watch the page tour"). */
  label: string;
  /** The small line under it ("About a minute"). */
  hint?: string;
  /** The card shown while there is no video. Omit to render nothing in that case. */
  soon?: { title: string; body: string };
  /** A shorter poster, for a video that sits inside one task. */
  compact?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  // A different video in the same place (the Super Admin replaced it) starts from its poster.
  const src = video?.url;
  useEffect(() => setPlaying(false), [src]);

  if (video === undefined) {
    if (soon === undefined) return null;
    return (
      <div
        data-testid="help-video-soon"
        className="border-border/70 from-primary/[0.05] to-gold/[0.08] flex items-center gap-3.5 rounded-2xl border border-dashed bg-gradient-to-br p-4"
      >
        <span className="bg-card text-muted-foreground ring-border/60 flex size-11 shrink-0 items-center justify-center rounded-xl ring-1">
          <Clapperboard className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold">{soon.title}</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{soon.body}</p>
        </div>
      </div>
    );
  }

  if (!playing) {
    return (
      <button
        type="button"
        data-testid="help-video-play"
        onClick={() => setPlaying(true)}
        className={cn(
          "group focus-visible:ring-ring/60 relative flex w-full items-center overflow-hidden rounded-2xl text-start text-white outline-none focus-visible:ring-2",
          compact ? "gap-3 p-3" : "aspect-video flex-col justify-center gap-3 p-5",
        )}
        style={{ background: "linear-gradient(135deg, oklch(0.27 0.045 258) 0%, oklch(0.36 0.07 255) 100%)" }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -end-10 -top-12 size-40 rounded-full blur-3xl"
          style={{ background: "oklch(0.835 0.118 85 / 0.32)" }}
        />
        <span
          className={cn(
            "bg-gold text-gold-foreground relative flex shrink-0 items-center justify-center rounded-full shadow-lg transition-transform group-hover:scale-105",
            compact ? "size-9" : "size-14",
          )}
        >
          <Play className={cn("fill-current rtl:-scale-x-100", compact ? "size-4" : "size-6")} aria-hidden />
        </span>
        <span className={cn("relative min-w-0", !compact && "text-center")}>
          <span className={cn("block font-bold", compact ? "text-sm" : "text-base")}>{label}</span>
          {hint && <span className="mt-0.5 block text-xs text-white/75">{hint}</span>}
        </span>
      </button>
    );
  }

  const player = videoPlayer(video.url);
  return (
    <div className="aspect-video overflow-hidden rounded-2xl bg-black" data-testid="help-video-player">
      {player.kind === "embed" ? (
        <iframe
          src={player.src}
          title={label}
          className="size-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      ) : (
        // No captions track: it is a screen recording, and the written steps beside it are its text.
        <video src={player.src} className="size-full" controls autoPlay playsInline />
      )}
    </div>
  );
}
