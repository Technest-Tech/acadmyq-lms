"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  createAdvanceInvoice,
  createManualInvoice,
  getAdvanceQuote,
  listGuardians,
  listStudents,
  type AdvanceQuote,
  type ManualLineInput,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";

// ── Types + small helpers ────────────────────────────────────────────────────

type Mode = "itemized" | "advance";
type PayerType = "guardian" | "student";

/** A draft line row. `amount` is the raw major-unit string the operator typed. */
interface LineRow {
  description: string;
  amount: string;
}

/** Major-unit string → integer minor units (assumes 2-decimal currencies, like money.ts). */
function toMinor(major: string): number {
  const n = parseFloat(major);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** A Date → local `YYYY-MM-DD` (avoids the UTC shift of toISOString). */
function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

const NOW = new Date();
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const YEARS = Array.from({ length: 4 }, (_, i) => NOW.getFullYear() - 1 + i);

/** Common currencies offered in the manual-bill form (ISO 4217). */
const CURRENCIES = [
  "EGP",
  "SAR",
  "AED",
  "USD",
  "EUR",
  "GBP",
  "JOD",
  "KWD",
  "QAR",
  "BHD",
  "OMR",
  "TRY",
];

// ── Component ────────────────────────────────────────────────────────────────

export interface ManualBillModalProps {
  open: boolean;
  onClose: () => void;
  /** Fires with the new invoice id after a successful create. */
  onCreated: (invoiceId: string) => void;
}

/**
 * Create a manual bill (Sprint 9). Two modes:
 *   - Itemized: pick a guardian/student payer + free-form line items.
 *   - Advance:  pick a student + start date → server quotes the remaining still-billable
 *               sessions this month × their hourly/subscription price.
 * Both create an OPEN MANUAL draft that then follows the normal close → send → pay flow.
 */
export function ManualBillModal({
  open,
  onClose,
  onCreated,
}: ManualBillModalProps) {
  const t = useTranslations("invoices");
  const locale = useLocale();

  const [mode, setMode] = useState<Mode>("itemized");

  // Payer option lists (loaded once per open).
  const [guardians, setGuardians] = useState<ComboboxOption[]>([]);
  const [students, setStudents] = useState<ComboboxOption[]>([]);
  const [guardianCurrency, setGuardianCurrency] = useState<
    Record<string, string>
  >({});
  const [studentCurrency, setStudentCurrency] = useState<
    Record<string, string>
  >({});

  // Itemized state.
  const [payerType, setPayerType] = useState<PayerType>("guardian");
  const [payerId, setPayerId] = useState("");
  const [year, setYear] = useState(NOW.getFullYear());
  const [month, setMonth] = useState(NOW.getMonth() + 1);
  const [currency, setCurrency] = useState("");
  const [lines, setLines] = useState<LineRow[]>([
    { description: "", amount: "" },
  ]);

  // Advance state.
  const [advStudentId, setAdvStudentId] = useState("");
  const [advStartDate, setAdvStartDate] = useState(toISODate(NOW));
  const [quote, setQuote] = useState<AdvanceQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load payers when the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void listGuardians({ pageSize: 200 })
      .then((res) => {
        if (cancelled) return;
        setGuardians(
          res.rows.map((g) => ({
            value: g.id,
            label: g.full_name,
            sublabel: g.currency,
          })),
        );
        setGuardianCurrency(
          Object.fromEntries(res.rows.map((g) => [g.id, g.currency])),
        );
      })
      .catch(() => {});

    void listStudents({ pageSize: 200 })
      .then((res) => {
        if (cancelled) return;
        setStudents(
          res.rows.map((s) => ({
            value: s.id,
            label: s.full_name,
            sublabel: s.price_currency ?? undefined,
          })),
        );
        setStudentCurrency(
          Object.fromEntries(
            res.rows.map((s) => [s.id, s.price_currency ?? ""]),
          ),
        );
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Debounced advance quote whenever the student / start date change.
  useEffect(() => {
    if (!open || mode !== "advance" || !advStudentId || !advStartDate) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);
    const handle = setTimeout(() => {
      getAdvanceQuote(advStudentId, advStartDate)
        .then((q) => {
          if (!cancelled) setQuote(q);
        })
        .catch((err) => {
          if (!cancelled)
            setQuoteError(err instanceof ApiError ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setQuoteLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, mode, advStudentId, advStartDate]);

  const payerOptions = payerType === "guardian" ? guardians : students;

  // Currency is operator-selectable but auto-fills from the chosen payer.
  const payerCurrency =
    payerType === "guardian"
      ? (guardianCurrency[payerId] ?? "")
      : (studentCurrency[payerId] ?? "");

  useEffect(() => {
    if (payerCurrency) setCurrency(payerCurrency);
  }, [payerCurrency]);

  // Localized month names for the period dropdown.
  const monthOptions = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { month: "long" });
    return MONTHS.map((m) => ({
      value: m,
      label: fmt.format(new Date(2020, m - 1, 1)),
    }));
  }, [locale]);

  const itemizedTotalMinor = useMemo(
    () => lines.reduce((sum, l) => sum + toMinor(l.amount), 0),
    [lines],
  );

  function reset() {
    setMode("itemized");
    setPayerType("guardian");
    setPayerId("");
    setYear(NOW.getFullYear());
    setMonth(NOW.getMonth() + 1);
    setCurrency("");
    setLines([{ description: "", amount: "" }]);
    setAdvStudentId("");
    setAdvStartDate(toISODate(NOW));
    setQuote(null);
    setQuoteError(null);
    setError(null);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  function updateLine(idx: number, patch: Partial<LineRow>) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "itemized") {
      const cleaned = lines.filter(
        (l) => l.description.trim() && l.amount.trim(),
      );
      if (!payerId || cleaned.length === 0) {
        setError(t("manualValidation"));
        return;
      }
      setSubmitting(true);
      try {
        const line_items: ManualLineInput[] = cleaned.map((l) => ({
          description: l.description.trim(),
          amount_minor: toMinor(l.amount),
          ...(payerType === "student" ? { student_id: payerId } : {}),
        }));
        const res = await createManualInvoice({
          payer_type: payerType,
          payer_id: payerId,
          period_year: year,
          period_month: month,
          ...(currency ? { currency } : {}),
          line_items,
        });
        reset();
        onCreated(res.id);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Advance mode.
    if (!advStudentId || !quote || quote.count === 0) {
      setError(t("advanceNoSessions"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await createAdvanceInvoice(advStudentId, advStartDate);
      reset();
      onCreated(res.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";
  const labelClass = "mb-1 block text-sm font-medium";

  const submitDisabled =
    submitting ||
    (mode === "advance" && (!quote || quote.count === 0 || quoteLoading));

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t("manualTitle")}
      description={t("manualSubtitle")}
      size="lg"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={submitting}
          >
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            form="manual-bill-form"
            size="sm"
            disabled={submitDisabled}
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : null}
            {submitting ? t("saving") : t("manualCreate")}
          </Button>
        </>
      }
    >
      <form
        id="manual-bill-form"
        onSubmit={(e) => void handleSubmit(e)}
        className="space-y-4"
        noValidate
      >
        {/* Mode toggle */}
        <div
          role="tablist"
          aria-label={t("manualTitle")}
          className="flex gap-1 rounded-xl border bg-muted/40 p-1"
        >
          {(["itemized", "advance"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              data-testid={`manual-mode-${m}`}
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

        {mode === "itemized" ? (
          <>
            {/* Payer type + payer */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>{t("payerType")}</label>
                <select
                  value={payerType}
                  onChange={(e) => {
                    setPayerType(e.target.value as PayerType);
                    setPayerId("");
                  }}
                  disabled={submitting}
                  className={inputClass}
                >
                  <option value="guardian">{t("payerGuardian")}</option>
                  <option value="student">{t("payerStudent")}</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>{t("payer")}</label>
                <Combobox
                  options={payerOptions}
                  value={payerId}
                  onChange={setPayerId}
                  placeholder={t("payerSelect")}
                  searchPlaceholder={t("payerSearch")}
                  disabled={submitting}
                  data-testid="manual-payer"
                />
              </div>
            </div>

            {/* Period + currency */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className={labelClass}>{t("filterMonth")}</label>
                <select
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  disabled={submitting}
                  className={inputClass}
                >
                  {monthOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>{t("filterYear")}</label>
                <select
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  disabled={submitting}
                  className={inputClass}
                >
                  {YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className={labelClass}>{t("currency")}</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  disabled={submitting}
                  className={inputClass}
                  data-testid="manual-currency"
                >
                  <option value="" disabled>
                    {t("currencySelect")}
                  </option>
                  {/* Include the payer currency even if it is outside the common list. */}
                  {currency && !CURRENCIES.includes(currency) && (
                    <option value={currency}>{currency}</option>
                  )}
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Line items */}
            <div>
              <label className={labelClass}>{t("lineItems")}</label>
              <div className="space-y-2">
                {lines.map((line, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={line.description}
                      onChange={(e) =>
                        updateLine(idx, { description: e.target.value })
                      }
                      placeholder={t("liDescription")}
                      disabled={submitting}
                      className={cn(inputClass, "flex-1")}
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.01}
                      value={line.amount}
                      onChange={(e) =>
                        updateLine(idx, { amount: e.target.value })
                      }
                      placeholder="0.00"
                      disabled={submitting}
                      className={cn(inputClass, "w-28 text-end tabular-nums")}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setLines((prev) =>
                          prev.length === 1
                            ? prev
                            : prev.filter((_, i) => i !== idx),
                        )
                      }
                      disabled={submitting || lines.length === 1}
                      aria-label={t("removeLine")}
                      className="text-muted-foreground hover:text-destructive shrink-0 rounded-lg p-2 transition-colors disabled:opacity-30"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setLines((prev) => [...prev, { description: "", amount: "" }])
                }
                disabled={submitting}
                className="text-primary mt-2 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
              >
                <Plus className="size-3.5" aria-hidden />
                {t("addLine")}
              </button>
            </div>

            {/* Total */}
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm font-medium">{t("total")}</span>
              <span className="text-lg font-bold tabular-nums">
                {formatMoney(
                  { amount: itemizedTotalMinor, currency: currency || "USD" },
                  locale,
                )}
              </span>
            </div>
          </>
        ) : (
          <>
            {/* Advance: student + start date */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>{t("payerStudent")}</label>
                <Combobox
                  options={students}
                  value={advStudentId}
                  onChange={setAdvStudentId}
                  placeholder={t("payerSelect")}
                  searchPlaceholder={t("payerSearch")}
                  disabled={submitting}
                  data-testid="advance-student"
                />
              </div>
              <div>
                <label className={labelClass}>{t("advanceStartDate")}</label>
                <input
                  type="date"
                  value={advStartDate}
                  onChange={(e) => setAdvStartDate(e.target.value)}
                  disabled={submitting}
                  className={inputClass}
                />
              </div>
            </div>

            {/* Quote preview */}
            {quoteLoading && (
              <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t("advanceCalculating")}
              </div>
            )}

            {quoteError && <AlertBanner variant="error" message={quoteError} />}

            {!quoteLoading && quote && advStudentId && (
              <div className="rounded-xl border">
                {quote.count === 0 ? (
                  <p className="text-muted-foreground p-4 text-sm">
                    {quote.has_subscription
                      ? t("advanceNoSessions")
                      : t("advanceNoSubscription")}
                  </p>
                ) : (
                  <>
                    <div className="max-h-52 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40 text-muted-foreground text-xs">
                          <tr>
                            <th className="px-3 py-2 text-start font-medium">
                              {t("liDate")}
                            </th>
                            <th className="px-3 py-2 text-start font-medium">
                              {t("liDescription")}
                            </th>
                            <th className="px-3 py-2 text-end font-medium">
                              {t("liAmount")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {quote.lines.map((l) => (
                            <tr key={l.session_id} className="border-t">
                              <td className="px-3 py-2 tabular-nums">
                                {l.session_date}
                              </td>
                              <td className="px-3 py-2">{l.description}</td>
                              <td className="px-3 py-2 text-end tabular-nums">
                                {formatMoney(
                                  {
                                    amount: l.amount_minor,
                                    currency: quote.currency,
                                  },
                                  locale,
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between border-t px-3 py-3">
                      <span className="text-sm font-medium">
                        {t("advanceSessionsCount", { count: quote.count })}
                      </span>
                      <span className="text-lg font-bold tabular-nums">
                        {formatMoney(
                          {
                            amount: quote.total_minor,
                            currency: quote.currency,
                          },
                          locale,
                        )}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {error && (
          <AlertBanner
            variant="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        )}
      </form>
    </Modal>
  );
}
