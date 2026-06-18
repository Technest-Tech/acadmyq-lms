import { StaffDetailScreen } from "@/app/staff/[id]/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

export default function StaffDetailRoute() {
  return (
    <AuthProvider>
      <AppShell>
        <StaffDetailScreen />
      </AppShell>
    </AuthProvider>
  );
}
