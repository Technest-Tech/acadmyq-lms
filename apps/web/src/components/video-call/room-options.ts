import { VideoPreset, type RoomOptions } from "livekit-client";

/**
 * Tuned connect-time options for the classroom SFU.
 *
 * The goal is Zoom-grade camera video: SMOOTH first, sharp second. Two things get us there —
 * letting the SDK pick the degradation policy per source, and publishing a simulcast ladder whose
 * every rung runs at the capture framerate.
 *
 *  • NO `degradationPreference` here — this is deliberate, do not "tune" it back in.
 *    It lives in `publishDefaults`, so setting it applies to EVERY video track, camera and screen
 *    alike. LiveKit's own default (`getDefaultDegradationPreference`) already branches on the
 *    source: screen-share → "maintain-resolution" (slides must stay legible; nobody notices a
 *    slide at 12fps), camera → "balanced" (a face at 12fps reads as broken). Pinning it to
 *    "maintain-resolution" therefore changed nothing for screen-share and only told the camera
 *    encoder to hold 720p and throw away FRAMES under the slightest CPU/bandwidth pressure — which
 *    is both the stutter and the mush, since a starved 720p is blockier than a clean 360p. It also
 *    inverted V-AUD-1 (00-OVERVIEW §"non-negotiables"), which says degrade RESOLUTION first.
 *
 *  • videoSimulcastLayers — the real quality lever. LiveKit's default ladder for a 16:9 camera is
 *    [h180 = 320x180 @ 160kbps @ 20fps, h360 = 640x360 @ 450kbps @ 20fps], so ANY viewer whose tile
 *    is too small to pull the top layer is capped at 20fps before the network is even involved —
 *    and during a screen-share every face rides the 128–160px filmstrip, i.e. the bottom rung. We
 *    republish the same two rungs at the full 30fps with enough bitrate to look good: motion is
 *    what the eye reads as "quality", and smoothness is cheap at these resolutions.
 *
 *  • videoEncoding — the top rung (1280x720 @ 30fps), for the spotlight / pinned / fullscreen tile.
 *
 *  • screenShareEncoding — 4 Mbps @ 15fps keeps shared text crisp; framerate barely matters there.
 *
 * dynacast stays on, and it's what makes the ladder affordable: the SFU pauses any layer nobody is
 * watching, so while the teacher presents, their camera collapses to the ~250kbps bottom rung
 * instead of burning uplink on a 720p layer that every viewer is rendering into a thumbnail.
 *
 * Codec is left at the SDK default (VP8) on purpose: VP9/AV1 SVC compress better but cost the
 * publisher more encode CPU (and a backup-codec double-encode for old-device compatibility), which
 * is risky for budget student devices — that's the next lever, gated on a real-device test pass.
 */
export const CLASSROOM_ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: { pixelDensity: "screen" },
  dynacast: true,
  publishDefaults: {
    videoEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
    videoSimulcastLayers: [
      new VideoPreset(320, 180, 250_000, 30),
      new VideoPreset(640, 360, 800_000, 30),
    ],
    screenShareEncoding: { maxBitrate: 4_000_000, maxFramerate: 15 },
  },
};
