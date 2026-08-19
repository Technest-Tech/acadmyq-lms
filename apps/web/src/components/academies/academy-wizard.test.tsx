import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import * as api from "@/lib/api";
import enMessages from "../../../messages/en.json";
import { AcademyWizard } from "./academy-wizard";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getAcademyTypes: vi.fn(),
  createAcademy: vi.fn(),
}));

const W = enMessages.academies.wizard;

function renderWizard(
  onCreated = vi.fn(),
  onCancel = vi.fn(),
  props: Partial<React.ComponentProps<typeof AcademyWizard>> = {},
) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ToastProvider>
        <AcademyWizard onCreated={onCreated} onCancel={onCancel} {...props} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
  return { onCreated, onCancel };
}

beforeEach(() => {
  vi.mocked(api.getAcademyTypes).mockResolvedValue({
    academyTypes: [
      {
        id: "type-quran",
        code: "QURAN",
        name: "Qur'an",
        description: null,
        reportFieldTemplate: [],
      },
    ],
  });
  vi.mocked(api.createAcademy).mockResolvedValue({
    academyId: "new-id",
    ownerId: "owner-id",
    reportFields: 5,
  });
});

describe("AcademyWizard (single-screen quick create)", () => {
  it("creates the academy from one screen; a paid tier goes straight to ACTIVE (no trial)", async () => {
    const user = userEvent.setup();
    const { onCreated } = renderWizard();
    await waitFor(() => expect(api.getAcademyTypes).toHaveBeenCalled());

    await user.type(screen.getByLabelText(W.name), "Noor Academy");
    // The first academy type auto-selects; this client pays from day one.
    await user.click(screen.getByTestId("start-paid"));
    await user.type(screen.getByLabelText(W.ownerEmail), "owner@noor.test");
    await user.type(screen.getByLabelText(W.ownerPassword), "secret123");

    await user.click(screen.getByRole("button", { name: W.create }));

    await waitFor(() =>
      expect(api.createAcademy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Noor Academy",
          academy_type_id: "type-quran",
          client_type: "MANAGEMENT",
          status: "ACTIVE",
          default_currency: "EGP",
          email: "owner@noor.test",
          password: "secret123",
        }),
      ),
    );
    expect(onCreated).toHaveBeenCalledWith("new-id");
  });

  it("starts every module on a trial by default, and carries the client type + extra modules", async () => {
    const user = userEvent.setup();
    renderWizard(vi.fn(), vi.fn(), {
      clientType: "MANAGEMENT",
      extraModules: [{ module: "VIDEO", price_minor: 20000 }],
    });
    await waitFor(() => expect(api.getAcademyTypes).toHaveBeenCalled());

    await user.type(screen.getByLabelText(W.name), "Trial Academy");
    await user.type(screen.getByLabelText(W.ownerEmail), "owner@free.test");
    await user.type(screen.getByLabelText(W.ownerPassword), "secret123");
    await user.click(screen.getByRole("button", { name: W.create }));

    await waitFor(() =>
      expect(api.createAcademy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "TRIAL",
          client_type: "MANAGEMENT",
          modules: [{ module: "VIDEO", price_minor: 20000 }],
        }),
      ),
    );
  });

  it("keeps Create disabled until the essentials are valid", async () => {
    const user = userEvent.setup();
    renderWizard();
    await waitFor(() => expect(api.getAcademyTypes).toHaveBeenCalled());

    const createBtn = screen.getByRole("button", { name: W.create });
    expect(createBtn).toBeDisabled();

    // Name + email but no password yet → still disabled.
    await user.type(screen.getByLabelText(W.name), "Half Academy");
    await user.type(screen.getByLabelText(W.ownerEmail), "owner@x.test");
    expect(createBtn).toBeDisabled();

    await user.type(screen.getByLabelText(W.ownerPassword), "secret123");
    expect(createBtn).toBeEnabled();
  });

  it("reveals optional branding under the Advanced disclosure and sends fixed defaults", async () => {
    const user = userEvent.setup();
    renderWizard();
    await waitFor(() => expect(api.getAcademyTypes).toHaveBeenCalled());

    // The branding panel is collapsed by default.
    expect(screen.queryByTestId("advanced-panel")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("advanced-toggle"));
    expect(screen.getByTestId("advanced-panel")).toBeInTheDocument();
    expect(screen.getByLabelText(W.brandName)).toBeInTheDocument();

    // Currency / timezone / grouping are fixed platform defaults — not shown, but still sent.
    await user.type(screen.getByLabelText(W.name), "Fixed Academy");
    await user.type(screen.getByLabelText(W.ownerEmail), "owner@x.test");
    await user.type(screen.getByLabelText(W.ownerPassword), "secret123");
    await user.click(screen.getByRole("button", { name: W.create }));

    await waitFor(() =>
      expect(api.createAcademy).toHaveBeenCalledWith(
        expect.objectContaining({
          default_currency: "EGP",
          timezone: "Africa/Cairo",
          invoice_grouping: "PER_GUARDIAN",
          billing_day: 1,
        }),
      ),
    );
  });

  it("surfaces a server validation error via a toast", async () => {
    vi.mocked(api.createAcademy).mockRejectedValue(
      new api.ApiError(422, "That subdomain is taken."),
    );
    const user = userEvent.setup();
    renderWizard();
    await waitFor(() => expect(api.getAcademyTypes).toHaveBeenCalled());

    await user.type(screen.getByLabelText(W.name), "X");
    await user.type(screen.getByLabelText(W.ownerEmail), "owner@x.test");
    await user.type(screen.getByLabelText(W.ownerPassword), "secret123");
    await user.click(screen.getByRole("button", { name: W.create }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That subdomain is taken.",
    );
  });
});
