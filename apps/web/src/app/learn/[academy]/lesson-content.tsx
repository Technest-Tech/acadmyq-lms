"use client";

import { FileText, Loader2, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { learnPlayback, type LearnLesson } from "@/lib/learn-api";
import { QuizRunner } from "./quiz-runner";

/** Renders a lesson's content by type. Content is absent when the viewer isn't entitled to it. */
export function LessonContent({
  lesson,
  academy,
  onComplete,
}: {
  lesson: LearnLesson;
  academy: string;
  onComplete?: () => void;
}) {
  const t = useTranslations("learn");

  // A quiz carries its own content (the questions) and completes itself on a pass.
  if (lesson.type === "QUIZ") {
    return <QuizRunner academy={academy} lessonId={lesson.id} onPassed={onComplete} />;
  }

  const uploaded = lesson.has_media === true; // VIDEO_UPLOAD, or an uploaded AUDIO
  const hasContent =
    lesson.youtube_video_id != null ||
    lesson.body != null ||
    lesson.attachment_path != null ||
    uploaded;

  if (!hasContent) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-sm">
        <Lock className="size-5 opacity-50" />
        {t("player.locked")}
      </div>
    );
  }

  if (lesson.type === "YOUTUBE" && lesson.youtube_video_id) {
    return (
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
        <iframe
          className="h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${lesson.youtube_video_id}?rel=0`}
          title={lesson.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  // Uploaded video / audio (docs/lms/04): fetch a short-lived signed url just in time.
  if (lesson.type === "VIDEO_UPLOAD" || (lesson.type === "AUDIO" && uploaded)) {
    if (lesson.media_status && lesson.media_status !== "READY") {
      return (
        <div className="text-muted-foreground flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t("player.processing")}
        </div>
      );
    }
    return <UploadedMedia academy={academy} lesson={lesson} />;
  }

  if (lesson.type === "AUDIO" && lesson.attachment_path) {
    return <audio controls src={lesson.attachment_path} className="w-full" />;
  }

  if (lesson.type === "PDF" && lesson.attachment_path) {
    return (
      <a
        href={lesson.attachment_path}
        target="_blank"
        rel="noreferrer"
        className="border-input hover:bg-muted flex items-center gap-3 rounded-xl border p-4 text-sm"
      >
        <FileText className="size-5 opacity-70" />
        {t("player.openPdf")}
      </a>
    );
  }

  if (lesson.type === "TEXT" && lesson.body != null) {
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed">
        {lesson.body}
      </div>
    );
  }

  return null;
}

/** Resolves the enrollment-gated signed playback URL, then renders a <video>/<audio> element. */
function UploadedMedia({ academy, lesson }: { academy: string; lesson: LearnLesson }) {
  const t = useTranslations("learn");
  const [url, setUrl] = useState<string | null>(null);
  const [kind, setKind] = useState<"VIDEO" | "AUDIO">("VIDEO");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setUrl(null);
    setError(null);
    learnPlayback(academy, lesson.id)
      .then((r) => {
        if (!active) return;
        setUrl(r.url);
        setKind(r.kind);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : t("errors.generic"));
      });
    return () => {
      active = false;
    };
  }, [academy, lesson.id, t]);

  if (error) {
    return (
      <div className="rounded-xl border border-dashed p-4 text-sm text-red-600 dark:text-red-400">
        {error}
      </div>
    );
  }

  if (url === null) {
    return (
      <div className="text-muted-foreground flex aspect-video w-full items-center justify-center rounded-xl border border-dashed text-sm">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (kind === "AUDIO") {
    return <audio controls src={url} className="w-full" />;
  }

  return (
    <video controls playsInline src={url} className="aspect-video w-full rounded-xl bg-black" />
  );
}
