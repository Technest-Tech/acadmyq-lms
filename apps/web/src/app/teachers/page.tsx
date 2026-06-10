import { TeachersScreen } from "@/app/teachers/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

/** The Teachers route (Sprint 4). Permission-gated client-side (teacher.read); API enforced. */
export default function TeachersPage() {
  return (
    <AuthProvider>
      <AppShell>
        <TeachersScreen />
      </AppShell>
    </AuthProvider>
  );
}
