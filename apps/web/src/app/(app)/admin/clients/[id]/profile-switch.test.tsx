import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { ToastProvider } from "@/components/ui/toast";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../../../../messages/en.json";
import { ClientProfileCard } from "@/components/clients/client-settings";

// A client created with the wrong type (Quran academy ↔ centre) is switched from its Settings tab:
// the card previews what turns on and off, refuses when live money blocks it, and moves on confirm.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  updateClientProfile: vi.fn(),
}));

import * as api from "@/lib/api";

const client = {
  id: "c1",
  name: "Mixed Up Academy",
  client_type: "MANAGEMENT",
  status: "ACTIVE",
  created_at: "2026-01-01T00:00:00Z",
} as unknown as api.ClientDetail["client"];

const onSaved = vi.fn();

const wrap = (permissions: string[], profile: "QURAN" | "CENTRE" = "QURAN") => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <AuthContext.Provider value={authValue(makeSession("SUPER_ADMIN", { permissions }))}>
      <ToastProvider>
        <ClientProfileCard client={client} profile={profile} onSaved={onSaved} />
      </ToastProvider>
    </AuthContext.Provider>
  </NextIntlClientProvider>
);

const preview = (over: Partial<api.ClientProfileChange> = {}): api.ClientProfileChange => ({
  from: "QURAN",
  to: "CENTRE",
  turned_on: ["centre", "accounting"],
  turned_off: ["supervision", "packages"],
  blocker: null,
  has_management: true,
  ...over,
});

describe("ClientProfileCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is not offered without academy_billing.manage", () => {
    render(wrap(["academy.configure"]));
    expect(screen.queryByTestId("client-profile-card")).toBeNull();
  });

  it("marks the current type and offers the other one", () => {
    render(wrap(["academy_billing.manage"], "CENTRE"));
    expect(screen.getByTestId("client-profile-CENTRE")).toHaveAttribute("data-current", "true");
    expect(screen.getByTestId("client-profile-QURAN")).not.toHaveAttribute("data-current");
    expect(screen.getByTestId("client-profile-open")).toHaveTextContent("Switch to Quran academy");
  });

  it("previews the change, then switches on confirm", async () => {
    vi.mocked(api.updateClientProfile).mockResolvedValue(preview());
    const user = userEvent.setup();
    render(wrap(["academy_billing.manage"]));

    await user.click(screen.getByTestId("client-profile-open"));
    expect(api.updateClientProfile).toHaveBeenCalledWith("c1", "CENTRE", true);
    const plan = await screen.findByTestId("client-profile-plan");
    expect(plan).toHaveTextContent("Will be switched on");
    expect(plan).toHaveTextContent("Will be switched off");

    await user.click(screen.getByTestId("client-profile-confirm"));
    await waitFor(() => expect(api.updateClientProfile).toHaveBeenLastCalledWith("c1", "CENTRE"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("says why and cannot confirm while hour packages are still open", async () => {
    vi.mocked(api.updateClientProfile).mockResolvedValue(
      preview({ blocker: { code: "open_packages", count: 4 } }),
    );
    const user = userEvent.setup();
    render(wrap(["academy_billing.manage"]));

    await user.click(screen.getByTestId("client-profile-open"));
    expect(await screen.findByTestId("client-profile-blocked")).toHaveTextContent("4 active hour packages");
    expect(screen.getByTestId("client-profile-confirm")).toBeDisabled();
    await user.click(screen.getByTestId("client-profile-confirm"));
    expect(api.updateClientProfile).toHaveBeenCalledTimes(1);
  });
});
