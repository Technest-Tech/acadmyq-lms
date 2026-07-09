import type { Metadata } from "next";
import { WhatsAppConnectScreen } from "./screen";

/**
 * Public "connect your WhatsApp" page — `/wa-connect/{token}` (docs/whatsapp-api). A chrome-free,
 * no-login surface the Super Admin shares with a client: it starts a gateway session and shows the
 * pairing QR the client scans from their phone. The token is a shareable, expiring secret, so the
 * page is never indexed.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nosnippet: true },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function WhatsAppConnectPage({ params }: PageProps) {
  const { token } = await params;
  return <WhatsAppConnectScreen token={token} />;
}
