import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { AcademyDashboard } from "@/components/dashboard/academy-dashboard";

export default async function DashboardPage() {
  return (
    <AuthProvider>
      <AppShell>
        <AcademyDashboard />
      </AppShell>
    </AuthProvider>
  );
}
