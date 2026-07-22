"use client";

import { FileText, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { LearnLesson } from "@/lib/learn-api";

/** Renders a lesson's content by type. Content is absent when the viewer isn't entitled to it. */
export function LessonContent({ lesson }: { lesson: LearnLesson }) {
  const t = useTranslations("learn");
  const hasContent =
    lesson.youtube_video_id != null || lesson.body != null || lesson.attachment_path != null;

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
