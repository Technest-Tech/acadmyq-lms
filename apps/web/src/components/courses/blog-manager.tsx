"use client";

import {
  ArrowUpRight,
  Clock,
  MoreHorizontal,
  Newspaper,
  Plus,
  Rocket,
  SearchX,
  SquarePen,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CourseStatusBadge } from "@/components/courses/course-status-badge";
import { Field, inputClass } from "@/components/courses/form-bits";
import {
  EmptyState,
  PageHeader,
  SearchField,
  SegmentedFilter,
  Sk,
  type SegmentOption,
} from "@/components/courses/lms-ui";
import { AlertBanner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/ui/modal";
import {
  createBlogPost,
  deleteBlogPost,
  getBlogSummary,
  listBlogPosts,
  setBlogPostStatus,
  type BlogPostRow,
  type BlogPostStatus,
  type BlogSummary,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/time";

type StatusFilter = "all" | BlogPostStatus;

/** The public address of one post, or null while the client has no site handle yet. */
export function postUrl(siteUrl: string | null, slug: string): string | null {
  return siteUrl === null ? null : `${siteUrl.replace(/\/+$/, "")}/blog/${slug}`;
}

/**
 * The Blog page of the LMS workspace (docs/lms/12) — every article, newest edit first.
 *
 * A list rather than a card wall: a blog is read by title and date, and a writer scanning for "the
 * one I was drafting on Tuesday" wants rows. Writing happens on its own page (`/lms/blog/[id]`),
 * because an article needs the whole screen — the opposite of a book, which fits in a dialog.
 */
export function BlogManager() {
  const t = useTranslations("blog");
  const locale = useLocale();
  const router = useRouter();
  const { can } = useAuth();
  const canManage = can("course.manage");

  const [rows, setRows] = useState<BlogPostRow[]>([]);
  const [summary, setSummary] = useState<BlogSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<BlogPostRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<{ variant: "success" | "error"; message: string } | null>(
    null,
  );

  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  const showAlert = useCallback((variant: "success" | "error", message: string) => {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 4000);
  }, []);

  useEffect(() => {
    void getBlogSummary()
      .then(setSummary)
      .catch(() => {});
  }, [refreshToken]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setLoading(true);
      void listBlogPosts({
        pageSize: 100,
        search: search.trim() || undefined,
        filter: filter === "all" ? undefined : { status: filter },
      })
        .then((res) => setRows(res.rows))
        .catch(() => showAlert("error", t("alerts.failed")))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [filter, search, refreshToken, t, showAlert]);

  async function submitCreate(title: string) {
    setBusy(true);
    try {
      const { postId } = await createBlogPost(title.trim());
      // Straight into the editor: a post is nothing until it has a body.
      router.push(`/lms/blog/${postId}`);
    } catch (e) {
      showAlert("error", e instanceof Error ? e.message : t("alerts.failed"));
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteBlogPost(deleting.id);
      setDeleting(null);
      refresh();
      showAlert("success", t("alerts.deleted"));
    } catch {
      showAlert("error", t("alerts.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(post: BlogPostRow, status: BlogPostStatus) {
    try {
      await setBlogPostStatus(post.id, status);
      refresh();
      showAlert("success", t(status === "PUBLISHED" ? "alerts.published" : "alerts.unpublished"));
    } catch (e) {
      showAlert("error", e instanceof Error ? e.message : t("alerts.failed"));
    }
  }

  const segments: SegmentOption<StatusFilter>[] = [
    { value: "all", label: t("filter.all"), count: summary?.total },
    { value: "PUBLISHED", label: t("filter.PUBLISHED"), count: summary?.published },
    { value: "DRAFT", label: t("filter.DRAFT"), count: summary?.draft },
  ];

  const filtered = search.trim() !== "" || filter !== "all";
  const blogUrl =
    summary?.site_url && summary.published > 0
      ? `${summary.site_url.replace(/\/+$/, "")}/blog`
      : null;

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        Icon={Newspaper}
        color="cyan"
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            {blogUrl && (
              <a
                href={blogUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline", size: "lg" })}
              >
                <ArrowUpRight /> {t("viewBlog")}
              </a>
            )}
            {canManage && (
              <Button size="lg" onClick={() => setCreating(true)}>
                <Plus /> {t("new")}
              </Button>
            )}
          </>
        }
      />

      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedFilter options={segments} value={filter} onChange={setFilter} locale={locale} />
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={t("search")}
          className="ms-auto w-full sm:w-64"
        />
      </div>

      {loading && rows.length === 0 ? (
        <div className="bg-card divide-y rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <Sk className="aspect-video w-28 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Sk className="h-4 w-2/3" />
                <Sk className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
          {filtered ? (
            <EmptyState
              Icon={SearchX}
              color="slate"
              title={t("noResults")}
              description={t("noResultsHint")}
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                >
                  {t("clearFilters")}
                </Button>
              }
            />
          ) : (
            <EmptyState
              Icon={Newspaper}
              color="cyan"
              title={t("empty")}
              description={t("emptyHint")}
              action={
                canManage && (
                  <Button size="lg" onClick={() => setCreating(true)}>
                    <Plus /> {t("new")}
                  </Button>
                )
              }
            />
          )}
        </div>
      ) : (
        <ul className="bg-card divide-y overflow-hidden rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
          {rows.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              locale={locale}
              canManage={canManage}
              publicUrl={
                post.status === "PUBLISHED" ? postUrl(summary?.site_url ?? null, post.slug) : null
              }
              onDelete={() => setDeleting(post)}
              onStatus={(status) => void changeStatus(post, status)}
            />
          ))}
        </ul>
      )}

      {creating && (
        <CreatePostModal
          busy={busy}
          onCancel={() => setCreating(false)}
          onSubmit={(title) => void submitCreate(title)}
        />
      )}

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t("confirm.deleteTitle")}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={busy}>
              {t("form.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {t("delete")}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          <span className="text-muted-foreground">{t("confirm.deleteBody")}</span>{" "}
          <span className="font-semibold" dir="auto">
            {deleting?.title}
          </span>
        </p>
      </Modal>
    </div>
  );
}

function PostRow({
  post,
  locale,
  canManage,
  publicUrl,
  onDelete,
  onStatus,
}: {
  post: BlogPostRow;
  locale: string;
  canManage: boolean;
  publicUrl: string | null;
  onDelete: () => void;
  onStatus: (status: BlogPostStatus) => void;
}) {
  const t = useTranslations("blog");
  const href = `/lms/blog/${post.id}`;
  // A published post is dated by when it went live; a draft by when it was last touched.
  const when =
    post.status === "PUBLISHED" && post.published_at
      ? t("row.published", { when: formatRelativeTime(post.published_at, locale) })
      : post.updated_at
        ? t("row.edited", { when: formatRelativeTime(post.updated_at, locale) })
        : null;

  return (
    <li className="group hover:bg-muted/30 flex items-center gap-3 p-3 transition-colors sm:gap-4 sm:p-4">
      <Link
        href={href}
        className="bg-muted relative hidden aspect-video w-28 shrink-0 overflow-hidden rounded-lg sm:block"
        aria-hidden
        tabIndex={-1}
      >
        {post.cover_image_path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.cover_image_path}
            alt=""
            className="absolute inset-0 size-full object-cover"
            loading="lazy"
          />
        ) : (
          <Newspaper
            className="text-muted-foreground/40 absolute inset-0 m-auto size-7"
            aria-hidden
          />
        )}
      </Link>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={href}
            className="hover:text-primary line-clamp-1 text-sm font-semibold transition-colors"
            dir="auto"
          >
            {post.title}
          </Link>
          <CourseStatusBadge status={post.status} />
        </div>
        {post.summary && (
          <p className="text-muted-foreground line-clamp-1 text-xs" dir="auto">
            {post.summary}
          </p>
        )}
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {when && <span>{when}</span>}
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {t("row.minutes", { count: post.reading_minutes })}
          </span>
          {post.author_name && <span dir="auto">{post.author_name}</span>}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Link href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
          <SquarePen /> <span className="hidden sm:inline">{t("row.edit")}</span>
        </Link>
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger>
              <button
                type="button"
                aria-label={t("row.more")}
                className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {post.status === "PUBLISHED" ? (
                <>
                  {publicUrl && (
                    <DropdownMenuItem onClick={() => window.open(publicUrl, "_blank", "noopener")}>
                      <ArrowUpRight /> {t("row.view")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => onStatus("DRAFT")}>
                    <Undo2 /> {t("row.unpublish")}
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onClick={() => onStatus("PUBLISHED")}>
                  <Rocket /> {t("row.publish")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onClick={onDelete}>
                <Trash2 /> {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}

function CreatePostModal({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}) {
  const t = useTranslations("blog");
  const [title, setTitle] = useState("");
  const ready = title.trim() !== "" && !busy;

  return (
    <Modal
      open
      onClose={onCancel}
      title={t("form.newTitle")}
      description={t("form.newHint")}
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t("form.cancel")}
          </Button>
          <Button onClick={() => onSubmit(title)} disabled={!ready}>
            {t("form.create")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onSubmit(title);
        }}
      >
        <Field label={t("form.title")}>
          <input
            className={inputClass}
            value={title}
            dir="auto"
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("form.titlePlaceholder")}
          />
        </Field>
      </form>
    </Modal>
  );
}
