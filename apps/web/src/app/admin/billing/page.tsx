import { BillingScreen } from "@/app/admin/billing/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

export default function BillingPage() {
  return (
    <AuthProvider>
      <AppShell>
        <BillingScreen />
      </AppShell>
    </AuthProvider>
  );
}
