"use client";

import {
  Archive,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  LayoutGrid,
  List,
  MoreHorizontal,
  PlayCircle,
  Plus,
  Rocket,
  SearchX,
  SquarePen,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CourseStatusBadge } from "@/components/courses/course-status-badge";
import { Field, inputClass, PriceField, textareaClass } from "@/components/courses/form-bits";
import { MediaUpload } from "@/components/courses/media-upload";
import {
  EmptyState,
  lmsColor,
  PageHeader,
  PriceTag,
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
  COURSE_STATUSES,
  createCourse,
  deleteCourse,
  getCourseSummary,
  listCourses,
  setCourseStatus,
  type CourseRow,
  type CourseStatus,
  type CourseSummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | CourseStatus;
type ViewMode = "grid" | "list";

/** Cover tints, picked deterministically per course so the catalogue stays visually scannable. */
const COVER_COLORS = ["violet", "indigo", "blue", "cyan", "teal", "emerald", "amber", "rose"];

function coverColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return lmsColor(COVER_COLORS[hash % COVER_COLORS.length]);
}

/**
 * The Courses cockpit: headline counts folded into the status filter, a search box, and the course
 * catalogue as cards (or a dense list). Creating a course opens a small modal (title + optional
 * subtitle/description) and drops you into the editor. `course.manage` gates create/delete; readers
 * see the catalogue only.
 */
export function CoursesManager() {
  const t = useTranslations("courses");
  const locale = useLocale();
  const { can } = useAuth();
  const canManage = can("course.manage");

  const [rows, setRows] = useState<CourseRow[]>([]);
  const [summary, setSummary] = useState<CourseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const [refreshToken, setRefreshToken] = useState(0);

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CourseRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<{ variant: "success" | "error"; message: string } | null>(
    null,
  );

  function refresh() {
    setRefreshToken((n) => n + 1);
  }

  function showAlert(variant: "success" | "error", message: string) {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 4000);
  }

  // Summary (unfiltered counts) — independent of the list filter.
  useEffect(() => {
    void getCourseSummary()
      .then(setSummary)
      .catch(() => {});
  }, [refreshToken]);

  // The list — refetched (server-side filtered) when filter/search change; search is debounced.
  useEffect(() => {
    const handle = setTimeout(() => {
      setLoading(true);
      void listCourses({
        pageSize: 100,
        search: search.trim() || undefined,
        filter: filter === "all" ? undefined : { status: filter },
      })
        .then((res) => setRows(res.rows))
        .catch(() => showAlert("error", t("alerts.failed")))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [filter, search, refreshToken, t]);

  async function submitCreate(input: {
    title: string;
    subtitle: string;
    description: string;
    price_minor: number;
    cover_media_asset_id: string | null;
  }) {
    setBusy(true);
    try {
      await createCourse({
        title: input.title.trim(),
        subtitle: input.subtitle.trim() || null,
        description: input.description.trim() || null,
        price_minor: input.price_minor,
        cover_media_asset_id: input.cover_media_asset_id,
      });
      setCreating(false);
      refresh();
      showAlert("success", t("alerts.created"));
    } catch {
      showAlert("error", t("alerts.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteCourse(deleting.id);
      setDeleting(null);
      refresh();
      showAlert("success", t("alerts.deleted"));
    } catch {
      showAlert("error", t("alerts.failed"));
    } finally {
      setBusy(false);
    }
  }

  // Lifecycle actions straight from a card's ⋯ menu — publish, unpublish, archive, restore —
  // without a round-trip through the editor. The API rejects publishing a course with no lessons,
  // so the menu disables Publish for empty courses and this surfaces any other failure as an alert.
  async function changeStatus(course: CourseRow, status: CourseStatus, successKey: string) {
    try {
      await setCourseStatus(course.id, status);
      refresh();
      showAlert("success", t(successKey));
    } catch (e) {
      showAlert("error", e instanceof Error ? e.message : t("alerts.failed"));
    }
  }

  const segments: SegmentOption<StatusFilter>[] = [
    { value: "all", label: t("filter.all"), count: summary?.total },
    ...COURSE_STATUSES.map((s) => ({
      value: s as StatusFilter,
      label: t(`filter.${s}`),
      count: summary?.[s.toLowerCase() as "draft" | "published" | "archived"],
    })),
  ];

  const filtered = search.trim() !== "" || filter !== "all";

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        Icon={BookOpen}
        color="violet"
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          canManage && (
            <Button size="lg" onClick={() => setCreating(true)}>
              <Plus /> {t("new")}
            </Button>
          )
        }
      />

      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      {/* Toolbar: status segments + search + view switch */}
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedFilter
          options={segments}
          value={filter}
          onChange={setFilter}
          locale={locale}
        />
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={t("search")}
          className="ms-auto w-full sm:w-64"
        />
        <div className="bg-muted/60 hidden items-center gap-0.5 rounded-xl p-1 sm:flex">
          <ViewButton
            active={view === "grid"}
            onClick={() => setView("grid")}
            label={t("view.grid")}
            Icon={LayoutGrid}
          />
          <ViewButton
            active={view === "list"}
            onClick={() => setView("list")}
            label={t("view.list")}
            Icon={List}
          />
        </div>
      </div>

      {/* Catalogue */}
      {loading && rows.length === 0 ? (
        view === "grid" ? (
          <GridSkeleton />
        ) : (
          <ListSkeleton />
        )
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
              Icon={BookOpen}
              color="violet"
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
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((c) => (
            <CourseCard
              key={c.id}
              course={c}
              canManage={canManage}
              onDelete={() => setDeleting(c)}
              onStatus={(status, key) => void changeStatus(c, status, key)}
            />
          ))}
        </div>
      ) : (
        <ul className="bg-card divide-y overflow-hidden rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
          {rows.map((c) => (
            <CourseRowItem
              key={c.id}
              course={c}
              canManage={canManage}
              onDelete={() => setDeleting(c)}
              onStatus={(status, key) => void changeStatus(c, status, key)}
            />
          ))}
        </ul>
      )}

      {creating && (
        <CreateCourseModal
          busy={busy}
          currency={summary?.currency ?? "USD"}
          onCancel={() => setCreating(false)}
          onSubmit={submitCreate}
        />
      )}

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t("confirm.deleteCourse")}
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
          <span className="text-muted-foreground">{t("confirm.deleteCourseBody")}</span>{" "}
          <span className="font-semibold">{deleting?.title}</span>
        </p>
      </Modal>
    </div>
  );
}

/** Two-letter monogram from the course title — the frosted brand tile on the card cover. */
function monogram(title: string): string {
  return (
    title
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/**
 * A catalogue card built for scanning and acting: a branded gradient cover (monogram tile + pinned
 * status), the title/subtitle on a fixed-height block so every card in a row lines up, a metadata
 * strip (lessons · created), and a footer that pairs the primary "open" action with a ⋯ menu of
 * lifecycle controls. Managing a course's status no longer requires opening the editor.
 */
function CourseCard({
  course,
  canManage,
  onDelete,
  onStatus,
}: {
  course: CourseRow;
  canManage: boolean;
  onDelete: () => void;
  onStatus: (status: CourseStatus, successKey: string) => void;
}) {
  const t = useTranslations("courses");
  const locale = useLocale();
  const c = coverColor(course.id);
  const href = `/lms/courses/${course.id}`;
  const dated = course.published_at ?? course.created_at;

  return (
    <article className="group bg-card relative flex flex-col overflow-hidden rounded-2xl shadow-sm ring-1 ring-foreground/[0.06] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      {/* Cover — the uploaded image when there is one, else the gradient brand band + monogram. */}
      <div className={cn("relative aspect-[64/27] shrink-0 bg-gradient-to-br", c.chip)}>
        {course.cover_image_path !== null ? (
          <>
            {/* Absolutely positioned, like the fallback art below: in flow, the picture's intrinsic
                height becomes this flex item's min-height and overrides the aspect ratio, so a tall
                screenshot stretches the whole card. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={course.cover_image_path}
              alt=""
              className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            {/* The status pill sits on an unknown picture — darken behind it so it stays legible. */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/45 to-transparent" />
          </>
        ) : (
          <>
            <svg className="absolute inset-0 size-full opacity-20" aria-hidden>
              <defs>
                <pattern
                  id={`cover-${course.id}`}
                  width="18"
                  height="18"
                  patternUnits="userSpaceOnUse"
                >
                  <circle cx="1.5" cy="1.5" r="1.5" fill="white" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill={`url(#cover-${course.id})`} />
            </svg>
            <BookOpen
              className="absolute -bottom-3 -end-2 size-20 text-white/15 transition-transform duration-300 group-hover:scale-110"
              strokeWidth={1.25}
              aria-hidden
            />
          </>
        )}
        <Link href={href} className="absolute inset-0" aria-label={course.title} />
        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          {course.cover_image_path === null && (
            <span className="flex size-11 items-center justify-center rounded-xl bg-white/20 text-base font-bold text-white ring-1 ring-white/30 backdrop-blur-sm">
              {monogram(course.title)}
            </span>
          )}
          <span className="ms-auto rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-sm backdrop-blur-sm dark:bg-slate-900/80 dark:text-slate-200">
            {t(`status.${course.status}`)}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col p-4">
        <div className="min-h-[2.75rem]">
          <Link href={href} className="line-clamp-1 text-sm font-semibold hover:underline">
            {course.title}
          </Link>
          <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs leading-relaxed">
            {course.subtitle || t("noSubtitle")}
          </p>
        </div>

        {/* Metadata strip: price + at-a-glance counts */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <PriceTag
            priceMinor={course.price_minor}
            currency={course.currency}
            free={course.is_free}
            freeLabel={t("price.free")}
            locale={locale}
          />
          <dl className="text-muted-foreground flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <PlayCircle className="size-3.5" />
              <dd className="tabular-nums">{t("lessonCount", { count: course.lesson_count })}</dd>
            </div>
            <span className="bg-border h-3 w-px" aria-hidden />
            <div className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" />
              <dd className="tabular-nums">
                {new Date(dated).toLocaleDateString(locale, { day: "numeric", month: "short" })}
              </dd>
            </div>
          </dl>
        </div>

        {/* Footer actions */}
        <div className="mt-3.5 flex items-center gap-2 border-t pt-3">
          <Link
            href={href}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}
          >
            <SquarePen /> {t("openEditor")}
          </Link>
          {canManage && (
            <CourseActionsMenu course={course} onDelete={onDelete} onStatus={onStatus} />
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * The per-course ⋯ menu. Offers exactly the lifecycle transitions valid from the current status
 * (publish is disabled until the course has a lesson, mirroring the API), then the destructive
 * delete. Shared by the card and the list row so both action surfaces stay identical.
 */
function CourseActionsMenu({
  course,
  onDelete,
  onStatus,
  align = "end",
}: {
  course: CourseRow;
  onDelete: () => void;
  onStatus: (status: CourseStatus, successKey: string) => void;
  align?: "start" | "center" | "end";
}) {
  const t = useTranslations("courses");
  const canPublish = course.lesson_count > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <button
          type="button"
          aria-label={t("cardMenu")}
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuItem render={<Link href={`/lms/courses/${course.id}`} />}>
          <ArrowUpRight aria-hidden />
          {t("openEditor")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {course.status !== "PUBLISHED" && (
          <DropdownMenuItem
            disabled={!canPublish}
            onClick={() => onStatus("PUBLISHED", "alerts.published")}
          >
            <Rocket aria-hidden />
            {canPublish ? t("editor.publish") : t("editor.publishBlocked")}
          </DropdownMenuItem>
        )}
        {course.status === "PUBLISHED" && (
          <DropdownMenuItem onClick={() => onStatus("DRAFT", "alerts.unpublished")}>
            <Undo2 aria-hidden />
            {t("editor.unpublish")}
          </DropdownMenuItem>
        )}
        {course.status !== "ARCHIVED" ? (
          <DropdownMenuItem onClick={() => onStatus("ARCHIVED", "alerts.archived")}>
            <Archive aria-hidden />
            {t("editor.archive")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onStatus("DRAFT", "alerts.unpublished")}>
            <Undo2 aria-hidden />
            {t("editor.restore")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onClick={onDelete}>
          <Trash2 aria-hidden />
          {t("delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The dense alternative to {@link CourseCard} — same data and actions, one line per course. */
function CourseRowItem({
  course,
  canManage,
  onDelete,
  onStatus,
}: {
  course: CourseRow;
  canManage: boolean;
  onDelete: () => void;
  onStatus: (status: CourseStatus, successKey: string) => void;
}) {
  const t = useTranslations("courses");
  const locale = useLocale();
  const c = coverColor(course.id);

  return (
    <li className="hover:bg-muted/40 flex items-center gap-3 p-3 transition-colors">
      <Link href={`/lms/courses/${course.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        {course.cover_image_path !== null ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={course.cover_image_path}
            alt=""
            className="bg-muted size-10 shrink-0 rounded-xl object-cover shadow-sm"
          />
        ) : (
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-bold text-white shadow-sm",
              c.chip,
            )}
          >
            {monogram(course.title)}
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{course.title}</span>
          <span className="text-muted-foreground block truncate text-xs">
            {course.subtitle || t("lessonCount", { count: course.lesson_count })}
          </span>
        </span>
      </Link>
      <span className="text-muted-foreground hidden items-center gap-1.5 text-xs tabular-nums sm:inline-flex">
        <PlayCircle className="size-3.5" />
        {t("lessonCount", { count: course.lesson_count })}
      </span>
      <PriceTag
        priceMinor={course.price_minor}
        currency={course.currency}
        free={course.is_free}
        freeLabel={t("price.free")}
        locale={locale}
        className="hidden sm:inline-flex"
      />
      <CourseStatusBadge status={course.status} />
      {canManage && (
        <CourseActionsMenu course={course} onDelete={onDelete} onStatus={onStatus} />
      )}
    </li>
  );
}

function ViewButton({
  active,
  onClick,
  label,
  Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  Icon: typeof LayoutGrid;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-7 items-center justify-center rounded-lg transition-all",
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="bg-card overflow-hidden rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]"
        >
          <Sk className="aspect-[64/27] rounded-none" />
          <div className="space-y-2 p-4">
            <Sk className="h-4 w-3/4" />
            <Sk className="h-3 w-1/2" />
            <Sk className="mt-3 h-5 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="bg-card divide-y overflow-hidden rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="flex items-center gap-3 p-3">
          <Sk className="size-10 rounded-xl" />
          <div className="flex-1 space-y-1.5">
            <Sk className="h-4 w-2/5" />
            <Sk className="h-3 w-1/4" />
          </div>
          <Sk className="h-5 w-16 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

function CreateCourseModal({
  busy,
  currency,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  currency: string;
  onCancel: () => void;
  onSubmit: (v: {
    title: string;
    subtitle: string;
    description: string;
    price_minor: number;
    cover_media_asset_id: string | null;
  }) => void;
}) {
  const t = useTranslations("courses");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceMinor, setPriceMinor] = useState(0);
  const [coverAssetId, setCoverAssetId] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);

  return (
    <Modal open onClose={onCancel} title={t("new")} description={t("form.createHint")}>
      <form
        id="create-course-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) {
            onSubmit({
              title,
              subtitle,
              description,
              price_minor: priceMinor,
              cover_media_asset_id: coverAssetId,
            });
          }
        }}
      >
        <Field label={t("form.title")}>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("form.titlePlaceholder")}
            className={inputClass}
            required
          />
        </Field>
        <Field label={t("form.subtitle")} optional={t("form.optional")}>
          <input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder={t("form.subtitlePlaceholder")}
            className={inputClass}
          />
        </Field>
        <Field label={t("form.description")} optional={t("form.optional")}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("form.descriptionPlaceholder")}
            rows={4}
            className={textareaClass}
          />
        </Field>
        <Field label={t("form.cover")} optional={t("form.optional")} hint={t("form.coverHint")}>
          <MediaUpload
            kind="IMAGE"
            accept="image/*"
            onChange={setCoverAssetId}
            onBusyChange={setCoverUploading}
          />
        </Field>
        <Field label={t("form.price")}>
          <PriceField
            defaultMinor={0}
            currency={currency}
            onChange={setPriceMinor}
            labels={{
              free: t("price.free"),
              paid: t("price.paid"),
              amount: t("price.amount", { currency }),
              placeholder: t("price.placeholder"),
              freeHint: t("price.freeHint"),
            }}
          />
        </Field>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {t("form.cancel")}
          </Button>
          <Button type="submit" disabled={busy || coverUploading || !title.trim()}>
            {t("form.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
