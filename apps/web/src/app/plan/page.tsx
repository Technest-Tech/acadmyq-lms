import { PlanScreen } from "@/app/plan/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

export default function PlanPage() {
  return (
    <AuthProvider>
      <AppShell>
        <PlanScreen />
      </AppShell>
    </AuthProvider>
  );
}
