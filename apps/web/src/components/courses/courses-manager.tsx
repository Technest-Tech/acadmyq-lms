"use client";

import { BookOpen, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CoursesTabs } from "@/components/courses/courses-tabs";
import { CourseStatusBadge } from "@/components/courses/course-status-badge";
import { Field, inputClass, textareaClass } from "@/components/courses/form-bits";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  COURSE_STATUSES,
  createCourse,
  deleteCourse,
  getCourseSummary,
  listCourses,
  type CourseRow,
  type CourseStatus,
  type CourseSummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | CourseStatus;

/**
 * The Courses cockpit: headline counts, a status filter + search, and the course list. Creating a
 * course opens a small modal (title + optional subtitle/description) and drops you into the editor.
 * `course.manage` gates create/delete; readers see the list only.
 */
export function CoursesManager() {
  const t = useTranslations("courses");
  const { can } = useAuth();
  const canManage = can("course.manage");

  const [rows, setRows] = useState<CourseRow[]>([]);
  const [summary, setSummary] = useState<CourseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
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
  }) {
    setBusy(true);
    try {
      await createCourse({
        title: input.title.trim(),
        subtitle: input.subtitle.trim() || null,
        description: input.description.trim() || null,
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

  const stats: { key: keyof CourseSummary; label: string }[] = [
    { key: "total", label: t("stats.total") },
    { key: "draft", label: t("stats.draft") },
    { key: "published", label: t("stats.published") },
    { key: "archived", label: t("stats.archived") },
  ];

  return (
    <div className="space-y-6">
      <CoursesTabs />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("subtitle")}</p>
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus /> {t("new")}
          </Button>
        )}
      </div>

      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.key} className="rounded-xl border p-4">
            <div className="text-muted-foreground text-xs">{s.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {summary ? summary[s.key] : "—"}
            </div>
          </div>
        ))}
      </div>

      {/* Filter + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {(["all", ...COURSE_STATUSES] as StatusFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground",
              )}
            >
              {f === "all" ? t("filter.all") : t(`filter.${f}`)}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("search")}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 ms-auto h-8 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-3 sm:w-56"
        />
      </div>

      {/* List */}
      {loading && rows.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">…</p>
      ) : rows.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed py-16 text-center text-sm">
          <BookOpen className="mx-auto mb-3 size-6 opacity-50" />
          {t("empty")}
        </div>
      ) : (
        <ul className="divide-y rounded-xl border">
          {rows.map((c) => (
            <li key={c.id} className="hover:bg-muted/40 flex items-center gap-3 p-3 transition-colors">
              <Link href={`/courses/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
                  <BookOpen className="size-5 opacity-70" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.title}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {c.subtitle || t("lessonCount", { count: c.lesson_count })}
                  </span>
                </span>
              </Link>
              <CourseStatusBadge status={c.status} />
              <span className="text-muted-foreground hidden w-24 text-end text-xs tabular-nums sm:block">
                {t("lessonCount", { count: c.lesson_count })}
              </span>
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("confirm.deleteCourse")}
                  onClick={() => setDeleting(c)}
                >
                  <Trash2 className="text-destructive" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <CreateCourseModal
          busy={busy}
          onCancel={() => setCreating(false)}
          onSubmit={submitCreate}
        />
      )}

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t("confirm.deleteCourse")}
      >
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">{deleting?.title}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={busy}>
              {t("form.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {t("delete")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function CreateCourseModal({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (v: { title: string; subtitle: string; description: string }) => void;
}) {
  const t = useTranslations("courses");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [description, setDescription] = useState("");

  return (
    <Modal open onClose={onCancel} title={t("new")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) onSubmit({ title, subtitle, description });
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
        <Field label={t("form.subtitle")}>
          <input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder={t("form.subtitlePlaceholder")}
            className={inputClass}
          />
        </Field>
        <Field label={t("form.description")}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("form.descriptionPlaceholder")}
            rows={4}
            className={textareaClass}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {t("form.cancel")}
          </Button>
          <Button type="submit" disabled={busy || !title.trim()}>
            {t("form.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
