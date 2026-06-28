"use client";

import { Check, Copy, Download, Loader2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getRecordingUrl, type RoomRecording } from "@/lib/api";
import { cn } from "@/lib/utils";

const SPEEDS = [0.5, 1, 1.5, 2] as const;

/** Human-readable byte size (MB/GB), or null when unknown. */
function formatBytes(bytes: number | null, locale: string): string | null {
  if (bytes == null || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mb / 1024)} GB`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: mb < 10 ? 1 : 0 }).format(mb)} MB`;
}

/** Duration `1h 02m` / `12m 30s` / `45s`, or null when unknown. */
function formatDuration(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/**
 * Professional recording player (08-ROOM-ACCESS §15, Part D). A self-contained player card centered
 * in a full-viewport dark overlay — rendered through a PORTAL to `document.body` so it always covers
 * the entire page (an inline `fixed` element is trapped by the scrollable AppShell `<main>`). The
 * video and its controls (playback-speed, Copy-link, Download) live together inside the card, not
 * floating at the screen edge. A fresh short-lived presigned URL is fetched on open (never stored).
 * Closes on backdrop click, Esc, or the close button; background scroll is locked while open.
 */
export function RecordingPlayer({
  recording,
  roomName,
  onClose,
  onCopied,
  onError,
}: {
  recording: RoomRecording;
  roomName?: string | null;
  onClose: () => void;
  /** Surface a "copied" toast in the parent. */
  onCopied: (message: string) => void;
  /** Surface a load/copy failure toast in the parent. */
  onError: (message: string) => void;
}) {
  const t = useTranslations("videoClassroom");
  const locale = useLocale();
  const [mounted, setMounted] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [copied, setCopied] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Portal target only exists on the client.
  useEffect(() => setMounted(true), []);

  // Fetch a fresh presigned URL on open (re-fetched every open, so an expired link is never reused).
  useEffect(() => {
    let active = true;
    setLoading(true);
    getRecordingUrl(recording.id)
      .then(({ url }) => {
        if (active) setUrl(url);
      })
      .catch(() => {
        if (active) {
          onError(t("recordingUnavailable"));
          onClose();
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [recording.id, onClose, onError, t]);

  // Esc to close, lock background scroll, and focus the close button (keyboard-accessible).
  useEffect(() => {
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  function applySpeed(rate: number) {
    setSpeed(rate);
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }

  const copyLink = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onCopied(t("linkCopied"));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onError(t("recordingUnavailable"));
    }
  }, [url, onCopied, onError, t]);

  function download() {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `recording-${recording.id}.mp4`;
    a.rel = "noopener";
    a.click();
  }

  if (!mounted) return null;

  const dateLabel = new Date(recording.created_at).toLocaleString(locale);
  const dur = formatDuration(recording.duration_s);
  const size = formatBytes(recording.bytes, locale);
  const metaChips = [dur, size].filter(Boolean) as string[];

  return createPortal(
    <div
      className="animate-in fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3 duration-150 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("playerTitle")}
      data-testid="recording-player"
    >
      {/* Self-contained player card */}
      <div
        className="animate-in zoom-in-95 flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-neutral-950 shadow-2xl ring-1 ring-white/10 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-white">
              {roomName || t("playerTitle")}
            </h2>
            <p className="truncate text-xs text-white/50">{dateLabel}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Video — the hero, on black */}
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
          {loading || !url ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3">
              <Loader2 className="size-8 animate-spin text-white/70" />
              <span className="text-xs font-medium text-white/40">{t("playerTitle")}…</span>
            </div>
          ) : (
            <video
              ref={videoRef}
              src={url}
              controls
              autoPlay
              className="max-h-[70dvh] w-full bg-black"
              data-testid="recording-video"
            />
          )}
        </div>

        {/* Controls — attached to the video section */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-white/50">{t("speed")}</span>
              <div className="inline-flex rounded-lg bg-white/10 p-0.5">
                {SPEEDS.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => applySpeed(rate)}
                    aria-pressed={speed === rate}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors",
                      speed === rate ? "bg-white text-black" : "text-white/70 hover:text-white",
                    )}
                  >
                    {rate}×
                  </button>
                ))}
              </div>
            </div>
            {metaChips.length > 0 && (
              <span className="hidden text-xs text-white/40 sm:inline">{metaChips.join(" · ")}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyLink}
              disabled={!url}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/10 disabled:opacity-40"
            >
              {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
              {t("copyLink")}
            </button>
            <button
              type="button"
              onClick={download}
              disabled={!url}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-white/90 disabled:opacity-40"
            >
              <Download className="size-3.5" />
              {t("downloadRecording")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
