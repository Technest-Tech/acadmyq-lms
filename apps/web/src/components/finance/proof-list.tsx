"use client";

import { ImageIcon, ReceiptText } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { approveProof, fetchProofScreenshot, rejectProof, type PaymentProof } from "@/lib/api";
import { inputClass } from "./finance-fields";
import { errorMessage, formatDay, fromMinor, money, toMinor } from "./finance-format";

/**
 * Transfer screenshots clients uploaded from their pay link, waiting for the owner. Approving one
 * records the confirmed amount as money from that client (oldest dues first, the subscription
 * renews); rejecting it leaves the dues as they were. The amount box starts at what the client
 * typed — the owner corrects it if the transfer says otherwise.
 */
export function ProofList({
  proofs,
  showClient = true,
  onChanged,
}: {
  proofs: PaymentProof[];
  showClient?: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("accounts.proofs");
  const tf = useTranslations("finance");
  const locale = useLocale();
  const toast = useToast();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  if (proofs.length === 0) return null;

  async function view(id: string) {
    try {
      window.open(await fetchProofScreenshot(id), "_blank", "noopener");
    } catch (e) {
      toast.error(errorMessage(e, tf("common.loadError")));
    }
  }

  async function decide(p: PaymentProof, approve: boolean) {
    setBusy(p.id);
    try {
      if (approve) {
        const minor = toMinor(amounts[p.id] ?? (p.amount_minor ? fromMinor(p.amount_minor) : ""));
        if (!minor || minor <= 0) {
          toast.error(t("amountRequired"));
          return;
        }
        await approveProof(p.id, { amount_minor: minor });
        toast.success(t("approved"));
      } else {
        await rejectProof(p.id);
        toast.success(t("rejected"));
      }
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e, tf("form.errors.generic")));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="proof-list">
      {proofs.map((p) => (
        <li key={p.id} className="bg-card flex flex-col gap-2.5 rounded-xl p-4 shadow-sm ring-1 ring-foreground/[0.06]" data-proof={p.id}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {showClient && (
                <Link
                  href={p.academy_id ? `/admin/clients/${p.academy_id}?tab=subscription` : `/admin/accounts/${p.client_id}`}
                  className="hover:text-primary block font-semibold break-words hover:underline"
                >
                  {p.academy_name ?? p.client_name}
                </Link>
              )}
              <p className="text-muted-foreground flex items-center gap-1 text-xs">
                <ReceiptText className="size-3.5" aria-hidden />
                {tf(`method.${p.method}`)} · {formatDay(p.created_at.slice(0, 10), locale)}
              </p>
            </div>
            {p.amount_minor ? (
              <span className="text-primary shrink-0 font-bold tabular-nums">{money(p.amount_minor, p.currency, locale)}</span>
            ) : null}
          </div>
          {p.note ? <p className="text-muted-foreground text-xs break-words">“{p.note}”</p> : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" size="xs" variant="outline" onClick={() => void view(p.id)}>
              <ImageIcon className="size-3" aria-hidden />
              {t("view")}
            </Button>
            <input
              aria-label={t("confirmAmount", { currency: p.currency })}
              type="number"
              inputMode="decimal"
              min={0}
              value={amounts[p.id] ?? (p.amount_minor ? fromMinor(p.amount_minor) : "")}
              onChange={(e) => setAmounts((a) => ({ ...a, [p.id]: e.target.value }))}
              placeholder={t("confirmAmount", { currency: p.currency })}
              className={`${inputClass} h-6 w-28 text-xs`}
              dir="ltr"
            />
            <Button type="button" size="xs" disabled={busy === p.id} onClick={() => void decide(p, true)} data-testid={`approve-${p.id}`}>
              {t("approve")}
            </Button>
            <Button type="button" size="xs" variant="ghost" disabled={busy === p.id} onClick={() => void decide(p, false)}>
              {t("reject")}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
