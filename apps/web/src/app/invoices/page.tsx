import { InvoicesScreen } from "@/app/invoices/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

/**
 * Invoices route (Sprint 7). Same authenticated shell as the rest of the app;
 * the screen is permission-gated client-side (invoice.read) and the API enforces
 * it for real with a Gate::authorize on every endpoint.
 */
export default function InvoicesPage() {
  return (
    <AuthProvider>
      <AppShell>
        <InvoicesScreen />
      </AppShell>
    </AuthProvider>
  );
}
