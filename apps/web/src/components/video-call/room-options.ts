import type { RoomOptions } from "livekit-client";

/**
 * Tuned connect-time options for the classroom SFU.
 *
 * LiveKit's out-of-the-box defaults are conservative and were the main reason our video looked soft
 * next to Zoom — the room was previously created with only `{ adaptiveStream: true, dynacast: true }`,
 * so every stream fell back to the SDK defaults (≈1.7 Mbps 720p, "balanced" degradation, and a
 * DPR-unaware adaptiveStream). The knobs below fix that without hurting weak networks — congestion
 * control still throttles below every ceiling, so these are upside on good links and neutral on bad
 * ones:
 *
 *  • adaptiveStream.pixelDensity: "screen" — the subscriber picks a simulcast layer from the tile's
 *    *rendered* size. Without this it ignores devicePixelRatio, so a crisp Retina/hi-DPI tile only
 *    requests ~half its true pixels and looks soft. "screen" scales the request by DPR, so a pinned
 *    or fullscreen tile actually pulls the 720p layer instead of 360p.
 *
 *  • degradationPreference: "maintain-resolution" — under CPU/bandwidth pressure, shed framerate
 *    instead of resolution. A talking teacher and a shared whiteboard must stay sharp; the WebRTC
 *    default ("balanced") drops resolution first, which reads as "blurry" — the exact complaint.
 *
 *  • videoEncoding — raise the camera ceiling from the 1.7 Mbps default to 2.5 Mbps @ 30fps so good
 *    uplinks can actually deliver a crisp top layer.
 *
 *  • screenShareEncoding — shared slides/PDFs need bitrate for legible text; framerate matters far
 *    less, so 4 Mbps @ 15fps keeps text readable where the ~1.5 Mbps default turns it mushy.
 *
 * dynacast stays on (the server pauses layers nobody is watching). Codec is left at the SDK default
 * (VP8) on purpose: VP9/AV1 SVC compress better but cost the publisher more encode CPU (and a
 * backup-codec double-encode for old-device compatibility), which is risky for budget student
 * devices — that's the next lever, gated on a real-device test pass, not this change.
 */
export const CLASSROOM_ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: { pixelDensity: "screen" },
  dynacast: true,
  publishDefaults: {
    degradationPreference: "maintain-resolution",
    videoEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
    screenShareEncoding: { maxBitrate: 4_000_000, maxFramerate: 15 },
  },
};
