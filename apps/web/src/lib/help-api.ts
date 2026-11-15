/**
 * The in-app help's server half (App\Http\Controllers\HelpController + Admin\HelpVideoController).
 *
 * The help TEXT ships with this app (src/content/help); the server holds only the videos, so one
 * can be recorded and attached without a deploy, and tells a new academy's dashboard how far its
 * first steps got. A module of its own, like `levels-api.ts`: nothing in `api.ts` grows a help call.
 */
import { apiFetch, uploadFileToTarget, type MediaUploadTarget } from "@/lib/api";

/** A recorded help video. A slot with no video is simply absent from the list. */
export interface HelpVideo {
  /** Where it plays: a topic's own id (the page tour) or `<topic>.<task>` (one task). */
  slot: string;
  source: "LINK" | "UPLOAD";
  /** A LINK as it was pasted; an UPLOAD as a signed url that expires — re-read, never store. */
  url: string;
  filename: string | null;
  sizeBytes: number | null;
  updatedAt: string;
}

export function getHelpVideos(): Promise<{ videos: HelpVideo[] }> {
  return apiFetch("/api/help/videos");
}

/** The first things an academy does, and whether it has done each. */
export type OnboardingStep = "teacher" | "student" | "group" | "schedule" | "attendance" | "money";

export interface Onboarding {
  /** False for an academy that is no longer new, and for a platform Super Admin. */
  show: boolean;
  done: Partial<Record<OnboardingStep, boolean>>;
}

export function getOnboarding(): Promise<Onboarding> {
  return apiFetch("/api/help/onboarding");
}

/** Point a slot at a link (YouTube, Vimeo or a direct file url). Super Admin only. */
export function setHelpVideoLink(slot: string, url: string): Promise<{ ok: true }> {
  return apiFetch(`/api/admin/help-videos/${encodeURIComponent(slot)}`, {
    method: "PUT",
    body: JSON.stringify({ url }),
  });
}

/**
 * Upload a recording into a slot: reserve a key, send the file straight to storage, attach it.
 * `onProgress` gets 0–100 while the file travels. Super Admin only.
 */
export async function uploadHelpVideo(
  slot: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const reserved = await apiFetch<{ key: string; upload: MediaUploadTarget }>(
    "/api/admin/help-videos/upload-url",
    {
      method: "POST",
      body: JSON.stringify({
        slot,
        filename: file.name,
        content_type: file.type || "video/mp4",
        size_bytes: file.size,
      }),
    },
  );
  await uploadFileToTarget(reserved.upload, file, onProgress);
  await apiFetch(`/api/admin/help-videos/${encodeURIComponent(slot)}`, {
    method: "PUT",
    body: JSON.stringify({ storage_key: reserved.key, filename: file.name }),
  });
}

/** Back to "not recorded yet". Super Admin only. */
export function removeHelpVideo(slot: string): Promise<{ ok: true }> {
  return apiFetch(`/api/admin/help-videos/${encodeURIComponent(slot)}`, { method: "DELETE" });
}

/** How a video url plays: an embedded player for YouTube / Vimeo, a plain <video> for a file. */
export type VideoPlayer =
  | { kind: "embed"; src: string }
  | { kind: "file"; src: string };

/**
 * Turn whatever was pasted into something a page can play. YouTube in its four spellings (watch,
 * youtu.be, shorts, embed) and Vimeo become their embed players; anything else is taken to be a
 * video file. Never throws: a link we cannot read is handed to <video>, which shows its own error.
 */
export function videoPlayer(url: string): VideoPlayer {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "file", src: url };
  }
  const host = parsed.hostname.replace(/^www\.|^m\./, "");
  const segments = parsed.pathname.split("/").filter(Boolean);

  let youtubeId: string | null = null;
  if (host === "youtu.be") youtubeId = segments[0] ?? null;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (segments[0] === "watch") youtubeId = parsed.searchParams.get("v");
    else if (segments[0] === "shorts" || segments[0] === "embed" || segments[0] === "live") youtubeId = segments[1] ?? null;
  }
  if (youtubeId !== null && /^[\w-]{6,20}$/.test(youtubeId)) {
    return { kind: "embed", src: `https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&autoplay=1` };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = segments.find((segment) => /^\d+$/.test(segment));
    if (id !== undefined) return { kind: "embed", src: `https://player.vimeo.com/video/${id}?autoplay=1` };
  }

  return { kind: "file", src: url };
}
