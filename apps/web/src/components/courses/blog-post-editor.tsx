"use client";

import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock,
  Loader2,
  Newspaper,
  Rocket,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { postUrl } from "@/components/courses/blog-manager";
import { CourseStatusBadge } from "@/components/courses/course-status-badge";
import { Field, inputClass, textareaClass } from "@/components/courses/form-bits";
import { EmptyState, Panel, Sk } from "@/components/courses/lms-ui";
import { MediaUpload } from "@/components/courses/media-upload";
import { RichTextEditor } from "@/components/courses/rich-text-editor";
import { AlertBanner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  deleteBlogPost,
  getBlogPost,
  setBlogPostStatus,
  updateBlogPost,
  type BlogPostDetail,
  type BlogPostInput,
  type BlogPostStatus,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/time";

interface Draft {
  title: string;
  excerpt: string;
  author_name: string;
  slug: string;
  content_html: string;
  /** A freshly uploaded cover, not yet saved. `undefined` = untouched. */
  cover_media_asset_id?: string | null;
}

function draftOf(post: BlogPostDetail): Draft {
  return {
    title: post.title,
    excerpt: post.excerpt ?? "",
    author_name: post.author_name ?? "",
    slug: post.slug,
    content_html: post.content_html,
  };
}

/**
 * Writing one blog post (docs/lms/12). The body takes the main column; everything about the post
 * that is not the post — cover, summary, byline, address — sits in a side panel.
 *
 * One Save for all of it, with a visible "unsaved changes" state, Ctrl/⌘+S, and a leave-page
 * warning: an article is long work, and the one unforgivable bug here is losing it. Publishing
 * saves first, so "Publish" never ships an older version than the one on screen.
 */
export function BlogPostEditor({ postId }: { postId: string }) {
  const t = useTranslations("blog");
  const locale = useLocale();
  const router = useRouter();
  const { can } = useAuth();
  const canManage = can("course.manage");
  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;

  const [post, setPost] = useState<BlogPostDetail | null>(null);
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [alert, setAlert] = useState<{ variant: "success" | "error"; message: string } | null>(
    null,
  );

  const showAlert = useCallback((variant: "success" | "error", message: string) => {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 3000);
  }, []);

  useEffect(() => {
    let alive = true;
    void getBlogPost(postId)
      .then((res) => {
        if (!alive) return;
        setPost(res.post);
        setSiteUrl(res.site_url);
        setDraft(draftOf(res.post));
      })
      .catch(() => alive && setNotFound(true));
    return () => {
      alive = false;
    };
  }, [postId]);

  function patch(next: Partial<Draft>) {
    setDraft((d) => (d === null ? d : { ...d, ...next }));
    setDirty(true);
  }

  // Latest draft for the keyboard shortcut and the publish path, without re-binding listeners.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });

  const save = useCallback(async (): Promise<boolean> => {
    const d = draftRef.current;
    if (d === null || post === null) return false;
    setSaving(true);
    try {
      const input: BlogPostInput = {
        title: d.title.trim(),
        excerpt: d.excerpt.trim() || null,
        author_name: d.author_name.trim() || null,
        content_html: d.content_html,
        ...(d.slug !== post.slug ? { slug: d.slug } : {}),
        // Only a cover that actually landed — the uploader reports null mid-pick and on failure,
        // and a present-but-null key means "remove the cover" to the API.
        ...(typeof d.cover_media_asset_id === "string"
          ? { cover_media_asset_id: d.cover_media_asset_id }
          : {}),
      };
      const res = await updateBlogPost(post.id, input);
      setPost((p) => (p === null ? p : { ...p, ...res.post, excerpt: input.excerpt ?? null }));
      // The server may have adjusted the slug (taken → suffixed); show what it actually saved.
      setDraft((cur) =>
        cur === null ? cur : { ...cur, slug: res.post.slug, cover_media_asset_id: undefined },
      );
      setDirty(false);
      return true;
    } catch (e) {
      showAlert("error", e instanceof Error ? e.message : t("alerts.failed"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [post, showAlert, t]);

  // Ctrl/⌘+S saves; the browser's "Save page" dialog is never what a writer meant.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (canManage) void save().then((ok) => ok && showAlert("success", t("alerts.saved")));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canManage, save, showAlert, t]);

  // Unsaved work survives an accidental tab close.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function changeStatus(status: BlogPostStatus) {
    if (post === null) return;
    if (dirty && !(await save())) return;
    setSaving(true);
    try {
      const res = await setBlogPostStatus(post.id, status);
      setPost((p) => (p === null ? p : { ...p, ...res.post }));
      showAlert("success", t(status === "PUBLISHED" ? "alerts.published" : "alerts.unpublished"));
    } catch (e) {
      showAlert("error", e instanceof Error ? e.message : t("alerts.failed"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (post === null) return;
    setSaving(true);
    try {
      await deleteBlogPost(post.id);
      setDirty(false);
      router.push("/lms/blog");
    } catch {
      showAlert("error", t("alerts.failed"));
      setSaving(false);
    }
  }

  if (notFound) {
    return (
      <div className="bg-card rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
        <EmptyState
          Icon={Newspaper}
          color="slate"
          title={t("editor.notFound")}
          action={
            <Button variant="outline" onClick={() => router.push("/lms/blog")}>
              <BackIcon /> {t("editor.back")}
            </Button>
          }
        />
      </div>
    );
  }

  if (post === null || draft === null) {
    return (
      <div className="space-y-4">
        <Sk className="h-5 w-32" />
        <Sk className="h-14 w-full rounded-2xl" />
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Sk className="h-[28rem] rounded-2xl" />
          <Sk className="h-72 rounded-2xl" />
        </div>
      </div>
    );
  }

  const published = post.status === "PUBLISHED";
  const liveUrl = published ? postUrl(siteUrl, post.slug) : null;
  const busy = saving || coverBusy;

  return (
    <div className="space-y-4 pb-4">
      <Link
        href="/lms/blog"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <BackIcon className="size-4" /> {t("editor.back")}
      </Link>

      {/* ── the action bar: where the post stands and what to do next ─────────── */}
      <div className="bg-card sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5 shadow-sm ring-1 ring-foreground/[0.06] sm:px-4">
        <CourseStatusBadge status={post.status} />
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          {saving ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t("editor.saving")}
            </>
          ) : dirty ? (
            <span className="text-amber-600 dark:text-amber-400">{t("editor.unsaved")}</span>
          ) : (
            <>
              <Check className="size-3.5" aria-hidden />
              {post.updated_at
                ? t("editor.savedAt", { when: formatRelativeTime(post.updated_at, locale) })
                : t("editor.saved")}
            </>
          )}
        </span>

        <div className="ms-auto flex flex-wrap items-center gap-2">
          {liveUrl && (
            <a
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              <ArrowUpRight /> {t("editor.viewLive")}
            </a>
          )}
          {canManage && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={!dirty || busy || draft.title.trim() === ""}
                onClick={() =>
                  void save().then((ok) => ok && showAlert("success", t("alerts.saved")))
                }
              >
                <Save /> {t("editor.save")}
              </Button>
              {published ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void changeStatus("DRAFT")}
                >
                  <Undo2 /> {t("row.unpublish")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={busy || draft.title.trim() === ""}
                  onClick={() => void changeStatus("PUBLISHED")}
                >
                  <Rocket /> {t("row.publish")}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
        {/* ── the article ─────────────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-4">
          <input
            className="bg-card placeholder:text-muted-foreground/60 w-full rounded-2xl px-4 py-4 text-2xl font-bold tracking-tight shadow-sm ring-1 ring-foreground/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:px-6 sm:text-3xl"
            value={draft.title}
            dir="auto"
            aria-label={t("form.title")}
            placeholder={t("form.titlePlaceholder")}
            disabled={!canManage}
            onChange={(e) => patch({ title: e.target.value })}
          />
          <RichTextEditor
            key={post.id}
            initialHtml={post.content_html}
            disabled={!canManage}
            placeholder={t("editor.bodyPlaceholder")}
            onChange={(html) => patch({ content_html: html })}
          />
        </div>

        {/* ── everything about the post that is not the post ─────────────────── */}
        <div className="space-y-4 xl:sticky xl:top-20">
          <Panel title={t("editor.details")}>
            <div className="space-y-4 p-4 sm:p-5">
              <Field
                label={t("form.cover")}
                optional={t("form.optional")}
                hint={t("form.coverHint")}
              >
                <MediaUpload
                  kind="IMAGE"
                  accept="image/*"
                  hasExisting={post.cover_image_path !== null}
                  existingUrl={post.cover_image_path}
                  onBusyChange={setCoverBusy}
                  onChange={(assetId) => patch({ cover_media_asset_id: assetId })}
                />
              </Field>

              <Field
                label={t("form.excerpt")}
                optional={t("form.optional")}
                hint={t("form.excerptHint")}
              >
                <textarea
                  className={textareaClass}
                  rows={3}
                  maxLength={500}
                  value={draft.excerpt}
                  dir="auto"
                  disabled={!canManage}
                  onChange={(e) => patch({ excerpt: e.target.value })}
                />
              </Field>

              <Field label={t("form.author")} optional={t("form.optional")}>
                <input
                  className={inputClass}
                  value={draft.author_name}
                  maxLength={120}
                  dir="auto"
                  disabled={!canManage}
                  onChange={(e) => patch({ author_name: e.target.value })}
                />
              </Field>

              <Field label={t("form.slug")} hint={t("form.slugHint")}>
                <input
                  className={inputClass}
                  value={draft.slug}
                  dir="ltr"
                  disabled={!canManage}
                  onChange={(e) =>
                    patch({
                      // The address is ASCII-dash by contract (the API's regex); fold as you type
                      // so Save never fails on a space.
                      slug: e.target.value
                        .toLowerCase()
                        .replace(/\s+/g, "-")
                        .replace(/[^a-z0-9-]/g, ""),
                    })
                  }
                />
              </Field>

              <p className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                <Clock className="size-3.5" aria-hidden />
                {t("row.minutes", { count: post.reading_minutes })}
              </p>
            </div>
          </Panel>

          {canManage && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive w-full"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 /> {t("editor.delete")}
            </Button>
          )}
        </div>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t("confirm.deleteTitle")}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={saving}>
              {t("form.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={saving}>
              {t("delete")}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          <span className="text-muted-foreground">{t("confirm.deleteBody")}</span>{" "}
          <span className="font-semibold" dir="auto">
            {post.title}
          </span>
        </p>
      </Modal>
    </div>
  );
}
