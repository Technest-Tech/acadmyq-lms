import { InvoicesScreen } from "./screen";

/**
 * Invoices route (Sprint 7). Same authenticated shell as the rest of the app;
 * the screen is permission-gated client-side (invoice.read) and the API enforces
 * it for real with a Gate::authorize on every endpoint.
 */
export default function InvoicesPage() {
  return <InvoicesScreen />;
}
