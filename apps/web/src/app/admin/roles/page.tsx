import { RoleEditorScreen } from "@/app/admin/roles/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

export default function RoleEditorPage() {
  return (
    <AuthProvider>
      <AppShell>
        <RoleEditorScreen />
      </AppShell>
    </AuthProvider>
  );
}
