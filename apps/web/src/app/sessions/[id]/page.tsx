import { SessionScreen } from "@/app/sessions/[id]/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

/**
 * The session attendance/report route (Sprint 6). Same authenticated shell as the rest of the
 * app; the screen is permission-gated client-side and the API enforces capability + teacher
 * scoping. The teacher (own sessions) or owner/support (any session) records the outcome, fills
 * the report, and composes the manual WhatsApp message here.
 */
export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AuthProvider>
      <AppShell>
        <SessionScreen sessionId={id} />
      </AppShell>
    </AuthProvider>
  );
}
