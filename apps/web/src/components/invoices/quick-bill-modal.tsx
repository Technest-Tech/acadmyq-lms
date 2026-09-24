"use client";

import { CheckCircle2, ExternalLink, Link2, Loader2, MessageSquare, Send } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { CopyButton, waLink } from "@/components/invoices/invoice-detail-modal";
import { AlertBanner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  createQuickBill,
  getAcademyProfile,
  listStudents,
  sendInvoicePaymentLink,
  type InvoiceSendLinkResult,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type PayerMode = "student" | "name";

/** Common currencies offered in the form (ISO 4217). The student's own currency is added if missing. */
const CURRENCIES = ["EGP", "SAR", "AED", "USD", "EUR", "GBP", "JOD", "KWD", "QAR", "BHD", "OMR", "TRY"];

/** Major-unit string → integer minor units (2-decimal currencies, like money.ts). */
function toMinor(major: string): number {
  const n = parseFloat(major);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const inputClass =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";
const labelClass = "mb-1 block text-sm font-medium";

export interface QuickBillModalProps {
  open: boolean;
  onClose: () => void;
  /** Fires once the bill exists — the list behind the modal can refresh. */
  onCreated: (invoiceId: string) => void;
  /** Open the full bill (detail modal) from the success step. */
  onView: (invoiceId: string) => void;
}

/**
 * The basic custom bill: pick a student OR type a name, then amount + currency + description, and
 * get the payment link straight away (on the academy's own address). The bill is an OPEN manual
 * invoice for the current month, so it is payable the moment the link is shared.
 */
export function QuickBillModal({ open, onClose, onCreated, onView }: QuickBillModalProps) {
  const t = useTranslations("invoices.quick");
  const tInv = useTranslations("invoices");
  const locale = useLocale();

  const [mode, setMode] = useState<PayerMode>("student");
  const [students, setStudents] = useState<ComboboxOption[]>([]);
  const [studentCurrency, setStudentCurrency] = useState<Record<string, string>>({});
  const [defaultCurrency, setDefaultCurrency] = useState("EGP");

  const [studentId, setStudentId] = useState("");
  const [payerName, setPayerName] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EGP");
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; url: string; totalMinor: number; currency: string } | null>(null);

  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<InvoiceSendLinkResult | null>(null);

  // Students + the academy's default currency, once per open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void listStudents({ pageSize: 200 })
      .then((res) => {
        if (cancelled) return;
        setStudents(
          res.rows.map((s) => ({ value: s.id, label: s.full_name, sublabel: s.price_currency ?? undefined })),
        );
        setStudentCurrency(Object.fromEntries(res.rows.map((s) => [s.id, s.price_currency ?? ""])));
      })
      .catch(() => {});

    void getAcademyProfile()
      .then((res) => {
        if (cancelled || !res.academy.default_currency) return;
        setDefaultCurrency(res.academy.default_currency);
        setCurrency((c) => (c === "EGP" ? res.academy.default_currency : c));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Picking a student pre-fills their billing currency; it stays editable.
  useEffect(() => {
    const c = studentCurrency[studentId];
    if (studentId && c) setCurrency(c);
  }, [studentId, studentCurrency]);

  const reset = useCallback(() => {
    setMode("student");
    setStudentId("");
    setPayerName("");
    setAmount("");
    setCurrency(defaultCurrency);
    setDescription("");
    setError(null);
    setCreated(null);
    setSendResult(null);
  }, [defaultCurrency]);

  const handleClose = useCallback(() => {
    if (submitting || sending) return;
    reset();
    onClose();
  }, [submitting, sending, reset, onClose]);

  const amountMinor = toMinor(amount);
  const payerOk = mode === "student" ? studentId !== "" : payerName.trim().length > 0;
  const canSubmit = payerOk && amountMinor > 0 && currency !== "" && description.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      setError(t("validation"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const base = { amount_minor: amountMinor, currency, description: description.trim() };
      const res = await createQuickBill(
        mode === "student" ? { ...base, student_id: studentId } : { ...base, payer_name: payerName.trim() },
      );
      setCreated({ id: res.id, url: res.url, totalMinor: amountMinor, currency });
      onCreated(res.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSend() {
    if (!created) return;
    setSending(true);
    setError(null);
    try {
      setSendResult(await sendInvoicePaymentLink(created.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const currencyOptions = currency && !CURRENCIES.includes(currency) ? [currency, ...CURRENCIES] : CURRENCIES;

  // ── Step 2: the link ────────────────────────────────────────────────────────
  if (created) {
    return (
      <Modal
        open={open}
        onClose={handleClose}
        title={t("doneTitle")}
        description={t("doneSubtitle")}
        footer={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => { const id = created.id; reset(); onView(id); }}>
              {t("viewBill")}
            </Button>
            <Button type="button" size="sm" onClick={handleClose}>
              {t("done")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <CheckCircle2 className="size-6 shrink-0 text-emerald-600" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("created")}</p>
              <p className="text-lg font-bold tabular-nums">
                {formatMoney({ amount: created.totalMinor, currency: created.currency }, locale)}
              </p>
            </div>
          </div>

          <div>
            <label className={labelClass}>{t("link")}</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="bg-muted/40 flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-2">
                <Link2 className="text-muted-foreground size-4 shrink-0" aria-hidden />
                <span className="truncate font-mono text-xs" dir="ltr" data-testid="quick-bill-link">
                  {created.url}
                </span>
              </div>
              <div className="flex gap-2">
                <CopyButton value={created.url} label={tInv("copyLink")} copiedLabel={tInv("copied")} />
                <a
                  href={created.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  aria-label={t("openLink")}
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </div>
            </div>
          </div>

          {sendResult === null ? (
            <Button type="button" variant="outline" className="w-full" onClick={() => void handleSend()} disabled={sending}>
              {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
              {t("sendWhatsApp")}
            </Button>
          ) : sendResult.sent ? (
            <p className="text-sm font-medium text-emerald-600">{t("sent")}</p>
          ) : (
            // No connected WhatsApp (or no number on file): hand over the message to send by hand.
            <div className="bg-muted/30 space-y-2 rounded-xl border p-3">
              <pre className="bg-card/60 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border p-2.5 text-xs leading-relaxed">
                {sendResult.message}
              </pre>
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton value={sendResult.message} label={tInv("copyMessage")} copiedLabel={tInv("copied")} />
                <a
                  href={
                    sendResult.phone
                      ? waLink(sendResult.phone, sendResult.message)
                      : `https://wa.me/?text=${encodeURIComponent(sendResult.message)}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants({ size: "sm" }))}
                >
                  <MessageSquare className="size-3.5" aria-hidden />
                  {tInv("openInWhatsApp")}
                </a>
              </div>
            </div>
          )}

          {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
        </div>
      </Modal>
    );
  }

  // ── Step 1: the form ────────────────────────────────────────────────────────
  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t("title")}
      description={t("subtitle")}
      footer={
        <>
          <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={submitting}>
            {tInv("cancel")}
          </Button>
          <Button type="submit" form="quick-bill-form" size="sm" disabled={submitting || !canSubmit}>
            {submitting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
            {submitting ? tInv("saving") : t("create")}
          </Button>
        </>
      }
    >
      <form id="quick-bill-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
        {/* Who pays: a listed student, or a name typed by hand */}
        <div>
          <label className={labelClass}>{t("payer")}</label>
          <div role="tablist" aria-label={t("payer")} className="mb-2 flex gap-1 rounded-xl border bg-muted/40 p-1">
            {(["student", "name"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                data-testid={`quick-mode-${m}`}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={cn(
                  "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                  mode === m
                    ? "bg-card text-foreground shadow-sm ring-1 ring-black/5"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`mode_${m}`)}
              </button>
            ))}
          </div>
          {mode === "student" ? (
            <Combobox
              options={students}
              value={studentId}
              onChange={setStudentId}
              placeholder={t("studentSelect")}
              searchPlaceholder={t("studentSearch")}
              disabled={submitting}
              data-testid="quick-student"
            />
          ) : (
            <input
              type="text"
              value={payerName}
              onChange={(e) => setPayerName(e.target.value)}
              placeholder={t("namePlaceholder")}
              maxLength={120}
              disabled={submitting}
              className={inputClass}
              data-testid="quick-name"
            />
          )}
        </div>

        {/* Amount + currency */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className={labelClass}>{t("amount")}</label>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              disabled={submitting}
              className={cn(inputClass, "tabular-nums")}
              data-testid="quick-amount"
            />
          </div>
          <div>
            <label className={labelClass}>{tInv("currency")}</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={submitting}
              className={inputClass}
              data-testid="quick-currency"
            >
              {currencyOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass}>{tInv("liDescription")}</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("descriptionPlaceholder")}
            maxLength={500}
            disabled={submitting}
            className={inputClass}
            data-testid="quick-description"
          />
        </div>

        {amountMinor > 0 && (
          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-sm font-medium">{tInv("total")}</span>
            <span className="text-lg font-bold tabular-nums">
              {formatMoney({ amount: amountMinor, currency: currency || defaultCurrency }, locale)}
            </span>
          </div>
        )}

        {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      </form>
    </Modal>
  );
}
