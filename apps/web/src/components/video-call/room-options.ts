import {
  ScreenSharePresets,
  VideoPreset,
  type RoomOptions,
  type ScreenShareCaptureOptions,
} from "livekit-client";

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
 *  • screenShareEncoding — 4 Mbps @ 30fps. Screen-share is the classroom's main surface, and its
 *    degradation stays "maintain-resolution" (the per-source SDK default), so the fps cap is what a
 *    GOOD link enjoys, not what a bad link pays for: static slides emit almost no frames either way,
 *    scrolling/video-in-share now renders smooth instead of 15fps-janky, and under pressure the
 *    encoder sheds fps back down exactly as before — text never goes soft.
 *
 *  • screenShareSimulcastLayers — pinned to the SDK's h720fps15 (1280x720 @ 1.5 Mbps @ 15fps).
 *    The low rung IS the share's worst-case reading experience, reached from BOTH sides: a viewer
 *    whose downlink can't hold the top layer is downswitched onto it, and a presenter whose UPLINK
 *    can't hold the top layer stops sending it — putting the whole class on the low rung. The SDK's
 *    auto rung is half-res (960x540), and 540p is precisely where slide text turns to mush; 720p is
 *    the smallest size that keeps it readable, so that's the floor. Pinning also matters for the
 *    fps: recomputed under a 30fps cap, the auto rung would spend the same bitrate on twice the
 *    frames. Low rung keeps its bits at 15fps; only the top rung gets the fps.
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
  /**
   * Mic processing for the FIRST publish, before any saved settings are re-applied.
   *
   * This has to live here, not only in the Settings dialog, because the loudest complaint about the
   * classroom is the other side's background noise ("the student's room is in my ear"), and a student
   * will never open Settings. Whatever we want every participant to get has to be the join default.
   *
   * `voiceIsolation` is the ML speech extractor and the actual fix for fan/room noise — plain
   * `noiseSuppression` only ever took the edge off it (see `micConstraints` for why sending both is
   * correct and why it degrades safely on browsers that lack it).
   */
  audioCaptureDefaults: {
    echoCancellation: true,
    noiseSuppression: true,
    voiceIsolation: true,
    autoGainControl: true,
  },
  publishDefaults: {
    videoEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
    videoSimulcastLayers: [
      new VideoPreset(320, 180, 250_000, 30),
      new VideoPreset(640, 360, 800_000, 30),
    ],
    screenShareEncoding: { maxBitrate: 4_000_000, maxFramerate: 30 },
    screenShareSimulcastLayers: [ScreenSharePresets.h720fps15],
  },
};

/**
 * getDisplayMedia options for every screen-share toggle (main + presenter control bars share these).
 *
 *  • contentHint "detail" — slides/whiteboard/text is the dominant share content; bias the encoder
 *    to spatial detail. Only effective on the VP8 path — with SVC codecs the SDK force-overrides the
 *    hint to "motion", which is one more reason the codec stays VP8 (see above).
 *  • selfBrowserSurface "exclude" — sharing the call's own tab is the classic infinite-mirror
 *    accident; remove it from the picker.
 *  • surfaceSwitching "include" — let the sharer retarget tabs mid-share without stopping.
 *  • audio + systemAudio — surface the "share audio" checkbox for tab AND full-screen shares.
 *
 *  • audio.restrictOwnAudio "true" — THE echo fix. `systemAudio: "include"` lets the teacher share a
 *    whole-screen capture with sound, but a system-audio capture is indiscriminate: it grabs
 *    everything the machine is playing, and that includes the call itself coming out of the
 *    teacher's speakers. So every student's voice was being re-captured and re-published back into
 *    the room on the screen-audio track — the class hearing itself a beat late, which is precisely
 *    the "annoying echo at the student" report. Muting the mic appeared to fix it only because it
 *    removed the loudest thing feeding those speakers; the loop was in the SHARE, not the mic.
 *    `restrictOwnAudio` tells the browser to exclude our own rendered audio from the capture, which
 *    kills the loop at the source and — unlike muting — leaves the teacher free to talk over the clip.
 *    Unrecognised constraint names are discarded by the UA and it's an ideal (non-`exact`) boolean,
 *    so on a browser without it the share still starts, just without the protection.
 *
 *    NOT paired with `suppressLocalAudioPlayback`, which would also break the loop but by silencing
 *    the clip on the teacher's own speakers — they'd be narrating a video they can't hear.
 */
export const SCREEN_SHARE_CAPTURE_OPTIONS: ScreenShareCaptureOptions = {
  audio: { restrictOwnAudio: true },
  systemAudio: "include",
  contentHint: "detail",
  selfBrowserSurface: "exclude",
  surfaceSwitching: "include",
};
