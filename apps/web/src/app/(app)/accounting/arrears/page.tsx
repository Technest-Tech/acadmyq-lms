import { Suspense } from "react";
import { AccountingGate } from "@/components/accounting/accounting-ui";
import { AccountingArrearsScreen } from "@/components/accounting/accounting-arrears";

/** Accounting (docs/groups/01-ACCOUNTING.md) — who owes, aged. Gated on invoice.read + the accounting switch. */
export default function Page() {
  return (
    <Suspense>
      <AccountingGate>
        <AccountingArrearsScreen />
      </AccountingGate>
    </Suspense>
  );
}
