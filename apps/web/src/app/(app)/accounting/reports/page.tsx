import { Suspense } from "react";
import { AccountingReportsHub } from "@/components/accounting/accounting-reports-hub";
import { AccountingGate } from "@/components/accounting/accounting-ui";

/** Accounting (docs/groups/01-ACCOUNTING.md) — the reports, as tabs (`?tab=daily|income|groups`). Gated on invoice.read + the accounting switch. */
export default function Page() {
  return (
    <Suspense>
      <AccountingGate>
        <AccountingReportsHub />
      </AccountingGate>
    </Suspense>
  );
}
