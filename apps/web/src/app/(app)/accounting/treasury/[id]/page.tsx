import { AccountingGate } from "@/components/accounting/accounting-ui";
import { TreasuryAccountScreen } from "@/components/accounting/treasury-account";

/** Accounting (docs/groups/01-ACCOUNTING.md) — one treasury account: money in beside money out. Gated on invoice.read + the accounting switch. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AccountingGate>
      <TreasuryAccountScreen accountId={id} />
    </AccountingGate>
  );
}
