"use client";

import {
  BadgeCheck,
  Ban,
  BookOpen,
  CircleDollarSign,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Hourglass,
  Mail,
  Phone,
  Receipt,
  RotateCcw,
  SearchX,
  ShoppingBag,
  Undo2,
  Wallet,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Field, inputClass, selectClass, textareaClass } from "@/components/courses/form-bits";
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
import { AlertBanner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  approveCourseOrder,
  cancelCourseOrder,
  fetchCourseOrderReceipt,
  getCourseOrder,
  getCourseSalesSummary,
  listCourseOrders,
  listCourses,
  refundCourseOrder,
  rejectCourseOrder,
  type CourseOrderDetail,
  type CourseOrderReceipt,
  type CourseOrderRow,
  type CourseOrderStatus,
  type CourseRow,
  type CourseSalesSummary,
} from "@/lib/api";
import { exportRowsToExcel, fetchAllRows } from "@/lib/export-excel";
import { formatMoney, formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The client's sales desk (docs/lms/10 §4) — every course order, the receipts waiting on a decision,
 * and the money the catalogue actually made.
 *
 * The screen is built around the one number that demands action: **receipts awaiting review**. It is
 * the default filter, the first stat tile and the reason the page exists — everything else (revenue,
 * per-course sales, the buyer list) is reporting that can wait.
 *
 * Decisions live in a review drawer rather than inline row buttons: approving a payment means looking
 * at a photo of a bank transfer, and a decision that moves money should never be one stray click.
 */

const STATUS_TONE: Record<CourseOrderStatus, PillTone> = {
  PAID: "emerald",
  UNDER_REVIEW: "amber",
  AWAITING_PAYMENT: "blue",
  REJECTED: "rose",
  REFUNDED: "violet",
  CANCELLED: "slate",
};

type Tab = "needs_action" | "all" | "PAID" | "REJECTED" | "REFUNDED";

export function SalesManager() {
  const t = useTranslations("courses");
  const locale = useLocale();
  const { can } = useAuth();
  const canManage = can("course_order.manage");

  const [summary, setSummary] = useState<CourseSalesSummary | null>(null);
  const [rows, setRows] = useState<CourseOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("needs_action");
  const [search, setSearch] = useState("");
  const [courseId, setCourseId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [alert, setAlert] = useState<{ variant: "success" | "error"; message: string } | null>(null);

  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);
  const showAlert = useCallback((variant: "success" | "error", message: string) => {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 3500);
  }, []);

  /** The list query the table and the export share, so a CSV can never disagree with the screen. */
  const query = useMemo(
    () => ({
      search: search.trim() || undefined,
      filter: {
        ...(tab === "needs_action" ? { needs_action: "1" } : {}),
        ...(tab !== "needs_action" && tab !== "all" ? { status: tab } : {}),
        ...(courseId ? { course_id: courseId } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      },
      sort: "-created_at",
    }),
    [search, tab, courseId, from, to],
  );

  useEffect(() => {
    setLoading(true);
    listCourseOrders({ ...query, page, pageSize: 25 })
      .then((r) => {
        setRows(r.rows);
        setTotal(r.total);
      })
      .catch(() => showAlert("error", t("alerts.failed")))
      .finally(() => setLoading(false));
  }, [query, page, refreshToken, showAlert, t]);

  useEffect(() => {
    getCourseSalesSummary()
      .then(setSummary)
      .catch(() => undefined);
  }, [refreshToken]);

  useEffect(() => {
    listCourses({ pageSize: 100 })
      .then((r) => setCourses(r.rows))
      .catch(() => undefined);
  }, []);

  // A filter change invalidates the page number — page 3 of a different result set is nonsense.
  useEffect(() => setPage(1), [query]);

  const currency = summary?.currency ?? "EGP";

  async function exportAll() {
    setExporting(true);
    try {
      const { rows: all, truncated } = await fetchAllRows(listCourseOrders, query);
      await exportRowsToExcel({
        fileName: `course-orders-${new Date().toISOString().slice(0, 10)}`,
        sheetName: t("sales.title"),
        rows: all,
        rightToLeft: locale === "ar",
        columns: [
          { header: t("sales.col.number"), value: (r) => r.order_number, width: 16 },
          { header: t("sales.col.date"), value: (r) => fmtDate(r.created_at, locale) },
          { header: t("sales.col.course"), value: (r) => r.course_title ?? "", width: 34 },
          { header: t("sales.col.buyer"), value: (r) => r.buyer_name ?? "", width: 26 },
          { header: t("sales.col.email"), value: (r) => r.buyer_email ?? "", width: 30 },
          { header: t("sales.col.phone"), value: (r) => r.buyer_phone ?? "" },
          // Excel gets the real number, not a formatted string, so totals can be summed there.
          { header: `${t("sales.col.amount")} (${currency})`, value: (r) => r.price_minor / 100 },
          { header: t("sales.col.method"), value: (r) => (r.payment_method_type ? t(`sales.method.${r.payment_method_type}`) : "") },
          { header: t("sales.col.status"), value: (r) => t(`sales.status.${r.status}`) },
          { header: t("sales.col.confirmedAt"), value: (r) => fmtDate(r.confirmed_at, locale) },
        ],
      });
      if (truncated) showAlert("error", t("sales.exportTruncated"));
    } catch {
      showAlert("error", t("alerts.failed"));
    } finally {
      setExporting(false);
    }
  }

  const s = summary?.stats;
  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="space-y-5">
      <PageHeader
        Icon={ShoppingBag}
        color="emerald"
        title={t("sales.title")}
        subtitle={t("sales.subtitle")}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportAll} disabled={exporting || total === 0}>
              <Download className="size-4" />
              {exporting ? t("sales.exporting") : t("sales.export")}
            </Button>
            <Link
              href="/lms/payments"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <Wallet className="size-3.5" />
              {t("payments.title")}
            </Link>
          </>
        }
      />

      {alert && (
        <AlertBanner variant={alert.variant} message={alert.message} onDismiss={() => setAlert(null)} />
      )}

      {/* The money, then the queue. Pending receipts is first because it is the only tile that asks
          the client to do something. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          Icon={Receipt}
          color="amber"
          label={t("sales.stat.pendingReceipts")}
          value={s?.pending_receipts ?? null}
          hint={t("sales.stat.pendingHint")}
          loading={!summary}
          locale={locale}
        />
        <StatCard
          Icon={CircleDollarSign}
          color="emerald"
          label={t("sales.stat.revenue")}
          value={s ? formatMoney({ amount: s.revenue_minor, currency }, locale) : null}
          hint={
            s
              ? t("sales.stat.thisMonth", {
                  amount: formatMoney({ amount: s.revenue_this_month_minor, currency }, locale),
                })
              : undefined
          }
          loading={!summary}
          locale={locale}
        />
        <StatCard
          Icon={ShoppingBag}
          color="violet"
          label={t("sales.stat.orders")}
          value={s?.orders ?? null}
          hint={s ? t("sales.stat.ordersThisMonth", { count: s.orders_this_month }) : undefined}
          loading={!summary}
          locale={locale}
        />
        <StatCard
          Icon={BadgeCheck}
          color="teal"
          label={t("sales.stat.paid")}
          value={s?.paid ?? null}
          hint={s ? t("sales.stat.rejectedCount", { count: s.rejected }) : undefined}
          loading={!summary}
          locale={locale}
        />
      </div>

      {/* Per-course sales — which course is actually carrying the business. */}
      {summary && summary.by_course.length > 0 && (
        <Panel Icon={BookOpen} color="indigo" title={t("sales.byCourse")} flush>
          <div className="divide-y">
            {summary.by_course.slice(0, 6).map((c) => {
              const top = summary.by_course[0]?.revenue_minor || 1;
              return (
                <div key={c.course_id} className="flex items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.title}</p>
                    <div className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
                        style={{ width: `${Math.max(3, (c.revenue_minor / top) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-end">
                    <p className="text-sm font-bold tabular-nums">
                      {formatMoney({ amount: c.revenue_minor, currency }, locale)}
                    </p>
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {t("sales.soldCount", { count: c.paid })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3.5">
          <SegmentedFilter<Tab>
            value={tab}
            onChange={setTab}
            locale={locale}
            options={[
              { value: "needs_action", label: t("sales.tab.needsAction"), count: s ? s.under_review + s.awaiting_payment : undefined },
              { value: "all", label: t("sales.tab.all"), count: s?.orders },
              { value: "PAID", label: t("sales.status.PAID"), count: s?.paid },
              { value: "REJECTED", label: t("sales.status.REJECTED"), count: s?.rejected },
              { value: "REFUNDED", label: t("sales.status.REFUNDED"), count: s?.refunded },
            ]}
          />
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t("sales.searchPlaceholder")}
            className="min-w-56 flex-1"
          />
        </div>

        <div className="flex flex-wrap items-end gap-3 border-b px-5 py-3">
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-semibold">
            <Filter className="size-3.5" />
            {t("sales.filters")}
          </span>
          <select
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            className={cn(selectClass, "h-8 w-auto min-w-44 text-xs")}
          >
            <option value="">{t("sales.allCourses")}</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label={t("sales.from")}
            className={cn(inputClass, "h-8 w-auto text-xs")}
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label={t("sales.to")}
            className={cn(inputClass, "h-8 w-auto text-xs")}
          />
          {(courseId || from || to) && (
            <button
              type="button"
              onClick={() => {
                setCourseId("");
                setFrom("");
                setTo("");
              }}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium"
            >
              <X className="size-3.5" />
              {t("sales.clearFilters")}
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={tableHeadClass}>
              <tr>
                <th className={thClass}>{t("sales.col.buyer")}</th>
                <th className={thClass}>{t("sales.col.course")}</th>
                <th className={thClass}>{t("sales.col.amount")}</th>
                <th className={thClass}>{t("sales.col.method")}</th>
                <th className={thClass}>{t("sales.col.status")}</th>
                <th className={thClass}>{t("sales.col.date")}</th>
                <th className={cn(thClass, "text-end")}>{t("sales.col.actions")}</th>
              </tr>
            </thead>
            {loading ? (
              <TableSkeleton cols={7} />
            ) : rows.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      Icon={search || courseId || from || to ? SearchX : ShoppingBag}
                      color="emerald"
                      title={search ? t("sales.emptySearch") : t("sales.empty")}
                      description={search ? undefined : t("sales.emptyHint")}
                    />
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className={trClass}>
                    <td className={tdClass}>
                      <div className="flex items-center gap-2.5">
                        <InitialsAvatar name={r.buyer_name || r.buyer_email || "?"} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.buyer_name || "—"}</p>
                          <p className="text-muted-foreground truncate font-mono text-xs">
                            {r.order_number}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className={cn(tdClass, "max-w-56 truncate")}>{r.course_title ?? "—"}</td>
                    <td className={cn(tdClass, "font-semibold tabular-nums whitespace-nowrap")}>
                      {formatMoney({ amount: r.price_minor, currency: r.currency }, locale)}
                    </td>
                    <td className={cn(tdClass, "text-muted-foreground text-xs whitespace-nowrap")}>
                      {r.payment_method_type ? t(`sales.method.${r.payment_method_type}`) : "—"}
                    </td>
                    <td className={tdClass}>
                      <StatusPill tone={STATUS_TONE[r.status]}>{t(`sales.status.${r.status}`)}</StatusPill>
                    </td>
                    <td className={cn(tdClass, "text-muted-foreground text-xs whitespace-nowrap")}>
                      {fmtDate(r.created_at, locale)}
                    </td>
                    <td className={cn(tdClass, "text-end")}>
                      <Button variant="outline" size="sm" onClick={() => setOpenId(r.id)}>
                        {r.receipt_count ? (
                          <>
                            <Receipt className="size-3.5" />
                            {t("sales.review")}
                          </>
                        ) : (
                          t("sales.open")
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
            <p className="text-muted-foreground text-xs">
              {t("sales.pageOf", { page, pages, total: formatNumber(total, locale) })}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t("sales.prev")}
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                {t("sales.next")}
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {openId && (
        <OrderDrawer
          orderId={openId}
          canManage={canManage}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            refresh();
            setOpenId(null);
          }}
          onError={() => showAlert("error", t("alerts.failed"))}
        />
      )}
    </div>
  );
}

/* ─── The review drawer ─────────────────────────────────────────────────────── */

/**
 * One order, its buyer, and the receipt image at a size a human can actually read a reference number
 * off. Rejection demands a typed reason — the learner is shown it verbatim, so "no reason given" is
 * not an option the UI offers.
 */
function OrderDrawer({
  orderId,
  canManage,
  onClose,
  onChanged,
  onError,
}: {
  orderId: string;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
  onError: () => void;
}) {
  const t = useTranslations("courses");
  const locale = useLocale();

  const [order, setOrder] = useState<CourseOrderDetail | null>(null);
  const [receipts, setReceipts] = useState<CourseOrderReceipt[]>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"view" | "reject" | "refund">("view");
  const [reason, setReason] = useState("");
  const [keepAccess, setKeepAccess] = useState(false);

  useEffect(() => {
    getCourseOrder(orderId)
      .then((r) => {
        setOrder(r.order);
        setReceipts(r.receipts);
      })
      .catch(onError);
  }, [orderId, onError]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch {
      onError();
    } finally {
      setBusy(false);
    }
  }

  const latest = receipts[0];
  const open = order ? ["AWAITING_PAYMENT", "UNDER_REVIEW"].includes(order.status) : false;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={order ? `${t("sales.orderTitle")} ${order.order_number}` : t("sales.orderTitle")}
      description={order?.course_title ?? undefined}
      footer={
        order && canManage ? (
          <div className="flex flex-wrap justify-end gap-2">
            {mode === "view" && (
              <>
                {open && (
                  <Button variant="outline" onClick={() => run(() => cancelCourseOrder(order.id))} disabled={busy}>
                    <Ban className="size-4" />
                    {t("sales.cancel")}
                  </Button>
                )}
                {open && (
                  <Button variant="destructive" onClick={() => setMode("reject")} disabled={busy}>
                    <X className="size-4" />
                    {t("sales.reject")}
                  </Button>
                )}
                {order.status === "PAID" && (
                  <Button variant="outline" onClick={() => setMode("refund")} disabled={busy}>
                    <Undo2 className="size-4" />
                    {t("sales.refund")}
                  </Button>
                )}
                {open && (
                  <Button onClick={() => run(() => approveCourseOrder(order.id))} disabled={busy}>
                    <BadgeCheck className="size-4" />
                    {t("sales.approve")}
                  </Button>
                )}
              </>
            )}
            {mode === "reject" && (
              <>
                <Button variant="outline" onClick={() => setMode("view")} disabled={busy}>
                  {t("sales.back")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => run(() => rejectCourseOrder(order.id, reason.trim()))}
                >
                  {t("sales.confirmReject")}
                </Button>
              </>
            )}
            {mode === "refund" && (
              <>
                <Button variant="outline" onClick={() => setMode("view")} disabled={busy}>
                  {t("sales.back")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      refundCourseOrder(order.id, {
                        reason: reason.trim() || null,
                        keep_access: keepAccess,
                      }),
                    )
                  }
                >
                  <RotateCcw className="size-4" />
                  {t("sales.confirmRefund")}
                </Button>
              </>
            )}
          </div>
        ) : undefined
      }
    >
      {!order ? (
        <div className="space-y-3 py-6">
          <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
          <div className="bg-muted h-32 animate-pulse rounded-xl" />
        </div>
      ) : mode !== "view" ? (
        <div className="space-y-4">
          <AlertBanner
            variant={mode === "reject" ? "error" : "info"}
            message={mode === "reject" ? t("sales.rejectWarning") : t("sales.refundWarning")}
          />
          <Field
            label={mode === "reject" ? t("sales.rejectReason") : t("sales.refundReason")}
            hint={mode === "reject" ? t("sales.rejectReasonHint") : undefined}
          >
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={textareaClass}
              placeholder={mode === "reject" ? t("sales.rejectReasonPlaceholder") : ""}
            />
          </Field>
          {mode === "refund" && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3">
              <input
                type="checkbox"
                checked={keepAccess}
                onChange={(e) => setKeepAccess(e.target.checked)}
                className="accent-primary mt-0.5 size-4"
              />
              <span>
                <span className="block text-sm font-medium">{t("sales.keepAccess")}</span>
                <span className="text-muted-foreground block text-xs">{t("sales.keepAccessHint")}</span>
              </span>
            </label>
          )}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={STATUS_TONE[order.status]}>{t(`sales.status.${order.status}`)}</StatusPill>
              <span className="text-lg font-bold tabular-nums">
                {formatMoney({ amount: order.price_minor, currency: order.currency }, locale)}
              </span>
            </div>

            <div className="bg-muted/40 space-y-2 rounded-xl p-3.5 text-sm">
              <div className="flex items-center gap-2">
                <InitialsAvatar name={order.learner.full_name || "?"} />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{order.learner.full_name}</p>
                  <p className="text-muted-foreground text-xs">
                    {t("sales.learnerSince", { date: fmtDate(order.learner.since, locale) })}
                  </p>
                </div>
              </div>
              {order.learner.email && (
                <p className="text-muted-foreground flex items-center gap-2 text-xs">
                  <Mail className="size-3.5 shrink-0" />
                  <span className="truncate">{order.learner.email}</span>
                </p>
              )}
              {order.learner.phone && (
                <p className="text-muted-foreground flex items-center gap-2 text-xs">
                  <Phone className="size-3.5 shrink-0" />
                  <span dir="ltr">{order.learner.phone}</span>
                </p>
              )}
            </div>

            <dl className="space-y-2 text-sm">
              <Row label={t("sales.col.course")} value={order.course_title ?? "—"} />
              <Row
                label={t("sales.col.method")}
                value={order.payment_method_type ? t(`sales.method.${order.payment_method_type}`) : "—"}
              />
              <Row label={t("sales.placedAt")} value={fmtDateTime(order.created_at, locale)} />
              {order.submitted_at && (
                <Row label={t("sales.submittedAt")} value={fmtDateTime(order.submitted_at, locale)} />
              )}
              {order.confirmed_at && (
                <Row label={t("sales.confirmedAt")} value={fmtDateTime(order.confirmed_at, locale)} />
              )}
              <Row
                label={t("sales.termsAccepted")}
                value={order.terms_accepted_at ? fmtDateTime(order.terms_accepted_at, locale) : "—"}
              />
              <Row
                label={t("sales.access")}
                value={
                  order.enrollment?.status === "ACTIVE"
                    ? t("sales.accessActive")
                    : order.enrollment
                      ? t("sales.accessRevoked")
                      : t("sales.accessNone")
                }
              />
            </dl>

            {order.rejection_reason && (
              <AlertBanner variant="error" message={`${t("sales.rejectedFor")}: ${order.rejection_reason}`} />
            )}
            {order.refund_reason && (
              <AlertBanner variant="info" message={`${t("sales.refundedFor")}: ${order.refund_reason}`} />
            )}
          </div>

          <div className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <Receipt className="size-4" />
              {t("sales.receipts")}
            </h3>
            {receipts.length === 0 ? (
              <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
                <Hourglass className="mx-auto mb-2 size-6 opacity-50" />
                {t("sales.noReceipt")}
              </div>
            ) : (
              receipts.map((r) => (
                <ReceiptCard
                  key={r.id}
                  orderId={order.id}
                  receipt={r}
                  currency={order.currency}
                  highlight={r.id === latest?.id}
                  locale={locale}
                />
              ))
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
      <dd className="min-w-0 truncate text-end text-sm font-medium">{value}</dd>
    </div>
  );
}

/** One uploaded proof. The file is private, so it is fetched as a blob and revoked on unmount. */
function ReceiptCard({
  orderId,
  receipt,
  currency,
  highlight,
  locale,
}: {
  orderId: string;
  receipt: CourseOrderReceipt;
  currency: string;
  highlight: boolean;
  locale: string;
}) {
  const t = useTranslations("courses");
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked: string | null = null;
    fetchCourseOrderReceipt(orderId, receipt.id)
      .then((u) => {
        revoked = u;
        setUrl(u);
      })
      .catch(() => setFailed(true));
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [orderId, receipt.id]);

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border p-3",
        highlight ? "border-primary/40 bg-primary/5" : "bg-muted/30",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <StatusPill
          tone={
            receipt.review_status === "APPROVED"
              ? "emerald"
              : receipt.review_status === "REJECTED"
                ? "rose"
                : "amber"
          }
        >
          {t(`sales.receiptStatus.${receipt.review_status}`)}
        </StatusPill>
        <span className="text-muted-foreground text-xs">{fmtDateTime(receipt.created_at, locale)}</span>
      </div>

      {failed ? (
        <p className="text-muted-foreground py-4 text-center text-xs">{t("sales.receiptUnavailable")}</p>
      ) : !url ? (
        <div className="bg-muted h-40 animate-pulse rounded-lg" />
      ) : receipt.is_pdf ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-primary flex items-center justify-center gap-2 rounded-lg border border-dashed py-6 text-sm font-medium"
        >
          <FileText className="size-4" />
          {t("sales.openPdf")}
          <ExternalLink className="size-3.5" />
        </a>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={t("sales.receiptAlt")}
            className="max-h-72 w-full rounded-lg object-contain"
          />
        </a>
      )}

      <dl className="space-y-1 text-xs">
        {receipt.sender_name && <Row label={t("sales.senderName")} value={receipt.sender_name} />}
        {receipt.sender_reference && (
          <Row label={t("sales.senderReference")} value={receipt.sender_reference} />
        )}
        {receipt.amount_minor != null && (
          <Row
            label={t("sales.statedAmount")}
            value={formatMoney({ amount: receipt.amount_minor, currency }, locale)}
          />
        )}
        {receipt.paid_at && <Row label={t("sales.paidAt")} value={fmtDate(receipt.paid_at, locale)} />}
        {receipt.note && <Row label={t("sales.note")} value={receipt.note} />}
      </dl>
    </div>
  );
}

/* ─── date helpers ──────────────────────────────────────────────────────────── */

function fmtDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
