"use client";

import { CheckCircle2, Loader2, RotateCcw, UploadCloud, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import {
  confirmMediaUploaded,
  getMediaAsset,
  requestMediaUpload,
  uploadFileToTarget,
  type MediaKind,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

type Phase = "idle" | "uploading" | "processing" | "ready" | "error";

/**
 * Direct-to-storage media upload with progress (docs/lms/04). Reserve → PUT the file to the returned
 * target (presigned S3, or a signed proxy on a local disk) → confirm READY. v0 is ready immediately;
 * if a later transcode step returns PROCESSING it polls until READY/FAILED, so the UI already handles it.
 */
export function MediaUpload({
  kind,
  accept,
  hasExisting = false,
  onChange,
}: {
  kind: MediaKind;
  accept: string;
  hasExisting?: boolean;
  onChange: (assetId: string | null) => void;
}) {
  const t = useTranslations("courses.media");
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>(hasExisting ? "ready" : "idle");
  const [percent, setPercent] = useState(0);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      {phase === "idle" && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="border-input hover:bg-muted flex w-full flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-sm transition-colors"
        >
          <UploadCloud className="size-6 opacity-60" />
          <span className="font-medium">{t("choose")}</span>
          <span className="text-muted-foreground text-xs">{t("hint")}</span>
        </button>
      )}

      {phase === "uploading" && (
        <div className="border-input rounded-xl border p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="truncate">{name}</span>
            <span className="text-muted-foreground tabular-nums">{percent}%</span>
          </div>
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-muted-foreground mt-2 text-xs">{t("uploading")}</p>
        </div>
      )}

      {phase === "processing" && (
        <div className="border-input text-muted-foreground flex items-center gap-2 rounded-xl border p-4 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t("processing")}
        </div>
      )}

      {phase === "ready" && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-300/50 bg-emerald-50 p-4 text-sm dark:border-emerald-800/50 dark:bg-emerald-950/30">
          <span className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-4" />
            {name ?? t("ready")}
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
        <div className="space-y-2 rounded-xl border border-red-300/50 bg-red-50 p-4 text-sm dark:border-red-800/50 dark:bg-red-950/30">
          <span className="flex items-center gap-2 text-red-700 dark:text-red-300">
            <XCircle className="size-4" />
            {error}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <RotateCcw className="mr-1.5 size-3.5" />
            {t("retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
