import { AdminDashboardScreen } from "@/app/admin/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

export default function AdminDashboardPage() {
  return (
    <AuthProvider>
      <AppShell>
        <AdminDashboardScreen />
      </AppShell>
    </AuthProvider>
  );
}
