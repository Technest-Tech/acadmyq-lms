import { NextIntlClientProvider } from "next-intl";
import { vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
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
    "student.read",
    "teacher.read",
    "schedule.read",
    "invoice.read",
    "payout.read",
    "academy.configure",
    "audit.read",
  ],
  TEACHER: [
    "schedule.read",
    "student.read",
    "session.write_report",
    "payout.read_own",
  ],
};

export function makeSession(
  role: AppRole,
  overrides: Partial<Session> = {},
): Session {
  return {
    user: { id: "u1", fullName: "Test User", email: "test@example.com" },
    role,
    academyId: role === "SUPER_ADMIN" ? null : "academy-1",
    permissions: PERMISSIONS_BY_ROLE[role],
    locale: "ar",
    ...overrides,
  };
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

export function withAuth(
  session: Session | null,
  children: React.ReactNode,
  overrides = {},
) {
  return (
    <NextIntlClientProvider locale="ar" messages={arMessages}>
      <AuthContext.Provider value={authValue(session, overrides)}>
        {children}
      </AuthContext.Provider>
    </NextIntlClientProvider>
  );
}
