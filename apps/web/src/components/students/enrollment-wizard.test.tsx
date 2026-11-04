import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { EnrollmentWizard } from "./enrollment-wizard";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getStudent: vi.fn(),
  listTeachers: vi.fn(),
  openLessonPackage: vi.fn(),
  setSubscription: vi.fn(),
  updateStudent: vi.fn(),
}));

import * as api from "@/lib/api";

const groupsApi = { listGroups: vi.fn(), addGroupMembers: vi.fn() };
vi.mock("@/lib/groups-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/groups-api")>()),
  listGroups: (...a: unknown[]) => groupsApi.listGroups(...a),
  addGroupMembers: (...a: unknown[]) => groupsApi.addGroupMembers(...a),
}));
const sellSubscription = vi.fn();
vi.mock("@/lib/subscriptions-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subscriptions-api")>()),
  sellSubscription: (...a: unknown[]) => sellSubscription(...a),
}));

/**
 * A trial who converts is set up in the same one place as a student created active: the pricing
 * step asks monthly or package, and the package path opens the package itself — which creates the
 * package-billing subscription that makes REGULAR reachable — instead of sending the owner to the
 * packages page afterwards.
 */
function renderWizard(onCompleted = vi.fn(), capabilities?: string[]) {
  const session = makeSession("ACADEMY_OWNER", capabilities ? { capabilities } : {});
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider
        value={authValue({
          ...session,
          permissions: [
            ...session.permissions,
            "student.set_price",
            "package.manage",
            "group.manage",
          ],
        })}
      >
        <EnrollmentWizard
          studentId="s1"
          onCompleted={onCompleted}
          onCancel={() => {}}
        />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
  return { onCompleted };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listTeachers).mockResolvedValue({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 50,
  });
  vi.mocked(api.getStudent).mockResolvedValue({
    student: {
      id: "s1",
      full_name: "Trial Tala",
      guardian_id: "g1",
      is_self_guardian: false,
      status: "TRIAL",
    },
    guardian: {
      id: "g1",
      full_name: "Guardian One",
      whatsapp_phone: "+201000000000",
      country: "EG",
      currency: "USD",
      notes: null,
      deleted_at: null,
      created_at: "",
    },
    subscription: null,
    currentTeacher: null,
  } as unknown as Awaited<ReturnType<typeof api.getStudent>>);
  vi.mocked(api.openLessonPackage).mockResolvedValue({
    id: "p1",
    invoice_id: "i1",
    carried_over_minutes: 0,
    imported_lessons: 0,
    skipped_locked_lessons: 0,
    switched_to_package_billing: true,
  });
  vi.mocked(api.updateStudent).mockResolvedValue({
    ok: true,
    changed: ["status"],
  } as unknown as Awaited<ReturnType<typeof api.updateStudent>>);
});

describe("EnrollmentWizard billing step", () => {
  it("enrols a trial onto a lesson package, opening the package before making them regular", async () => {
    const user = userEvent.setup();
    const { onCompleted } = renderWizard();

    await user.click(
      screen.getByRole("button", {
        name: enMessages.students.enroll.skipSchedule,
      }),
    );
    await user.click(await screen.findByTestId("enroll-billing-package"));

    await user.type(
      screen.getByLabelText(enMessages.packages.form.lessons),
      "10",
    );
    await user.type(
      screen.getByLabelText(enMessages.packages.form.price),
      "2500",
    );

    await user.click(
      screen.getByRole("button", { name: enMessages.students.enroll.title }),
    );

    await waitFor(() =>
      expect(onCompleted).toHaveBeenCalledWith({ packageOpened: true }),
    );
    expect(api.openLessonPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        student_id: "s1",
        hours: 10,
        price_minor: 250000,
        // The guardian's currency seeds the package's.
        currency: "USD",
      }),
    );
    // Order matters: REGULAR is refused until an active subscription exists, and it is opening
    // the package that creates one.
    const opened = vi.mocked(api.openLessonPackage).mock
      .invocationCallOrder[0]!;
    const regular = vi.mocked(api.updateStudent).mock.invocationCallOrder[0]!;
    expect(opened).toBeLessThan(regular);
    // One clock only.
    expect(api.setSubscription).not.toHaveBeenCalled();
  });

  it("keeps the monthly path as the default", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.click(
      screen.getByRole("button", {
        name: enMessages.students.enroll.skipSchedule,
      }),
    );

    expect(await screen.findByTestId("enroll-billing-monthly")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByLabelText(enMessages.packages.form.lessons),
    ).not.toBeInTheDocument();
  });
});

describe("EnrollmentWizard — a centre's pricing step (docs/centre-profile/01)", () => {
  beforeEach(() => {
    groupsApi.listGroups.mockReset().mockResolvedValue({
      groups: [{ id: "g1", name: "English A1", teacher_name: "Miss Mona", start_date: "2026-01-10", lessons: { held: 5 }, pricing: null }],
      counts: {},
    });
    groupsApi.addGroupMembers.mockReset().mockResolvedValue({ added: 1, group: {} });
    sellSubscription.mockReset().mockResolvedValue({ subscription: { id: "sub1" }, invoice_id: "i1", due_minor: 72000, warnings: [] });
    vi.mocked(api.listTeachers).mockResolvedValue({
      rows: [{ id: "t1", full_name: "Teacher One" }, { id: "t2", full_name: "Teacher Two" }] as unknown as Awaited<ReturnType<typeof api.listTeachers>>["rows"],
      total: 2,
      page: 1,
      pageSize: 50,
    });
    vi.mocked(api.getStudent).mockResolvedValue({
      student: { id: "s1", full_name: "Trial Tala", guardian_id: "g1", is_self_guardian: false, status: "TRIAL" },
      guardian: { id: "g1", full_name: "Guardian One", whatsapp_phone: "+201000000000", country: "EG", currency: "EGP", notes: null, deleted_at: null, created_at: "" },
      teachers: [{ teacher_id: "t2", teacher_name: "Teacher Two", course: "Maths", started_at: "" }],
      subscription: null,
      currentTeacher: null,
    } as unknown as Awaited<ReturnType<typeof api.getStudent>>);
  });

  it("offers a subscription for one of the student's subjects plus groups, sells the block first, then makes them regular — no monthly, no package", async () => {
    const user = userEvent.setup();
    const { onCompleted } = renderWizard(vi.fn(), ["invoicing", "groups", "centre"]);
    await user.click(await screen.findByRole("button", { name: enMessages.students.enroll.skipSchedule }));

    expect(await screen.findByTestId("enroll-centre-pricing")).toBeInTheDocument();
    expect(screen.queryByTestId("enroll-billing-monthly")).not.toBeInTheDocument();
    expect(screen.queryByTestId("enroll-billing-package")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(enMessages.students.monthly.lessons)).not.toBeInTheDocument();

    // The student's existing subject is the block's subject.
    const subject = screen.getByTestId("enroll-sub-subject") as HTMLSelectElement;
    await waitFor(() => expect(subject.value).toBe("t2::maths"));
    await user.type(screen.getByTestId("enroll-sub-lessons"), "8");
    await user.type(screen.getByTestId("enroll-sub-unit-price"), "90");
    const pick = await screen.findByTestId("enroll-group-subs-pick");
    await waitFor(() => expect(within(pick).getAllByRole("option").length).toBeGreaterThan(1));
    await user.selectOptions(pick, "g1");

    await user.click(screen.getByRole("button", { name: enMessages.students.enroll.title }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith({ packageOpened: true }));
    expect(sellSubscription).toHaveBeenCalledWith({ student_id: "s1", teacher_id: "t2", course: "Maths", lessons_sold: 8, lesson_minutes: 60, lesson_price_minor: 9000, price_minor: 72000 });
    expect(groupsApi.addGroupMembers).toHaveBeenCalledWith("g1", expect.objectContaining({ student_ids: ["s1"] }));
    expect(api.updateStudent).toHaveBeenCalledWith("s1", { status: "REGULAR" });
    expect(api.openLessonPackage).not.toHaveBeenCalled();
    expect(api.setSubscription).not.toHaveBeenCalled();
    // The sale came before the status change.
    expect(sellSubscription.mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(api.updateStudent).mock.invocationCallOrder[0]!);
  });

  it("enrols on groups alone when told no private subscription", async () => {
    const user = userEvent.setup();
    const { onCompleted } = renderWizard(vi.fn(), ["invoicing", "groups", "centre"]);
    await user.click(await screen.findByRole("button", { name: enMessages.students.enroll.skipSchedule }));
    await screen.findByTestId("enroll-centre-pricing");
    await user.click(screen.getByTestId("enroll-billing-none"));
    expect(screen.queryByTestId("enroll-sub-subscription")).not.toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: enMessages.students.enroll.title });
    expect(confirm).toBeDisabled();
    const pick = await screen.findByTestId("enroll-group-subs-pick");
    await waitFor(() => expect(within(pick).getAllByRole("option").length).toBeGreaterThan(1));
    await user.selectOptions(pick, "g1");
    await user.click(confirm);
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith({ packageOpened: false }));
    expect(sellSubscription).not.toHaveBeenCalled();
    expect(groupsApi.addGroupMembers).toHaveBeenCalledTimes(1);
  });
});
