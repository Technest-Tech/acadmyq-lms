"use client";

import {
  Archive,
  ArrowUpRight,
  BookMarked,
  Download,
  Eye,
  FileText,
  GripVertical,
  Library,
  MoreHorizontal,
  Plus,
  Rocket,
  SearchX,
  SquarePen,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CourseStatusBadge } from "@/components/courses/course-status-badge";
import {
  CheckOption,
  Field,
  inputClass,
  PriceField,
  textareaClass,
} from "@/components/courses/form-bits";
import {
  EmptyState,
  lmsColor,
  PageHeader,
  PriceTag,
  SearchField,
  SegmentedFilter,
  Sk,
  StatusPill,
  type SegmentOption,
} from "@/components/courses/lms-ui";
import { MediaUpload } from "@/components/courses/media-upload";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/ui/modal";
import {
  addProductFile,
  COURSE_STATUSES,
  createProduct,
  deleteProduct,
  deleteProductFile,
  getProduct,
  getProductSummary,
  listProducts,
  reorderProductFiles,
  setProductStatus,
  updateProduct,
  updateProductFile,
  type CourseStatus,
  type ProductDetail,
  type ProductFile,
  type ProductInput,
  type ProductRow,
  type ProductSummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | CourseStatus;

/** Spine tints, picked deterministically per book so a shelf of them stays scannable. */
const SPINE_COLORS = ["amber", "rose", "violet", "indigo", "teal", "emerald", "blue", "cyan"];

function spineColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return lmsColor(SPINE_COLORS[hash % SPINE_COLORS.length]);
}

/** What the browser should offer to pick for a book file — PDFs first, then the rest. */
const FILE_ACCEPT =
  ".pdf,.epub,.mobi,.doc,.docx,.zip,.txt,.md,application/pdf,application/epub+zip,text/plain";

/** Human file size. Books are megabytes, so one decimal is enough and never reads as fake precision. */
function fileSize(bytes: number | null): string | null {
  if (bytes === null || bytes <= 0) return null;
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The Books cockpit (docs/lms/11) — the second shelf of a course platform's catalogue.
 *
 * Deliberately ONE screen rather than a list plus a `/[id]` editor route: a book has no sections and
 * no lessons, so everything it owns — the sales copy, the price, the files and which of them is the
 * free sample — fits in a single dialog. `course.manage` gates every write; a reader sees the shelf.
 */
export function BooksManager() {
  const t = useTranslations("books");
  const locale = useLocale();
  const { can } = useAuth();
  const canManage = can("course.manage");

  const [rows, setRows] = useState<ProductRow[]>([]);
  const [summary, setSummary] = useState<ProductSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ProductRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<{ variant: "success" | "error"; message: string } | null>(null);

  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  const showAlert = useCallback((variant: "success" | "error", message: string) => {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 4000);
  }, []);

  useEffect(() => {
    void getProductSummary()
      .then(setSummary)
      .catch(() => {});
  }, [refreshToken]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setLoading(true);
      void listProducts({
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

  async function submitCreate(input: {
    title: string;
    price_minor: number;
    cover_media_asset_id: string | null;
  }) {
    setBusy(true);
    try {
      const { productId } = await createProduct({
        title: input.title.trim(),
        price_minor: input.price_minor,
        cover_media_asset_id: input.cover_media_asset_id,
      });
      setCreating(false);
      refresh();
      // Straight into the editor: a book with no file cannot be published, so the very next thing
      // the client has to do is upload one.
      setEditingId(productId);
    } catch (e) {
      showAlert("error", e instanceof Error ? e.message : t("alerts.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteProduct(deleting.id);
      setDeleting(null);
      refresh();
      showAlert("success", t("alerts.deleted"));
    } catch {
      showAlert("error", t("alerts.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(book: ProductRow, status: CourseStatus, successKey: string) {
    try {
      await setProductStatus(book.id, status);
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
        Icon={Library}
        color="amber"
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

      {/* The one warning worth interrupting for: books priced but nowhere to send the money. */}
      {summary !== null && !summary.accepts_payments && summary.published > 0 && (
        <AlertBanner variant="info" message={t("noPaymentMethod")} />
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-card space-y-3 rounded-2xl p-4 shadow-sm ring-1 ring-foreground/[0.06]"
            >
              <Sk className="h-32 w-full rounded-xl" />
              <Sk className="h-4 w-3/4" />
              <Sk className="h-3 w-1/2" />
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
              Icon={Library}
              color="amber"
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((b) => (
            <BookCard
              key={b.id}
              book={b}
              canManage={canManage}
              onOpen={() => setEditingId(b.id)}
              onDelete={() => setDeleting(b)}
              onStatus={(status, key) => void changeStatus(b, status, key)}
            />
          ))}
        </div>
      )}

      {creating && (
        <CreateBookModal
          busy={busy}
          currency={summary?.currency ?? "USD"}
          onCancel={() => setCreating(false)}
          onSubmit={submitCreate}
        />
      )}

      {editingId !== null && (
        <BookEditor
          productId={editingId}
          canManage={canManage}
          onClose={() => {
            setEditingId(null);
            refresh();
          }}
          onAlert={showAlert}
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

// ── the shelf ────────────────────────────────────────────────────────────────

/**
 * A book card. The cover is the point — people buy books by their cover — so an uploaded one fills
 * the tile and the fallback is a drawn spine rather than a generic grey box. Under it: what the
 * client needs to see at a glance (price, how many files, whether there is a sample, how many
 * people own it) and the lifecycle menu, so publishing never requires opening the editor.
 */
function BookCard({
  book,
  canManage,
  onOpen,
  onDelete,
  onStatus,
}: {
  book: ProductRow;
  canManage: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onStatus: (status: CourseStatus, successKey: string) => void;
}) {
  const t = useTranslations("books");
  const locale = useLocale();
  const c = spineColor(book.id);

  return (
    <article className="group bg-card relative flex flex-col overflow-hidden rounded-2xl shadow-sm ring-1 ring-foreground/[0.06] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      <div className={cn("relative aspect-[64/33] shrink-0 bg-gradient-to-br", c.chip)}>
        {book.cover_image_path !== null ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={book.cover_image_path}
              alt=""
              className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/45 to-transparent" />
          </>
        ) : (
          <BookMarked
            className="absolute -bottom-4 -end-3 size-24 text-white/15 transition-transform duration-300 group-hover:scale-110"
            strokeWidth={1.25}
            aria-hidden
          />
        )}
        <button
          type="button"
          onClick={onOpen}
          className="absolute inset-0 cursor-pointer"
          aria-label={book.title}
        />
        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <CourseStatusBadge status={book.status} />
          {book.preview_count > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 shadow-sm">
              <Eye className="size-3" aria-hidden />
              {t("card.hasPreview")}
            </span>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <div className="min-h-11">
          <h3 className="line-clamp-2 text-sm font-semibold" dir="auto">
            {book.title}
          </h3>
        </div>

        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1">
            <FileText className="size-3.5" aria-hidden />
            {t("card.files", { count: book.file_count })}
          </span>
          {book.owner_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" aria-hidden />
              {t("card.owners", { count: book.owner_count })}
            </span>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <PriceTag
            priceMinor={book.price_minor}
            currency={book.currency}
            free={book.is_free}
            freeLabel={t("price.free")}
            locale={locale}
          />
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={onOpen}>
              <SquarePen /> {t("card.edit")}
            </Button>
            {canManage && (
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <button
                    type="button"
                    aria-label={t("card.more")}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
                  >
                    <MoreHorizontal className="size-4" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {book.status !== "PUBLISHED" && (
                    <DropdownMenuItem
                      // The API refuses to publish a book with nothing to deliver; disabling it
                      // here says WHY before the click rather than after it.
                      disabled={book.file_count === 0}
                      onClick={() => onStatus("PUBLISHED", "alerts.published")}
                    >
                      <Rocket /> {t("card.publish")}
                    </DropdownMenuItem>
                  )}
                  {book.status === "PUBLISHED" && (
                    <DropdownMenuItem onClick={() => onStatus("DRAFT", "alerts.unpublished")}>
                      <Undo2 /> {t("card.unpublish")}
                    </DropdownMenuItem>
                  )}
                  {book.status !== "ARCHIVED" ? (
                    <DropdownMenuItem onClick={() => onStatus("ARCHIVED", "alerts.archived")}>
                      <Archive /> {t("card.archive")}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => onStatus("DRAFT", "alerts.restored")}>
                      <Undo2 /> {t("card.restore")}
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
        </div>
      </div>
    </article>
  );
}

// ── create ───────────────────────────────────────────────────────────────────

function CreateBookModal({
  busy,
  currency,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  currency: string;
  onCancel: () => void;
  onSubmit: (input: {
    title: string;
    price_minor: number;
    cover_media_asset_id: string | null;
  }) => void;
}) {
  const t = useTranslations("books");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState(0);
  const [cover, setCover] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

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
          <Button
            onClick={() => onSubmit({ title, price_minor: price, cover_media_asset_id: cover })}
            disabled={busy || uploading || title.trim() === ""}
          >
            {t("form.create")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
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

        <Field label={t("form.price")}>
          <PriceField
            defaultMinor={0}
            currency={currency}
            onChange={setPrice}
            labels={{
              free: t("price.free"),
              paid: t("price.paid"),
              amount: t("price.amount"),
              placeholder: t("price.placeholder"),
              freeHint: t("price.freeHint"),
            }}
          />
        </Field>

        <Field label={t("form.cover")} optional={t("form.optional")}>
          <MediaUpload
            kind="IMAGE"
            accept="image/*"
            onChange={setCover}
            onBusyChange={setUploading}
          />
        </Field>
      </div>
    </Modal>
  );
}

// ── edit ─────────────────────────────────────────────────────────────────────

/**
 * The book editor: everything a digital product owns, in one dialog.
 *
 * Two independent halves, and they save independently on purpose. The metadata form is a normal
 * save-when-you-are-done form; the FILES are live — adding, removing, reordering or re-flagging one
 * hits the API at once and re-renders from its response. A file upload that only landed when you
 * remembered to press Save would be the worst kind of data loss.
 */
function BookEditor({
  productId,
  canManage,
  onClose,
  onAlert,
}: {
  productId: string;
  canManage: boolean;
  onClose: () => void;
  onAlert: (variant: "success" | "error", message: string) => void;
}) {
  const t = useTranslations("books");

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [files, setFiles] = useState<ProductFile[]>([]);
  const [form, setForm] = useState<ProductInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void getProduct(productId)
      .then((res) => {
        if (!alive) return;
        setProduct(res.product);
        setFiles(res.files);
        setForm({
          title: res.product.title,
          description: res.product.description ?? "",
          price_minor: res.product.price_minor,
        });
      })
      .catch(() => onAlert("error", t("alerts.failed")));
    return () => {
      alive = false;
    };
  }, [productId, onAlert, t]);

  function patch(next: Partial<ProductInput>) {
    setForm((f) => (f === null ? f : { ...f, ...next }));
  }

  async function save() {
    if (form === null) return;
    setSaving(true);
    try {
      // Dropped from the spread, then re-added only when it holds a real asset id (see below).
      const { cover_media_asset_id: cover, ...rest } = form;
      await updateProduct(productId, {
        ...rest,
        description: form.description?.trim() || null,
        // Send the cover key ONLY when a new image actually landed. The uploader reports `null`
        // while a pick is in flight and again if it fails, and the API reads a present-but-null key
        // as "clear the cover" — so passing it through would delete the existing cover on a failed
        // upload, which is a worse outcome than the retry the user was about to make.
        ...(typeof cover === "string" ? { cover_media_asset_id: cover } : {}),
      });
      onAlert("success", t("alerts.saved"));
      onClose();
    } catch (e) {
      onAlert("error", e instanceof Error ? e.message : t("alerts.failed"));
    } finally {
      setSaving(false);
    }
  }

  /** Every file mutation funnels through here so the shelf always re-renders from the server. */
  async function mutateFiles(run: () => Promise<{ files: ProductFile[] }>) {
    setFileBusy(true);
    try {
      setFiles((await run()).files);
    } catch (e) {
      onAlert("error", e instanceof Error ? e.message : t("alerts.failed"));
    } finally {
      setFileBusy(false);
    }
  }

  const disabled = !canManage || saving;

  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={product?.title ?? t("form.editTitle")}
      description={t("form.editHint")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("form.close")}
          </Button>
          {canManage && (
            <Button onClick={() => void save()} disabled={disabled || form === null}>
              {t("form.save")}
            </Button>
          )}
        </>
      }
    >
      {form === null || product === null ? (
        <div className="space-y-3">
          <Sk className="h-9 w-full" />
          <Sk className="h-9 w-full" />
          <Sk className="h-24 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── the files, first: a book with none cannot be published ────────── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">{t("files.title")}</h3>
              <StatusPill tone={files.some((f) => f.is_preview) ? "emerald" : "slate"}>
                {files.some((f) => f.is_preview) ? t("files.hasPreview") : t("files.noPreview")}
              </StatusPill>
            </div>
            <p className="text-muted-foreground text-xs">{t("files.hint")}</p>

            {files.length === 0 ? (
              <p className="border-input text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm">
                {t("files.empty")}
              </p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-xl border">
                {files.map((file, index) => (
                  <li key={file.id} className="flex items-center gap-3 p-3">
                    <span className="text-muted-foreground/60 hidden sm:block">
                      <GripVertical className="size-4" aria-hidden />
                    </span>
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold",
                        file.is_preview
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {file.format ?? <FileText className="size-4" aria-hidden />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" dir="auto">
                        {file.title}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {[
                          fileSize(file.size_bytes),
                          file.is_preview ? t("files.previewBadge") : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>

                    {file.url !== null && (
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground shrink-0 rounded-lg p-2"
                        aria-label={t("files.open")}
                        title={t("files.open")}
                      >
                        <Download className="size-4" aria-hidden />
                      </a>
                    )}

                    {canManage && (
                      <>
                        <label
                          className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-medium"
                          title={t("files.previewToggleHint")}
                        >
                          <input
                            type="checkbox"
                            className="accent-primary size-4"
                            checked={file.is_preview}
                            disabled={fileBusy}
                            onChange={(e) =>
                              void mutateFiles(() =>
                                updateProductFile(productId, file.id, {
                                  is_preview: e.target.checked,
                                }),
                              )
                            }
                          />
                          <span className="hidden sm:inline">{t("files.previewToggle")}</span>
                        </label>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("files.moveUp")}
                          disabled={fileBusy || index === 0}
                          onClick={() => {
                            // Swap with the row above and send the whole order — the API rewrites
                            // positions from the array, so a partial list would renumber the rest.
                            const ids = files.map((f) => f.id);
                            const above = ids[index - 1];
                            const here = ids[index];
                            if (above === undefined || here === undefined) return;
                            ids[index - 1] = here;
                            ids[index] = above;
                            void mutateFiles(() => reorderProductFiles(productId, ids));
                          }}
                        >
                          <ArrowUpRight className="rotate-[-45deg]" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("files.remove")}
                          disabled={fileBusy}
                          onClick={() =>
                            void mutateFiles(() => deleteProductFile(productId, file.id))
                          }
                        >
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canManage && (
              <AddFileRow
                busy={fileBusy}
                onAdd={(input) => mutateFiles(() => addProductFile(productId, input))}
              />
            )}
          </section>

          {/* ── the pitch: what a shop actually needs to list a book ─────────── */}
          <section className="space-y-4">
            <Field label={t("form.title")}>
              <input
                className={inputClass}
                value={form.title ?? ""}
                dir="auto"
                disabled={disabled}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </Field>
            <Field label={t("form.cover")} optional={t("form.optional")}>
              <MediaUpload
                kind="IMAGE"
                accept="image/*"
                hasExisting={product.cover_image_path !== null}
                existingUrl={product.cover_image_path}
                onChange={(assetId) => patch({ cover_media_asset_id: assetId })}
              />
            </Field>
          </section>

          <Field label={t("form.description")} optional={t("form.optional")}>
            <textarea
              className={textareaClass}
              rows={5}
              value={form.description ?? ""}
              dir="auto"
              disabled={disabled}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </Field>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t("form.priceSection")}</h3>
            <PriceField
              key={product.id}
              defaultMinor={product.price_minor}
              currency={product.currency}
              disabled={disabled}
              onChange={(minor) => patch({ price_minor: minor })}
              labels={{
                free: t("price.free"),
                paid: t("price.paid"),
                amount: t("price.amount"),
                placeholder: t("price.placeholder"),
                freeHint: t("price.freeHint"),
              }}
            />
            {/* The honest answer, not the flag: a Buy button with nowhere to pay strands the buyer. */}
            {!product.sells_online && !product.is_free && (
              <p className="text-muted-foreground text-xs">{t("form.notSellingHint")}</p>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

/**
 * Add one file to the book. The upload happens first (so a half-uploaded file never becomes a row)
 * and the "free sample" flag is set here rather than afterwards, because whether a file is the
 * giveaway is a decision made while choosing it, not a property discovered later.
 */
function AddFileRow({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (input: { title: string; media_asset_id: string; is_preview: boolean }) => Promise<void>;
}) {
  const t = useTranslations("books");
  const [title, setTitle] = useState("");
  const [assetId, setAssetId] = useState<string | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const ready = assetId !== null && title.trim() !== "" && !uploading && !busy;

  return (
    <div className="border-input space-y-3 rounded-xl border border-dashed p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("files.newTitle")}>
          <input
            className={inputClass}
            value={title}
            dir="auto"
            placeholder={t("files.newTitlePlaceholder")}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label={t("files.newFile")}>
          {/* Remounted after each add (`nonce`), so the uploader returns to its drop zone rather
              than showing the previous file as if it were still attached. */}
          <MediaUpload
            key={nonce}
            kind="DOCUMENT"
            accept={FILE_ACCEPT}
            onChange={setAssetId}
            onBusyChange={setUploading}
          />
        </Field>
      </div>

      <CheckOption
        checked={isPreview}
        onChange={setIsPreview}
        label={t("files.markPreview")}
        hint={t("files.markPreviewHint")}
      />

      <Button
        size="sm"
        disabled={!ready}
        onClick={async () => {
          if (assetId === null) return;
          await onAdd({ title: title.trim(), media_asset_id: assetId, is_preview: isPreview });
          setTitle("");
          setAssetId(null);
          setIsPreview(false);
          setNonce((n) => n + 1);
        }}
      >
        <Plus /> {t("files.add")}
      </Button>
    </div>
  );
}
