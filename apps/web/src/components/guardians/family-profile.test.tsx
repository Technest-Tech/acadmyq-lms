import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { FamilyProfile } from "./family-profile";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getGuardian: vi.fn(),
  updateGuardian: vi.fn(),
  deactivateGuardian: vi.fn(),
  reactivateGuardian: vi.fn(),
  updateStudent: vi.fn(),
  listStudents: vi.fn(),
  listGuardians: vi.fn(),
  listTeachers: vi.fn(),
  createStudent: vi.fn(),
}));

import * as api from "@/lib/api";

function child(overrides: Partial<api.GuardianChild> = {}): api.GuardianChild {
  return {
    id: "s1",
    full_name: "Yusuf",
    whatsapp_phone: null,
    country: null,
    status: "REGULAR",
    is_self_guardian: false,
    notes: null,
    deleted_at: null,
    created_at: "2026-03-12T00:00:00Z",
    teacher_id: "t1",
    teacher_name: "Ustadh Karim",
    subscription_id: "sub1",
    plan_label: "8/month",
    sessions_per_month: 8,
    price_minor: 12000,
    price_currency: "EGP",
    price_basis: "PER_SESSION",
    start_date: "2026-03-01",
    ...overrides,
  };
}

const OWNER_CAPS = [
  "guardian.read",
  "guardian.create",
  "guardian.update",
  "student.read",
  "student.create",
  "student.update",
  "student.deactivate",
];

/** `student.set_price` is the capability that decides whether a child's rate is rendered. */
function renderProfile({ price = true }: { price?: boolean } = {}) {
  const permissions = price ? [...OWNER_CAPS, "student.set_price"] : OWNER_CAPS;
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider
        value={authValue(makeSession("ACADEMY_OWNER", { permissions }))}
      >
        <FamilyProfile guardianId="g1" />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("FamilyProfile", () => {
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
        created_at: "2026-01-04T00:00:00Z",
      },
      children: [
        child(),
        child({
          id: "s2",
          full_name: "Maryam",
          teacher_name: null,
          plan_label: null,
        }),
      ],
    });
    vi.mocked(api.updateGuardian).mockResolvedValue({ ok: true, changed: [] });
    vi.mocked(api.updateStudent).mockResolvedValue({ ok: true, changed: [] });
    vi.mocked(api.listStudents).mockResolvedValue({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 200,
    });
  });

  it("lists the family's children with their teacher", async () => {
    renderProfile();
    const children = await screen.findByTestId("guardian-children");
    expect(children).toHaveTextContent("Yusuf");
    expect(children).toHaveTextContent("Ustadh Karim");
    expect(children).toHaveTextContent("Maryam");
    // A child with no teacher says so rather than showing a blank.
    expect(children).toHaveTextContent("No teacher");
  });

  // The whole point of the redesign: a child's details without leaving the family.
  it("expands a child to their rate and contact details", async () => {
    renderProfile();
    await screen.findByTestId("guardian-children");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("child-toggle-s1"));

    const children = screen.getByTestId("guardian-children");
    expect(within(children).getByText("Rate")).toBeInTheDocument();
    expect(within(children).getByText(/120/)).toBeInTheDocument();
    expect(within(children).getByText("Open profile")).toBeInTheDocument();
  });

  it("edits a child in place", async () => {
    renderProfile();
    await screen.findByTestId("guardian-children");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("child-toggle-s1"));
    await user.click(screen.getByTestId("edit-child-s1"));

    // Scoped: the billing-contact card below carries a "Full name" of its own.
    const name = within(screen.getByTestId("guardian-children")).getByLabelText(
      "Full name",
    );
    await user.clear(name);
    await user.type(name, "Yusuf Mohamed");
    await user.click(screen.getByTestId("save-child-s1"));

    await waitFor(() =>
      expect(api.updateStudent).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({ full_name: "Yusuf Mohamed" }),
      ),
    );
  });

  // The button existed before and silently did nothing — the API dropped guardian_id on PATCH.
  it("moves an existing student into this family", async () => {
    vi.mocked(api.listStudents).mockResolvedValue({
      rows: [
        {
          id: "s9",
          full_name: "Bilal",
          guardian_name: "Another Family",
          deleted_at: null,
        } as unknown as api.StudentRow,
      ],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    renderProfile();
    await screen.findByTestId("guardian-children");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("link-child"));
    await user.click(await screen.findByTestId("link-student-picker"));
    await user.click(await screen.findByText("Bilal"));
    await user.click(screen.getByTestId("confirm-link-child"));

    await waitFor(() =>
      expect(api.updateStudent).toHaveBeenCalledWith("s9", {
        guardian_id: "g1",
      }),
    );
  });

  it("saves the billing contact", async () => {
    renderProfile();
    await screen.findByTestId("family-profile");
    const user = userEvent.setup();

    const name = screen.getByLabelText("Full name", { selector: "input" });
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

  it("blocks deactivation while the family still has active students", async () => {
    renderProfile();
    await screen.findByTestId("family-profile");

    expect(screen.getByTestId("deactivate-guardian")).toBeDisabled();
    expect(
      screen.getByText(/deactivate 2 active students first/i),
    ).toBeInTheDocument();
  });

  it("offers the way back on a deactivated parent", async () => {
    vi.mocked(api.getGuardian).mockResolvedValue({
      guardian: {
        id: "g1",
        full_name: "Paused Family",
        whatsapp_phone: "+201000000000",
        country: "EG",
        currency: "EGP",
        notes: null,
        deleted_at: "2026-05-01T00:00:00Z",
        created_at: "2026-01-04T00:00:00Z",
      },
      children: [],
    });
    vi.mocked(api.reactivateGuardian).mockResolvedValue({ ok: true });
    renderProfile();
    await screen.findByTestId("family-profile");
    const user = userEvent.setup();

    expect(screen.queryByTestId("deactivate-guardian")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("reactivate-guardian"));

    await waitFor(() =>
      expect(api.reactivateGuardian).toHaveBeenCalledWith("g1"),
    );
  });

  // A supervisor runs the academy but never sees the money (docs: supervisor role).
  it("hides a child's rate from a role that may not price", async () => {
    renderProfile({ price: false });
    await screen.findByTestId("guardian-children");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("child-toggle-s1"));

    const children = screen.getByTestId("guardian-children");
    expect(within(children).queryByText("Rate")).not.toBeInTheDocument();
  });
});
