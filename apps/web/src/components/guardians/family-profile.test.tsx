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
  deleteGuardian: vi.fn(),
  reactivateGuardian: vi.fn(),
  updateStudent: vi.fn(),
  carryStudentCharges: vi.fn(),
  getGuardianAdvanceDues: vi.fn(),
  suspendGuardian: vi.fn(),
  resumeGuardian: vi.fn(),
  listStudents: vi.fn(),
  listGuardians: vi.fn(),
  listTeachers: vi.fn(),
  createStudent: vi.fn(),
}));

// The parent-page card on the profile fetches its link on mount.
vi.mock("@/lib/portal-api", () => ({
  getPortalLink: vi.fn(() => Promise.resolve({ url: null, issued_at: null })),
  issuePortalLink: vi.fn(),
  revokePortalLink: vi.fn(),
  sendPortalLink: vi.fn(),
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
function renderProfile({ price = true, only, capabilities }: { price?: boolean; only?: string[]; capabilities?: string[] } = {}) {
  const permissions = only ?? (price ? [...OWNER_CAPS, "student.set_price"] : OWNER_CAPS);
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider
        value={authValue(makeSession("ACADEMY_OWNER", { permissions, ...(capabilities ? { capabilities } : {}) }))}
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

  // Lingo, 2026-10-28: the child moved, their bills stayed behind with the old parent.
  it("says what came along with a moved child, and what could not", async () => {
    vi.mocked(api.listStudents).mockResolvedValue({
      rows: [{ id: "s9", full_name: "Bilal", guardian_name: "Another Family", deleted_at: null } as unknown as api.StudentRow],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    vi.mocked(api.updateStudent).mockResolvedValue({
      ok: true,
      changed: ["guardian_id"],
      charges: { lines: 2, invoices: 2, stuck: 1, amounts: [{ currency: "EGP", amount_minor: 90000 }] },
    });
    renderProfile();
    await screen.findByTestId("guardian-children");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("link-child"));
    await user.click(await screen.findByTestId("link-student-picker"));
    await user.click(await screen.findByText("Bilal"));
    await user.click(screen.getByTestId("confirm-link-child"));

    expect(await screen.findByText(/with what they owe: EGP\s?900/)).toBeInTheDocument();
    expect(screen.getByText(/1 charge stays on a closed bill/)).toBeInTheDocument();
  });

  it("offers to send a moved child's charges after them, and does", async () => {
    const base = await api.getGuardian("g1");
    const stray = { student_id: "s7", student_name: "Omar", guardian_id: "g2", guardian_name: "Ayat Mohsen", movable: true, amounts: [{ currency: "EGP", amount_minor: 45000 }] };
    vi.mocked(api.getGuardian).mockResolvedValueOnce({ ...base, moved_away: [stray] }).mockResolvedValue({ ...base, moved_away: [] });
    vi.mocked(api.carryStudentCharges).mockResolvedValue({ charges: { lines: 1, invoices: 1, stuck: 0, amounts: [{ currency: "EGP", amount_minor: 45000 }] } });
    renderProfile();

    const card = await screen.findByTestId("moved-away");
    expect(within(card).getByText("Omar")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Ayat Mohsen" })).toHaveAttribute("href", "/guardians/g2");
    await userEvent.setup().click(within(card).getByTestId("carry-s7"));

    await waitFor(() => expect(api.carryStudentCharges).toHaveBeenCalledWith("s7", "g1"));
    expect(await screen.findByText(/Omar’s charges \(EGP\s?450.*\) moved to Ayat Mohsen/)).toBeInTheDocument();
    expect(screen.queryByTestId("moved-away")).not.toBeInTheDocument();
  });

  it("names a moved child's charges it cannot split, without a button", async () => {
    const base = await api.getGuardian("g1");
    vi.mocked(api.getGuardian).mockResolvedValue({
      ...base,
      moved_away: [{ student_id: "s7", student_name: "Omar", guardian_id: "g2", guardian_name: "Ayat Mohsen", movable: false, amounts: [{ currency: "EGP", amount_minor: 45000 }] }],
    });
    renderProfile();

    const card = await screen.findByTestId("moved-away");
    expect(within(card).getByText(enMessages.guardians.detail.movedAway.stuck)).toBeInTheDocument();
    expect(within(card).queryByTestId("carry-s7")).not.toBeInTheDocument();
  });

  // Adding a child is one flow: the "already in the system" path must be reachable from the
  // primary Add button, not only from a second button somewhere else on the page.
  it("offers the existing-student picker inside the add flow", async () => {
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
    await screen.findByTestId("family-profile");
    const user = userEvent.setup();

    // The primary action opens on "new student" — the create form, not a picker.
    await user.click(screen.getByTestId("add-child"));
    expect(screen.getByTestId("student-form")).toBeInTheDocument();
    expect(screen.queryByTestId("link-student-picker")).not.toBeInTheDocument();

    // …and the other way in is one click away, in the same modal.
    await user.click(screen.getByTestId("add-mode-existing"));
    expect(
      await screen.findByTestId("link-student-picker"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("student-form")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("link-student-picker"));
    await user.click(await screen.findByText("Bilal"));
    await user.click(screen.getByTestId("confirm-link-child"));

    await waitFor(() =>
      expect(api.updateStudent).toHaveBeenCalledWith("s9", {
        guardian_id: "g1",
      }),
    );
  });

  it("says so when there is no one left to move in", async () => {
    renderProfile();
    await screen.findByTestId("family-profile");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("link-child"));

    expect(
      await screen.findByText(
        "Every active student is already in this family.",
      ),
    ).toBeInTheDocument();
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

  it("deletes a parent with their children only once the children are ticked too", async () => {
    vi.mocked(api.deleteGuardian).mockResolvedValue({ ok: true, removed_children: 2 });
    renderProfile();
    await screen.findByTestId("family-profile");
    const user = userEvent.setup();

    // The children are named before the click.
    expect(screen.getByText(/with them:/i)).toBeInTheDocument();
    await user.click(screen.getByTestId("deactivate-guardian"));

    const confirm = screen.getByTestId("confirm-deactivate-guardian");
    expect(confirm).toBeDisabled();
    await user.click(within(screen.getByTestId("delete-guardian-children")).getByRole("checkbox"));
    await user.click(confirm);

    await waitFor(() => expect(api.deleteGuardian).toHaveBeenCalledWith("g1", true));
  });

  it("does not offer to take the children for a role that may not remove students", async () => {
    renderProfile({ only: OWNER_CAPS.filter((c) => c !== "student.deactivate") });
    await screen.findByTestId("family-profile");

    expect(screen.getByTestId("deactivate-guardian")).toBeDisabled();
    expect(screen.getByText(/deactivate 2 active students first/i)).toBeInTheDocument();
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

describe("FamilyProfile — suspending a family", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getGuardian).mockResolvedValue({
      guardian: { id: "g1", full_name: "Mohamed Family", whatsapp_phone: "+201000000000", country: "EG", currency: "EGP", notes: null, deleted_at: null, created_at: "2026-01-04T00:00:00Z" },
      children: [child()],
    });
  });

  it("lists the dues billed ahead, lets the desk tick which to cancel, and suspends with them", async () => {
    vi.mocked(api.getGuardianAdvanceDues).mockResolvedValue({
      can_cancel: true,
      dues: [
        { id: "l1", student_id: "s1", student_name: "Yusuf", description: "English A1 — June 2026", kind: "GROUP", date: "2026-06-01", remaining_minor: 45000, currency: "EGP" },
        { id: "l2", student_id: "s1", student_name: "Yusuf", description: "8 × 40 min — June", kind: "PACKAGE", date: "2026-06-03", remaining_minor: 72000, currency: "EGP" },
      ],
    });
    vi.mocked(api.suspendGuardian).mockResolvedValue({ ok: true, paused_schedules: 1, cancelled: [{ currency: "EGP", amount_minor: 45000 }] });
    const user = userEvent.setup();
    renderProfile({ capabilities: ["invoicing", "accounting", "centre"] });

    // Asked first — nothing goes on the first click, and nothing is ticked for the desk.
    await user.click(await screen.findByTestId("suspend-guardian"));
    expect(api.suspendGuardian).not.toHaveBeenCalled();
    const list = await screen.findByTestId("advance-dues");
    expect(within(list).getByText(/English A1/)).toBeInTheDocument();
    expect(within(list).getByText(new RegExp(enMessages.guardians.detail.advanceDuePackageEnds))).toBeInTheDocument();
    expect(screen.getByTestId("advance-due-l1")).not.toBeChecked();

    await user.click(screen.getByTestId("advance-due-l1"));
    expect(screen.getByTestId("advance-dues-total").textContent).toContain("450");
    await user.click(screen.getByTestId("suspend-confirm-go"));
    await waitFor(() => expect(api.suspendGuardian).toHaveBeenCalledWith("g1", ["l1"]));
    expect(await screen.findByText(/450/, { selector: "p, span, div" })).toBeInTheDocument();
  });

  it("suspends straight from the confirm when nothing was billed ahead", async () => {
    vi.mocked(api.getGuardianAdvanceDues).mockResolvedValue({ can_cancel: false, dues: [] });
    vi.mocked(api.suspendGuardian).mockResolvedValue({ ok: true, paused_schedules: 1, cancelled: [] });
    const user = userEvent.setup();
    renderProfile({ capabilities: ["invoicing", "accounting", "centre"] });

    await user.click(await screen.findByTestId("suspend-guardian"));
    expect(await screen.findByText(enMessages.guardians.detail.advanceDuesNone)).toBeInTheDocument();
    await user.click(screen.getByTestId("suspend-confirm-go"));
    await waitFor(() => expect(api.suspendGuardian).toHaveBeenCalledWith("g1", []));
  });

  it("suspends on the click, as it always has, for an academy that is not a centre — nothing asked, no dues fetched", async () => {
    vi.mocked(api.suspendGuardian).mockResolvedValue({ ok: true, paused_schedules: 1 });
    const user = userEvent.setup();
    renderProfile({ capabilities: ["invoicing", "accounting"] });

    await user.click(await screen.findByTestId("suspend-guardian"));
    await waitFor(() => expect(api.suspendGuardian).toHaveBeenCalledWith("g1"));
    expect(screen.queryByTestId("suspend-confirm")).toBeNull();
    expect(api.getGuardianAdvanceDues).not.toHaveBeenCalled();
  });
});
