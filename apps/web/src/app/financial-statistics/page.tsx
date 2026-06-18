import { FinancialStatisticsScreen } from "@/app/financial-statistics/screen";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

export default function FinancialStatisticsPage() {
  return (
    <AuthProvider>
      <AppShell>
        <FinancialStatisticsScreen />
      </AppShell>
    </AuthProvider>
  );
}
