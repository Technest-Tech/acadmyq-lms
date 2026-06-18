import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { StaffDepartmentsScreen } from "@/app/admin/staff-departments/screen";

export const metadata = { title: "Staff Departments" };

export default function StaffDepartmentsPage() {
  return (
    <AuthProvider>
      <AppShell>
        <StaffDepartmentsScreen />
      </AppShell>
    </AuthProvider>
  );
}
