import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { StaffScreen } from "@/app/staff/screen";

export const metadata = { title: "Staff" };

export default function StaffPage() {
  return (
    <AuthProvider>
      <AppShell>
        <StaffScreen />
      </AppShell>
    </AuthProvider>
  );
}
