import { render, screen, waitFor } from "@testing-library/react";
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

/**
 * A trial who converts is set up in the same one place as a student created active: the pricing
 * step asks monthly or package, and the package path opens the package itself — which creates the
 * package-billing subscription that makes REGULAR reachable — instead of sending the owner to the
 * packages page afterwards.
 */
function renderWizard(onCompleted = vi.fn()) {
  const session = makeSession("ACADEMY_OWNER");
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider
        value={authValue({
          ...session,
          permissions: [
            ...session.permissions,
            "student.set_price",
            "package.manage",
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
      screen.getByLabelText(enMessages.packages.form.hours),
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
      screen.queryByLabelText(enMessages.packages.form.hours),
    ).not.toBeInTheDocument();
  });
});
