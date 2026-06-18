import { PlanAdminScreen } from "@/app/admin/plans/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

export default function PlanAdminPage() {
  return (
    <AuthProvider>
      <AppShell>
        <PlanAdminScreen />
      </AppShell>
    </AuthProvider>
  );
}
