"use client";

import { Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CollectModal, type CollectTarget } from "@/components/accounting/collect-modal";
import { PayerPicker } from "@/components/accounting/payer-picker";
import { useAuth } from "@/components/auth-provider";

/**
 * The header's "Collect" button (docs/groups/01-ACCOUNTING.md): the one thing a desk does all day,
 * reachable from every page instead of from a group's tab or an invoice. Pick the student, their
 * family's account opens, record the payment. Only for a client on receipts (`accounting`, held
 * explicitly — a platform admin outside an academy has no desk) who may mark invoices paid.
 */
export function CollectQuickAction() {
  const t = useTranslations("accounting");
  const { session, can } = useAuth();
  const [picking, setPicking] = useState(false);
  const [target, setTarget] = useState<CollectTarget | null>(null);

  if (!session?.capabilities?.includes("accounting") || !can("invoice.mark_paid")) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setPicking(true)}
        data-testid="header-collect"
        className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold shadow-sm transition-colors outline-none focus-visible:ring-2"
      >
        <Wallet className="size-4" aria-hidden />
        <span className="hidden sm:inline">{t("quickCollect")}</span>
        <span className="sr-only sm:hidden">{t("quickCollect")}</span>
      </button>
      <PayerPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(studentId) => {
          setPicking(false);
          setTarget({ student_id: studentId });
        }}
      />
      <CollectModal open={target !== null} target={target} onClose={() => setTarget(null)} />
    </>
  );
}
