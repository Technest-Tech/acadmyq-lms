"use client";

import {
  ArrowLeft,
  ArrowRight,
  Archive,
  BookOpen,
  Eye,
  Layers,
  ListChecks,
  Pencil,
  PlayCircle,
  Plus,
  Rocket,
  Settings2,
  Trash2,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CourseStatusBadge } from "@/components/courses/course-status-badge";
import {
  CheckOption,
  Field,
  inputClass,
  PriceField,
  selectClass,
  textareaClass,
} from "@/components/courses/form-bits";
import { StringList } from "@/components/courses/site-editor-bits";
import { MediaUpload } from "@/components/courses/media-upload";
import { LessonModal } from "@/components/courses/lesson-modal";
import {
  EmptyState,
  LESSON_STYLE,
  lmsColor,
  Panel,
  PriceTag,
  SectionTitle,
  Sk,
  StatusPill,
} from "@/components/courses/lms-ui";
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
  COURSE_LEVELS,
  type CourseDetail,
  type CourseLevel,
  type CourseStatus,
  type Lesson,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The course editor: the curriculum builder is the main column (sections of lessons, each added or
 * edited through the lesson modal), with the course's metadata and its publishing controls in a
 * sticky sidebar. Everything mutating is gated by `course.manage`; a reader sees a read-only outline.
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

  const [details, setDetails] = useState({
    title: "",
    subtitle: "",
    description: "",
    price_minor: 0,
    // How this course may be unlocked (docs/lms/10 §1) — checkout, access codes, or both.
    checkout_enabled: true,
    code_enabled: true,
    // The sales half of the course (docs/lms/09 §4). All optional: a course with none of it set
    // renders exactly as it does today, minus the blocks nobody wrote.
    level: "" as "" | CourseLevel,
    category: "",
    outcomes: [] as string[],
    requirements: [] as string[],
    audience: [] as string[],
  });
  const [detailsDirty, setDetailsDirty] = useState(false);
  const [newSection, setNewSection] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [lessonModal, setLessonModal] = useState<{ sectionId: string; lesson?: Lesson } | null>(
    null,
  );
  const [quizBuilder, setQuizBuilder] = useState<string | null>(null);
  // A newly uploaded cover, held until the details form is saved (null = leave the current one).
  const [coverAssetId, setCoverAssetId] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
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
          price_minor: d.course.price_minor,
          checkout_enabled: d.course.checkout_enabled ?? true,
          code_enabled: d.course.code_enabled ?? true,
          level: d.course.level ?? "",
          category: d.course.category ?? "",
          outcomes: d.course.outcomes ?? [],
          requirements: d.course.requirements ?? [],
          audience: d.course.audience ?? [],
        });
        setDetailsDirty(false);
        setCoverAssetId(null);
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
        price_minor: details.price_minor,
        checkout_enabled: details.checkout_enabled,
        code_enabled: details.code_enabled,
        level: details.level === "" ? null : details.level,
        category: details.category.trim() || null,
        // Blank rows are dropped server-side too; trimming here keeps the form honest about what
        // it is about to save.
        outcomes: details.outcomes.map((v) => v.trim()).filter(Boolean),
        requirements: details.requirements.map((v) => v.trim()).filter(Boolean),
        audience: details.audience.map((v) => v.trim()).filter(Boolean),
        // Only sent when a new image was uploaded — omitting it leaves the existing cover alone.
        ...(coverAssetId !== null ? { cover_media_asset_id: coverAssetId } : {}),
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

  const BackIcon = rtl ? ArrowRight : ArrowLeft;

  if (notFound) {
    return (
      <div className="bg-card rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
        <EmptyState
          Icon={BookOpen}
          color="slate"
          title={t("notFound")}
          description={t("notFoundHint")}
          action={
            <Button variant="outline" onClick={() => router.push("/lms/courses")}>
              <BackIcon /> {t("back")}
            </Button>
          }
        />
      </div>
    );
  }

  if (!data) return <EditorSkeleton />;

  const { course, sections } = data;
  const lessonCount = sections.reduce((n, s) => n + s.lessons.length, 0);
  const previewCount = sections.reduce(
    (n, s) => n + s.lessons.filter((l) => l.is_preview).length,
    0,
  );
  const canPublish = lessonCount > 0;

  return (
    <div className="space-y-5 pb-4">
      <Link
        href="/lms/courses"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <BackIcon className="size-4" /> {t("back")}
      </Link>

      <CourseBanner
        course={course}
        sectionCount={sections.length}
        lessonCount={lessonCount}
        previewCount={previewCount}
        locale={locale}
      />

      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        {/* ── Curriculum (main column) ── */}
        <div className="space-y-4">
          <SectionTitle
            Icon={Layers}
            color="indigo"
            title={t("editor.curriculum")}
            desc={t("editor.curriculumDesc")}
          />

          {sections.length === 0 ? (
            <div className="bg-card rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
              <EmptyState
                Icon={Layers}
                color="indigo"
                title={t("editor.noSections")}
                description={t("editor.noSectionsHint")}
              />
            </div>
          ) : (
            <div className="space-y-3">
              {sections.map((section, index) => (
                <section
                  key={section.id}
                  className="bg-card overflow-hidden rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]"
                >
                  <header className="bg-muted/30 flex items-center gap-3 border-b px-4 py-3">
                    <span className="bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums">
                      {formatNumber(index + 1, locale)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{section.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {t("lessonCount", { count: section.lessons.length })}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 items-center gap-0.5">
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
                      </div>
                    )}
                  </header>

                  {section.lessons.length === 0 ? (
                    <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                      {t("editor.noLessons")}
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {section.lessons.map((lesson, li) => (
                        <LessonRow
                          key={lesson.id}
                          lesson={lesson}
                          index={li}
                          locale={locale}
                          canManage={canManage}
                          onEdit={() => setLessonModal({ sectionId: section.id, lesson })}
                          onBuildQuiz={
                            lesson.type === "QUIZ" && lesson.quiz_id
                              ? () => setQuizBuilder(lesson.quiz_id)
                              : undefined
                          }
                          onDelete={() =>
                            setConfirm({
                              message: t("confirm.deleteLesson"),
                              run: async () => {
                                await deleteLesson(courseId, lesson.id);
                                refresh();
                              },
                            })
                          }
                        />
                      ))}
                    </ul>
                  )}

                  {canManage && (
                    <div className="border-t p-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => setLessonModal({ sectionId: section.id })}
                      >
                        <Plus /> {t("editor.addLesson")}
                      </Button>
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}

          {canManage && (
            <form
              className="border-input hover:border-primary/40 flex flex-wrap items-center gap-2 rounded-2xl border border-dashed p-3 transition-colors"
              onSubmit={(e) => {
                e.preventDefault();
                void submitAddSection();
              }}
            >
              <input
                value={newSection}
                onChange={(e) => setNewSection(e.target.value)}
                placeholder={t("editor.sectionTitle")}
                className={cn(inputClass, "min-w-0 flex-1 border-transparent bg-transparent")}
              />
              <Button type="submit" variant="outline" disabled={busy || !newSection.trim()}>
                <Plus /> {t("editor.addSection")}
              </Button>
            </form>
          )}
        </div>

        {/* ── Details + publishing (sidebar) ── */}
        <aside className="order-first space-y-4 xl:sticky xl:top-4 xl:order-none">
          {canManage && (
            <Panel Icon={Rocket} color="emerald" title={t("editor.publishing")}>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground text-xs font-medium">
                    {t("editor.currentStatus")}
                  </span>
                  <CourseStatusBadge status={course.status} />
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {t(`editor.statusHint.${course.status}`)}
                </p>

                {course.status === "DRAFT" && !canPublish && (
                  <p className="text-amber-600 dark:text-amber-400 text-xs font-medium">
                    {t("editor.publishHint")}
                  </p>
                )}

                <div className="flex flex-col gap-2 pt-1">
                  {course.status !== "PUBLISHED" && (
                    <Button
                      size="lg"
                      onClick={() => changeStatus("PUBLISHED", "alerts.published")}
                      disabled={busy || !canPublish}
                    >
                      <Rocket /> {t("editor.publish")}
                    </Button>
                  )}
                  {course.status === "PUBLISHED" && (
                    <Button
                      variant="outline"
                      onClick={() => changeStatus("DRAFT", "alerts.unpublished")}
                      disabled={busy}
                    >
                      <Undo2 /> {t("editor.unpublish")}
                    </Button>
                  )}
                  {course.status !== "ARCHIVED" ? (
                    <Button
                      variant="outline"
                      onClick={() => changeStatus("ARCHIVED", "alerts.archived")}
                      disabled={busy}
                    >
                      <Archive /> {t("editor.archive")}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => changeStatus("DRAFT", "alerts.unpublished")}
                      disabled={busy}
                    >
                      <Undo2 /> {t("editor.restore")}
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    onClick={() =>
                      setConfirm({
                        message: t("confirm.deleteCourse"),
                        run: async () => {
                          await deleteCourse(courseId);
                          router.push("/lms/courses");
                        },
                      })
                    }
                    disabled={busy}
                  >
                    <Trash2 /> {t("editor.deleteCourse")}
                  </Button>
                </div>
              </div>
            </Panel>
          )}

          <Panel
            Icon={Settings2}
            color="violet"
            title={t("editor.details")}
            action={
              detailsDirty ? (
                <StatusPill tone="amber">{t("editor.unsaved")}</StatusPill>
              ) : undefined
            }
          >
            <div className="space-y-4">
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
              <Field label={t("form.subtitle")} optional={t("form.optional")}>
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
              <Field label={t("form.description")} optional={t("form.optional")}>
                <textarea
                  value={details.description}
                  disabled={!canManage}
                  onChange={(e) => {
                    setDetails((d) => ({ ...d, description: e.target.value }));
                    setDetailsDirty(true);
                  }}
                  rows={5}
                  className={textareaClass}
                />
              </Field>
              <Field label={t("form.cover")} optional={t("form.optional")} hint={t("form.coverHint")}>
                <MediaUpload
                  kind="IMAGE"
                  accept="image/*"
                  hasExisting={course.cover_image_path !== null}
                  existingUrl={course.cover_image_path}
                  onChange={(id) => {
                    setCoverAssetId(id);
                    if (id !== null) setDetailsDirty(true);
                  }}
                  onBusyChange={setCoverUploading}
                />
              </Field>
              <Field label={t("form.price")}>
                <PriceField
                  key={`price-${refreshToken}`}
                  defaultMinor={course.price_minor}
                  currency={course.currency}
                  disabled={!canManage}
                  onChange={(minor) => {
                    setDetails((d) => ({ ...d, price_minor: minor }));
                    setDetailsDirty(true);
                  }}
                  labels={{
                    free: t("price.free"),
                    paid: t("price.paid"),
                    amount: t("price.amount", { currency: course.currency }),
                    placeholder: t("price.placeholder"),
                    freeHint: t("price.freeHint"),
                  }}
                />
              </Field>
              {/* How this course is unlocked (docs/lms/10 §1). Only meaningful once it has a
                  price — a free course is one click for anyone, with no channel to choose. */}
              {details.price_minor > 0 && (
                <div className="space-y-2">
                  <span className="text-sm font-medium">{t("channels.label")}</span>
                  <CheckOption
                    checked={details.checkout_enabled}
                    disabled={!canManage}
                    onChange={(v) => {
                      setDetails((d) => ({ ...d, checkout_enabled: v }));
                      setDetailsDirty(true);
                    }}
                    label={t("channels.checkout")}
                    hint={
                      course.sells_online === false && details.checkout_enabled
                        ? t("channels.noMethods")
                        : t("channels.checkoutHint")
                    }
                  />
                  <CheckOption
                    checked={details.code_enabled}
                    disabled={!canManage}
                    onChange={(v) => {
                      setDetails((d) => ({ ...d, code_enabled: v }));
                      setDetailsDirty(true);
                    }}
                    label={t("channels.code")}
                    hint={t("channels.codeHint")}
                  />
                  {!details.checkout_enabled && !details.code_enabled && (
                    <p className="text-destructive text-xs">{t("channels.noneWarning")}</p>
                  )}
                </div>
              )}

              {/* ── The sales half (docs/lms/09 §4) ────────────────────────────────
                  Everything here is optional and everything here is REAL: a block the owner
                  leaves empty simply does not appear on the public course page, because the
                  alternative — filler outcomes nobody wrote — is what makes a storefront look
                  like a demo. */}
              <div className="space-y-4 border-t pt-4">
                <div>
                  <p className="text-sm font-semibold">{t("sales.label")}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {t("sales.hint")}
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("sales.level")} optional={t("form.optional")}>
                    <select
                      value={details.level}
                      disabled={!canManage}
                      onChange={(e) => {
                        setDetails((d) => ({
                          ...d,
                          level: e.target.value as "" | CourseLevel,
                        }));
                        setDetailsDirty(true);
                      }}
                      className={selectClass}
                    >
                      <option value="">{t("sales.levelNone")}</option>
                      {COURSE_LEVELS.map((value) => (
                        <option key={value} value={value}>
                          {t(`sales.levels.${value}`)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label={t("sales.category")}
                    optional={t("form.optional")}
                    hint={t("sales.categoryHint")}
                  >
                    <input
                      value={details.category}
                      disabled={!canManage}
                      onChange={(e) => {
                        setDetails((d) => ({ ...d, category: e.target.value }));
                        setDetailsDirty(true);
                      }}
                      className={inputClass}
                    />
                  </Field>
                </div>

                {(
                  [
                    ["outcomes", 12],
                    ["audience", 8],
                    ["requirements", 8],
                  ] as const
                ).map(([key, max]) => (
                  <Field
                    key={key}
                    label={t(`sales.${key}`)}
                    optional={t("form.optional")}
                    hint={t(`sales.${key}Hint`)}
                  >
                    <StringList
                      items={details[key]}
                      onChange={(items) => {
                        setDetails((d) => ({ ...d, [key]: items }));
                        setDetailsDirty(true);
                      }}
                      addLabel={t("sales.add")}
                      placeholder={t(`sales.${key}Placeholder`)}
                      max={max}
                      maxLabel={t("sales.max")}
                    />
                  </Field>
                ))}
              </div>

              {canManage && (
                <Button
                  className="w-full"
                  onClick={saveDetails}
                  disabled={busy || coverUploading || !detailsDirty || !details.title.trim()}
                >
                  {t("form.save")}
                </Button>
              )}
            </div>
          </Panel>
        </aside>
      </div>

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
      <Modal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title={t("editor.renameSection")}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submitRename();
          }}
        >
          <Field label={t("editor.sectionTitle")}>
            <input
              autoFocus
              value={renaming?.title ?? ""}
              onChange={(e) => setRenaming((r) => (r ? { ...r, title: e.target.value } : r))}
              className={inputClass}
            />
          </Field>
          <div className="flex justify-end gap-2 border-t pt-4">
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
      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.message ?? ""}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>
              {t("form.cancel")}
            </Button>
            <Button variant="destructive" onClick={runConfirm} disabled={busy}>
              {t("delete")}
            </Button>
          </>
        }
      >
        <p className="text-muted-foreground text-sm">{t("confirm.irreversible")}</p>
      </Modal>
    </div>
  );
}

/** The editor's masthead — the course identity plus the three numbers that describe its shape. */
function CourseBanner({
  course,
  sectionCount,
  lessonCount,
  previewCount,
  locale,
}: {
  course: CourseDetail["course"];
  sectionCount: number;
  lessonCount: number;
  previewCount: number;
  locale: string;
}) {
  const t = useTranslations("courses");
  const c = lmsColor("violet");

  return (
    <header className="bg-card relative overflow-hidden rounded-2xl p-5 shadow-sm ring-1 ring-foreground/[0.06]">
      <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", c.stripe)} />
      <div
        className={cn("pointer-events-none absolute -top-20 -end-10 size-48 rounded-full blur-3xl", c.glow)}
      />
      <BookOpen
        className="text-foreground/[0.03] dark:text-foreground/[0.05] pointer-events-none absolute -bottom-6 -end-4 size-32"
        strokeWidth={1.25}
        aria-hidden
      />

      <div className="relative flex flex-wrap items-start gap-4">
        <span
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md",
            c.chip,
          )}
        >
          <BookOpen className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">{course.title}</h1>
            <CourseStatusBadge status={course.status} />
            <PriceTag
              priceMinor={course.price_minor}
              currency={course.currency}
              free={course.is_free}
              freeLabel={t("price.free")}
              locale={locale}
            />
          </div>
          {course.subtitle && (
            <p className="text-muted-foreground mt-1 text-sm">{course.subtitle}</p>
          )}
          <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <BannerStat
              Icon={Layers}
              label={t("editor.sectionsLabel")}
              value={formatNumber(sectionCount, locale)}
            />
            <BannerStat
              Icon={PlayCircle}
              label={t("editor.lessonsLabel")}
              value={formatNumber(lessonCount, locale)}
            />
            <BannerStat
              Icon={Eye}
              label={t("editor.previewsLabel")}
              value={formatNumber(previewCount, locale)}
            />
          </dl>
        </div>
      </div>
    </header>
  );
}

function BannerStat({ Icon, label, value }: { Icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="text-muted-foreground size-3.5" />
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** One lesson in the outline — position, kind chip, title, and (for managers) its row actions. */
function LessonRow({
  lesson,
  index,
  locale,
  canManage,
  onEdit,
  onBuildQuiz,
  onDelete,
}: {
  lesson: Lesson;
  index: number;
  locale: string;
  canManage: boolean;
  onEdit: () => void;
  onBuildQuiz?: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("courses");
  const style = LESSON_STYLE[lesson.type] ?? LESSON_STYLE.TEXT;
  const c = lmsColor(style.color);
  const Icon = style.Icon;

  return (
    <li className="hover:bg-muted/30 group flex items-center gap-3 px-4 py-2.5 transition-colors">
      <span className="text-muted-foreground w-4 shrink-0 text-xs tabular-nums">
        {formatNumber(index + 1, locale)}
      </span>
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm",
          c.chip,
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{lesson.title}</p>
        <p className="text-muted-foreground text-xs">{t(`lesson.types.${lesson.type}`)}</p>
      </div>
      {lesson.is_preview && (
        <StatusPill tone="blue" dot={false} className="hidden sm:inline-flex">
          <Eye className="size-3" />
          {t("editor.preview")}
        </StatusPill>
      )}
      {canManage && (
        <div className="flex shrink-0 items-center gap-0.5">
          {onBuildQuiz && (
            <Button variant="ghost" size="sm" onClick={onBuildQuiz}>
              <ListChecks /> <span className="hidden sm:inline">{t("quiz.build")}</span>
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label={t("lesson.save")} onClick={onEdit}>
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("editor.deleteLesson")}
            onClick={onDelete}
          >
            <Trash2 className="text-destructive" />
          </Button>
        </div>
      )}
    </li>
  );
}

function EditorSkeleton() {
  return (
    <div className="space-y-5">
      <Sk className="h-4 w-32" />
      <Sk className="h-32 rounded-2xl" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <Sk className="h-40 rounded-2xl" />
          <Sk className="h-40 rounded-2xl" />
        </div>
        <Sk className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}
