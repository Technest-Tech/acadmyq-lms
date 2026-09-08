import { FinanceOverviewScreen } from "./screen";

/**
 * Super Admin → Finance: the platform owner's OWN income book (deals, installments, payments).
 * Platform scoped (`platform.manage`); the finance_* tables force RLS on `app.is_super_admin()`,
 * so nothing here is reachable from any academy context. Deliberately unrelated to client
 * billing — this records what the owner was paid, not what the platform invoices.
 */
export default function AdminFinancePage() {
  return <FinanceOverviewScreen />;
}
