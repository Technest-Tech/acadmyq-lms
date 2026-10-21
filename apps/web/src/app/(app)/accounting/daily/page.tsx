import { Suspense } from "react";
import { AccountingGate } from "@/components/accounting/accounting-ui";
import { AccountingDailyScreen } from "@/components/accounting/accounting-daily";

/** Accounting (docs/groups/01-ACCOUNTING.md) — collections day by day. Gated on invoice.read + the accounting switch. */
export default function Page() {
  return (
    <Suspense>
      <AccountingGate>
        <AccountingDailyScreen />
      </AccountingGate>
    </Suspense>
  );
}
