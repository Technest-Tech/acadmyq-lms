import { render, screen, waitFor, within } from "@testing-library/react";
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

const groupsApi = { listGroups: vi.fn(), addGroupMembers: vi.fn() };
vi.mock("@/lib/groups-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/groups-api")>()),
  listGroups: (...a: unknown[]) => groupsApi.listGroups(...a),
  addGroupMembers: (...a: unknown[]) => groupsApi.addGroupMembers(...a),
}));

/**
 * `student.set_price` is what gates the package fields, so it is spelled out per test rather
 * than inherited from the role fixture — the two halves of the "active student" card (with a
 * package, and without one) are exactly the difference between holding it and not.
 */
function renderForm({
  canPrice = true,
  canManagePackages = false,
  capabilities,
  extraPermissions = [],
  onCreated = vi.fn(),
  onCancel = vi.fn(),
}: {
  canPrice?: boolean;
  canManagePackages?: boolean;
  capabilities?: string[];
  extraPermissions?: string[];
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
    ...extraPermissions,
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
          pay_type: "HOURLY",
          fixed_salary_minor: 0,
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
    // These intake flows are the trial path; the form now opens on "active".
    await user.click(screen.getByTestId("intent-trial"));
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
    // These intake flows are the trial path; the form now opens on "active".
    await user.click(screen.getByTestId("intent-trial"));

    await user.type(screen.getByLabelText("Full name"), "Yusuf");
    // Open the guardian combobox and pick "Guardian One"
    await user.click(screen.getByTestId("guardian-select"));
    await user.click(await screen.findByRole("option", { name: /Guardian One/ }));
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

  // A student may study different courses with different teachers, so the form takes a list.
  it("creates a student with two teachers, each with their course", async () => {
    const base = (await api.listTeachers()).rows[0]!;
    vi.mocked(api.listTeachers).mockResolvedValue({
      rows: [
        { ...base, id: "t1", full_name: "Teacher One", specialization: "Quran" },
        { ...base, id: "t2", full_name: "Teacher Two", specialization: null },
      ],
      total: 2,
      page: 1,
      pageSize: 50,
    });
    const user = userEvent.setup();
    renderForm();
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());
    // These intake flows are the trial path; the form now opens on "active".
    await user.click(screen.getByTestId("intent-trial"));

    await user.type(screen.getByLabelText("Full name"), "Yusuf");
    await user.click(screen.getByTestId("guardian-select"));
    await user.click(await screen.findByRole("option", { name: /Guardian One/ }));

    await user.click(await screen.findByTestId("add-teacher-link"));
    await user.click(screen.getByTestId("teacher-link-select-0"));
    await user.click(await screen.findByRole("option", { name: /Teacher One/ }));
    // The course is pre-filled from the teacher's specialization.
    expect(screen.getByTestId("teacher-link-course-0")).toHaveValue("Quran");

    await user.click(screen.getByTestId("add-teacher-link"));
    await user.click(screen.getByTestId("teacher-link-select-1"));
    await user.click(await screen.findByRole("option", { name: /Teacher Two/ }));
    await user.type(screen.getByTestId("teacher-link-course-1"), "Arabic");

    await user.click(screen.getByRole("button", { name: "Create student" }));

    await waitFor(() =>
      expect(api.createStudent).toHaveBeenCalledWith(
        expect.objectContaining({
          teachers: [
            { teacher_id: "t1", course: "Quran" },
            { teacher_id: "t2", course: "Arabic" },
          ],
        }),
      ),
    );
  });

  // The intake form is no longer trial-only: the two cards decide the lifecycle, and the
  // package fields exist only behind the "active student" one — which is the default now.
  it("starts on the active card, and hides the package once the trial card is picked", async () => {
    const user = userEvent.setup();
    renderForm();
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());

    expect(screen.getByTestId("intent-enrolled")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("billing-details")).toBeInTheDocument();

    await user.click(screen.getByTestId("intent-trial"));
    expect(screen.getByTestId("intent-enrolled")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("billing-details")).not.toBeInTheDocument();
  });

  it("folds the student's own numbers away while a family is on the record, and shows them for a self-guardian", async () => {
    const user = userEvent.setup();
    renderForm();
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());
    // A family's child: only the parent's numbers by default.
    expect(screen.queryByTestId("student-secondary-phone")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("own-phones-toggle"));
    expect(screen.getByTestId("student-secondary-phone")).toBeInTheDocument();
  });

  it("creates an active student with their package in one save", async () => {
    const user = userEvent.setup();
    const { onCreated } = renderForm();
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());

    await user.type(screen.getByLabelText("Full name"), "Yusuf");
    await user.click(screen.getByTestId("guardian-select"));
    await user.click(await screen.findByRole("option", { name: /Guardian One/ }));
    await user.click(screen.getByTestId("intent-enrolled"));
    await user.type(screen.getByLabelText("Hourly rate"), "150");
    await user.type(screen.getByLabelText(enMessages.students.monthly.lessons), "8");
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
          lesson_minutes: 60,
          price_basis: "PER_HOUR",
        }),
      }),
    );
  });

  // The desk counts "8 lessons of 40 minutes" — 5.33 hours, which the old whole-hours field refused.
  it("takes a month as lessons of a length, priced by the lesson, and saves the hourly rate", async () => {
    const user = userEvent.setup();
    renderForm();
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());

    await user.type(screen.getByLabelText("Full name"), "Yusuf");
    await user.click(screen.getByTestId("guardian-select"));
    await user.click(await screen.findByRole("option", { name: /Guardian One/ }));
    await user.click(screen.getByTestId("intent-enrolled"));
    await user.type(screen.getByLabelText(enMessages.students.monthly.lessons), "8");
    await user.selectOptions(screen.getByTestId("new-student-monthly-length"), "40");
    await user.click(screen.getByTestId("new-student-monthly-unit-lesson"));
    await user.type(screen.getByLabelText("Price of a 40-minute lesson"), "50");

    // 8 × 40 min = 5h 20m; 50 a lesson is 75 an hour and about 400 a month.
    expect(screen.getByTestId("new-student-monthly-readout")).toHaveTextContent("5h 20m");
    expect(screen.getByTestId("new-student-monthly-readout")).toHaveTextContent("400");

    await user.click(screen.getByRole("button", { name: "Add student" }));
    await waitFor(() => expect(api.createStudent).toHaveBeenCalled());
    expect(api.createStudent).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription: expect.objectContaining({
          sessions_per_month: 8,
          lesson_minutes: 40,
          price_minor: 7500,
          price_basis: "PER_HOUR",
        }),
      }),
    );
  });

  it("restates the typed price when the unit is switched, never changing the deal", async () => {
    const user = userEvent.setup();
    renderForm();
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());
    await user.click(screen.getByTestId("intent-enrolled"));
    await user.selectOptions(screen.getByTestId("new-student-monthly-length"), "30");
    await user.type(screen.getByLabelText("Hourly rate"), "100");
    await user.click(screen.getByTestId("new-student-monthly-unit-lesson"));
    expect(screen.getByLabelText("Price of a 30-minute lesson")).toHaveValue(50);
  });

  it("enrols a free student: no price asked, nothing billed, lessons still counted", async () => {
    const user = userEvent.setup();
    renderForm();
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());

    await user.type(screen.getByLabelText("Full name"), "Yusuf");
    await user.click(screen.getByTestId("guardian-select"));
    await user.click(await screen.findByRole("option", { name: /Guardian One/ }));
    await user.click(screen.getByTestId("intent-enrolled"));
    await user.click(within(screen.getByTestId("new-student-monthly-free")).getByRole("checkbox"));
    expect(screen.queryByLabelText("Hourly rate")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(enMessages.students.monthly.lessons), "8");

    await user.click(screen.getByRole("button", { name: "Add student" }));
    await waitFor(() => expect(api.createStudent).toHaveBeenCalled());
    expect(api.createStudent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "REGULAR",
        subscription: expect.objectContaining({ price_basis: "FREE", price_minor: 0, sessions_per_month: 8 }),
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
    await user.click(await screen.findByRole("option", { name: /Guardian One/ }));
    await user.click(screen.getByTestId("intent-enrolled"));
    await user.click(screen.getByRole("button", { name: "Add student" }));

    expect(
      await screen.findByText(enMessages.students.form.packageRequired),
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
    await user.click(await screen.findByRole("option", { name: /Guardian One/ }));
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
    await user.click(await screen.findByRole("option", { name: /Guardian One/ }));
    await user.click(screen.getByTestId("intent-enrolled"));
  }

  it("starts a centre's new student on a subscription, with that word — and everyone else monthly", async () => {
    const user = userEvent.setup();
    renderForm({ canManagePackages: true, capabilities: ["invoicing", "packages", "centre"] });
    await fillActiveStudent(user);
    // The subscription's own fields are already open: no click on the billing tile needed.
    expect(screen.getByLabelText(enMessages.packages.form.hours)).toBeInTheDocument();
    expect(screen.getByTestId("billing-package").textContent).toContain(enMessages.students.form.billingSubscription);
  });

  it("keeps a Quran academy's new student monthly by default", async () => {
    const user = userEvent.setup();
    renderForm({ canManagePackages: true, capabilities: ["invoicing", "packages"] });
    await fillActiveStudent(user);
    expect(screen.queryByLabelText(enMessages.packages.form.lessons)).not.toBeInTheDocument();
    expect(screen.getByTestId("billing-package").textContent).toContain(enMessages.students.form.billingPackage);
  });

  const centreGroups = () =>
    groupsApi.listGroups.mockResolvedValue({
      groups: [
        { id: "g1", name: "English A1", teacher_name: "Miss Mona", start_date: "2026-01-10", lessons: { held: 5 }, pricing: { billing_mode: "MONTHLY", price_minor: 60000, currency: "EGP", charge_absent: false, prorate_join: true, month_minutes: 480, solo_billed_minutes: null } },
        { id: "g2", name: "Math B2", teacher_name: "Mr Ali", start_date: "2026-02-01", lessons: { held: 0 }, pricing: null },
      ],
      counts: {},
    });

  it("enrols a centre's new student in groups only — no private subscription, no hourly price asked", async () => {
    centreGroups();
    groupsApi.addGroupMembers.mockResolvedValue({ added: 1, group: {} });
    vi.mocked(api.createStudent).mockResolvedValue({ studentId: "s9", guardianId: "g1" });
    const user = userEvent.setup();
    const { onCreated } = renderForm({ canManagePackages: true, capabilities: ["invoicing", "packages", "groups", "centre"], extraPermissions: ["group.manage"] });
    await fillActiveStudent(user);
    await user.click(screen.getByTestId("billing-monthly"));
    // Groups only: none of the private fields.
    expect(screen.queryByLabelText(enMessages.students.subscription.priceHourly)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(enMessages.packages.form.hours)).not.toBeInTheDocument();

    const pick = await screen.findByTestId("group-subs-pick");
    await waitFor(() => expect(within(pick).getAllByRole("option").length).toBeGreaterThan(1));
    expect(within(pick).getAllByRole("option")[0]!.textContent).toBe(enMessages.students.form.addGroup);
    await user.selectOptions(pick, "g1");
    // The next one is added from the same, always-visible control, which now says so.
    expect(within(screen.getByTestId("group-subs-pick")).getAllByRole("option")[0]!.textContent).toBe(enMessages.students.form.addAnotherGroup);
    await user.selectOptions(screen.getByTestId("group-subs-pick"), "g2");
    const list = screen.getByTestId("group-subs-list");
    expect(within(list).getByText("English A1")).toBeInTheDocument();
    expect(within(list).getByText(/8/)).toBeInTheDocument();
    // A class nobody has attended yet takes them from its first lesson.
    expect(screen.getByTestId("group-sub-from-g2")).toHaveValue("2026-02-01");

    await user.click(screen.getByTestId("submit-student"));
    await waitFor(() => expect(api.createStudent).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(api.createStudent).mock.calls[0]![0];
    expect(payload).not.toHaveProperty("subscription");
    expect(payload).not.toHaveProperty("package");
    expect(payload.status).toBe("REGULAR");
    await waitFor(() => expect(groupsApi.addGroupMembers).toHaveBeenCalledTimes(2));
    expect(groupsApi.addGroupMembers).toHaveBeenCalledWith("g1", expect.objectContaining({ student_ids: ["s9"] }));
    expect(groupsApi.addGroupMembers).toHaveBeenCalledWith("g2", { student_ids: ["s9"], joined_on: "2026-02-01" });
    expect(onCreated).toHaveBeenCalledWith("s9", expect.anything());
  });

  it("refuses a groups-only student with no group picked", async () => {
    centreGroups();
    const user = userEvent.setup();
    renderForm({ canManagePackages: true, capabilities: ["invoicing", "packages", "groups", "centre"], extraPermissions: ["group.manage"] });
    await fillActiveStudent(user);
    await user.click(screen.getByTestId("billing-monthly"));
    await user.click(screen.getByTestId("submit-student"));
    expect(await screen.findByText(enMessages.students.form.groupOrPrivateRequired)).toBeInTheDocument();
    expect(api.createStudent).not.toHaveBeenCalled();
  });

  it("still lets a centre add a group beside a private subscription", async () => {
    centreGroups();
    groupsApi.addGroupMembers.mockResolvedValue({ added: 1, group: {} });
    const user = userEvent.setup();
    renderForm({ canManagePackages: true, capabilities: ["invoicing", "packages", "groups", "centre"], extraPermissions: ["group.manage"] });
    await fillActiveStudent(user);
    // Starts on the subscription; the group list sits above it.
    expect(screen.getByLabelText(enMessages.packages.form.hours)).toBeInTheDocument();
    expect(await screen.findByTestId("group-subs")).toBeInTheDocument();
  });

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
    expect(screen.queryByLabelText(enMessages.students.monthly.lessons)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(enMessages.packages.form.lessons), "20");
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

  // No parent on file yet: they are typed in beside the picker and created in the same save.
  it("creates the student with a brand-new parent in one save", async () => {
    const user = userEvent.setup();
    const { onCreated } = renderForm();
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());
    // These intake flows are the trial path; the form now opens on "active".
    await user.click(screen.getByTestId("intent-trial"));

    await user.type(screen.getByLabelText("Full name"), "Yusuf");
    await user.click(screen.getByTestId("guardian-new-toggle"));
    expect(screen.queryByTestId("guardian-select")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Parent's name"), "Hassan Ali");
    await user.type(screen.getByTestId("new-guardian-phone"), "100000001");
    await user.click(screen.getByRole("button", { name: "Create student" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const sent = vi.mocked(api.createStudent).mock.calls[0]![0];
    expect(sent.guardian_id).toBeUndefined();
    expect(sent.new_guardian).toEqual(
      // The dial code follows the academy's country (EG in the test session), not a fixed +966.
      expect.objectContaining({ full_name: "Hassan Ali", whatsapp_phone: "+20100000001" }),
    );
  });

  it("refuses a new parent without a WhatsApp number", async () => {
    const user = userEvent.setup();
    renderForm();
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());
    // These intake flows are the trial path; the form now opens on "active".
    await user.click(screen.getByTestId("intent-trial"));

    await user.type(screen.getByLabelText("Full name"), "Yusuf");
    await user.click(screen.getByTestId("guardian-new-toggle"));
    await user.type(screen.getByLabelText("Parent's name"), "Hassan Ali");
    await user.click(screen.getByRole("button", { name: "Create student" }));

    expect(await screen.findByText("Enter the new parent's name and WhatsApp number.")).toBeInTheDocument();
    expect(api.createStudent).not.toHaveBeenCalled();
  });

  it("starts on a new parent when the academy has none yet", async () => {
    vi.mocked(api.listGuardians).mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 200 });
    renderForm();

    expect(await screen.findByTestId("new-guardian")).toBeInTheDocument();
    expect(screen.queryByTestId("guardian-select")).not.toBeInTheDocument();
  });

  it("sends the optional second phone", async () => {
    const user = userEvent.setup();
    renderForm();
    await waitFor(() => expect(api.listGuardians).toHaveBeenCalled());
    // These intake flows are the trial path; the form now opens on "active".
    await user.click(screen.getByTestId("intent-trial"));
    await user.click(screen.getByTestId("own-phones-toggle"));

    await user.type(screen.getByLabelText("Full name"), "Yusuf");
    await user.click(screen.getByTestId("guardian-select"));
    await user.click(await screen.findByRole("option", { name: /Guardian One/ }));
    await user.type(screen.getByTestId("student-secondary-phone"), "1234567");
    await user.click(screen.getByRole("button", { name: "Create student" }));

    await waitFor(() => expect(api.createStudent).toHaveBeenCalled());
    // Picking the Egyptian parent moved the empty second number onto +20 too.
    expect(vi.mocked(api.createStudent).mock.calls[0]![0].secondary_phone).toBe("+201234567");
  });
});
