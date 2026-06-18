import { CertificatesScreen } from "@/app/certificates/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

/**
 * Certificates route. Same authenticated shell as the rest of the app; the screen is
 * permission-gated client-side (certificate.read) and the API enforces it for real
 * (certificate.read to view, certificate.manage to edit). PDFs are generated client-side so
 * the premium design renders at full fidelity.
 */
export default function CertificatesPage() {
  return (
    <AuthProvider>
      <AppShell>
        <CertificatesScreen />
      </AppShell>
    </AuthProvider>
  );
}
