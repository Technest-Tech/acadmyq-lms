import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { GuardianDetail } from "./guardian-detail";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getGuardian: vi.fn(),
  updateGuardian: vi.fn(),
  deactivateGuardian: vi.fn(),
  createStudent: vi.fn(),
  listTeachers: vi.fn(),
  listGuardians: vi.fn(),
}));

import * as api from "@/lib/api";

function renderDetail() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(makeSession("ACADEMY_OWNER"))}>
        <GuardianDetail guardianId="g1" onBack={vi.fn()} />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("GuardianDetail (Sprint 4 §5.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getGuardian).mockResolvedValue({
      guardian: {
        id: "g1",
        full_name: "Mohamed Family",
        whatsapp_phone: "+201000000000",
        country: "EG",
        currency: "EGP",
        notes: null,
        deleted_at: null,
        created_at: "",
      },
      children: [
        {
          id: "s1",
          full_name: "Yusuf",
          whatsapp_phone: null,
          status: "REGULAR",
          is_self_guardian: false,
          deleted_at: null,
        },
        {
          id: "s2",
          full_name: "Maryam",
          whatsapp_phone: null,
          status: "REGULAR",
          is_self_guardian: false,
          deleted_at: null,
        },
      ],
    });
    vi.mocked(api.updateGuardian).mockResolvedValue({ ok: true, changed: [] });
    vi.mocked(api.listTeachers).mockResolvedValue({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
  });

  // AC-4.1: guardian detail lists the children.
  it("lists the guardian's children", async () => {
    renderDetail();
    const children = await screen.findByTestId("guardian-children");
    expect(children).toHaveTextContent("Yusuf");
    expect(children).toHaveTextContent("Maryam");
  });

  // §5.1: add a child inline, with the guardian fixed (no separate guardian picker).
  it("opens an inline student form with the guardian fixed", async () => {
    renderDetail();
    await screen.findByTestId("guardian-children");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("add-child"));
    expect(await screen.findByTestId("student-form")).toBeInTheDocument();
    // The guardian is fixed → no guardian picker is shown.
    expect(screen.queryByLabelText("Guardian")).not.toBeInTheDocument();
  });

  it("saves guardian edits", async () => {
    renderDetail();
    await screen.findByTestId("guardian-detail");
    const user = userEvent.setup();

    const name = screen.getByLabelText("Full name");
    await user.clear(name);
    await user.type(name, "Renamed Family");
    await user.click(screen.getByTestId("save-guardian"));

    await waitFor(() =>
      expect(api.updateGuardian).toHaveBeenCalledWith(
        "g1",
        expect.objectContaining({ full_name: "Renamed Family" }),
      ),
    );
  });
});
