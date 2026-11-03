"use client";

import { AcademyDashboard } from "@/components/dashboard/academy-dashboard";
import { CentreDashboard } from "@/components/dashboard/centre-dashboard";
import { useProfile } from "@/lib/capabilities";

/**
 * /dashboard — the home screen for the academy's PROFILE (`SessionAcademy.profile`): a learning
 * centre opens on its groups, sheets and receipts; everyone else keeps the academy dashboard
 * exactly as it was. The choice is the profile alone — never a feature switch, so a Quran academy
 * that happens to hold a centre feature still lands on its own screen.
 */
export function DashboardHome() {
  const profile = useProfile();
  return profile === "CENTRE" ? <CentreDashboard /> : <AcademyDashboard />;
}
