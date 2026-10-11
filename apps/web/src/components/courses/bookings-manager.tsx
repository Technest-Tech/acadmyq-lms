"use client";

import {
  ArrowUpRight,
  CalendarCheck2,
  CalendarClock,
  Check,
  CircleDot,
  Copy,
  Eye,
  EyeOff,
  Inbox,
  ListChecks,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  SearchX,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  CheckOption,
  Field,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/courses/form-bits";
import {
  EmptyState,
  InitialsAvatar,
  PageHeader,
  Panel,
  SearchField,
  SegmentedFilter,
  StatCard,
  StatusPill,
  tableHeadClass,
  TableSkeleton,
  tdClass,
  thClass,
  trClass,
  type PillTone,
} from "@/components/courses/lms-ui";
import { StringList } from "@/components/courses/site-editor-bits";
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
  BOOKING_STATUSES,
  createBookingForm,
  deleteBookingForm,
  deleteBookingRequest,
  getBookingRequest,
  getBookingSummary,
  listBookingForms,
  listBookingRequests,
  updateBookingForm,
  updateBookingRequest,
  type BookingForm,
  type BookingFormInput,
  type BookingRequestDetail,
  type BookingRequestRow,
  type BookingStatus,
  type BookingSummary,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * Booking requests (docs/lms/13) — "احجز استشارة", "احجز كورس", whatever the client named them.
 *
 * Two halves on one page: the INBOX (every request from every form, open ones first, because the
 * screen exists to get people called back) and the FORMS (what the site asks, and where it shows
 * it). One page rather than two sidebar items: a client with one form thinks of this as "my
 * bookings", and the forms are its settings.
 */

const STATUS_TONE: Record<BookingStatus, PillTone> = {
  NEW: "amber",
  CONTACTED: "blue",
  CONFIRMED: "emerald",
  COMPLETED: "violet",
  CANCELLED: "slate",
};

type View = "requests" | "forms";
type Tab = "open" | "all" | BookingStatus;

const PAGE_SIZE = 25;

export function BookingsManager() {
  const t = useTranslations("bookings");
  const locale = useLocale();
  const { can } = useAuth();
  const canManage = can("booking.manage");

  const [view, setView] = useState<View>("requests");
  const [summary, setSummary] = useState<BookingSummary | null>(null);
  const [forms, setForms] = useState<BookingForm[] | null>(null);
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [rows, setRows] = useState<BookingRequestRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("open");
  const [search, setSearch] = useState("");
  const [formId, setFormId] = useState("");
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<BookingForm | "new" | null>(null);
  const [preset, setPreset] = useState<BookingFormInput | null>(null);
  const [deletingForm, setDeletingForm] = useState<BookingForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<{ variant: "success" | "error"; message: string } | null>(
    null,
  );

  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);
  const showAlert = useCallback((variant: "success" | "error", message: string) => {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 3500);
  }, []);
  const onError = useCallback(() => showAlert("error", t("alerts.failed")), [showAlert, t]);

  const query = useMemo(
    () => ({
      search: search.trim() || undefined,
      filter: {
        ...(tab === "open" ? { open: "1" } : {}),
        ...(tab !== "open" && tab !== "all" ? { status: tab } : {}),
        ...(formId ? { form_id: formId } : {}),
      },
      sort: "-created_at",
    }),
    [search, tab, formId],
  );

  useEffect(() => {
    const handle = setTimeout(() => {
      setLoading(true);
      listBookingRequests({ ...query, page, pageSize: PAGE_SIZE })
        .then((r) => {
          setRows(r.rows);
          setTotal(r.total);
        })
        .catch(onError)
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(handle);
  }, [query, page, refreshToken, onError]);

  useEffect(() => {
    getBookingSummary()
      .then(setSummary)
      .catch(() => undefined);
    listBookingForms()
      .then((r) => {
        setForms(r.forms);
        setSiteUrl(r.site_url);
      })
      .catch(() => setForms([]));
  }, [refreshToken]);

  // A filter change invalidates the page number — page 3 of a different result set is nonsense.
  useEffect(() => setPage(1), [query]);

  const s = summary?.stats;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = search.trim() !== "" || formId !== "" || (tab !== "open" && tab !== "all");
  const noForms = forms !== null && forms.length === 0;

  function startForm(input: BookingFormInput | null) {
    setPreset(input);
    setEditing("new");
  }

  async function saveForm(input: BookingFormInput) {
    setBusy(true);
    try {
      if (editing === "new") {
        await createBookingForm(input);
        showAlert("success", t("alerts.created"));
      } else if (editing) {
        await updateBookingForm(editing.id, input);
        showAlert("success", t("alerts.saved"));
      }
      setEditing(null);
      setPreset(null);
      refresh();
    } catch (e) {
      showAlert("error", e instanceof Error ? e.message : t("alerts.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleForm(form: BookingForm) {
    try {
      await updateBookingForm(form.id, { status: form.status === "ACTIVE" ? "HIDDEN" : "ACTIVE" });
      refresh();
      showAlert("success", t(form.status === "ACTIVE" ? "alerts.hidden" : "alerts.shown"));
    } catch {
      onError();
    }
  }

  async function confirmDeleteForm() {
    if (!deletingForm) return;
    setBusy(true);
    try {
      await deleteBookingForm(deletingForm.id);
      if (formId === deletingForm.id) setFormId("");
      setDeletingForm(null);
      refresh();
      showAlert("success", t("alerts.formDeleted"));
    } catch {
      onError();
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      showAlert("success", t("alerts.copied"));
    } catch {
      onError();
    }
  }

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        Icon={CalendarCheck2}
        color="teal"
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          canManage && (
            <Button size="lg" onClick={() => startForm(null)}>
              <Plus /> {t("forms.new")}
            </Button>
          )
        }
      >
        <div
          role="tablist"
          className="no-scrollbar bg-muted/50 inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border p-1"
        >
          {(["requests", "forms"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors",
                view === key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {key === "requests" ? (
                <Inbox className="size-4" aria-hidden />
              ) : (
                <ListChecks className="size-4" aria-hidden />
              )}
              {t(`view.${key}`)}
              {key === "requests" && (s?.new ?? 0) > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white tabular-nums">
                  {formatNumber(s?.new ?? 0, locale)}
                </span>
              )}
              {key === "forms" && forms !== null && (
                <span className="text-muted-foreground text-xs tabular-nums">
                  {formatNumber(forms.length, locale)}
                </span>
              )}
            </button>
          ))}
        </div>
      </PageHeader>

      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      {view === "requests" ? (
        <>
          {/* NEW first: it is the only tile that asks someone to pick up a phone. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              Icon={CircleDot}
              color="amber"
              label={t("stat.new")}
              value={s?.new ?? null}
              hint={t("stat.newHint")}
              loading={!summary}
              locale={locale}
            />
            <StatCard
              Icon={Inbox}
              color="blue"
              label={t("stat.open")}
              value={s?.open ?? null}
              hint={t("stat.openHint")}
              loading={!summary}
              locale={locale}
            />
            <StatCard
              Icon={CalendarCheck2}
              color="emerald"
              label={t("stat.confirmed")}
              value={s?.confirmed ?? null}
              hint={s ? t("stat.completedHint", { count: s.completed }) : undefined}
              loading={!summary}
              locale={locale}
            />
            <StatCard
              Icon={Sparkles}
              color="violet"
              label={t("stat.thisMonth")}
              value={s?.this_month ?? null}
              hint={s ? t("stat.totalHint", { count: s.total }) : undefined}
              loading={!summary}
              locale={locale}
            />
          </div>

          <Panel flush>
            <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3.5 sm:px-5">
              <div className="no-scrollbar max-w-full overflow-x-auto">
                <SegmentedFilter<Tab>
                  value={tab}
                  onChange={setTab}
                  locale={locale}
                  options={[
                    { value: "open", label: t("filter.open"), count: s?.open },
                    { value: "NEW", label: t("status.NEW"), count: s?.new },
                    { value: "CONFIRMED", label: t("status.CONFIRMED"), count: s?.confirmed },
                    { value: "COMPLETED", label: t("status.COMPLETED"), count: s?.completed },
                    { value: "CANCELLED", label: t("status.CANCELLED"), count: s?.cancelled },
                    { value: "all", label: t("filter.all"), count: s?.total },
                  ]}
                />
              </div>
              {forms !== null && forms.length > 1 && (
                <select
                  value={formId}
                  onChange={(e) => setFormId(e.target.value)}
                  aria-label={t("filter.form")}
                  className={cn(selectClass, "h-9 w-full min-w-0 text-sm sm:w-auto sm:min-w-44")}
                >
                  <option value="">{t("filter.allForms")}</option>
                  {forms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.title}
                    </option>
                  ))}
                </select>
              )}
              <SearchField
                value={search}
                onChange={setSearch}
                placeholder={t("search")}
                className="w-full sm:ms-auto sm:w-64"
              />
            </div>

            {/* Cards on a phone: who, what, when, and the open button in one glance. */}
            {!loading && rows.length > 0 && (
              <ul className="divide-y sm:hidden">
                {rows.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setOpenId(r.id)}
                      className="hover:bg-muted/40 w-full space-y-2 px-4 py-3.5 text-start transition-colors"
                    >
                      <div className="flex items-start gap-2.5">
                        <InitialsAvatar name={r.full_name} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium" dir="auto">
                            {r.full_name}
                          </p>
                          <p className="text-muted-foreground truncate text-xs" dir="ltr">
                            {r.phone}
                          </p>
                        </div>
                        <StatusPill tone={STATUS_TONE[r.status]}>
                          {t(`status.${r.status}`)}
                        </StatusPill>
                      </div>
                      <p className="text-muted-foreground text-xs" dir="auto">
                        {r.form_title}
                        {requestDetail(r) && ` · ${requestDetail(r)}`}
                      </p>
                      <RequestWhen row={r} locale={locale} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div
              className={cn("overflow-x-auto", !loading && rows.length > 0 && "hidden sm:block")}
            >
              <table className="w-full text-sm">
                <thead className={tableHeadClass}>
                  <tr>
                    <th className={thClass}>{t("col.name")}</th>
                    <th className={thClass}>{t("col.form")}</th>
                    <th className={thClass}>{t("col.details")}</th>
                    <th className={thClass}>{t("col.status")}</th>
                    <th className={thClass}>{t("col.received")}</th>
                    <th className={cn(thClass, "text-end")}>
                      <span className="sr-only">{t("col.actions")}</span>
                    </th>
                  </tr>
                </thead>
                {loading ? (
                  <TableSkeleton cols={6} />
                ) : rows.length === 0 ? (
                  <tbody>
                    <tr>
                      <td colSpan={6}>
                        {noForms ? (
                          <EmptyState
                            Icon={ListChecks}
                            color="teal"
                            title={t("emptyNoForms")}
                            description={t("emptyNoFormsHint")}
                            action={
                              canManage && (
                                <Button size="lg" onClick={() => setView("forms")}>
                                  <Plus /> {t("forms.new")}
                                </Button>
                              )
                            }
                          />
                        ) : filtered ? (
                          <EmptyState
                            Icon={SearchX}
                            color="slate"
                            title={t("emptySearch")}
                            action={
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setSearch("");
                                  setFormId("");
                                  setTab("open");
                                }}
                              >
                                {t("clearFilters")}
                              </Button>
                            }
                          />
                        ) : (
                          <EmptyState
                            Icon={Inbox}
                            color="teal"
                            title={tab === "open" ? t("emptyOpen") : t("empty")}
                            description={t("emptyHint")}
                          />
                        )}
                      </td>
                    </tr>
                  </tbody>
                ) : (
                  <tbody className="divide-y">
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className={cn(trClass, "cursor-pointer")}
                        onClick={() => setOpenId(r.id)}
                      >
                        <td className={tdClass}>
                          <div className="flex items-center gap-2.5">
                            <InitialsAvatar name={r.full_name} />
                            <div className="min-w-0">
                              <p className="truncate font-medium" dir="auto">
                                {r.full_name}
                              </p>
                              <p className="text-muted-foreground truncate text-xs" dir="ltr">
                                {r.phone}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className={cn(tdClass, "max-w-48")}>
                          <p className="truncate" dir="auto">
                            {r.form_title}
                          </p>
                        </td>
                        <td className={cn(tdClass, "max-w-64")}>
                          <p className="text-muted-foreground truncate text-xs" dir="auto">
                            {requestDetail(r) ?? "—"}
                          </p>
                          {r.preferred_date && (
                            <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium">
                              <CalendarClock className="size-3.5" aria-hidden />
                              {formatPreferred(r, locale)}
                            </p>
                          )}
                        </td>
                        <td className={tdClass}>
                          <StatusPill tone={STATUS_TONE[r.status]}>
                            {t(`status.${r.status}`)}
                          </StatusPill>
                        </td>
                        <td
                          className={cn(tdClass, "text-muted-foreground text-xs whitespace-nowrap")}
                        >
                          {r.created_at ? formatRelativeTime(r.created_at, locale) : "—"}
                        </td>
                        <td className={cn(tdClass, "text-end")}>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenId(r.id);
                            }}
                          >
                            {t("open")}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                )}
              </table>
            </div>

            {pages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
                <p className="text-muted-foreground text-xs">
                  {t("pageOf", { page, pages, total: formatNumber(total, locale) })}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    {t("prev")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t("next")}
                  </Button>
                </div>
              </div>
            )}
          </Panel>
        </>
      ) : (
        <FormsView
          forms={forms}
          siteUrl={siteUrl}
          canManage={canManage}
          locale={locale}
          onCreate={startForm}
          onEdit={(f) => setEditing(f)}
          onToggle={(f) => void toggleForm(f)}
          onDelete={(f) => setDeletingForm(f)}
          onCopy={(url) => void copyLink(url)}
          onViewRequests={(f) => {
            setFormId(f.id);
            setTab("all");
            setView("requests");
          }}
        />
      )}

      {openId && (
        <RequestDrawer
          requestId={openId}
          canManage={canManage}
          onClose={() => setOpenId(null)}
          onChanged={(message) => {
            refresh();
            showAlert("success", message);
          }}
          onDeleted={() => {
            setOpenId(null);
            refresh();
            showAlert("success", t("alerts.requestDeleted"));
          }}
          onError={onError}
        />
      )}

      {editing && (
        <FormEditor
          key={editing === "new" ? "new" : editing.id}
          form={editing === "new" ? null : editing}
          preset={preset}
          siteUrl={siteUrl}
          busy={busy}
          onCancel={() => {
            setEditing(null);
            setPreset(null);
          }}
          onSave={(input) => void saveForm(input)}
        />
      )}

      <Modal
        open={deletingForm !== null}
        onClose={() => setDeletingForm(null)}
        title={t("confirm.deleteFormTitle")}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeletingForm(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void confirmDeleteForm()} disabled={busy}>
              {t("delete")}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          <span className="font-semibold" dir="auto">
            {deletingForm?.title}
          </span>
          {" — "}
          <span className="text-muted-foreground">{t("confirm.deleteFormBody")}</span>
        </p>
      </Modal>
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

/** The one-line "what about" of a request: the course, else the client's choice. */
function requestDetail(r: BookingRequestRow): string | null {
  const parts = [r.course_title, r.choice].filter((v): v is string => Boolean(v));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The visitor's preferred slot, formatted but never converted: it is a wall-clock wish in the
 * academy's own time, so it is parsed as a LOCAL date (no `Z`) and printed as such.
 */
function formatPreferred(r: BookingRequestRow, locale: string): string {
  if (!r.preferred_date) return "";
  const [y, m, d] = r.preferred_date.split("-").map(Number);
  const [hh, mm] = (r.preferred_time ?? "").split(":").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh || 0, mm || 0);
  const day = date.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  return r.preferred_time
    ? `${day} · ${date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}`
    : day;
}

/**
 * A `wa.me` link for a number as a visitor typed it. wa.me wants the full international number in
 * digits; most visitors of these sites type a local Egyptian mobile ("010…"), which is unambiguous
 * enough to complete ("2010…"). Anything else is passed through as digits.
 */
export function bookingWhatsappHref(phone: string, text?: string): string | null {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (/^01[0125]\d{8}$/.test(digits)) digits = `2${digits}`;
  if (digits.length < 6) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

function RequestWhen({ row, locale }: { row: BookingRequestRow; locale: string }) {
  return (
    <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      {row.preferred_date && (
        <span className="text-foreground inline-flex items-center gap-1 font-medium">
          <CalendarClock className="size-3.5" aria-hidden />
          {formatPreferred(row, locale)}
        </span>
      )}
      {row.created_at && <span>{formatRelativeTime(row.created_at, locale)}</span>}
    </p>
  );
}

/* ─── The request drawer ───────────────────────────────────────────────────── */

/**
 * One request: who, how to reach them in one tap, what they asked for, and the two things staff
 * actually do with it — move it along and write down what was agreed.
 */
function RequestDrawer({
  requestId,
  canManage,
  onClose,
  onChanged,
  onDeleted,
  onError,
}: {
  requestId: string;
  canManage: boolean;
  onClose: () => void;
  onChanged: (message: string) => void;
  onDeleted: () => void;
  onError: () => void;
}) {
  const t = useTranslations("bookings");
  const locale = useLocale();
  const [request, setRequest] = useState<BookingRequestDetail | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    getBookingRequest(requestId)
      .then((r) => {
        setRequest(r.request);
        setNote(r.request.staff_note ?? "");
      })
      .catch(onError);
  }, [requestId, onError]);

  async function save(input: { status?: BookingStatus; staff_note?: string | null }) {
    if (!request) return;
    setBusy(true);
    try {
      const res = await updateBookingRequest(request.id, input);
      setRequest({ ...request, ...res.request });
      onChanged(input.status ? t("alerts.statusSaved") : t("alerts.noteSaved"));
    } catch {
      onError();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!request) return;
    setBusy(true);
    try {
      await deleteBookingRequest(request.id);
      onDeleted();
    } catch {
      onError();
      setBusy(false);
    }
  }

  const whatsapp = request
    ? bookingWhatsappHref(
        request.phone,
        t("detail.whatsappText", { name: request.full_name, form: request.form_title }),
      )
    : null;
  const noteDirty = request !== null && note.trim() !== (request.staff_note ?? "");

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={request?.full_name ?? t("detail.title")}
      description={request?.form_title}
      footer={
        <>
          {canManage && request && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive me-auto"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              <Trash2 /> {t("delete")}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
        </>
      }
    >
      {!request ? (
        <div className="space-y-3">
          <div className="bg-muted h-10 animate-pulse rounded-xl" />
          <div className="bg-muted h-24 animate-pulse rounded-xl" />
        </div>
      ) : confirmDelete ? (
        <div className="space-y-4">
          <p className="text-sm">
            <span className="font-semibold">{t("confirm.deleteRequestTitle")}</span>{" "}
            <span className="text-muted-foreground">{t("confirm.deleteRequestBody")}</span>
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={busy}>
              {t("delete")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Reach them — the whole point of the request. */}
          <div className="flex flex-wrap gap-2">
            {whatsapp && (
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants({ size: "sm" }),
                  "bg-emerald-600 text-white hover:bg-emerald-700",
                )}
              >
                <MessageSquareText /> {t("detail.whatsapp")}
              </a>
            )}
            <a
              href={`tel:${request.phone.replace(/[^\d+]/g, "")}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Phone /> <span dir="ltr">{request.phone}</span>
            </a>
            {request.email && (
              <a
                href={`mailto:${request.email}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Mail /> <span className="max-w-48 truncate">{request.email}</span>
              </a>
            )}
          </div>

          <dl className="bg-muted/30 grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl border p-4 text-sm sm:grid-cols-2">
            <DetailItem label={t("detail.form")} value={request.form_title} />
            <DetailItem
              label={t("detail.received")}
              value={
                request.created_at
                  ? new Date(request.created_at).toLocaleString(locale, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : null
              }
            />
            {request.course_title && (
              <DetailItem label={t("detail.course")} value={request.course_title} />
            )}
            {request.choice && <DetailItem label={t("detail.choice")} value={request.choice} />}
            {request.preferred_date && (
              <DetailItem label={t("detail.preferred")} value={formatPreferred(request, locale)} />
            )}
            {request.learner && (
              <DetailItem
                label={t("detail.account")}
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <UserRound className="size-3.5" aria-hidden />
                    {request.learner.email ?? request.learner.full_name}
                  </span>
                }
              />
            )}
            {request.message && (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground text-xs font-medium">{t("detail.message")}</dt>
                <dd className="mt-1 leading-relaxed whitespace-pre-line" dir="auto">
                  {request.message}
                </dd>
              </div>
            )}
          </dl>

          <div className="space-y-2">
            <p className="text-sm font-medium">{t("detail.status")}</p>
            <div className="flex flex-wrap gap-2">
              {BOOKING_STATUSES.map((status) => {
                const active = request.status === status;
                return (
                  <button
                    key={status}
                    type="button"
                    disabled={!canManage || busy || active}
                    onClick={() => void save({ status })}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-default",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "hover:bg-muted text-muted-foreground disabled:opacity-60",
                    )}
                  >
                    {active && <Check className="size-3.5" aria-hidden />}
                    {t(`status.${status}`)}
                  </button>
                );
              })}
            </div>
            {request.handled_by_name && (
              <p className="text-muted-foreground text-xs">
                {t("detail.handledBy", { name: request.handled_by_name })}
              </p>
            )}
          </div>

          <Field label={t("detail.note")} hint={canManage ? t("detail.noteHint") : undefined}>
            <textarea
              className={textareaClass}
              rows={3}
              value={note}
              dir="auto"
              disabled={!canManage}
              placeholder={t("detail.notePlaceholder")}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {canManage && (
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!noteDirty || busy}
                onClick={() => void save({ staff_note: note.trim() || null })}
              >
                {t("detail.saveNote")}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="mt-0.5 font-medium break-words" dir="auto">
        {value ?? "—"}
      </dd>
    </div>
  );
}

/* ─── The forms ────────────────────────────────────────────────────────────── */

function FormsView({
  forms,
  siteUrl,
  canManage,
  locale,
  onCreate,
  onEdit,
  onToggle,
  onDelete,
  onCopy,
  onViewRequests,
}: {
  forms: BookingForm[] | null;
  siteUrl: string | null;
  canManage: boolean;
  locale: string;
  onCreate: (preset: BookingFormInput | null) => void;
  onEdit: (form: BookingForm) => void;
  onToggle: (form: BookingForm) => void;
  onDelete: (form: BookingForm) => void;
  onCopy: (url: string) => void;
  onViewRequests: (form: BookingForm) => void;
}) {
  const t = useTranslations("bookings");
  const taken = new Set((forms ?? []).map((f) => f.slug));

  // The two shapes every client so far has asked for, one click each. They are only starting
  // points: the name, the questions and the copy are all editable before saving.
  const presets: { key: "consultation" | "course"; input: BookingFormInput }[] = [
    {
      key: "consultation",
      input: {
        title: t("presets.consultation.title"),
        // A readable address out of the box: an Arabic name would otherwise transliterate into
        // something like /book/ahgz-astshar.
        slug: taken.has("consultation") ? undefined : "consultation",
        description: t("presets.consultation.description"),
        ask_date: true,
        ask_course: false,
      },
    },
    {
      key: "course",
      input: {
        title: t("presets.course.title"),
        slug: taken.has("book-a-course") ? undefined : "book-a-course",
        description: t("presets.course.description"),
        ask_course: true,
        ask_date: false,
      },
    },
  ];

  if (forms === null) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-muted h-40 animate-pulse rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {!siteUrl && forms.length > 0 && (
        <AlertBanner variant="info" message={t("forms.noSiteYet")} />
      )}

      {forms.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {forms.map((form) => (
            <li key={form.id}>
              <FormCard
                form={form}
                canManage={canManage}
                locale={locale}
                onEdit={() => onEdit(form)}
                onToggle={() => onToggle(form)}
                onDelete={() => onDelete(form)}
                onCopy={onCopy}
                onViewRequests={() => onViewRequests(form)}
              />
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <Panel
          Icon={Sparkles}
          color="teal"
          title={forms.length === 0 ? t("forms.emptyTitle") : t("forms.addAnother")}
        >
          {forms.length === 0 && (
            <p className="text-muted-foreground mb-4 text-sm">{t("forms.emptyHint")}</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onCreate(p.input)}
                className="hover:border-primary/50 hover:bg-primary/5 rounded-xl border p-4 text-start transition-colors"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {p.key === "consultation" ? (
                    <CalendarClock className="text-primary size-4" aria-hidden />
                  ) : (
                    <CalendarCheck2 className="text-primary size-4" aria-hidden />
                  )}
                  {p.input.title}
                </span>
                <span className="text-muted-foreground mt-1 block text-xs">
                  {t(`presets.${p.key}.hint`)}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => onCreate(null)}
              className="hover:border-primary/50 hover:bg-primary/5 rounded-xl border border-dashed p-4 text-start transition-colors"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Plus className="text-primary size-4" aria-hidden />
                {t("presets.blank.title")}
              </span>
              <span className="text-muted-foreground mt-1 block text-xs">
                {t("presets.blank.hint")}
              </span>
            </button>
          </div>
        </Panel>
      )}

      {!canManage && forms.length === 0 && (
        <div className="bg-card rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
          <EmptyState Icon={ListChecks} color="teal" title={t("forms.emptyTitle")} />
        </div>
      )}
    </div>
  );
}

function FormCard({
  form,
  canManage,
  locale,
  onEdit,
  onToggle,
  onDelete,
  onCopy,
  onViewRequests,
}: {
  form: BookingForm;
  canManage: boolean;
  locale: string;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onCopy: (url: string) => void;
  onViewRequests: () => void;
}) {
  const t = useTranslations("bookings");
  const live = form.status === "ACTIVE";
  const asks = [
    t("forms.asks.contact"),
    form.ask_email && t("forms.asks.email"),
    form.ask_course && t("forms.asks.course"),
    form.ask_date && t("forms.asks.date"),
    form.choices.length > 0 && (form.choice_label || t("forms.asks.choice")),
    form.ask_message && t("forms.asks.message"),
  ].filter((v): v is string => Boolean(v));

  return (
    <article
      className={cn(
        "bg-card flex h-full flex-col gap-4 rounded-2xl p-4 shadow-sm ring-1 ring-foreground/[0.06] sm:p-5",
        !live && "opacity-75",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500 text-white shadow-sm">
          <CalendarCheck2 className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold" dir="auto">
              {form.title}
            </h3>
            <StatusPill tone={live ? "emerald" : "slate"}>
              {t(live ? "forms.live" : "forms.hidden")}
            </StatusPill>
          </div>
          <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs" dir="ltr">
            /book/{form.slug}
          </p>
        </div>
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger>
              <button
                type="button"
                aria-label={t("forms.more")}
                className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil /> {t("forms.edit")}
              </DropdownMenuItem>
              {form.url && live && (
                <DropdownMenuItem onClick={() => onCopy(form.url as string)}>
                  <Copy /> {t("forms.copyLink")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onToggle}>
                {live ? <EyeOff /> : <Eye />} {t(live ? "forms.hide" : "forms.show")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onClick={onDelete}>
                <Trash2 /> {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {form.description && (
        <p className="text-muted-foreground line-clamp-2 text-sm" dir="auto">
          {form.description}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {asks.map((a) => (
          <span
            key={a}
            className="bg-muted rounded-md px-2 py-0.5 text-[11px] font-medium"
            dir="auto"
          >
            {a}
          </span>
        ))}
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>{t(form.show_in_nav ? "forms.inNav" : "forms.notInNav")}</span>
        <span>{t(form.show_on_home ? "forms.onHome" : "forms.notOnHome")}</span>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
        <Button variant="outline" size="sm" onClick={onViewRequests}>
          <Inbox />
          {t("forms.requests", { count: form.requests_total })}
          {form.requests_new > 0 && (
            <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white tabular-nums">
              {formatNumber(form.requests_new, locale)}
            </span>
          )}
        </Button>
        {form.url && live && (
          <a
            href={form.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ms-auto")}
          >
            <ArrowUpRight /> {t("forms.view")}
          </a>
        )}
      </div>
    </article>
  );
}

/* ─── The form editor ──────────────────────────────────────────────────────── */

function FormEditor({
  form,
  preset,
  siteUrl,
  busy,
  onCancel,
  onSave,
}: {
  form: BookingForm | null;
  preset: BookingFormInput | null;
  siteUrl: string | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: BookingFormInput) => void;
}) {
  const t = useTranslations("bookings");
  const seed: BookingFormInput = form ?? preset ?? {};

  const [title, setTitle] = useState(seed.title ?? "");
  const [slug, setSlug] = useState(seed.slug ?? "");
  const [description, setDescription] = useState(seed.description ?? "");
  const [askEmail, setAskEmail] = useState(seed.ask_email ?? true);
  const [askCourse, setAskCourse] = useState(seed.ask_course ?? false);
  const [askDate, setAskDate] = useState(seed.ask_date ?? false);
  const [askMessage, setAskMessage] = useState(seed.ask_message ?? true);
  const [choiceLabel, setChoiceLabel] = useState(seed.choice_label ?? "");
  const [choices, setChoices] = useState<string[]>(seed.choices ?? []);
  const [showInNav, setShowInNav] = useState(seed.show_in_nav ?? true);
  const [showOnHome, setShowOnHome] = useState(seed.show_on_home ?? true);
  const [live, setLive] = useState((seed.status ?? "ACTIVE") === "ACTIVE");
  const [submitLabel, setSubmitLabel] = useState(seed.submit_label ?? "");
  const [successMessage, setSuccessMessage] = useState(seed.success_message ?? "");

  const slugValid = slug === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const ready = title.trim().length >= 2 && slugValid && !busy;

  function submit() {
    if (!ready) return;
    onSave({
      title: title.trim(),
      // Blank on a new form = let the API derive one from the name.
      ...(slug !== "" ? { slug } : {}),
      description: description.trim() || null,
      ask_email: askEmail,
      ask_course: askCourse,
      ask_date: askDate,
      ask_message: askMessage,
      choice_label: choiceLabel.trim() || null,
      choices: choices.map((c) => c.trim()).filter(Boolean),
      show_in_nav: showInNav,
      show_on_home: showOnHome,
      status: live ? "ACTIVE" : "HIDDEN",
      submit_label: submitLabel.trim() || null,
      success_message: successMessage.trim() || null,
    });
  }

  const optional = t("editor.optional");

  return (
    <Modal
      open
      onClose={onCancel}
      size="lg"
      title={form ? t("editor.editTitle") : t("editor.newTitle")}
      description={t("editor.hint")}
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={!ready}>
            {form ? t("editor.save") : t("editor.create")}
          </Button>
        </>
      }
    >
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <section className="space-y-4">
          <Field label={t("editor.title")} hint={t("editor.titleHint")}>
            <input
              className={inputClass}
              value={title}
              dir="auto"
              autoFocus
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("presets.consultation.title")}
            />
          </Field>
          <Field
            label={t("editor.slug")}
            hint={slugValid ? t("editor.slugHint") : t("editor.slugInvalid")}
            optional={form ? undefined : optional}
          >
            <div
              className={cn(
                "flex items-center overflow-hidden rounded-lg border",
                !slugValid && "border-destructive",
              )}
              dir="ltr"
            >
              <span className="text-muted-foreground bg-muted/50 max-w-[45%] shrink-0 truncate border-e px-2.5 py-2 text-xs">
                {siteUrl ? `${siteUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : ""}/book/
              </span>
              <input
                className="h-9 min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none"
                value={slug}
                maxLength={80}
                placeholder={form ? undefined : "consultation"}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
              />
            </div>
          </Field>
          <Field
            label={t("editor.description")}
            hint={t("editor.descriptionHint")}
            optional={optional}
          >
            <textarea
              className={textareaClass}
              rows={2}
              dir="auto"
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">{t("editor.questions")}</h3>
            <p className="text-muted-foreground text-xs">{t("editor.alwaysAsked")}</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <CheckOption
              checked={askCourse}
              onChange={setAskCourse}
              label={t("editor.askCourse")}
              hint={t("editor.askCourseHint")}
            />
            <CheckOption
              checked={askDate}
              onChange={setAskDate}
              label={t("editor.askDate")}
              hint={t("editor.askDateHint")}
            />
            <CheckOption
              checked={askEmail}
              onChange={setAskEmail}
              label={t("editor.askEmail")}
              hint={t("editor.askEmailHint")}
            />
            <CheckOption
              checked={askMessage}
              onChange={setAskMessage}
              label={t("editor.askMessage")}
              hint={t("editor.askMessageHint")}
            />
          </div>
          <div className="space-y-3 rounded-xl border p-3">
            <Field
              label={t("editor.choiceLabel")}
              hint={t("editor.choiceLabelHint")}
              optional={optional}
            >
              <input
                className={inputClass}
                value={choiceLabel}
                dir="auto"
                maxLength={80}
                placeholder={t("editor.choiceLabelPlaceholder")}
                onChange={(e) => setChoiceLabel(e.target.value)}
              />
            </Field>
            <StringList
              items={choices}
              onChange={setChoices}
              addLabel={t("editor.addChoice")}
              placeholder={t("editor.choicePlaceholder")}
              max={12}
              maxLabel={t("editor.maxChoices")}
            />
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{t("editor.placement")}</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <CheckOption checked={showInNav} onChange={setShowInNav} label={t("editor.inNav")} />
            <CheckOption checked={showOnHome} onChange={setShowOnHome} label={t("editor.onHome")} />
          </div>
          <CheckOption
            checked={live}
            onChange={setLive}
            label={t("editor.live")}
            hint={t("editor.liveHint")}
          />
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t("editor.submitLabel")}
            hint={t("editor.submitLabelHint")}
            optional={optional}
          >
            <input
              className={inputClass}
              value={submitLabel}
              dir="auto"
              maxLength={60}
              onChange={(e) => setSubmitLabel(e.target.value)}
            />
          </Field>
          <Field label={t("editor.success")} hint={t("editor.successHint")} optional={optional}>
            <input
              className={inputClass}
              value={successMessage}
              dir="auto"
              maxLength={1000}
              onChange={(e) => setSuccessMessage(e.target.value)}
            />
          </Field>
        </section>
      </form>
    </Modal>
  );
}
