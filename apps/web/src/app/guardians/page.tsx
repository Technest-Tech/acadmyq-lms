import { GuardiansScreen } from "@/app/guardians/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

/** The Guardians route (Sprint 4). Permission-gated client-side (guardian.read); API enforced. */
export default function GuardiansPage() {
  return (
    <AuthProvider>
      <AppShell>
        <GuardiansScreen />
      </AppShell>
    </AuthProvider>
  );
}
