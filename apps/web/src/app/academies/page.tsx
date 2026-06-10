import { AcademiesScreen } from "@/app/academies/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

/**
 * The Super Admin academy-management route (Sprint 3). Same shell as the dashboard; the
 * screen itself is permission-gated client-side (academy.read) and the API is the real
 * control — a non-Super-Admin gets 403 from every endpoint regardless of what renders.
 */
export default function AcademiesPage() {
  return (
    <AuthProvider>
      <AppShell>
        <AcademiesScreen />
      </AppShell>
    </AuthProvider>
  );
}
