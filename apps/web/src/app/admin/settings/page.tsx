import { PlatformSettingsScreen } from "@/app/admin/settings/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

export default function PlatformSettingsPage() {
  return (
    <AuthProvider>
      <AppShell>
        <PlatformSettingsScreen />
      </AppShell>
    </AuthProvider>
  );
}
