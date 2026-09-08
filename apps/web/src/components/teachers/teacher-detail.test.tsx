import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { TeacherDetail } from "./teacher-detail";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getTeacher: vi.fn(),
  updateTeacher: vi.fn(),
  deactivateTeacher: vi.fn(),
  listSpecializations: vi.fn().mockResolvedValue({ specializations: [] }),
}));

import * as api from "@/lib/api";

function renderDetail() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(makeSession("ACADEMY_OWNER"))}>
        <TeacherDetail teacherId="t1" onBack={vi.fn()} />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("TeacherDetail (Sprint 4 §7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getTeacher).mockResolvedValue({
      teacher: {
        id: "t1",
        user_id: null,
        full_name: "Ustadh Kareem",
        phone: null,
        specialization: "Tajweed",
        session_rate_minor: 8000,
        currency: "EGP",
        timezone: null,
        payout_method: null,
        payout_handle: null,
        availability: [
          { weekday: 1, start_local: "17:00", end_local: "19:00" },
        ],
        is_active: true,
        deleted_at: null,
        created_at: "",
      },
      students: [{ id: "s1", full_name: "Yusuf", started_at: "2026-06-01" }],
      login: { has_login: false, email: null, is_active: null },
    });
    vi.mocked(api.updateTeacher).mockResolvedValue({ ok: true, changed: [] });
  });

  it("shows the rate, availability and current students", async () => {
    renderDetail();
    expect(await screen.findByTestId("teacher-rate")).toHaveTextContent("80");
    expect(screen.getByTestId("teacher-students")).toHaveTextContent("Yusuf");
    expect(screen.getByTestId("availability-editor")).toBeInTheDocument();
  });

  // The pair moves together: picking a wallet and typing the number sends both halves, because
  // a method with nowhere to send the money is a state the API (and the DB CHECK) rejects.
  it("saves a wallet payout destination as a pair", async () => {
    renderDetail();
    await screen.findByTestId("teacher-rate");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("payout-method-WALLET"));
    await user.type(screen.getByTestId("payout-handle"), "01001234567");
    await user.click(screen.getByTestId("save-teacher"));

    await waitFor(() =>
      expect(api.updateTeacher).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({
          payout_method: "WALLET",
          payout_handle: "01001234567",
        }),
      ),
    );
  });

  // Emptying the field is how a destination is removed — the method goes with it rather than
  // being left pointing at nothing.
  it("clears both halves when the destination is emptied", async () => {
    vi.mocked(api.getTeacher).mockResolvedValue({
      teacher: {
        id: "t1",
        user_id: null,
        full_name: "Ustadh Kareem",
        phone: null,
        specialization: "Tajweed",
        session_rate_minor: 8000,
        currency: "EGP",
        timezone: null,
        payout_method: "INSTAPAY",
        payout_handle: "kareem@instapay",
        availability: [],
        is_active: true,
        deleted_at: null,
        created_at: "",
      },
      students: [],
      login: { has_login: false, email: null, is_active: null },
    });

    renderDetail();
    const handle = await screen.findByTestId("payout-handle");
    expect(handle).toHaveValue("kareem@instapay");
    expect(screen.getByTestId("payout-method-INSTAPAY")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const user = userEvent.setup();
    await user.clear(handle);
    await user.click(screen.getByTestId("save-teacher"));

    await waitFor(() =>
      expect(api.updateTeacher).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ payout_method: null, payout_handle: null }),
      ),
    );
  });

  // AC-4.5 (UI side): editing the rate sends the new minor-unit rate.
  it("saves a rate change in minor units", async () => {
    renderDetail();
    await screen.findByTestId("teacher-rate");
    const user = userEvent.setup();

    const rate = screen.getByLabelText("Hourly rate");
    await user.clear(rate);
    await user.type(rate, "90");
    await user.click(screen.getByTestId("save-teacher"));

    await waitFor(() =>
      expect(api.updateTeacher).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ session_rate_minor: 9000 }),
      ),
    );
  });
});
