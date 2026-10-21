import { Suspense } from "react";
import { AccountingGate } from "@/components/accounting/accounting-ui";
import { AccountingStatementScreen } from "@/components/accounting/accounting-statement";

/** Accounting (docs/groups/01-ACCOUNTING.md) — a family's statement of account. Gated on invoice.read + the accounting switch. */
export default function Page() {
  return (
    <Suspense>
      <AccountingGate>
        <AccountingStatementScreen />
      </AccountingGate>
    </Suspense>
  );
}
