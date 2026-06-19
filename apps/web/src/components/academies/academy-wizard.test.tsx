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
  getPlanCatalog: vi.fn(),
  createAcademy: vi.fn(),
}));

const W = enMessages.academies.wizard;

function renderWizard(onCreated = vi.fn(), onCancel = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ToastProvider>
        <AcademyWizard onCreated={onCreated} onCancel={onCancel} />
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
  vi.mocked(api.getPlanCatalog).mockResolvedValue({
    plans: [
      {
        id: "plan-free",
        code: "FREE",
        name: "Free",
        price_minor: 0,
        currency: "EGP",
        is_active: true,
        features: { capabilities: [], limits: { maxStudents: 5, maxTeachers: 2 } },
      },
      {
        id: "plan-pro",
        code: "PRO",
        name: "Pro",
        price_minor: 99900,
        currency: "EGP",
        is_active: true,
        features: { capabilities: [], limits: { maxStudents: 60, maxTeachers: 15 } },
      },
    ],
    addOns: [],
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
    await waitFor(() => expect(api.getPlanCatalog).toHaveBeenCalled());

    await user.type(screen.getByLabelText(W.name), "Noor Academy");
    // The first academy type auto-selects; pick the paid PRO plan.
    await user.click(screen.getByTestId("plan-PRO"));
    await user.type(screen.getByLabelText(W.ownerEmail), "owner@noor.test");
    await user.type(screen.getByLabelText(W.ownerPassword), "secret123");

    await user.click(screen.getByRole("button", { name: W.create }));

    await waitFor(() =>
      expect(api.createAcademy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Noor Academy",
          academy_type_id: "type-quran",
          plan_id: "plan-pro",
          status: "ACTIVE",
          default_currency: "EGP",
          email: "owner@noor.test",
          password: "secret123",
        }),
      ),
    );
    expect(onCreated).toHaveBeenCalledWith("new-id");
  });

  it("sends status TRIAL when the FREE plan is chosen (5-day free trial)", async () => {
    const user = userEvent.setup();
    renderWizard();
    await waitFor(() => expect(api.getPlanCatalog).toHaveBeenCalled());

    await user.type(screen.getByLabelText(W.name), "Free Academy");
    await user.click(screen.getByTestId("plan-FREE"));
    await user.type(screen.getByLabelText(W.ownerEmail), "owner@free.test");
    await user.type(screen.getByLabelText(W.ownerPassword), "secret123");
    await user.click(screen.getByRole("button", { name: W.create }));

    await waitFor(() =>
      expect(api.createAcademy).toHaveBeenCalledWith(
        expect.objectContaining({ plan_id: "plan-free", status: "TRIAL" }),
      ),
    );
  });

  it("keeps Create disabled until the essentials are valid", async () => {
    const user = userEvent.setup();
    renderWizard();
    await waitFor(() => expect(api.getPlanCatalog).toHaveBeenCalled());

    const createBtn = screen.getByRole("button", { name: W.create });
    expect(createBtn).toBeDisabled();

    // Name + plan + email but no password yet → still disabled.
    await user.type(screen.getByLabelText(W.name), "Half Academy");
    await user.click(screen.getByTestId("plan-PRO"));
    await user.type(screen.getByLabelText(W.ownerEmail), "owner@x.test");
    expect(createBtn).toBeDisabled();

    await user.type(screen.getByLabelText(W.ownerPassword), "secret123");
    expect(createBtn).toBeEnabled();
  });

  it("reveals optional branding under the Advanced disclosure and sends fixed defaults", async () => {
    const user = userEvent.setup();
    renderWizard();
    await waitFor(() => expect(api.getPlanCatalog).toHaveBeenCalled());

    // The branding panel is collapsed by default.
    expect(screen.queryByTestId("advanced-panel")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("advanced-toggle"));
    expect(screen.getByTestId("advanced-panel")).toBeInTheDocument();
    expect(screen.getByLabelText(W.brandName)).toBeInTheDocument();

    // Currency / timezone / grouping are fixed platform defaults — not shown, but still sent.
    await user.type(screen.getByLabelText(W.name), "Fixed Academy");
    await user.click(screen.getByTestId("plan-FREE"));
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
    await waitFor(() => expect(api.getPlanCatalog).toHaveBeenCalled());

    await user.type(screen.getByLabelText(W.name), "X");
    await user.click(screen.getByTestId("plan-PRO"));
    await user.type(screen.getByLabelText(W.ownerEmail), "owner@x.test");
    await user.type(screen.getByLabelText(W.ownerPassword), "secret123");
    await user.click(screen.getByRole("button", { name: W.create }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That subdomain is taken.",
    );
  });
});
