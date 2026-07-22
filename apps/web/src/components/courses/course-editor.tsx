"use client";

import {
  ArrowLeft,
  ChevronLeft,
  FileText,
  ListChecks,
  Music,
  Pencil,
  Plus,
  Trash2,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CourseStatusBadge } from "@/components/courses/course-status-badge";
import { Field, inputClass, textareaClass } from "@/components/courses/form-bits";
import { LessonModal } from "@/components/courses/lesson-modal";
import { QuizBuilder } from "@/components/courses/quiz-builder";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  addSection,
  deleteCourse,
  deleteLesson,
  deleteSection,
  getCourse,
  setCourseStatus,
  updateCourse,
  updateSection,
  type CourseDetail,
  type CourseStatus,
  type Lesson,
  type LessonType,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const LESSON_ICON: Partial<Record<LessonType, typeof FileText>> = {
  YOUTUBE: Video,
  VIDEO_UPLOAD: Video,
  TEXT: FileText,
  PDF: FileText,
  AUDIO: Music,
  QUIZ: ListChecks,
};

/**
 * The course editor: metadata (title / subtitle / description), lifecycle actions
 * (publish / unpublish / archive), and the curriculum builder — sections of lessons, each added or
 * edited through the lesson modal. Everything mutating is gated by `course.manage`; a reader sees a
 * read-only outline.
 */
export function CourseEditor({ courseId }: { courseId: string }) {
  const t = useTranslations("courses");
  const locale = useLocale();
  const rtl = locale === "ar";
  const router = useRouter();
  const { can } = useAuth();
  const canManage = can("course.manage");

  const [data, setData] = useState<CourseDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<{ variant: "success" | "error"; message: string } | null>(
    null,
  );

  const [details, setDetails] = useState({ title: "", subtitle: "", description: "" });
  const [detailsDirty, setDetailsDirty] = useState(false);
  const [newSection, setNewSection] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [lessonModal, setLessonModal] = useState<{ sectionId: string; lesson?: Lesson } | null>(
    null,
  );
  const [quizBuilder, setQuizBuilder] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; run: () => Promise<void> } | null>(
    null,
  );

  function refresh() {
    setRefreshToken((n) => n + 1);
  }
  function showAlert(variant: "success" | "error", message: string) {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 3500);
  }

  useEffect(() => {
    void getCourse(courseId)
      .then((d) => {
        setData(d);
        setDetails({
          title: d.course.title,
          subtitle: d.course.subtitle ?? "",
          description: d.course.description ?? "",
        });
        setDetailsDirty(false);
      })
      .catch(() => setNotFound(true));
  }, [courseId, refreshToken]);

  async function saveDetails() {
    setBusy(true);
    try {
      await updateCourse(courseId, {
        title: details.title.trim(),
        subtitle: details.subtitle.trim() || null,
        description: details.description.trim() || null,
      });
      setDetailsDirty(false);
      refresh();
      showAlert("success", t("alerts.saved"));
    } catch {
      showAlert("error", t("alerts.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: CourseStatus, successKey: string) {
    setBusy(true);
    try {
      await setCourseStatus(courseId, status);
      refresh();
      showAlert("success", t(successKey));
    } catch (e) {
      showAlert("error", e instanceof Error ? e.message : t("alerts.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function submitAddSection() {
    if (!newSection.trim()) return;
    setBusy(true);
    try {
      await addSection(courseId, newSection.trim());
      setNewSection("");
      refresh();
    } catch {
      showAlert("error", t("alerts.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function submitRename() {
    if (!renaming || !renaming.title.trim()) return;
    setBusy(true);
    try {
      await updateSection(courseId, renaming.id, renaming.title.trim());
      setRenaming(null);
      refresh();
    } catch {
      showAlert("error", t("alerts.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      await confirm.run();
      setConfirm(null);
    } catch {
      showAlert("error", t("alerts.failed"));
    } finally {
      setBusy(false);
    }
  }

  const BackIcon = rtl ? ChevronLeft : ArrowLeft;

  if (notFound) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/courses")}>
          <BackIcon /> {t("back")}
        </Button>
      </div>
    );
  }

  if (!data) {
    return <p className="text-muted-foreground py-16 text-center text-sm">…</p>;
  }

  const { course, sections } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <Link
          href="/courses"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <BackIcon className="size-4" /> {t("back")}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">{course.title}</h1>
            <CourseStatusBadge status={course.status} />
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {course.status !== "PUBLISHED" && (
                <Button onClick={() => changeStatus("PUBLISHED", "alerts.published")} disabled={busy}>
                  {t("editor.publish")}
                </Button>
              )}
              {course.status === "PUBLISHED" && (
                <Button
                  variant="outline"
                  onClick={() => changeStatus("DRAFT", "alerts.unpublished")}
                  disabled={busy}
                >
                  {t("editor.unpublish")}
                </Button>
              )}
              {course.status !== "ARCHIVED" ? (
                <Button
                  variant="outline"
                  onClick={() => changeStatus("ARCHIVED", "alerts.archived")}
                  disabled={busy}
                >
                  {t("editor.archive")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => changeStatus("DRAFT", "alerts.unpublished")}
                  disabled={busy}
                >
                  {t("editor.restore")}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("delete")}
                onClick={() =>
                  setConfirm({
                    message: t("confirm.deleteCourse"),
                    run: async () => {
                      await deleteCourse(courseId);
                      router.push("/courses");
                    },
                  })
                }
              >
                <Trash2 className="text-destructive" />
              </Button>
            </div>
          )}
        </div>
        {course.status === "DRAFT" && sections.every((s) => s.lessons.length === 0) && (
          <p className="text-muted-foreground text-xs">{t("editor.publishHint")}</p>
        )}
      </div>

      {alert && (
        <AlertBanner variant={alert.variant} message={alert.message} onDismiss={() => setAlert(null)} />
      )}

      {/* Details */}
      <section className="space-y-4 rounded-xl border p-4">
        <h2 className="font-medium">{t("editor.details")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("form.title")}>
            <input
              value={details.title}
              disabled={!canManage}
              onChange={(e) => {
                setDetails((d) => ({ ...d, title: e.target.value }));
                setDetailsDirty(true);
              }}
              className={inputClass}
            />
          </Field>
          <Field label={t("form.subtitle")}>
            <input
              value={details.subtitle}
              disabled={!canManage}
              onChange={(e) => {
                setDetails((d) => ({ ...d, subtitle: e.target.value }));
                setDetailsDirty(true);
              }}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label={t("form.description")}>
          <textarea
            value={details.description}
            disabled={!canManage}
            onChange={(e) => {
              setDetails((d) => ({ ...d, description: e.target.value }));
              setDetailsDirty(true);
            }}
            rows={4}
            className={textareaClass}
          />
        </Field>
        {canManage && (
          <div className="flex justify-end">
            <Button onClick={saveDetails} disabled={busy || !detailsDirty || !details.title.trim()}>
              {t("form.save")}
            </Button>
          </div>
        )}
      </section>

      {/* Curriculum */}
      <section className="space-y-4">
        <h2 className="font-medium">{t("editor.curriculum")}</h2>

        {sections.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
            {t("editor.noSections")}
          </p>
        ) : (
          <div className="space-y-3">
            {sections.map((section) => (
              <div key={section.id} className="rounded-xl border">
                <div className="flex items-center gap-2 border-b p-3">
                  <span className="flex-1 font-medium">{section.title}</span>
                  {canManage && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("editor.renameSection")}
                        onClick={() => setRenaming({ id: section.id, title: section.title })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("editor.deleteSection")}
                        onClick={() =>
                          setConfirm({
                            message: t("confirm.deleteSection"),
                            run: async () => {
                              await deleteSection(courseId, section.id);
                              refresh();
                            },
                          })
                        }
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    </>
                  )}
                </div>

                {section.lessons.length === 0 ? (
                  <p className="text-muted-foreground px-3 py-4 text-sm">{t("editor.noLessons")}</p>
                ) : (
                  <ul className="divide-y">
                    {section.lessons.map((lesson) => {
                      const Icon = LESSON_ICON[lesson.type] ?? FileText;
                      return (
                        <li key={lesson.id} className="flex items-center gap-3 px-3 py-2.5">
                          <Icon className="size-4 shrink-0 opacity-60" />
                          <span className="min-w-0 flex-1 truncate text-sm">{lesson.title}</span>
                          {lesson.is_preview && (
                            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                              {t("editor.preview")}
                            </span>
                          )}
                          <span className="text-muted-foreground text-xs">
                            {t(`lesson.types.${lesson.type}`)}
                          </span>
                          {canManage && (
                            <>
                              {lesson.type === "QUIZ" && lesson.quiz_id && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setQuizBuilder(lesson.quiz_id)}
                                >
                                  <ListChecks className="size-4" /> {t("quiz.build")}
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t("lesson.save")}
                                onClick={() => setLessonModal({ sectionId: section.id, lesson })}
                              >
                                <Pencil />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t("editor.deleteLesson")}
                                onClick={() =>
                                  setConfirm({
                                    message: t("confirm.deleteLesson"),
                                    run: async () => {
                                      await deleteLesson(courseId, lesson.id);
                                      refresh();
                                    },
                                  })
                                }
                              >
                                <Trash2 className="text-destructive" />
                              </Button>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {canManage && (
                  <div className="border-t p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLessonModal({ sectionId: section.id })}
                    >
                      <Plus /> {t("editor.addLesson")}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {canManage && (
          <div className="flex gap-2">
            <input
              value={newSection}
              onChange={(e) => setNewSection(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitAddSection();
                }
              }}
              placeholder={t("editor.sectionTitle")}
              className={cn(inputClass, "max-w-xs")}
            />
            <Button variant="outline" onClick={submitAddSection} disabled={busy || !newSection.trim()}>
              <Plus /> {t("editor.addSection")}
            </Button>
          </div>
        )}
      </section>

      {/* Lesson add/edit modal */}
      {lessonModal && (
        <LessonModal
          courseId={courseId}
          sectionId={lessonModal.sectionId}
          lesson={lessonModal.lesson}
          onClose={() => setLessonModal(null)}
          onSaved={() => {
            setLessonModal(null);
            refresh();
            showAlert("success", t("alerts.lessonAdded"));
          }}
        />
      )}

      {/* Quiz builder modal */}
      {quizBuilder && (
        <QuizBuilder
          courseId={courseId}
          quizId={quizBuilder}
          onClose={() => setQuizBuilder(null)}
          onSaved={() => {
            setQuizBuilder(null);
            showAlert("success", t("alerts.saved"));
          }}
        />
      )}

      {/* Rename section modal */}
      <Modal open={renaming !== null} onClose={() => setRenaming(null)} title={t("editor.renameSection")}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submitRename();
          }}
        >
          <input
            autoFocus
            value={renaming?.title ?? ""}
            onChange={(e) => setRenaming((r) => (r ? { ...r, title: e.target.value } : r))}
            className={inputClass}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRenaming(null)} disabled={busy}>
              {t("form.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !renaming?.title.trim()}>
              {t("form.save")}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Generic confirm modal */}
      <Modal open={confirm !== null} onClose={() => setConfirm(null)} title={confirm?.message ?? ""}>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>
            {t("form.cancel")}
          </Button>
          <Button variant="destructive" onClick={runConfirm} disabled={busy}>
            {t("delete")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
