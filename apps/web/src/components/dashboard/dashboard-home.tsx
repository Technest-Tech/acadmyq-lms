"use client";

import { AcademyDashboard } from "@/components/dashboard/academy-dashboard";
import { CentreDashboard } from "@/components/dashboard/centre-dashboard";
import { ModernDashboard } from "@/components/dashboard/modern-dashboard";
import { TeacherDashboard } from "@/components/dashboard/teacher-dashboard";
import { useAuth } from "@/components/auth-provider";
import { GettingStarted } from "@/components/help/getting-started";
import { useModernLook, useProfile } from "@/lib/capabilities";

/**
 * /dashboard — the home screen for the academy's PROFILE (`SessionAcademy.profile`) and LOOK: a
 * learning centre opens on its groups, sheets and receipts; a Quran academy a Super Admin switched
 * onto the modern look (`modern_look`) opens on the slim dashboard in its own colours; everyone else
 * keeps the academy dashboard exactly as it was. A centre feature switch alone never moves a Quran
 * academy off its own screen.
 *
 * A TEACHER outside a centre gets a home of their own (TeacherDashboard): their day, what is late,
 * their reports — in either look. A centre's teachers keep the centre dashboard.
 */
export function DashboardHome() {
  const profile = useProfile();
  const modern = useModernLook();
  const { session } = useAuth();
  const teacher = session?.role === "TEACHER";
  // A new academy's first steps sit above whichever dashboard it gets, and leave once done.
  return (
    <>
      <GettingStarted />
      {profile === "CENTRE" ? (
        <CentreDashboard />
      ) : teacher ? (
        <TeacherDashboard />
      ) : modern ? (
        <ModernDashboard />
      ) : (
        <AcademyDashboard />
      )}
    </>
  );
}
