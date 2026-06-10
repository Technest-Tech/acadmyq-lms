import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { StudentForm } from "./student-form";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  createStudent: vi.fn(),
  listTeachers: vi.fn(),
  listGuardians: vi.fn(),
}));

import * as api from "@/lib/api";

function renderForm(onCreated = vi.fn(), onCancel = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StudentForm onCreated={onCreated} onCancel={onCancel} />
    </NextIntlClientProvider>,
  );
  return { onCreated, onCancel };
}

describe("StudentForm (Sprint 4 §5.1)", () => {
  beforeEach(() => {
    vi.mocked(api.listTeachers).mockResolvedValue({
      rows: [
        {
          id: "t1",
          user_id: null,
          full_name: "Teacher One",
          phone: null,
          specialization: null,
          session_rate_minor: 5000,
          currency: "EGP",
          timezone: null,
          availability: [],
          is_active: true,
          deleted_at: null,
          created_at: "",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    vi.mocked(api.listGuardians).mockResolvedValue({
      rows: [
        {
          id: "g1",
          full_name: "Guardian One",
          whatsapp_phone: "+201000000000",
          country: "EG",
          currency: "EGP",
          notes: null,
          deleted_at: null,
          created_at: "",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    vi.mocked(api.createStudent).mockResolvedValue({
      studentId: "s1",
      guardianId: "g1",
    });
  });

  // AC-4.2 / TC-4.3: the self-guardian toggle hides the separate guardian section
  // and sends is_self_guardian to the server.
  it("hides the guardian picker for an adult-solo student", async () => {
    const user = userEvent.setup();
    renderForm();

    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());
    expect(screen.getByLabelText("Guardian")).toBeInTheDocument();

    await user.click(screen.getByTestId("self-guardian"));
    expect(screen.queryByLabelText("Guardian")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Full name"), "Adult Learner");
    await user.click(screen.getByRole("button", { name: "Create student" }));

    await waitFor(() =>
      expect(api.createStudent).toHaveBeenCalledWith(
        expect.objectContaining({
          full_name: "Adult Learner",
          is_self_guardian: true,
        }),
      ),
    );
  });

  // AC-4.1: a guardian-linked student with an inline subscription.
  it("creates a guardian-linked student with an inline subscription", async () => {
    const user = userEvent.setup();
    const { onCreated } = renderForm();
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());

    await user.type(screen.getByLabelText("Full name"), "Yusuf");
    await user.selectOptions(screen.getByLabelText("Guardian"), "g1");
    await user.click(screen.getByTestId("add-subscription"));
    await user.type(screen.getByLabelText("Plan label"), "8/month");
    await user.type(screen.getByLabelText("Price"), "100");
    await user.type(screen.getByLabelText("Start date"), "2026-06-01");
    await user.click(screen.getByRole("button", { name: "Create student" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("s1"));
    expect(api.createStudent).toHaveBeenCalledWith(
      expect.objectContaining({
        guardian_id: "g1",
        subscription: expect.objectContaining({
          plan_label: "8/month",
          price_minor: 10000, // 100.00 → minor units
          start_date: "2026-06-01",
        }),
      }),
    );
  });
});
