"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { CheckOption, Field, inputClass, textareaClass } from "@/components/courses/form-bits";
import { LESSON_STYLE, lmsColor } from "@/components/courses/lms-ui";
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
 * Add or edit a lesson. The `type` picker offers the authorable kinds (YouTube / uploaded video /
 * text / PDF / audio / quiz) as icon tiles, and the chosen kind decides which single payload field
 * shows — so the form never asks for more than the one thing that lesson needs. QUIZ shows no
 * payload field at all: saving mints an empty quiz, built from the editor's "Build quiz" action.
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
    lesson?.youtube_video_id ? `https://www.youtube.com/watch?v=${lesson.youtube_video_id}` : "",
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
    // QUIZ needs nothing but a title — its questions are authored in the builder afterwards.
    (type === "QUIZ" ||
      (type === "YOUTUBE" && youtubeUrl.trim() !== "") ||
      (type === "TEXT" && body.trim() !== "") ||
      ((type === "PDF" || type === "AUDIO") && url.trim() !== "") ||
      (type === "VIDEO_UPLOAD" && mediaAssetId != null));

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? t("lesson.editTitle") : t("lesson.add")}
      description={t("lesson.hint")}
      size="lg"
    >
      <form
        className="space-y-5"
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
            placeholder={t("lesson.titlePlaceholder")}
            className={inputClass}
            required
          />
        </Field>

        <div className="space-y-2">
          <span className="text-sm font-medium">{t("lesson.type")}</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {AUTHORABLE_LESSON_TYPES.map((ty) => (
              <TypeTile
                key={ty}
                type={ty}
                active={type === ty}
                label={t(`lesson.types.${ty}`)}
                onSelect={() => setType(ty)}
              />
            ))}
          </div>
          <p className="text-muted-foreground text-xs">{t("lesson.typeHint")}</p>
        </div>

        {type === "YOUTUBE" && (
          <Field label={t("lesson.youtubeUrl")} hint={t("lesson.youtubeHint")}>
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
              rows={8}
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

        <CheckOption
          checked={isPreview}
          onChange={setIsPreview}
          label={t("lesson.isPreview")}
          hint={t("lesson.isPreviewHint")}
        />

        <div className="flex justify-end gap-2 border-t pt-4">
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

/** One kind of lesson, as a selectable tile — icon, label, and a clear selected state. */
function TypeTile({
  type,
  active,
  label,
  onSelect,
}: {
  type: LessonType;
  active: boolean;
  label: string;
  onSelect: () => void;
}) {
  const style = LESSON_STYLE[type];
  const c = lmsColor(style.color);
  const Icon = style.Icon;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-2.5 rounded-xl border p-2.5 text-start transition-all",
        active
          ? "border-primary/50 bg-primary/5 ring-primary/20 shadow-sm ring-1"
          : "border-input hover:bg-muted/60",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm transition-opacity",
          c.chip,
          !active && "opacity-70",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 truncate text-sm font-medium">{label}</span>
    </button>
  );
}
