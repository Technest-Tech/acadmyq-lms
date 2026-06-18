import { PlatformUsersScreen } from "@/app/admin/users/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

export default function PlatformUsersPage() {
  return (
    <AuthProvider>
      <AppShell>
        <PlatformUsersScreen />
      </AppShell>
    </AuthProvider>
  );
}
