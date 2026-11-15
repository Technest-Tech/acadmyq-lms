"use client";

import { AcademyDashboard } from "@/components/dashboard/academy-dashboard";
import { CentreDashboard } from "@/components/dashboard/centre-dashboard";
import { ModernDashboard } from "@/components/dashboard/modern-dashboard";
import { GettingStarted } from "@/components/help/getting-started";
import { useModernLook, useProfile } from "@/lib/capabilities";

/**
 * /dashboard — the home screen for the academy's PROFILE (`SessionAcademy.profile`) and LOOK: a
 * learning centre opens on its groups, sheets and receipts; a Quran academy a Super Admin switched
 * onto the modern look (`modern_look`) opens on the slim dashboard in its own colours; everyone else
 * keeps the academy dashboard exactly as it was. A centre feature switch alone never moves a Quran
 * academy off its own screen.
 */
export function DashboardHome() {
  const profile = useProfile();
  const modern = useModernLook();
  // A new academy's first steps sit above whichever dashboard it gets, and leave once done.
  return (
    <>
      <GettingStarted />
      {profile === "CENTRE" ? <CentreDashboard /> : modern ? <ModernDashboard /> : <AcademyDashboard />}
    </>
  );
}
