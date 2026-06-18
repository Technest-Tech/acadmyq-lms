import { SettingsScreen } from "@/app/settings/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

/** The Settings route — academy configuration (specializations). Gated client-side; API enforced. */
export default function SettingsPage() {
  return (
    <AuthProvider>
      <AppShell>
        <SettingsScreen />
      </AppShell>
    </AuthProvider>
  );
}
