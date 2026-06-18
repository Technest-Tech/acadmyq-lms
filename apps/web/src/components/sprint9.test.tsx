import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));

import { AuditLogScreen } from "@/app/audit/screen";
import { PlanAdminScreen } from "@/app/admin/plans/screen";
import { AppShell } from "@/components/app-shell";
import {
  actorInitials,
  auditTone,
} from "@/components/audit/audit-action-style";
import { UpgradePrompt } from "@/components/entitlements/upgrade-prompt";
import { StatusPage } from "@/components/status-page";
import { makeSession, withAuth } from "@/test/auth";
import arMessages from "../../messages/ar.json";

function navKeys(): string[] {
  return Array.from(document.querySelectorAll("[data-nav]")).map(
    (el) => el.getAttribute("data-nav")!,
  );
}

describe("Sprint 9 — plan gating, audit & nav (AC-9.5/9.6/9.11)", () => {
  it("shows an Owner the My-Plan nav, but not the audit link or Super-Admin plan catalog", () => {
    render(
      withAuth(
        makeSession("ACADEMY_OWNER"),
        <AppShell>
          <p>x</p>
        </AppShell>,
      ),
    );
    const keys = navKeys();
    expect(keys).toContain("plan");
    // The Audit Log link is Super-Admin-only in the sidebar; owners reach it by URL.
    expect(keys).not.toContain("audit");
    expect(keys).not.toContain("plans");
  });

  it("shows a Super Admin the plan catalog + audit, not the owner My-Plan", () => {
    render(
      withAuth(
        makeSession("SUPER_ADMIN"),
        <AppShell>
          <p>x</p>
        </AppShell>,
      ),
    );
    const keys = navKeys();
    expect(keys).toContain("plans");
    expect(keys).toContain("audit");
    expect(keys).not.toContain("plan");
  });

  it("hides plan/audit/plans from a Teacher", () => {
    render(
      withAuth(
        makeSession("TEACHER"),
        <AppShell>
          <p>x</p>
        </AppShell>,
      ),
    );
    const keys = navKeys();
    expect(keys).not.toContain("plan");
    expect(keys).not.toContain("plans");
    expect(keys).not.toContain("audit");
  });

  it("gates the audit screen on audit.read (Teacher sees a no-permission notice)", () => {
    render(withAuth(makeSession("TEACHER"), <AuditLogScreen />));
    expect(screen.getByText(arMessages.audit.noPermission)).toBeInTheDocument();
  });

  it("gates the plan-catalog screen on plan.manage (Owner sees a no-permission notice)", () => {
    render(withAuth(makeSession("ACADEMY_OWNER"), <PlanAdminScreen />));
    expect(
      screen.getByText(arMessages.planAdmin.noPermission),
    ).toBeInTheDocument();
  });

  it("renders the upgrade prompt as an upsell with a CTA (not an error)", () => {
    render(
      <NextIntlClientProvider locale="ar" messages={arMessages}>
        <UpgradePrompt />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText(arMessages.entitlements.upgradeTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(arMessages.entitlements.upgradeCta),
    ).toBeInTheDocument();
  });

  it("renders a bilingual 404 status page with a home action", () => {
    render(
      <NextIntlClientProvider locale="ar" messages={arMessages}>
        <StatusPage variant="notFound" />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText(arMessages.errors.notFoundTitle),
    ).toBeInTheDocument();
    expect(screen.getByText(arMessages.errors.goHome)).toBeInTheDocument();
  });
});

describe("audit action styling", () => {
  it("maps actions to sensible tones and builds actor initials", () => {
    expect(auditTone("student.create")).toBe("create");
    expect(auditTone("invoice.closed")).toBe("money");
    expect(auditTone("teacher.deactivate")).toBe("destroy");
    expect(auditTone("auth.login")).toBe("auth");
    expect(actorInitials("Owner Noor")).toBe("ON");
    expect(actorInitials(null)).toBe("•");
  });
});
