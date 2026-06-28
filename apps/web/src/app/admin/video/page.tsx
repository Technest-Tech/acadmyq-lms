import { AdminVideoScreen } from "@/app/admin/video/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

export default function AdminVideoPage() {
  return (
    <AuthProvider>
      <AppShell>
        <AdminVideoScreen />
      </AppShell>
    </AuthProvider>
  );
}
