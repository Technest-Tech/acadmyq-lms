import { NextIntlClientProvider } from "next-intl";
import { vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { ThemeProvider } from "@/components/theme-provider";
import type { AppRole, Session } from "@/lib/api";
import arMessages from "../../messages/ar.json";

/**
 * Test helpers for rendering authenticated UI. We provide the AuthContext value directly
 * (rather than letting AuthProvider hit the network), so component tests assert purely on
 * how the resolved session shapes the UI.
 */

const PERMISSIONS_BY_ROLE: Record<AppRole, string[]> = {
  SUPER_ADMIN: ["academy.read", "academy.enter", "plan.manage", "audit.read"],
  ACADEMY_OWNER: [
    "guardian.read",
    "guardian.create",
    "guardian.update",
    "student.read",
    "student.create",
    "student.update",
    "student.deactivate",
    "teacher.read",
    "teacher.create",
    "teacher.update",
    "teacher.deactivate",
    "schedule.read",
    "invoice.read",
    "payout.read",
    "academy.configure",
    "specialization.manage",
    "teacher_report.manage",
    "audit.read",
  ],
  TEACHER: [
    "schedule.read",
    "student.read",
    "teacher.read_own",
    "session.write_report",
    "payout.read_own",
  ],
};

export function makeSession(
  role: AppRole,
  overrides: Partial<Session> = {},
): Session {
  const session: Session = {
    user: { id: "u1", fullName: "Test User", email: "test@example.com" },
    role,
    academyId: role === "SUPER_ADMIN" ? null : "academy-1",
    permissions: PERMISSIONS_BY_ROLE[role],
    locale: "ar",
    capabilities: null,
    // The panel's own identity travels with the session; a platform Super Admin has no academy, so
    // the chrome keeps the platform's mark.
    academy:
      role === "SUPER_ADMIN"
        ? null
        : { name: "Noor Academy", displayName: "Noor Academy", logoUrl: null },
    ...overrides,
  };

  // Capabilities ship with the session (GET /auth/me) and follow the academy scope: a client
  // resolves everything its modules grant, a platform Super Admin has none. Since packages are
  // gone (05-MODULES-NOT-PACKAGES) the default client here holds the management module plus video
  // — a test that cares about a switched-off feature passes `capabilities` explicitly.
  if (!("capabilities" in overrides)) {
    session.capabilities =
      session.academyId === null
        ? null
        : [
            "invoicing",
            "payroll",
            "certificates",
            "staff",
            "custom_roles",
            "trials",
            "crm",
            "student_reports",
            "audit.full",
            "report_field.custom",
            "video.conferencing",
          ];
  }

  return session;
}

export function authValue(session: Session | null, overrides = {}) {
  return {
    session,
    loading: false,
    can: (permission: string) =>
      session?.permissions.includes(permission) ?? false,
    refresh: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    changeLocale: vi.fn(async () => {}),
    exitAcademy: vi.fn(async () => {}),
    ...overrides,
  };
}

/**
 * Renders `children` inside the same providers the real tree gives them. ThemeProvider is part of
 * that contract: the root layout always supplies it, and the header's theme toggle calls useTheme(),
 * which throws without one — so a harness that omits it would fail for a reason the app never hits.
 */
export function withAuth(
  session: Session | null,
  children: React.ReactNode,
  overrides = {},
) {
  return (
    <ThemeProvider>
      <NextIntlClientProvider locale="ar" messages={arMessages}>
        <AuthContext.Provider value={authValue(session, overrides)}>
          {children}
        </AuthContext.Provider>
      </NextIntlClientProvider>
    </ThemeProvider>
  );
}
