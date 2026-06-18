import { AutomationOverviewScreen } from "@/app/admin/automation/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

export default function AutomationPage() {
  return (
    <AuthProvider>
      <AppShell>
        <AutomationOverviewScreen />
      </AppShell>
    </AuthProvider>
  );
}
