import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import enMessages from "../../../messages/en.json";
import { AcademyWizard } from "./academy-wizard";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getAcademyTypes: vi.fn(),
  createAcademy: vi.fn(),
}));

const W = enMessages.academies.wizard;

function renderWizard(onCreated = vi.fn(), onCancel = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AcademyWizard onCreated={onCreated} onCancel={onCancel} />
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

describe("AcademyWizard (Sprint 3 §4.1)", () => {
  it("walks the steps and creates the academy with the entered payload", async () => {
    const user = userEvent.setup();
    const { onCreated } = renderWizard();
    await waitFor(() => expect(api.getAcademyTypes).toHaveBeenCalled());

    // Step 1 — Identity
    await user.type(screen.getByLabelText(W.name), "Noor Academy");
    await user.clear(screen.getByLabelText(W.currency));
    await user.type(screen.getByLabelText(W.currency), "EGP");
    await user.click(screen.getByRole("button", { name: W.next }));

    // Step 2 — Billing
    expect(screen.getByTestId("step-billing")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: W.next }));

    // Step 3 — Branding (reserved)
    expect(screen.getByTestId("step-branding")).toHaveTextContent(W.reserved);
    await user.click(screen.getByRole("button", { name: W.next }));

    // Step 4 — Owner
    await user.type(screen.getByLabelText(W.ownerName), "Owner Noor");
    await user.type(screen.getByLabelText(W.ownerEmail), "owner@noor.test");
    await user.click(screen.getByRole("button", { name: W.next }));

    // Step 5 — Review → Create
    expect(screen.getByTestId("step-review")).toHaveTextContent("Noor Academy");
    await user.click(screen.getByRole("button", { name: W.create }));

    await waitFor(() =>
      expect(api.createAcademy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Noor Academy",
          academy_type_id: "type-quran",
          default_currency: "EGP",
          owner_email: "owner@noor.test",
        }),
      ),
    );
    expect(onCreated).toHaveBeenCalledWith("new-id");
  });

  it("surfaces a server validation error and returns to step 1", async () => {
    vi.mocked(api.createAcademy).mockRejectedValue(
      new api.ApiError(422, "That subdomain is taken."),
    );
    const user = userEvent.setup();
    renderWizard();
    await waitFor(() => expect(api.getAcademyTypes).toHaveBeenCalled());

    // Jump to review quickly (fields can be empty for this error-path test).
    await user.type(screen.getByLabelText(W.name), "X");
    for (let i = 0; i < 4; i++) {
      await user.click(screen.getByRole("button", { name: W.next }));
    }
    await user.click(screen.getByRole("button", { name: W.create }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That subdomain is taken.",
    );
    expect(screen.getByTestId("step-identity")).toBeInTheDocument();
  });
});
