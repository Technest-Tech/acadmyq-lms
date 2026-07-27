"use client";

import { CheckCircle2, Loader2, RotateCcw, UploadCloud, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  confirmMediaUploaded,
  getMediaAsset,
  requestMediaUpload,
  uploadFileToTarget,
  type MediaKind,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type Phase = "idle" | "uploading" | "processing" | "ready" | "error";

/**
 * Direct-to-storage media upload with progress (docs/lms/04). Reserve → PUT the file to the returned
 * target (presigned S3, or a signed proxy on a local disk) → confirm READY. v0 is ready immediately;
 * if a later transcode step returns PROCESSING it polls until READY/FAILED, so the UI already handles it.
 *
 * The idle state doubles as a drop zone — dragging a file onto it is the same path as picking one.
 *
 * An IMAGE upload (a course cover) additionally shows a thumbnail: `existingUrl` for the cover already
 * saved, swapped for a local object URL the moment a new file is picked, so the choice is visible
 * before the upload finishes rather than reading as a filename.
 */
export function MediaUpload({
  kind,
  accept,
  hasExisting = false,
  existingUrl = null,
  onChange,
  onBusyChange,
}: {
  kind: MediaKind;
  accept: string;
  hasExisting?: boolean;
  existingUrl?: string | null;
  onChange: (assetId: string | null) => void;
  /** Fires while a file is uploading/processing, so a parent form can hold its submit button. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const t = useTranslations("courses.media");
  // The copy is per-kind: a cover picker must not tell you to choose a video in MP4 or WebM.
  const isImage = kind === "IMAGE";
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>(hasExisting ? "ready" : "idle");
  const [percent, setPercent] = useState(0);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(existingUrl);

  // Object URLs are only freed by revoking them; hold the latest so replace + unmount both clean up.
  const objectUrlRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (objectUrlRef.current !== null) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  // Follow the saved cover when the parent refetches it — otherwise the thumbnail is frozen at
  // whatever the first render happened to see. A locally picked file always wins: it is already
  // the image being saved, so swapping to the server copy would only flash the old one back.
  useEffect(() => {
    if (objectUrlRef.current === null) setPreview(existingUrl);
  }, [existingUrl]);

  async function pollUntilReady(id: string): Promise<void> {
    // v0 confirm already returns READY; this covers a future async transcode without a UI change.
    for (let i = 0; i < 600; i++) {
      const asset = await getMediaAsset(id);
      if (asset.status === "READY") return;
      if (asset.status === "FAILED") throw new Error(asset.error ?? t("processingFailed"));
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(t("processingFailed"));
  }

  async function handleFile(file: File) {
    setError(null);
    setName(file.name);
    setPhase("uploading");
    setPercent(0);
    onChange(null);
    if (isImage) {
      if (objectUrlRef.current !== null) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = URL.createObjectURL(file);
      setPreview(objectUrlRef.current);
    }
    try {
      const { mediaAssetId, upload } = await requestMediaUpload({
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        kind,
        size_bytes: file.size,
      });
      await uploadFileToTarget(upload, file, setPercent);
      setPhase("processing");
      const res = await confirmMediaUploaded(mediaAssetId);
      if (res.status !== "READY") await pollUntilReady(mediaAssetId);
      setPhase("ready");
      onChange(mediaAssetId);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : t("failed"));
      onChange(null);
    }
  }

  const busy = phase === "uploading" || phase === "processing";
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />

      {/* A cover with a thumbnail: the picture IS the control, so it replaces the drop zone and the
          generic "uploaded" row. Progress still renders below via the shared phase blocks. */}
      {isImage && preview !== null && phase !== "error" && (
        <div className="border-input overflow-hidden rounded-xl border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="aspect-video w-full bg-muted object-cover" />
          <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
            <span className="text-muted-foreground truncate text-xs">{name ?? t("ready")}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {t("replace")}
            </Button>
          </div>
        </div>
      )}

      {phase === "idle" && !(isImage && preview !== null) && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className={cn(
            "flex w-full flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-sm transition-colors",
            dragging
              ? "border-primary bg-primary/5"
              : "border-input hover:border-primary/40 hover:bg-muted/50",
          )}
        >
          <span
            className={cn(
              "flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-md transition-transform",
              dragging && "scale-110",
            )}
          >
            <UploadCloud className="size-5" />
          </span>
          <span className="mt-1 font-medium">{t(isImage ? "chooseImage" : "choose")}</span>
          <span className="text-muted-foreground text-xs">{t(isImage ? "hintImage" : "hint")}</span>
        </button>
      )}

      {phase === "uploading" && (
        <div className="border-input rounded-xl border p-4">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
            <span className="truncate font-medium">{name}</span>
            <span className="text-muted-foreground shrink-0 tabular-nums">{percent}%</span>
          </div>
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-500 transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-muted-foreground mt-2 text-xs">{t("uploading")}</p>
        </div>
      )}

      {phase === "processing" && (
        <div className="border-input text-muted-foreground flex items-center gap-2.5 rounded-xl border p-4 text-sm">
          <Loader2 className="text-primary size-4 animate-spin" />
          <span className="truncate">{t(isImage ? "processingImage" : "processing")}</span>
        </div>
      )}

      {phase === "ready" && !(isImage && preview !== null) && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-300/50 bg-emerald-50 p-4 text-sm dark:border-emerald-800/50 dark:bg-emerald-950/30">
          <span className="flex min-w-0 items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-4 shrink-0" />
            <span className="truncate font-medium">{name ?? t("ready")}</span>
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {t("replace")}
          </Button>
        </div>
      )}

      {phase === "error" && (
        <div className="border-destructive/30 bg-destructive/8 dark:bg-destructive/10 space-y-2.5 rounded-xl border p-4 text-sm">
          <span className="text-destructive flex items-start gap-2">
            <XCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <RotateCcw /> {t("retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
