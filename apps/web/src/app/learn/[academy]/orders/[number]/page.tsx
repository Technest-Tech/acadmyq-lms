"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  FileUp,
  Hourglass,
  Loader2,
  PlayCircle,
  Receipt,
  Upload,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { useLearn, useLearnHref } from "@/components/learn/context";
import { Container, CtaButton } from "@/components/learn/sections";
import {
  learnCancelOrder,
  learnChooseMethod,
  learnOrder,
  learnUploadReceipt,
  type LearnCheckout,
  type LearnOrder,
  type LearnOrderReceipt,
  type LearnPaymentMethod,
} from "@/lib/learn-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { OrderStatusPill } from "../status-pill";

/**
 * One order's status page (docs/lms/10 §3) — «طلبك قيد المراجعة», and the four other things it can
 * be. This is the screen the buyer bookmarks: it holds the order number, the account to pay, the
 * upload box, and — when the client refuses a receipt — the reason, in the client's own words, with
 * the upload box still open so a corrected receipt is one step away.
 *
 * The status drives everything. There is no separate "success page" and "failure page": an order has
 * a state, and this page renders it.
 */
export default function OrderPage() {
  const t = useTranslations("learn");
  const locale = useLocale();
  const href = useLearnHref();
  const { academy, learner, loading: authLoading, openAuth, refresh } = useLearn();
  const params = useParams<{ number: string }>();
  const number = params.number;

  const [order, setOrder] = useState<LearnOrder | null>(null);
  const [course, setCourse] = useState<LearnCheckout["course"] | null>(null);
  const [receipts, setReceipts] = useState<LearnOrderReceipt[]>([]);
  const [methods, setMethods] = useState<LearnPaymentMethod[]>([]);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!authLoading && learner === null) openAuth("login");
  }, [authLoading, learner, openAuth]);

  useEffect(() => {
    if (learner === null) return;
    learnOrder(academy, number)
      .then((r) => {
        setOrder(r.order);
        setCourse(r.course);
        setReceipts(r.receipts);
        setMethods(r.payment_methods);
      })
      .catch(() => setMissing(true));
  }, [academy, number, learner, reloadToken]);

  // An approval creates the enrollment, so /me has to be re-read for the player link to work.
  useEffect(() => {
    if (order?.status === "PAID") void refresh();
  }, [order?.status, refresh]);

  if (missing) {
    return (
      <Container className="py-24 text-center">
        <p className="text-muted-foreground text-sm">{t("orders.notFound")}</p>
        <CtaButton variant="outline" className="mt-6" href={href("/orders")}>
          {t("orders.title")}
        </CtaButton>
      </Container>
    );
  }

  if (!order || learner === null) {
    return (
      <Container className="py-24 text-center">
        <Loader2 className="text-muted-foreground mx-auto size-6 animate-spin" />
      </Container>
    );
  }

  const canUpload = ["AWAITING_PAYMENT", "UNDER_REVIEW", "REJECTED"].includes(order.status);
  const banner = BANNERS[order.status];

  async function cancel() {
    setBusy(true);
    try {
      await learnCancelOrder(academy, number);
      setReloadToken((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("orders.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container className="py-10 sm:py-14">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* The headline state — an icon, a sentence, and what happens next. */}
        <div
          className={cn(
            "flex items-start gap-4 rounded-2xl border p-5",
            banner.wrap,
          )}
        >
          <banner.Icon className={cn("mt-0.5 size-6 shrink-0", banner.icon)} aria-hidden />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold">{t(`orders.headline.${order.status}`)}</h1>
            <p className="mt-1 text-sm leading-relaxed opacity-90">
              {t(`orders.explain.${order.status}`)}
            </p>
            {order.status === "REJECTED" && order.rejection_reason && (
              <p className="bg-background/60 mt-3 rounded-lg p-3 text-sm font-medium">
                {order.rejection_reason}
              </p>
            )}
            {order.status === "REFUNDED" && order.refund_reason && (
              <p className="bg-background/60 mt-3 rounded-lg p-3 text-sm">{order.refund_reason}</p>
            )}
          </div>
        </div>

        {order.status === "PAID" && course && (
          <CtaButton href={href(`/watch/${course.slug}`)} className="w-full sm:w-auto">
            <PlayCircle className="size-4" aria-hidden />
            {t("course.continue")}
          </CtaButton>
        )}

        {/* Order facts */}
        <div className="bg-card space-y-3 rounded-2xl border p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-muted-foreground text-xs">{t("orders.number")}</p>
              <p className="font-mono text-lg font-bold">{order.order_number}</p>
            </div>
            <OrderStatusPill status={order.status} />
          </div>
          <dl className="grid gap-2 border-t pt-3 text-sm sm:grid-cols-2">
            <Fact label={t("orders.course")} value={order.course_title ?? course?.title ?? "—"} />
            <Fact
              label={t("orders.amount")}
              value={formatMoney({ amount: order.price_minor, currency: order.currency }, locale)}
            />
            <Fact label={t("orders.placed")} value={fmt(order.created_at, locale)} />
            {order.confirmed_at && (
              <Fact label={t("orders.confirmed")} value={fmt(order.confirmed_at, locale)} />
            )}
          </dl>
        </div>

        {canUpload && (
          <ReceiptForm
            academy={academy}
            number={number}
            methods={methods}
            selectedMethodId={order.payment_method_id}
            onMethodChange={async (id) => {
              await learnChooseMethod(academy, number, id);
              setReloadToken((n) => n + 1);
            }}
            onUploaded={() => setReloadToken((n) => n + 1)}
          />
        )}

        {receipts.length > 0 && (
          <div className="bg-card space-y-3 rounded-2xl border p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <Receipt className="size-4" aria-hidden />
              {t("orders.yourReceipts")}
            </h2>
            <ul className="space-y-2">
              {receipts.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                >
                  <span className="text-muted-foreground text-xs">{fmt(r.created_at, locale)}</span>
                  <span className="flex items-center gap-2">
                    {r.sender_reference && (
                      <span className="text-muted-foreground font-mono text-xs">
                        {r.sender_reference}
                      </span>
                    )}
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-semibold",
                        r.review_status === "APPROVED"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                          : r.review_status === "REJECTED"
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
                      )}
                    >
                      {t(`orders.receiptStatus.${r.review_status}`)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Link href={href("/orders")} className="text-muted-foreground text-sm hover:underline">
            {t("orders.allOrders")}
          </Link>
          {["AWAITING_PAYMENT", "UNDER_REVIEW"].includes(order.status) && (
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="text-muted-foreground hover:text-destructive text-sm underline disabled:opacity-50"
            >
              {t("orders.cancel")}
            </button>
          )}
        </div>
      </div>
    </Container>
  );
}

const BANNERS: Record<
  LearnOrder["status"],
  { Icon: typeof Clock; wrap: string; icon: string }
> = {
  AWAITING_PAYMENT: {
    Icon: Clock,
    wrap: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-100",
    icon: "text-blue-600 dark:text-blue-400",
  },
  UNDER_REVIEW: {
    Icon: Hourglass,
    wrap: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100",
    icon: "text-amber-600 dark:text-amber-400",
  },
  PAID: {
    Icon: CheckCircle2,
    wrap: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100",
    icon: "text-emerald-600 dark:text-emerald-400",
  },
  REJECTED: {
    Icon: AlertTriangle,
    wrap: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100",
    icon: "text-rose-600 dark:text-rose-400",
  },
  CANCELLED: {
    Icon: XCircle,
    wrap: "bg-muted/50 text-foreground",
    icon: "text-muted-foreground",
  },
  REFUNDED: {
    Icon: Copy,
    wrap: "border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-100",
    icon: "text-violet-600 dark:text-violet-400",
  },
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/**
 * The upload box. Only the file is required — a buyer standing in a bank queue should not have to
 * fill a form to prove they paid; the reference and amount help the reviewer and are optional.
 */
function ReceiptForm({
  academy,
  number,
  methods,
  selectedMethodId,
  onMethodChange,
  onUploaded,
}: {
  academy: string;
  number: string;
  methods: LearnPaymentMethod[];
  selectedMethodId: string | null;
  onMethodChange: (id: string) => Promise<void>;
  onUploaded: () => void;
}) {
  const t = useTranslations("learn");
  const [file, setFile] = useState<File | null>(null);
  const [senderName, setSenderName] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const method = methods.find((m) => m.id === selectedMethodId) ?? methods[0] ?? null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await learnUploadReceipt(academy, number, {
        receipt: file,
        payment_method_id: method?.id ?? null,
        sender_name: senderName.trim() || undefined,
        sender_reference: reference.trim() || undefined,
      });
      setFile(null);
      setSenderName("");
      setReference("");
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("orders.uploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="bg-card space-y-4 rounded-2xl border p-5">
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <FileUp className="size-4" aria-hidden />
        {t("orders.uploadTitle")}
      </h2>

      {method && (
        <div className="bg-muted/50 space-y-2 rounded-xl p-4">
          <p className="text-muted-foreground text-xs">{t("orders.payTo")}</p>
          <p className="font-semibold">{method.label || t(`checkout.method.${method.type}`)}</p>
          {method.account_number && (
            <p dir="ltr" className="font-mono text-lg font-bold">
              {method.account_number}
            </p>
          )}
          {method.account_name && (
            <p className="text-muted-foreground text-xs">{method.account_name}</p>
          )}
          {method.instructions && (
            <p className="text-muted-foreground text-xs whitespace-pre-line">
              {method.instructions}
            </p>
          )}
          {methods.length > 1 && (
            <select
              value={method.id}
              onChange={(e) => void onMethodChange(e.target.value)}
              className="border-input bg-background mt-2 h-9 w-full rounded-lg border px-2 text-sm"
            >
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label || t(`checkout.method.${m.type}`)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <label className="hover:border-primary/50 flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center transition-colors">
        <Upload className="text-muted-foreground size-6" aria-hidden />
        <span className="text-sm font-medium">
          {file ? file.name : t("orders.chooseFile")}
        </span>
        <span className="text-muted-foreground text-xs">{t("orders.fileHint")}</span>
        <input
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-sm font-medium">{t("orders.senderName")}</span>
          <input
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            className="border-input bg-background h-10 w-full rounded-lg border px-3 text-sm"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">{t("orders.reference")}</span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            dir="ltr"
            className="border-input bg-background h-10 w-full rounded-lg border px-3 text-sm"
          />
        </label>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {/* A real submit button, not a CtaButton: this lives inside a <form>, and Enter in the
          reference field should send it exactly as the click does. */}
      <button
        type="submit"
        disabled={!file || busy}
        className="bg-primary text-primary-foreground inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold shadow-lg transition-all hover:scale-[1.02] active:scale-100 disabled:pointer-events-none disabled:opacity-60 sm:w-auto"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Upload className="size-4" aria-hidden />
        )}
        {t("orders.submitReceipt")}
      </button>
    </form>
  );
}

function fmt(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
