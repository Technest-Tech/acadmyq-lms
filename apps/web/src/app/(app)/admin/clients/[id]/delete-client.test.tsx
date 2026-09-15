import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { ToastProvider } from "@/components/ui/toast";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../../../../messages/en.json";
import { DeleteClientCard } from "./screen";

// The one irreversible action on the client page: hidden without academy.delete, and dead until
// the client's exact name is typed.

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
}));

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  deleteClient: vi.fn(),
}));

import * as api from "@/lib/api";

const client = {
  id: "c1",
  name: "Doomed Academy",
  client_type: "MANAGEMENT",
  status: "ACTIVE",
  suspended_at: null,
  suspended_reason: null,
  plan_id: null,
  default_currency: "EGP",
  timezone: "Africa/Cairo",
  invoice_grouping: "PER_GUARDIAN",
  billing_day: 1,
  brand_display_name: null,
  brand_logo_url: null,
  subdomain: null,
  created_at: "2026-01-01T00:00:00Z",
} as unknown as api.ClientDetail["client"];

const wrap = (permissions: string[]) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <AuthContext.Provider value={authValue(makeSession("SUPER_ADMIN", { permissions }))}>
      <ToastProvider>
        <DeleteClientCard client={client} />
      </ToastProvider>
    </AuthContext.Provider>
  </NextIntlClientProvider>
);

describe("DeleteClientCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.deleteClient).mockResolvedValue({ ok: true, deleted: {} });
  });

  it("is not offered without academy.delete", () => {
    render(wrap(["academy.suspend", "academy.configure"]));
    expect(screen.queryByTestId("client-delete-card")).toBeNull();
  });

  it("stays disabled until the exact name is typed, then deletes and leaves the page", async () => {
    const user = userEvent.setup();
    render(wrap(["academy.delete"]));

    await user.click(screen.getByTestId("client-delete-open"));
    const confirm = () => screen.getByTestId("client-delete-confirm");
    expect(confirm()).toBeDisabled();

    await user.type(screen.getByTestId("client-delete-name"), "doomed academy");
    expect(confirm()).toBeDisabled();
    await user.click(confirm());
    expect(api.deleteClient).not.toHaveBeenCalled();

    await user.clear(screen.getByTestId("client-delete-name"));
    await user.type(screen.getByTestId("client-delete-name"), "Doomed Academy");
    expect(confirm()).toBeEnabled();
    await user.click(confirm());

    await waitFor(() => expect(api.deleteClient).toHaveBeenCalledWith("c1", "Doomed Academy"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/clients"));
  });
});
