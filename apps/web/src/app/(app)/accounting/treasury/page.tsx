import { Suspense } from "react";
import { AccountingTreasuryHub } from "@/components/accounting/accounting-treasury-hub";
import { AccountingGate } from "@/components/accounting/accounting-ui";

/** Accounting (docs/groups/01-ACCOUNTING.md) — the treasury, as tabs (`?tab=accounts|receipts|expenses`). Gated on invoice.read + the accounting switch. */
export default function Page() {
  return (
    <Suspense>
      <AccountingGate>
        <AccountingTreasuryHub />
      </AccountingGate>
    </Suspense>
  );
}
