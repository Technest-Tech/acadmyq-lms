import { AuditLogScreen } from "@/app/audit/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

export default function AuditPage() {
  return (
    <AuthProvider>
      <AppShell>
        <AuditLogScreen />
      </AppShell>
    </AuthProvider>
  );
}
