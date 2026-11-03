import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { ToastProvider } from "@/components/ui/toast";
import { AbsenceAlertManager } from "./absence-alert-manager";

// Settings → WhatsApp → the centre's absence alert: the switch and the wording, saved together; the
// preview is the API's rendering, so the owner reads what the parent will.

const auth = vi.hoisted(() => ({ perms: new Set(["settings.manage"]) }));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    can: (p: string) => auth.perms.has(p),
    session: { role: "ACADEMY_OWNER", academyId: "a1", capabilities: ["centre", "groups", "whatsapp.automation"] },
  }),
}));

vi.mock("@/lib/portal-groups-api", () => ({
  getAbsenceAlert: vi.fn(),
  updateAbsenceAlert: vi.fn(),
  previewAbsenceAlert: vi.fn(),
}));

import * as api from "@/lib/portal-groups-api";

const settings = (over: Partial<api.AbsenceAlertSettings> = {}): api.AbsenceAlertSettings => ({
  enabled: false,
  message: null,
  default_message: "🏫 *{{academy}}*\nنود إبلاغكم بأن {{student}} لم يحضر حصة مجموعة «{{group}}» يوم {{date}} الساعة {{time}}.",
  placeholders: ["student", "group", "date", "time", "academy"],
  sample: "🏫 *Lingo*\nنود إبلاغكم بأن آدم لم يحضر حصة مجموعة «English A1» يوم الاثنين الساعة 5:00 م.",
  ...over,
});

function renderManager() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ToastProvider>
        <AbsenceAlertManager />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("AbsenceAlertManager", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auth.perms = new Set(["settings.manage"]);
    vi.mocked(api.previewAbsenceAlert).mockResolvedValue({ sample: "preview" });
  });

  it("shows the switch off with the default wording as the placeholder and the API's sample", async () => {
    vi.mocked(api.getAbsenceAlert).mockResolvedValue(settings());
    renderManager();

    const toggle = await screen.findByTestId("absence-alert-enabled");
    expect(toggle).not.toBeChecked();
    expect(screen.getByTestId("absence-alert-message")).toHaveValue("");
    expect(screen.getByTestId("absence-alert-message")).toHaveAttribute("placeholder", expect.stringContaining("{{student}}"));
    expect(screen.getByTestId("absence-alert-sample")).toHaveTextContent("آدم لم يحضر");
    expect(screen.getByTestId("absence-alert-save")).toBeDisabled();
  });

  it("switches it on, builds the wording by tapping a fact, and saves both", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getAbsenceAlert).mockResolvedValue(settings());
    vi.mocked(api.updateAbsenceAlert).mockResolvedValue(settings({ enabled: true, message: "غاب {{student}}", sample: "غاب آدم" }));
    renderManager();

    await user.click(await screen.findByTestId("absence-alert-enabled"));
    await user.type(screen.getByTestId("absence-alert-message"), "غاب ");
    await user.click(screen.getByTestId("absence-alert-fact-student"));
    expect(screen.getByTestId("absence-alert-message")).toHaveValue("غاب {{student}}");

    await user.click(screen.getByTestId("absence-alert-save"));

    await waitFor(() => expect(api.updateAbsenceAlert).toHaveBeenCalledWith({ enabled: true, message: "غاب {{student}}" }));
    expect(await screen.findByTestId("absence-alert-sample")).toHaveTextContent("غاب آدم");
    expect(screen.getByTestId("absence-alert-enabled")).toBeChecked();
    expect(screen.getByTestId("absence-alert-save")).toBeDisabled();
  });

  it("goes back to the default wording with one tap", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getAbsenceAlert).mockResolvedValue(settings({ enabled: true, message: "غاب {{student}}", sample: "غاب آدم" }));
    vi.mocked(api.updateAbsenceAlert).mockResolvedValue(settings({ enabled: true }));
    renderManager();

    await user.click(await screen.findByTestId("absence-alert-use-default"));
    expect(screen.getByTestId("absence-alert-message")).toHaveValue("");
    await user.click(screen.getByTestId("absence-alert-save"));

    await waitFor(() => expect(api.updateAbsenceAlert).toHaveBeenCalledWith({ enabled: true, message: null }));
  });

  it("is read-only without settings.manage", async () => {
    auth.perms = new Set();
    vi.mocked(api.getAbsenceAlert).mockResolvedValue(settings());
    renderManager();

    expect(await screen.findByTestId("absence-alert-enabled")).toBeDisabled();
    expect(screen.getByTestId("absence-alert-message")).toBeDisabled();
    expect(screen.queryByTestId("absence-alert-save")).toBeNull();
  });
});
