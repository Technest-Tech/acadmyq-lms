import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { WhatsAppPage } from "./whatsapp-page";

// The academy's WhatsApp page: the number for the owner, the lesson reminders once a Super Admin
// switched them on for the client, and a centre's absence alert — numbered in the order shown.

const auth = vi.hoisted(() => ({
  perms: new Set<string>(),
  capabilities: [] as string[] | null,
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    can: (p: string) => auth.perms.has(p),
    session: { role: "ACADEMY_OWNER", academyId: "a1", capabilities: auth.capabilities },
  }),
}));

vi.mock("@/components/settings/whatsapp-manager", () => ({
  WhatsAppManager: () => <div data-testid="number-card" />,
}));
vi.mock("@/components/settings/lesson-reminders-manager", () => ({
  LessonRemindersManager: () => <div data-testid="reminders-card" />,
}));
vi.mock("@/components/settings/absence-alert-manager", () => ({
  AbsenceAlertManager: () => <div data-testid="absence-card" />,
}));

const wrap = () =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WhatsAppPage />
    </NextIntlClientProvider>,
  );

describe("WhatsAppPage", () => {
  beforeEach(() => {
    auth.perms = new Set(["settings.manage", "student.update", "teacher.update"]);
    auth.capabilities = ["whatsapp.automation", "whatsapp.group_reminders"];
  });

  it("walks the owner from linking the number to the reminders", () => {
    wrap();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(enMessages.whatsappPage.title);
    const steps = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(steps).toEqual([`1${enMessages.whatsappPage.stepNumber}`, `2${enMessages.whatsappPage.stepReminders}`]);
    expect(screen.getByTestId("number-card")).toBeInTheDocument();
    expect(screen.getByTestId("reminders-card")).toBeInTheDocument();
    expect(screen.queryByTestId("absence-card")).not.toBeInTheDocument();
  });

  it("shows only the number while the reminders are not switched on for the client", () => {
    auth.capabilities = ["whatsapp.automation"];
    wrap();

    expect(screen.getByTestId("number-card")).toBeInTheDocument();
    expect(screen.queryByTestId("reminders-card")).not.toBeInTheDocument();
    expect(screen.getByText(enMessages.whatsappPage.subtitleNumberOnly)).toBeInTheDocument();
  });

  it("gives a centre its absence alert as the last step", () => {
    auth.capabilities = ["whatsapp.automation", "whatsapp.group_reminders", "centre", "groups"];
    wrap();

    expect(screen.getAllByRole("heading", { level: 2 }).at(-1)).toHaveTextContent(`3${enMessages.whatsappPage.stepAbsence}`);
    expect(screen.getByTestId("absence-card")).toBeInTheDocument();
  });

  it("lets a supervisor who assigns groups reach the reminders, not the number", () => {
    auth.perms = new Set(["student.update"]);
    wrap();

    expect(screen.queryByTestId("number-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("reminders-card")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(`1${enMessages.whatsappPage.stepReminders}`);
  });

  it("is closed to a client without the WhatsApp module", () => {
    auth.capabilities = [];
    wrap();

    expect(screen.getByText(enMessages.whatsappPage.noAccess)).toBeInTheDocument();
    expect(screen.queryByTestId("number-card")).not.toBeInTheDocument();
  });
});
