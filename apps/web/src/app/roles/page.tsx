import { AcademyRolesScreen } from "@/app/roles/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

export const metadata = { title: "Roles & Permissions" };

export default function AcademyRolesPage() {
  return (
    <AuthProvider>
      <AppShell>
        <AcademyRolesScreen />
      </AppShell>
    </AuthProvider>
  );
}
