"use client";

import { CheckCircle2, ExternalLink, Link2, Loader2, MessageSquare, Phone, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { CopyLinkButton, METHOD_ICON, dayLabel, monthLabel, toMajorText, toMinor, todayLocal, waLink } from "@/components/accounting/accounting-ui";
import { apiErrorMessage } from "@/components/groups/group-form";
import { AlertBanner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  RECEIPT_METHODS,
  getPayerAccount,
  recordReceipt,
  sendReceipt,
  type OpenLine,
  type PayerAccount,
  type ReceiptDetail,
  type ReceiptMethod,
} from "@/lib/accounting-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Who is paying, and (optionally) which of their charges to tick first. */
export interface CollectTarget {
  guardian_id?: string | null;
  student_id?: string | null;
  /** Pay one invoice only (from the invoice screen). */
  invoice_id?: string | null;
  /** Pre-tick these charges. Omitted = every unpaid charge in the first currency. */
  line_ids?: string[];
}

const inputClass =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 h-10 w-full rounded-xl border px-3 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";
const labelClass = "mb-1.5 block text-sm font-medium";

/**
 * Collect a payment (docs/groups/01-ACCOUNTING.md): who is paying and where they stand, their
 * unpaid charges to tick (oldest first, part-paid ones showing what is left), the amount, the
 * method, and a live preview of exactly what the money will pay — anything beyond the ticked
 * charges goes to their other charges, or is kept as credit. The server allocates the same way.
 *
 * Ends on the receipt itself: its number, what is still owed, and one tap to WhatsApp it, open the
 * printable receipt, or copy its link.
 */
export function CollectModal({
  open,
  target,
  onClose,
  onRecorded,
}: {
  open: boolean;
  target: CollectTarget | null;
  onClose: () => void;
  /** Fires once the receipt exists, so the screen behind can refresh. */
  onRecorded?: (receipt: ReceiptDetail) => void;
}) {
  const t = useTranslations("accounting");
  const locale = useLocale();

  const [account, setAccount] = useState<PayerAccount | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>("");
  const [selected, setSelected] = useState<string[]>([]);
  const [amountText, setAmountText] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [method, setMethod] = useState<ReceiptMethod>("CASH");
  const [reference, setReference] = useState("");
  const [receivedOn, setReceivedOn] = useState(todayLocal());
  const [proof, setProof] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [keepCredit, setKeepCredit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ReceiptDetail | null>(null);
  const [sending, setSending] = useState(false);
  const [sendNotice, setSendNotice] = useState<string | null>(null);

  // Load the payer's account each time the modal opens on a target.
  useEffect(() => {
    if (!open || target === null) return;
    let alive = true;
    setAccount(null);
    setLoadError(null);
    setDone(null);
    setError(null);
    setSendNotice(null);
    setMethod("CASH");
    setReference("");
    setReceivedOn(todayLocal());
    setProof(null);
    setNote("");
    setKeepCredit(false);
    setAmountTouched(false);

    getPayerAccount({ guardian_id: target.guardian_id, student_id: target.student_id, invoice_id: target.invoice_id })
      .then((acc) => {
        if (!alive) return;
        setAccount(acc);
        // Ticked first: the charges asked for, else (from an invoice) that invoice's own charges.
        const wanted = target.line_ids ?? (target.invoice_id ? acc.lines.filter((l) => l.invoice_id === target.invoice_id).map((l) => l.id) : null);
        const first = (wanted && acc.lines.find((l) => wanted.includes(l.id))) ?? acc.lines[0];
        const cur = first?.currency ?? acc.balance[0]?.currency ?? "";
        setCurrency(cur);
        const inCurrency = acc.lines.filter((l) => l.currency === cur);
        setSelected((wanted ? inCurrency.filter((l) => wanted.includes(l.id)) : inCurrency).map((l) => l.id));
      })
      .catch((err) => alive && setLoadError(apiErrorMessage(err, t("collect.loadFailed"))));

    return () => {
      alive = false;
    };
  }, [open, target, t]);

  const lines = useMemo(() => (account?.lines ?? []).filter((l) => l.currency === currency), [account, currency]);
  const currencies = useMemo(() => {
    const set = new Set<string>([...(account?.lines ?? []).map((l) => l.currency), ...(account?.balance ?? []).map((b) => b.currency)]);
    return [...set];
  }, [account]);
  const balance = account?.balance.find((b) => b.currency === currency) ?? null;
  const selectedLines = lines.filter((l) => selected.includes(l.id));
  const selectedDue = selectedLines.reduce((s, l) => s + l.remaining_minor, 0);

  // The amount follows the ticks until the operator types their own.
  useEffect(() => {
    if (!amountTouched) setAmountText(selectedDue > 0 ? toMajorText(selectedDue) : "");
  }, [selectedDue, amountTouched]);

  const amount = toMinor(amountText);
  const fmt = (minor: number) => formatMoney({ amount: minor, currency: currency || "EGP" }, locale);

  // What the money will pay, in the order the server pays it.
  const preview = useMemo(() => {
    let left = amount;
    const pays: { line: OpenLine; take: number }[] = [];
    const order = [...selectedLines, ...(keepCredit ? [] : lines.filter((l) => !selected.includes(l.id)))];
    for (const line of order) {
      if (left <= 0) break;
      const take = Math.min(line.remaining_minor, left);
      if (take > 0) pays.push({ line, take });
      left -= take;
    }
    return { pays, credit: Math.max(0, left) };
  }, [amount, selectedLines, lines, selected, keepCredit]);

  const byMonth = useMemo(() => {
    const out: { period: string; lines: OpenLine[] }[] = [];
    for (const l of lines) {
      const last = out[out.length - 1];
      if (last && last.period === l.period) last.lines.push(l);
      else out.push({ period: l.period, lines: [l] });
    }
    return out;
  }, [lines]);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : lines.filter((l) => l.id === id || s.includes(l.id)).map((l) => l.id)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!account || amount <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const payer = account.payer;
      const res = await recordReceipt({
        guardian_id: payer.kind === "GUARDIAN" ? payer.id : null,
        student_id: payer.kind === "STUDENT" ? payer.id : null,
        invoice_id: payer.kind === "NAME" ? (target?.invoice_id ?? null) : null,
        amount_minor: amount,
        currency,
        method,
        reference,
        note,
        received_on: receivedOn,
        proof,
        line_ids: selectedLines.map((l) => l.id),
        apply_rest: !keepCredit,
      });
      setDone(res.receipt);
      onRecorded?.(res.receipt);
    } catch (err) {
      setError(apiErrorMessage(err, t("collect.failed")));
    } finally {
      setSubmitting(false);
    }
  }

  async function send() {
    if (!done) return;
    setSending(true);
    setSendNotice(null);
    try {
      const res = await sendReceipt(done.id);
      if (res.sent) {
        setSendNotice(t("collect.sent", { phone: res.phone }));
      } else if (res.phone) {
        window.open(waLink(res.phone, res.message), "_blank", "noopener,noreferrer");
      } else {
        setSendNotice(t("collect.noPhone"));
      }
    } catch (err) {
      setSendNotice(apiErrorMessage(err, t("collect.sendFailed")));
    } finally {
      setSending(false);
    }
  }

  const payerName = account?.payer.name ?? "—";

  // ── The receipt, once recorded ────────────────────────────────────────────
  if (done) {
    const owed = done.balance_after.find((b) => b.currency === done.currency);
    return (
      <Modal open={open} onClose={onClose} title={t("collect.doneTitle")} size="md">
        <div className="space-y-4" data-testid="collect-done">
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-center">
            <CheckCircle2 className="size-10 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <p className="text-muted-foreground text-sm">{t("collect.receiptNo")}</p>
            <p className="font-mono text-lg font-bold tracking-wide" dir="ltr">{done.number}</p>
            <p className="text-2xl font-bold tabular-nums break-words">{formatMoney({ amount: done.amount_minor, currency: done.currency }, locale)}</p>
            <p className="text-muted-foreground text-sm">
              {payerName} · {t(`method.${done.method}`)} · {dayLabel(done.received_on, locale)}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-xl border p-3">
              <p className="text-muted-foreground text-xs">{t("collect.stillOwed")}</p>
              <p className={cn("mt-1 font-bold tabular-nums", owed && owed.due_minor > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                {formatMoney({ amount: owed?.due_minor ?? 0, currency: done.currency }, locale)}
              </p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="text-muted-foreground text-xs">{t("collect.creditHeld")}</p>
              <p className="mt-1 font-bold tabular-nums">{formatMoney({ amount: owed?.credit_minor ?? 0, currency: done.currency }, locale)}</p>
            </div>
          </div>

          {sendNotice && <AlertBanner variant="info" message={sendNotice} onDismiss={() => setSendNotice(null)} />}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void send()} disabled={sending} className="gap-1.5" data-testid="collect-send">
              {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MessageSquare className="size-4" aria-hidden />}
              {t("collect.sendWhatsApp")}
            </Button>
            <a href={done.public_url} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}>
              <ExternalLink className="size-4" aria-hidden />
              {t("collect.openReceipt")}
            </a>
            <CopyLinkButton value={done.public_url} label={t("collect.copyLink")} copiedLabel={t("collect.copied")} icon={Link2} />
            <Button type="button" variant="ghost" onClick={onClose} className="ms-auto">
              {t("collect.done")}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ── The form ──────────────────────────────────────────────────────────────
  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose()}
      title={t("collect.title")}
      description={account ? payerName : undefined}
      size="lg"
      footer={
        account ? (
          <>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {t("collect.cancel")}
            </Button>
            <Button type="submit" form="collect-form" disabled={submitting || amount <= 0 || (method !== "CASH" && proof === null)} className="gap-1.5" data-testid="collect-submit">
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Wallet className="size-4" aria-hidden />}
              {amount > 0 ? t("collect.submitAmount", { amount: fmt(amount) }) : t("collect.submit")}
            </Button>
          </>
        ) : undefined
      }
    >
      {loadError && <AlertBanner variant="error" message={loadError} />}
      {!account && !loadError && (
        <p className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("collect.loading")}
        </p>
      )}

      {account && (
        <form id="collect-form" onSubmit={(e) => void submit(e)} className="space-y-5" noValidate data-testid="collect-form">
          {/* Where the payer stands */}
          <div className="bg-muted/40 flex flex-col gap-3 rounded-2xl border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold break-words">{payerName}</p>
              {account.payer.phone && (
                <p className="text-muted-foreground flex items-center gap-1 text-xs" dir="ltr">
                  <Phone className="size-3" aria-hidden />
                  {account.payer.phone}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-700 tabular-nums dark:text-rose-300">
                {t("collect.owes", { amount: fmt(balance?.due_minor ?? 0) })}
              </span>
              {(balance?.credit_minor ?? 0) > 0 && (
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 tabular-nums dark:text-emerald-300">
                  {t("collect.holds", { amount: fmt(balance?.credit_minor ?? 0) })}
                </span>
              )}
            </div>
          </div>

          {currencies.length > 1 && (
            <div className="no-scrollbar flex gap-1 overflow-x-auto" role="tablist" aria-label={t("collect.currency")}>
              {currencies.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={c === currency}
                  onClick={() => {
                    setCurrency(c);
                    setSelected((account.lines ?? []).filter((l) => l.currency === c).map((l) => l.id));
                    setAmountTouched(false);
                  }}
                  className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-semibold", c === currency ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* What is being paid */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("collect.charges")}</h3>
              {lines.length > 0 && (
                <div className="flex gap-1">
                  <Button type="button" size="xs" variant="ghost" onClick={() => setSelected(lines.map((l) => l.id))}>
                    {t("collect.selectAll")}
                  </Button>
                  <Button type="button" size="xs" variant="ghost" onClick={() => setSelected([])}>
                    {t("collect.clear")}
                  </Button>
                </div>
              )}
            </div>

            {lines.length === 0 ? (
              <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm">{t("collect.nothingOwed")}</p>
            ) : (
              <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl border p-2" data-testid="collect-lines">
                {byMonth.map((m) => (
                  <div key={m.period} className="space-y-1">
                    <p className="text-muted-foreground px-1 text-xs font-semibold">{monthLabel(m.period, locale)}</p>
                    {m.lines.map((l) => {
                      const on = selected.includes(l.id);
                      return (
                        <label
                          key={l.id}
                          className={cn(
                            "flex cursor-pointer items-start gap-3 rounded-lg p-2 transition-colors",
                            on ? "bg-primary/5 ring-primary/30 ring-1" : "hover:bg-muted/60",
                          )}
                        >
                          <input type="checkbox" className="accent-primary mt-1 size-4 shrink-0" checked={on} onChange={() => toggle(l.id)} data-testid={`collect-line-${l.id}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium break-words">{l.description}</span>
                            <span className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                              {l.student_name && <span>{l.student_name}</span>}
                              {l.group_name && <span className="bg-muted rounded px-1.5 py-0.5">{l.group_name}</span>}
                              {l.paid_minor > 0 && <span className="text-amber-700 dark:text-amber-300">{t("collect.partlyPaid", { paid: fmt(l.paid_minor), of: fmt(l.amount_minor) })}</span>}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">{fmt(l.remaining_minor)}</span>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Amount + date */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="collect-amount" className={labelClass}>
                {t("collect.amount", { currency })}
              </label>
              <input
                id="collect-amount"
                type="text"
                inputMode="decimal"
                dir="ltr"
                className={cn(inputClass, "text-lg font-semibold tabular-nums")}
                value={amountText}
                onChange={(e) => {
                  setAmountTouched(true);
                  setAmountText(e.target.value);
                }}
                placeholder="0"
                data-testid="collect-amount"
              />
              {selectedDue > 0 && amount !== selectedDue && (
                <button type="button" className="text-primary mt-1 text-xs hover:underline" onClick={() => setAmountTouched(false)}>
                  {t("collect.useSelected", { amount: fmt(selectedDue) })}
                </button>
              )}
            </div>
            <div>
              <label htmlFor="collect-date" className={labelClass}>
                {t("collect.receivedOn")}
              </label>
              <input id="collect-date" type="date" className={inputClass} value={receivedOn} max={todayLocal()} onChange={(e) => setReceivedOn(e.target.value)} />
            </div>
          </div>

          {/* Method */}
          <fieldset>
            <legend className={labelClass}>{t("collect.method")}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup">
              {RECEIPT_METHODS.map((m) => {
                const Icon = METHOD_ICON[m];
                const on = m === method;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setMethod(m)}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors",
                      on ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
                    )}
                    data-testid={`collect-method-${m}`}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{t(`method.${m}`)}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {method !== "CASH" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="collect-ref" className={labelClass}>
                  {t("collect.reference")} <span className="text-muted-foreground font-normal">({t("collect.optional")})</span>
                </label>
                <input id="collect-ref" type="text" dir="ltr" maxLength={255} className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("collect.referenceHint")} />
              </div>
              <div>
                {/* Money that moved through a bank, a wallet or a card leaves a picture — the API insists on it too. */}
                <label htmlFor="collect-proof" className={labelClass}>
                  {t("collect.proof")} <span className="text-destructive font-normal">({t("collect.required")})</span>
                </label>
                <input id="collect-proof" type="file" required accept="image/jpeg,image/png,image/webp" className={cn(inputClass, "py-1.5")} onChange={(e) => setProof(e.target.files?.[0] ?? null)} data-testid="collect-proof" />
                {proof === null && <p className="text-muted-foreground mt-1 text-xs">{t("collect.proofNeeded")}</p>}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="collect-note" className={labelClass}>
              {t("collect.note")} <span className="text-muted-foreground font-normal">({t("collect.optional")})</span>
            </label>
            <input id="collect-note" type="text" maxLength={1000} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {/* What the money will pay */}
          {amount > 0 && (
            <section className="space-y-2 rounded-2xl border border-dashed p-3" data-testid="collect-preview">
              <h3 className="text-sm font-semibold">{t("collect.willPay")}</h3>
              {preview.pays.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("collect.allCredit")}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {preview.pays.map(({ line, take }) => (
                    <li key={line.id} className="flex items-start justify-between gap-3">
                      <span className="min-w-0 break-words">
                        {line.description}
                        {take < line.remaining_minor && <span className="text-amber-700 dark:text-amber-300"> · {t("collect.partOf", { of: fmt(line.remaining_minor) })}</span>}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">{fmt(take)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {preview.credit > 0 && (
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{t("collect.becomesCredit", { amount: fmt(preview.credit) })}</p>
              )}
              {selectedLines.length < lines.length && (
                <label className="text-muted-foreground flex items-center gap-2 pt-1 text-xs">
                  <input type="checkbox" className="accent-primary size-3.5" checked={keepCredit} onChange={(e) => setKeepCredit(e.target.checked)} />
                  {t("collect.keepCredit")}
                </label>
              )}
            </section>
          )}

          {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
        </form>
      )}
    </Modal>
  );
}
