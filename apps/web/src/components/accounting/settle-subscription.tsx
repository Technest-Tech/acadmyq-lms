"use client";

import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { apiErrorMessage } from "@/components/groups/group-form";
import { settledNotice, settlementInput, SubscriptionSettlementFields, type SettlementChoice } from "@/components/subscriptions/close-subscription-modal";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { UnsettledPackage } from "@/lib/accounting-api";
import { formatMoney } from "@/lib/money";
import { closeSubscription } from "@/lib/subscriptions-api";

/**
 * Decide, later, for a centre's subscription that closed waiting on it (`unsettled` rows of
 * `kind: SUBSCRIPTION` on the family's account). The same question the close dialog asks, answered
 * through the same route (POST /subscriptions/{id}/close with the settlement only).
 */
export function SettleSubscriptionModal({ item, canRefund, onClose, onDone }: { item: UnsettledPackage | null; canRefund: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const t = useTranslations("subscriptions.settle");
  return (
    <Modal open={item !== null} onClose={onClose} title={t("title")} description={item ? t("for", { name: item.student_name, label: item.label }) : undefined} size="sm">
      {item !== null && <SettleBody item={item} canRefund={canRefund} onClose={onClose} onDone={onDone} />}
    </Modal>
  );
}

function SettleBody({ item, canRefund, onClose, onDone }: { item: UnsettledPackage; canRefund: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const t = useTranslations("subscriptions.settle");
  const locale = useLocale();
  const [choice, setChoice] = useState<SettlementChoice | null>({ mode: "CREDIT", refund: { method: "CASH", reference: "", note: "" } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = item.subscription_id ?? item.package_id;

  async function confirm() {
    if (choice === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await closeSubscription(id, { reason: "", ...settlementInput(choice) });
      onDone(res.settlement ? settledNotice(t, res.settlement.mode, formatMoney({ amount: res.settlement.amount_minor, currency: res.settlement.currency }, locale), res.settlement.expense_number) : t("saved"));
    } catch (err) {
      setError(apiErrorMessage(err, t("failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      <SubscriptionSettlementFields
        preview={{ paid_minor: item.paid_minor, used_value_minor: item.used_minor, owed_back_minor: item.owed_back_minor, currency: item.currency, can_refund: canRefund }}
        value={choice}
        onChange={setChoice}
      />
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          {t("back")}
        </Button>
        <Button size="sm" className="gap-1.5" onClick={() => void confirm()} disabled={busy || choice === null} data-testid="subscription-settle-confirm">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t("confirm")}
        </Button>
      </div>
    </div>
  );
}
