import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { AdminVideoAcademyScreen } from "./screen";

/**
 * Super Admin per-academy video oversight (Tier 2): video access status + activate/deactivate/trial/
 * tier controls, subscription details, usage stats, the room list, and per-room access logs.
 * Gated client-side (platform.manage) and server-side (the SECURITY DEFINER readers re-assert SUPER_ADMIN).
 */
export default function AdminVideoAcademyPage({ params }: { params: { academyId: string } }) {
  return (
    <AuthProvider>
      <AppShell>
        <AdminVideoAcademyScreen academyId={params.academyId} />
      </AppShell>
    </AuthProvider>
  );
}
