"use client";

import {
  BackgroundProcessor,
  supportsBackgroundProcessors,
  type BackgroundProcessorWrapper,
} from "@livekit/track-processors";
import type { LocalVideoTrack } from "livekit-client";
import type { CallBackground } from "./use-call-settings";

/** Whether the browser can run the MediaPipe segmentation (WebGL/WASM). Hide the feature if not. */
export function backgroundSupported(): boolean {
  try {
    return supportsBackgroundProcessors();
  } catch {
    return false;
  }
}

export function blurRadiusFor(strength: "light" | "strong"): number {
  return strength === "strong" ? 25 : 10;
}

// One processor instance, kept so we can switchTo() new modes in place (avoids re-init artifacts).
let processor: BackgroundProcessorWrapper | null = null;
let appliedKey: string | null = null; // the mediaStreamTrack.id the processor is currently attached to

function trackKey(track: LocalVideoTrack): string {
  return track.mediaStreamTrack?.id ?? "";
}

/**
 * Apply (or clear) the chosen background on the local camera track. Reuses one processor and switches
 * modes live when the track is unchanged; re-attaches fresh after a track restart (device/resolution
 * change gives a new mediaStreamTrack). No-ops without a track.
 */
export async function applyBackground(
  track: LocalVideoTrack | undefined,
  bg: CallBackground,
): Promise<void> {
  if (!track) return;

  if (bg.type === "none") {
    if (processor) {
      try {
        await track.stopProcessor();
      } catch {
        // already cleared
      }
    }
    processor = null;
    appliedKey = null;
    return;
  }

  const opts =
    bg.type === "blur"
      ? ({ mode: "background-blur", blurRadius: blurRadiusFor(bg.strength) } as const)
      : ({ mode: "virtual-background", imagePath: bg.src } as const);

  // Same track + an existing processor → switch mode in place.
  if (processor && appliedKey === trackKey(track)) {
    try {
      await processor.switchTo(opts);
      return;
    } catch {
      processor = null; // fall through to a fresh attach
    }
  }

  processor = BackgroundProcessor(opts);
  await track.setProcessor(processor);
  appliedKey = trackKey(track);
}

/**
 * Detach the processor from a track that is going away — the lobby preview on unmount, or when a new
 * preview track replaces it. Without this the segmentation instance the lobby spun up stays attached
 * to a dead track, still holding its WASM/GPU context, while the call immediately builds a second one
 * for its own camera. Also clears the module state so the next `applyBackground` attaches fresh
 * instead of trying to `switchTo()` on a processor whose track no longer exists.
 */
export async function releaseBackground(track: LocalVideoTrack | undefined): Promise<void> {
  if (!track) return;
  try {
    await track.stopProcessor();
  } catch {
    // track already stopped/detached — nothing to release
  }
  if (appliedKey === trackKey(track)) {
    processor = null;
    appliedKey = null;
  }
}
