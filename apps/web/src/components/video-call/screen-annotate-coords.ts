// Web side of the screen-share annotation coordinate math — the twin of apps/desktop's overlay
// coords. Marks live in a fixed "share frame" SHARE_W units wide × SHARE_W*(displayH/displayW) tall,
// so a mark at share-(x,y) lands at the same fraction of the shared screen for everyone (mirrors
// DOC_PAGE_WIDTH/pageBounds). Keep SHARE_W in sync with apps/desktop/src/renderer/overlay/coords.ts.

export const SHARE_W = 1000;

/** Height of the share frame in scene units for a shared screen of the given natural pixel size. */
export function shareFrameHeight(naturalW: number, naturalH: number): number {
  return naturalW > 0 ? (SHARE_W * naturalH) / naturalW : SHARE_W;
}

export interface ContentRect {
  /** Top-left + size of the actual video CONTENT (object-contain → letterboxed), in the chosen frame. */
  x: number;
  y: number;
  w: number;
  h: number;
  naturalW: number;
  naturalH: number;
}

/**
 * The letterboxed content rectangle of an `object-contain` video, expressed relative to an origin
 * (pass the container's viewport top-left to get container-local coords, or 0,0 for viewport coords).
 * Returns a zero-size rect until the video has dimensions.
 */
export function videoContentRect(
  video: HTMLVideoElement,
  originLeft = 0,
  originTop = 0,
): ContentRect {
  const box = video.getBoundingClientRect();
  const naturalW = video.videoWidth || 0;
  const naturalH = video.videoHeight || 0;
  if (naturalW === 0 || naturalH === 0 || box.width === 0 || box.height === 0) {
    return { x: 0, y: 0, w: 0, h: 0, naturalW, naturalH };
  }
  const natAspect = naturalW / naturalH;
  const boxAspect = box.width / box.height;
  let w: number;
  let h: number;
  if (natAspect > boxAspect) {
    // letterboxed top/bottom — content spans the full width
    w = box.width;
    h = box.width / natAspect;
  } else {
    // pillarboxed left/right — content spans the full height
    h = box.height;
    w = box.height * natAspect;
  }
  return {
    x: box.left + (box.width - w) / 2 - originLeft,
    y: box.top + (box.height - h) / 2 - originTop,
    w,
    h,
    naturalW,
    naturalH,
  };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Map a viewport pointer position to share-frame units, clamped to the shared screen. */
export function pointerToShare(rect: ContentRect, clientX: number, clientY: number): [number, number] {
  const fx = rect.w > 0 ? clamp01((clientX - rect.x) / rect.w) : 0;
  const fy = rect.h > 0 ? clamp01((clientY - rect.y) / rect.h) : 0;
  const shareH = shareFrameHeight(rect.naturalW, rect.naturalH);
  return [fx * SHARE_W, fy * shareH];
}
