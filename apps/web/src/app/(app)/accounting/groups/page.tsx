import { Suspense } from "react";
import { AccountingGate } from "@/components/accounting/accounting-ui";
import { AccountingGroupsScreen } from "@/components/accounting/accounting-groups";

/** Accounting (docs/groups/01-ACCOUNTING.md) — every group's collection and profit. Gated on invoice.read + the accounting switch. */
export default function Page() {
  return (
    <Suspense>
      <AccountingGate>
        <AccountingGroupsScreen />
      </AccountingGate>
    </Suspense>
  );
}
