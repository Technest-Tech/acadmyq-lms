import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { StudentForm } from "./student-form";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  createStudent: vi.fn(),
  listTeachers: vi.fn(),
  listGuardians: vi.fn(),
}));

import * as api from "@/lib/api";

/**
 * `student.set_price` is what gates the package fields, so it is spelled out per test rather
 * than inherited from the role fixture — the two halves of the "active student" card (with a
 * package, and without one) are exactly the difference between holding it and not.
 */
function renderForm({
  canPrice = true,
  canManagePackages = false,
  capabilities,
  onCreated = vi.fn(),
  onCancel = vi.fn(),
}: {
  canPrice?: boolean;
  canManagePackages?: boolean;
  capabilities?: string[];
  onCreated?: () => void;
  onCancel?: () => void;
} = {}) {
  const session = makeSession(
    "ACADEMY_OWNER",
    capabilities !== undefined ? { capabilities } : {},
  );
  const permissions = [
    ...session.permissions,
    ...(canPrice ? ["student.set_price"] : []),
    ...(canManagePackages ? ["package.manage"] : []),
  ];

  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue({ ...session, permissions })}>
        <StudentForm onCreated={onCreated} onCancel={onCancel} />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
  return { onCreated, onCancel };
}

describe("StudentForm (Sprint 4 §5.1)", () => {
  beforeEach(() => {
    // Call counts are asserted per test (a refused save must not have reached the API), so
    // they cannot carry over from the previous one.
    vi.clearAllMocks();
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
          payout_method: null,
          payout_handle: null,
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

  // AC-4.2 / TC-4.3: picking "single" over "family" hides the separate guardian section
  // and sends is_self_guardian to the server.
  it("hides the guardian picker for an adult-solo student", async () => {
    const user = userEvent.setup();
    renderForm();

    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());
    expect(screen.getByTestId("guardian-select")).toBeInTheDocument();

    await user.click(screen.getByTestId("guardian-mode-single"));
    expect(screen.queryByTestId("guardian-select")).not.toBeInTheDocument();

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

  // AC-4.1: a guardian-linked student is created as a TRIAL — pricing/teacher/schedule are
  // completed later from the student's profile (the form no longer has those steps).
  it("creates a guardian-linked student as a trial", async () => {
    const user = userEvent.setup();
    const { onCreated } = renderForm();
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());

    await user.type(screen.getByLabelText("Full name"), "Yusuf");
    // Open the guardian combobox and pick "Guardian One"
    await user.click(screen.getByTestId("guardian-select"));
    await user.click(await screen.findByRole("option", { name: "Guardian One" }));
    await user.click(screen.getByRole("button", { name: "Create student" }));

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith("s1", { packageOpened: false }),
    );
    expect(api.createStudent).toHaveBeenCalledWith(
      expect.objectContaining({
        guardian_id: "g1",
        status: "TRIAL",
      }),
    );
  });

  // The intake form is no longer trial-only: the two cards decide the lifecycle, and the
  // package fields exist only behind the "active student" one.
  it("keeps the package hidden until the active card is picked", async () => {
    const user = userEvent.setup();
    renderForm();
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());

    expect(screen.getByTestId("intent-trial")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("billing-details")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("intent-enrolled"));
    expect(screen.getByTestId("intent-trial")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("billing-details")).toBeInTheDocument();
  });

  it("creates an active student with their package in one save", async () => {
    const user = userEvent.setup();
    const { onCreated } = renderForm();
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());

    await user.type(screen.getByLabelText("Full name"), "Yusuf");
    await user.click(screen.getByTestId("guardian-select"));
    await user.click(await screen.findByRole("option", { name: "Guardian One" }));
    await user.click(screen.getByTestId("intent-enrolled"));
    await user.type(screen.getByLabelText("Hourly rate"), "150");
    await user.type(screen.getByLabelText("Hours / month"), "8");
    await user.click(screen.getByRole("button", { name: "Add student" }));

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith("s1", { packageOpened: false }),
    );
    expect(api.createStudent).toHaveBeenCalledWith(
      expect.objectContaining({
        guardian_id: "g1",
        status: "REGULAR",
        // Money crosses the wire in minor units, and the quota rides along as the plan label.
        subscription: expect.objectContaining({
          price_minor: 15000,
          sessions_per_month: 8,
          price_basis: "PER_HOUR",
        }),
      }),
    );
  });

  // A REGULAR student with no package is a learner nobody ever invoices.
  it("refuses to activate a student with no price named", async () => {
    const user = userEvent.setup();
    renderForm();
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());

    await user.type(screen.getByLabelText("Full name"), "Yusuf");
    await user.click(screen.getByTestId("guardian-select"));
    await user.click(await screen.findByRole("option", { name: "Guardian One" }));
    await user.click(screen.getByTestId("intent-enrolled"));
    await user.click(screen.getByRole("button", { name: "Add student" }));

    expect(
      await screen.findByText(/Enter an hourly price and a start date/i),
    ).toBeInTheDocument();
    expect(api.createStudent).not.toHaveBeenCalled();
  });

  // Without `student.set_price` the learner is still creatable — the package is simply not
  // this user's to name, so it is added later by someone who may price.
  it("creates the active student without a package when the user may not price", async () => {
    const user = userEvent.setup();
    renderForm({ canPrice: false });
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());

    await user.type(screen.getByLabelText("Full name"), "Yusuf");
    await user.click(screen.getByTestId("guardian-select"));
    await user.click(await screen.findByRole("option", { name: "Guardian One" }));
    await user.click(screen.getByTestId("intent-enrolled"));
    expect(screen.queryByTestId("billing-details")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add student" }));

    await waitFor(() => expect(api.createStudent).toHaveBeenCalled());
    expect(api.createStudent).toHaveBeenCalledWith(
      expect.not.objectContaining({ subscription: expect.anything() }),
    );
    expect(api.createStudent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "REGULAR" }),
    );
  });

  /*
   * Monthly or package is asked inside the active student's billing card, and the package path
   * does the whole setup in the one save — the package is opened by the same request that creates
   * the student, so they are on /packages the moment they exist.
   */

  async function fillActiveStudent(user: ReturnType<typeof userEvent.setup>) {
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());
    await user.type(screen.getByLabelText("Full name"), "Yusuf");
    await user.click(screen.getByTestId("guardian-select"));
    await user.click(await screen.findByRole("option", { name: "Guardian One" }));
    await user.click(screen.getByTestId("intent-enrolled"));
  }

  it("creates an active student straight onto a lesson package in one save", async () => {
    vi.mocked(api.createStudent).mockResolvedValue({
      studentId: "s1",
      guardianId: "g1",
      packageId: "p1",
      packageInvoiceId: "i1",
    });
    const user = userEvent.setup();
    const { onCreated } = renderForm({ canManagePackages: true });
    await fillActiveStudent(user);

    await user.click(screen.getByTestId("billing-package"));
    // The monthly quota is not a package field; the package's own fields replace it.
    expect(screen.queryByLabelText("Hours / month")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(enMessages.packages.form.hours), "20");
    await user.type(screen.getByLabelText(enMessages.packages.form.price), "4000");
    await user.click(screen.getByRole("button", { name: "Add student" }));

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith("s1", { packageOpened: true }),
    );
    const sent = vi.mocked(api.createStudent).mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      status: "REGULAR",
      package: {
        hours: 20,
        price_minor: 400000,
        // The guardian pays, so their currency seeds the package's.
        currency: "EGP",
        bill_timing: "ON_START",
      },
    });
    // One clock only: the package path never also sends a monthly subscription.
    expect(sent).not.toHaveProperty("subscription");
  });

  it("refuses a package student with no package terms", async () => {
    const user = userEvent.setup();
    renderForm({ canManagePackages: true });
    await fillActiveStudent(user);

    await user.click(screen.getByTestId("billing-package"));
    await user.click(screen.getByRole("button", { name: "Add student" }));

    expect(
      await screen.findByText(enMessages.students.form.packageTermsRequired),
    ).toBeInTheDocument();
    expect(api.createStudent).not.toHaveBeenCalled();
  });

  it("offers no package option to a role that cannot manage packages", async () => {
    const user = userEvent.setup();
    renderForm({ canManagePackages: false });
    await fillActiveStudent(user);

    expect(screen.getByTestId("billing-details")).toBeInTheDocument();
    expect(screen.queryByTestId("billing-package")).not.toBeInTheDocument();
  });

  it("offers no package option when invoicing is switched off for this client", async () => {
    const user = userEvent.setup();
    renderForm({ canManagePackages: true, capabilities: ["payroll", "trials"] });
    await fillActiveStudent(user);

    expect(screen.queryByTestId("billing-package")).not.toBeInTheDocument();
  });
});
