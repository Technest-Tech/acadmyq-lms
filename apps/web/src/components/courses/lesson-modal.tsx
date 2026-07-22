"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field, inputClass, textareaClass } from "@/components/courses/form-bits";
import { MediaUpload } from "@/components/courses/media-upload";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  addLesson,
  AUTHORABLE_LESSON_TYPES,
  updateLesson,
  type Lesson,
  type LessonInput,
  type LessonType,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Add or edit a lesson. The `type` picker offers only the phase-1 authorable kinds (YouTube / text /
 * PDF / audio); uploaded video + quizzes are noted as coming later. The type selects which single
 * payload field shows.
 */
export function LessonModal({
  courseId,
  sectionId,
  lesson,
  onClose,
  onSaved,
}: {
  courseId: string;
  sectionId: string;
  lesson?: Lesson;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("courses");
  const editing = lesson !== undefined;

  const [title, setTitle] = useState(lesson?.title ?? "");
  const [type, setType] = useState<LessonType>(
    lesson && AUTHORABLE_LESSON_TYPES.includes(lesson.type) ? lesson.type : "YOUTUBE",
  );
  const [isPreview, setIsPreview] = useState(lesson?.is_preview ?? false);
  const [youtubeUrl, setYoutubeUrl] = useState(
    lesson?.youtube_video_id
      ? `https://www.youtube.com/watch?v=${lesson.youtube_video_id}`
      : "",
  );
  const [body, setBody] = useState(lesson?.body ?? "");
  const [url, setUrl] = useState(lesson?.attachment_path ?? "");
  const [mediaAssetId, setMediaAssetId] = useState<string | null>(
    lesson?.type === "VIDEO_UPLOAD" ? (lesson.media_asset_id ?? null) : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function payload(): LessonInput {
    const base: LessonInput = { section_id: sectionId, type, title: title.trim() };
    if (type === "YOUTUBE") base.youtube_url = youtubeUrl.trim();
    if (type === "TEXT") base.body = body;
    if (type === "PDF" || type === "AUDIO") base.url = url.trim();
    if (type === "VIDEO_UPLOAD" && mediaAssetId) base.media_asset_id = mediaAssetId;
    base.is_preview = isPreview;
    return base;
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (editing && lesson) {
        await updateLesson(courseId, lesson.id, payload());
      } else {
        await addLesson(courseId, payload());
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("alerts.failed"));
    } finally {
      setBusy(false);
    }
  }

  const valid =
    title.trim() !== "" &&
    ((type === "YOUTUBE" && youtubeUrl.trim() !== "") ||
      (type === "TEXT" && body.trim() !== "") ||
      ((type === "PDF" || type === "AUDIO") && url.trim() !== "") ||
      (type === "VIDEO_UPLOAD" && mediaAssetId != null));

  return (
    <Modal open onClose={onClose} title={editing ? t("editor.addLesson") : t("lesson.add")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void submit();
        }}
      >
        {error && <AlertBanner variant="error" message={error} />}

        <Field label={t("lesson.title")}>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
            required
          />
        </Field>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">{t("lesson.type")}</span>
          <div className="flex flex-wrap gap-1.5">
            {AUTHORABLE_LESSON_TYPES.map((ty) => (
              <button
                key={ty}
                type="button"
                onClick={() => setType(ty)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  type === ty
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input hover:bg-muted",
                )}
              >
                {t(`lesson.types.${ty}`)}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">{t("lesson.typeHint")}</p>
        </div>

        {type === "YOUTUBE" && (
          <Field label={t("lesson.youtubeUrl")}>
            <input
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder={t("lesson.youtubePlaceholder")}
              className={inputClass}
            />
          </Field>
        )}
        {type === "TEXT" && (
          <Field label={t("lesson.body")}>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("lesson.bodyPlaceholder")}
              rows={6}
              className={textareaClass}
            />
          </Field>
        )}
        {(type === "PDF" || type === "AUDIO") && (
          <Field label={t("lesson.url")}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("lesson.urlPlaceholder")}
              className={inputClass}
            />
          </Field>
        )}
        {type === "VIDEO_UPLOAD" && (
          <Field label={t("lesson.video")}>
            <MediaUpload
              kind="VIDEO"
              accept="video/*"
              hasExisting={lesson?.type === "VIDEO_UPLOAD" && lesson.media_asset_id != null}
              onChange={setMediaAssetId}
            />
          </Field>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isPreview}
            onChange={(e) => setIsPreview(e.target.checked)}
            className="size-4 rounded border-input"
          />
          {t("lesson.isPreview")}
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("form.cancel")}
          </Button>
          <Button type="submit" disabled={busy || !valid}>
            {editing ? t("lesson.save") : t("lesson.add")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
