import { Suspense } from "react";
import { AccountingGate } from "@/components/accounting/accounting-ui";
import { AccountingOverviewScreen } from "@/components/accounting/accounting-overview";

/** Accounting (docs/groups/01-ACCOUNTING.md) — the month at a glance. Gated on invoice.read + the accounting switch. */
export default function Page() {
  return (
    <Suspense>
      <AccountingGate>
        <AccountingOverviewScreen />
      </AccountingGate>
    </Suspense>
  );
}
