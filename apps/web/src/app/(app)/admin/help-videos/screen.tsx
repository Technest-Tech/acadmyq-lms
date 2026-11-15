"use client";

import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Link2,
  ListOrdered,
  Play,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { StatusChip } from "@/components/admin/status-chip";
import { useAuth } from "@/components/auth-provider";
import { useHelpContent, useHelpVideos } from "@/components/help/help-data";
import { StepText } from "@/components/help/help-drawer";
import { HelpVideoCard } from "@/components/help/help-video";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { taskSlot, videoSlots } from "@/content/help/resolve";
import { HELP_TOPICS } from "@/content/help/topics";
import { removeHelpVideo, setHelpVideoLink, uploadHelpVideo, type HelpVideo } from "@/lib/help-api";
import { cn } from "@/lib/utils";

/**
 * Super Admin → help videos: every place in the app's help where a video can play, and whether one
 * has been recorded for it yet.
 *
 * The list is the help itself (src/content/help): each page's tour, then one row per task, in the
 * order people read them. A row with no video shows a "coming soon" card to every client; attaching
 * one — an uploaded recording, or a YouTube / Vimeo link — makes it play for everyone at once, with
 * no deploy. Each row can unfold its written steps, which double as the script for the recording.
 */

type Filter = "all" | "missing" | "ready";

interface Row {
  slot: string;
  title: string;
  /** The steps the video should walk through; none for a page tour. */
  steps: readonly string[];
  tour: boolean;
}

export function HelpVideosScreen() {
  const t = useTranslations("help.admin");
  const { can } = useAuth();
  const content = useHelpContent();
  const { videos, reload } = useHelpVideos();
  const [filter, setFilter] = useState<Filter>("all");
  const [preview, setPreview] = useState<{ title: string; video: HelpVideo } | null>(null);

  const total = useMemo(() => videoSlots(HELP_TOPICS).length, []);
  const ready = useMemo(() => videoSlots(HELP_TOPICS).filter((slot) => videos.has(slot)).length, [videos]);

  if (!can("platform.manage")) {
    return <p className="text-muted-foreground p-6 text-sm">{t("forbidden")}</p>;
  }

  const keep = (slot: string) =>
    filter === "all" || (filter === "ready" ? videos.has(slot) : !videos.has(slot));

  return (
    <div className="space-y-5" data-testid="help-videos-admin">
      <AdminPageHeader title={t("title")} subtitle={t("subtitle")} />

      {/* ── How far the recording has got ─────────────────────────────────── */}
      <section className="admin-surface bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-2xl font-extrabold tabular-nums">
              {ready} <span className="text-muted-foreground text-base font-semibold">/ {total}</span>
            </p>
            <p className="text-muted-foreground mt-0.5 text-sm">{t("recorded")}</p>
          </div>
          <div role="tablist" aria-label={t("filterLabel")} className="bg-muted no-scrollbar flex overflow-x-auto rounded-xl p-1">
            {(["all", "missing", "ready"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors sm:px-4",
                  filter === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`filter.${value}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-muted mt-4 h-2 overflow-hidden rounded-full">
          <div
            className="bg-primary centre-button-primary h-full rounded-full transition-[width] duration-500"
            style={{ width: `${total === 0 ? 0 : Math.round((ready / total) * 100)}%` }}
          />
        </div>
        <p className="text-muted-foreground mt-3 text-xs leading-relaxed">{t("hint")}</p>
      </section>

      {content === null ? (
        <div className="space-y-4" aria-hidden>
          {[0, 1, 2].map((n) => (
            <div key={n} className="bg-muted/60 h-40 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : (
        HELP_TOPICS.map((topic) => {
          const text = content[topic.id];
          if (text === undefined) return null;
          const rows: Row[] = [
            { slot: topic.id, title: t("tour"), steps: [], tour: true },
            ...topic.tasks.flatMap((task) => {
              const taskText = text.tasks[task.id];
              return taskText === undefined
                ? []
                : [{ slot: taskSlot(topic.id, task.id), title: taskText.title, steps: taskText.steps, tour: false }];
            }),
          ].filter((row) => keep(row.slot));
          if (rows.length === 0) return null;

          return (
            <SectionCard key={topic.id} icon={topic.icon} title={text.title} description={text.summary} flush>
              <ul className="divide-border/70 divide-y">
                {rows.map((row) => (
                  <SlotRow
                    key={row.slot}
                    row={row}
                    video={videos.get(row.slot)}
                    onChanged={reload}
                    onPreview={(video) => setPreview({ title: `${text.title} — ${row.title}`, video })}
                  />
                ))}
              </ul>
            </SectionCard>
          );
        })
      )}

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview?.title ?? ""}
        size="lg"
        closeLabel={t("close")}
      >
        {preview !== null && <HelpVideoCard video={preview.video} label={t("play")} />}
      </Modal>
    </div>
  );
}

/** One slot: its state, and the three things that can be done to it. */
function SlotRow({
  row,
  video,
  onChanged,
  onPreview,
}: {
  row: Row;
  video: HelpVideo | undefined;
  onChanged: () => void;
  onPreview: (video: HelpVideo) => void;
}) {
  const t = useTranslations("help.admin");
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [linking, setLinking] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [script, setScript] = useState(false);

  const upload = async (file: File) => {
    if (!file.type.startsWith("video/")) {
      toast.error(t("notVideo"));
      return;
    }
    setProgress(0);
    try {
      await uploadHelpVideo(row.slot, file, setProgress);
      toast.success(t("saved"));
      onChanged();
    } catch {
      toast.error(t("uploadFailed"));
    } finally {
      setProgress(null);
    }
  };

  const saveLink = async () => {
    const url = link.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      toast.error(t("badLink"));
      return;
    }
    setBusy(true);
    try {
      await setHelpVideoLink(row.slot, url);
      toast.success(t("saved"));
      setLinking(false);
      setLink("");
      onChanged();
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await removeHelpVideo(row.slot);
      toast.success(t("removed"));
      onChanged();
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <li data-slot-row={row.slot} className="px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            video ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground",
          )}
        >
          {video ? <CheckCircle2 className="size-4" aria-hidden /> : <CircleDashed className="size-4" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className={cn("text-sm leading-snug", row.tour ? "font-extrabold" : "font-semibold")}>{row.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {video ? (
              <StatusChip tone="good" dot>
                {video.source === "UPLOAD" ? t("state.upload") : t("state.link")}
              </StatusChip>
            ) : (
              <StatusChip tone="neutral">{t("state.missing")}</StatusChip>
            )}
            {video && (
              <span dir="ltr" className="text-muted-foreground max-w-56 truncate text-xs">
                {video.source === "UPLOAD" ? (video.filename ?? "") : video.url}
              </span>
            )}
            {row.steps.length > 0 && (
              <button
                type="button"
                onClick={() => setScript((value) => !value)}
                aria-expanded={script}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-semibold"
              >
                <ListOrdered className="size-3.5" aria-hidden />
                {t("script")}
                <ChevronDown className={cn("size-3 transition-transform", script && "rotate-180")} aria-hidden />
              </button>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="sr-only"
            aria-label={t("upload")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
          {video && (
            <Button variant="outline" size="sm" onClick={() => onPreview(video)}>
              <Play className="rtl:-scale-x-100" aria-hidden />
              {t("preview")}
            </Button>
          )}
          <Button
            variant={video ? "outline" : "default"}
            size="sm"
            disabled={progress !== null || busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload aria-hidden />
            {progress !== null ? t("uploading", { percent: progress }) : video ? t("replace") : t("upload")}
          </Button>
          <Button variant="outline" size="sm" disabled={progress !== null || busy} onClick={() => setLinking((value) => !value)}>
            <Link2 aria-hidden />
            {t("link")}
          </Button>
          {video &&
            (confirming ? (
              <Button variant="destructive" size="sm" disabled={busy} onClick={() => void remove()}>
                {t("confirmRemove")}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("remove")}
                title={t("remove")}
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                <Trash2 aria-hidden />
              </Button>
            ))}
        </div>
      </div>

      {progress !== null && (
        <div className="bg-muted mt-3 h-1.5 overflow-hidden rounded-full" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="bg-primary h-full rounded-full transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      )}

      {linking && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveLink();
          }}
        >
          <input
            type="url"
            dir="ltr"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://youtu.be/…"
            aria-label={t("linkLabel")}
            className="border-input bg-background focus:border-primary focus:ring-primary/20 h-9 min-w-full flex-1 rounded-lg border px-3 text-sm outline-none focus:ring-2 sm:min-w-0"
          />
          <Button type="submit" size="sm" disabled={busy || link.trim() === ""}>
            {t("saveLink")}
          </Button>
          <p className="text-muted-foreground basis-full text-xs">{t("linkHint")}</p>
        </form>
      )}

      {script && (
        <ol className="bg-muted/40 mt-3 space-y-1.5 rounded-xl p-3.5 text-[13px] leading-6">
          {row.steps.map((step, index) => (
            <li key={step} className="flex gap-2.5">
              <span className="text-muted-foreground w-4 shrink-0 font-bold tabular-nums">{index + 1}</span>
              <span>
                <StepText step={step} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
