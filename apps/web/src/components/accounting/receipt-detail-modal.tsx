"use client";

import { Ban, ExternalLink, FileImage, Link2, Loader2, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CopyLinkButton, MethodBadge, dayLabel, waLink } from "@/components/accounting/accounting-ui";
import { apiErrorMessage } from "@/components/groups/group-form";
import { AlertBanner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { fetchReceiptProof, getReceipt, sendReceipt, voidReceipt, type ReceiptDetail } from "@/lib/accounting-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * One receipt (docs/groups/01-ACCOUNTING.md): who paid, how and when, who took it, exactly which
 * charges it paid and what it left as credit, and where the payer stands after it. From here it is
 * sent on WhatsApp, opened as the printable receipt, or — `receipt.void` — voided with a reason.
 * A void keeps the number and the history; its money goes back to unpaid.
 */
export function ReceiptDetailModal({
  receiptId,
  onClose,
  onChanged,
}: {
  receiptId: string | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (receiptId === null) return;
    let alive = true;
    setReceipt(null);
    setError(null);
    setVoiding(false);
    setReason("");
    setNotice(null);
    getReceipt(receiptId)
      .then((res) => alive && setReceipt(res.receipt))
      .catch((err) => alive && setError(apiErrorMessage(err, t("detail.loadFailed"))));
    return () => {
      alive = false;
    };
  }, [receiptId, t]);

  const money = (minor: number) => formatMoney({ amount: minor, currency: receipt?.currency ?? "EGP" }, locale);

  async function doVoid() {
    if (!receipt || reason.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const res = await voidReceipt(receipt.id, reason.trim());
      setReceipt(res.receipt);
      setVoiding(false);
      onChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, t("detail.voidFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!receipt) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await sendReceipt(receipt.id);
      if (res.sent) setNotice(t("collect.sent", { phone: res.phone }));
      else if (res.phone) window.open(waLink(res.phone, res.message), "_blank", "noopener,noreferrer");
      else setNotice(t("collect.noPhone"));
    } catch (err) {
      setNotice(apiErrorMessage(err, t("collect.sendFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function openProof() {
    if (!receipt) return;
    // Opened before the fetch so the popup is not blocked, then pointed at the file.
    const tab = window.open("", "_blank");
    try {
      const url = await fetchReceiptProof(receipt.id);
      if (tab) tab.location.href = url;
      else window.open(url, "_blank");
    } catch (err) {
      tab?.close();
      setNotice(apiErrorMessage(err, t("detail.proofFailed")));
    }
  }

  const owed = receipt?.balance_after.find((b) => b.currency === receipt.currency);

  return (
    <Modal open={receiptId !== null} onClose={onClose} title={receipt ? t("detail.title", { number: receipt.number }) : t("detail.loading")} size="lg">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      {!receipt && !error && (
        <p className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("detail.loading")}
        </p>
      )}

      {receipt && (
        <div className="space-y-4" data-testid="receipt-detail">
          {receipt.voided && (
            <AlertBanner
              variant="error"
              message={t("detail.voidedBanner", { reason: receipt.void_reason ?? "", by: receipt.voided_by_name ?? "—" })}
            />
          )}

          <div className={cn("rounded-2xl border p-4", receipt.voided && "opacity-60")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs">{t("detail.receivedFrom")}</p>
                {/* The family (or the student billed directly) is one click away: the treasury and the family card are one book. */}
                {receipt.guardian_id || receipt.student_id ? (
                  <Link
                    href={receipt.guardian_id ? `/guardians/${receipt.guardian_id}` : `/students/${receipt.student_id}`}
                    className="font-semibold break-words hover:underline"
                    data-testid="receipt-payer-link"
                  >
                    {receipt.payer.name ?? receipt.payer_name ?? "—"}
                  </Link>
                ) : (
                  <p className="font-semibold break-words">{receipt.payer.name ?? receipt.payer_name ?? "—"}</p>
                )}
                {receipt.payer.phone && (
                  <p className="text-muted-foreground text-xs" dir="ltr">
                    {receipt.payer.phone}
                  </p>
                )}
              </div>
              <div className="text-end">
                <p className={cn("text-2xl font-bold tabular-nums break-words", receipt.voided && "line-through")}>{money(receipt.amount_minor)}</p>
                <MethodBadge method={receipt.method} className="mt-1" />
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <Fact label={t("detail.date")}>{dayLabel(receipt.received_on, locale)}</Fact>
              <Fact label={t("detail.collector")}>{receipt.received_by_name ?? t(`source.${receipt.source}`)}</Fact>
              <Fact label={t("detail.reference")}>{receipt.reference ? <span dir="ltr">{receipt.reference}</span> : "—"}</Fact>
            </dl>
            {receipt.note && <p className="text-muted-foreground mt-3 text-sm whitespace-pre-line">{receipt.note}</p>}
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t("detail.paidFor")}</h3>
            {receipt.allocations.length === 0 ? (
              <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm">{receipt.voided ? t("detail.voidNothing") : t("detail.allCredit")}</p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-xl border" data-testid="receipt-allocations">
                {receipt.allocations.map((a) => (
                  <li key={a.line_id} className="flex items-start justify-between gap-3 p-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium break-words">{a.description}</p>
                      <p className="text-muted-foreground text-xs">
                        {[a.student_name, a.group_name].filter(Boolean).join(" · ")}
                        {a.amount_minor < a.line_amount_minor && <> · {t("detail.partOf", { of: money(a.line_amount_minor) })}</>}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums">{money(a.amount_minor)}</span>
                  </li>
                ))}
              </ul>
            )}
            {receipt.unallocated_minor > 0 && (
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{t("detail.leftAsCredit", { amount: money(receipt.unallocated_minor) })}</p>
            )}
          </section>

          {owed && !receipt.voided && (
            <p className="text-muted-foreground text-sm">
              {owed.due_minor > 0 ? t("detail.nowOwes", { amount: money(owed.due_minor) }) : t("detail.settled")}
              {owed.credit_minor > 0 && <> · {t("collect.holds", { amount: money(owed.credit_minor) })}</>}
            </p>
          )}

          {notice && <AlertBanner variant="info" message={notice} onDismiss={() => setNotice(null)} />}

          {voiding ? (
            <div className="space-y-2 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-3">
              <label htmlFor="void-reason" className="block text-sm font-medium">
                {t("detail.voidReason")}
              </label>
              <input
                id="void-reason"
                className="border-input bg-background h-10 w-full rounded-xl border px-3 text-sm"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("detail.voidReasonHint")}
                data-testid="void-reason"
              />
              <p className="text-muted-foreground text-xs">{t("detail.voidWarning")}</p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setVoiding(false)} disabled={busy}>
                  {t("collect.cancel")}
                </Button>
                <Button type="button" variant="destructive" onClick={() => void doVoid()} disabled={busy || reason.trim().length < 3} data-testid="void-confirm">
                  {t("detail.voidConfirm")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {!receipt.voided && (
                <Button type="button" onClick={() => void send()} disabled={busy} className="gap-1.5">
                  <MessageSquare className="size-4" aria-hidden />
                  {t("collect.sendWhatsApp")}
                </Button>
              )}
              <a href={receipt.public_url} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}>
                <ExternalLink className="size-4" aria-hidden />
                {t("collect.openReceipt")}
              </a>
              <CopyLinkButton value={receipt.public_url} label={t("collect.copyLink")} copiedLabel={t("collect.copied")} icon={Link2} />
              {receipt.has_proof && (
                <Button type="button" variant="ghost" className="gap-1.5" onClick={() => void openProof()}>
                  <FileImage className="size-4" aria-hidden />
                  {t("detail.proof")}
                </Button>
              )}
              {receipt.can_void && (
                <Button type="button" variant="destructive" onClick={() => setVoiding(true)} className="ms-auto gap-1.5" data-testid="receipt-void">
                  <Ban className="size-4" aria-hidden />
                  {t("detail.void")}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium break-words">{children}</dd>
    </div>
  );
}
