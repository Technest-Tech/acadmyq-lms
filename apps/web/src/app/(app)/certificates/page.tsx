import { CertificatesScreen } from "./screen";

/**
 * Certificates route. Same authenticated shell as the rest of the app; the screen is
 * permission-gated client-side (certificate.read) and the API enforces it for real
 * (certificate.read to view, certificate.manage to edit). PDFs are generated client-side so
 * the premium design renders at full fidelity.
 */
export default function CertificatesPage() {
  return <CertificatesScreen />;
}
