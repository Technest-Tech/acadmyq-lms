import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { OpenPackageForm } from "./open-package-form";

/**
 * This form is the ONLY place a package is created, and these tests hold that line.
 *
 * Two facts it has to get right. The currency is a FIELD, not a caption: the price, the derived
 * hourly rate, the invoice and every later overdraft are snapshotted in it and nothing downstream
 * ever converts, so it has to be chosen deliberately with the student's own as the default rather
 * than the ceiling. And the picker lists EVERY student, including those still on monthly billing —
 * saving moves them over, which is what removed the invisible "go flip this on their profile
 * first" step that made the feature feel like it lived in two places.
 */

const listPackageStudents = vi.fn();
const openLessonPackage = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listPackageStudents: () => listPackageStudents(),
  openLessonPackage: (input: unknown) => openLessonPackage(input),
}));

const SARA = {
  id: "s1",
  full_name: "Sara",
  currency: "USD",
  default_hourly_rate_minor: 2000,
  price_basis: "PER_PACKAGE",
  plan_label: "Package billing",
  on_package_billing: true,
  active_package_id: null,
  active_package_label: null,
};

/** Still on the monthly clock — the case the old picker refused to show at all. */
const OMAR = {
  ...SARA,
  id: "s2",
  full_name: "Omar",
  price_basis: "PER_HOUR",
  plan_label: "8 hrs/month",
  on_package_billing: false,
};

function renderForm(props: Partial<Parameters<typeof OpenPackageForm>[0]> = {}) {
  return render(
    withAuth(
      makeSession("ACADEMY_OWNER", { permissions: ["package.read", "package.manage"] }),
      <OpenPackageForm onSaved={() => {}} onCancel={() => {}} {...props} />,
    ),
  );
}

/** Pick a student through the combobox: open it, then click the name in the portal list. */
async function pickStudent(name: string) {
  await userEvent.click(screen.getByTestId("package-student"));
  await userEvent.click(await screen.findByRole("option", { name: new RegExp(name) }));
}

beforeEach(() => {
  listPackageStudents.mockResolvedValue({ students: [SARA, OMAR] });
  openLessonPackage.mockResolvedValue({
    id: "p1",
    invoice_id: "i1",
    carried_over_minutes: 0,
    imported_lessons: 0,
    skipped_locked_lessons: 0,
    switched_to_package_billing: false,
  });
});

describe("OpenPackageForm", () => {
  it("offers a currency field and defaults it to the student's own", async () => {
    renderForm();
    await waitFor(() => expect(listPackageStudents).toHaveBeenCalled());

    expect(screen.getByText(arMessages.packages.form.currency)).toBeInTheDocument();
    await pickStudent("Sara");

    // Picking the student seeds the currency rather than leaving it blank.
    await waitFor(() =>
      expect(within(screen.getByTestId("package-currency")).getByText("USD")).toBeInTheDocument(),
    );
  });

  it("keeps the suggested package total in step while a multi-digit hour count is typed", async () => {
    renderForm();
    await waitFor(() => expect(listPackageStudents).toHaveBeenCalled());

    await pickStudent("Sara");
    await userEvent.type(screen.getByLabelText(arMessages.packages.form.hours), "16");

    // 16 hours at the student's USD 20/hour is USD 320. The old `price !== ""` guard froze
    // the suggestion after the first digit and produced USD 20 total (USD 1.25/hour).
    await waitFor(() =>
      expect(screen.getByLabelText(arMessages.packages.form.price)).toHaveValue(320),
    );
    expect(screen.getByTestId("package-rate-readout")).toHaveTextContent(/US\$/);
  });

  it("preserves a total the owner explicitly enters", async () => {
    renderForm();
    await waitFor(() => expect(listPackageStudents).toHaveBeenCalled());

    await pickStudent("Sara");
    await userEvent.type(screen.getByLabelText(arMessages.packages.form.hours), "10");

    const total = screen.getByLabelText(arMessages.packages.form.price);
    await userEvent.clear(total);
    await userEvent.type(total, "175");
    await userEvent.clear(screen.getByLabelText(arMessages.packages.form.hours));
    await userEvent.type(screen.getByLabelText(arMessages.packages.form.hours), "12");

    expect(total).toHaveValue(175);
  });

  it("sends the chosen currency with the package", async () => {
    renderForm();
    await waitFor(() => expect(listPackageStudents).toHaveBeenCalled());

    await pickStudent("Sara");
    await userEvent.type(screen.getByLabelText(arMessages.packages.form.hours), "10");

    await userEvent.click(
      screen.getByRole("button", { name: arMessages.packages.actions.open }),
    );

    await waitFor(() =>
      expect(openLessonPackage).toHaveBeenCalledWith(
        expect.objectContaining({ currency: "USD", hours: 10 }),
      ),
    );
  });

  it("names the package from its size and start month until the owner types over it", async () => {
    renderForm();
    await waitFor(() => expect(listPackageStudents).toHaveBeenCalled());

    await pickStudent("Sara");
    await userEvent.type(screen.getByLabelText(arMessages.packages.form.hours), "20");

    const name = screen.getByLabelText(arMessages.packages.form.label);
    await waitFor(() => expect((name as HTMLInputElement).value).toContain("20"));

    await userEvent.clear(name);
    await userEvent.type(name, "Autumn term");
    await userEvent.clear(screen.getByLabelText(arMessages.packages.form.hours));
    await userEvent.type(screen.getByLabelText(arMessages.packages.form.hours), "30");

    expect(name).toHaveValue("Autumn term");
  });

  it("lists a student who is still on monthly billing, and says the package will move them", async () => {
    renderForm();
    await waitFor(() => expect(listPackageStudents).toHaveBeenCalled());

    await pickStudent("Omar");

    expect(await screen.findByTestId("package-switch-note")).toHaveTextContent("Omar");

    // The switch never blocks the sale — it is a consequence stated, not a gate. With the block
    // itself filled in, the form is as ready to save for a monthly student as for any other.
    await userEvent.type(screen.getByLabelText(arMessages.packages.form.hours), "10");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: arMessages.packages.actions.open }),
      ).toBeEnabled(),
    );
  });

  it("says so in the confirmation when the save also moved the student onto package billing", async () => {
    openLessonPackage.mockResolvedValue({
      id: "p1",
      invoice_id: "i1",
      carried_over_minutes: 0,
      imported_lessons: 0,
      skipped_locked_lessons: 0,
      switched_to_package_billing: true,
    });
    const onSaved = vi.fn();
    renderForm({ onSaved });
    await waitFor(() => expect(listPackageStudents).toHaveBeenCalled());

    await pickStudent("Omar");
    await userEvent.type(screen.getByLabelText(arMessages.packages.form.hours), "10");
    await userEvent.click(
      screen.getByRole("button", { name: arMessages.packages.actions.open }),
    );

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(String(onSaved.mock.calls[0]?.[0])).toContain("Omar");
  });

  it("hides carry-over for a student with no closed package to carry hours from", async () => {
    renderForm({ studentsWithHistory: new Set<string>() });
    await waitFor(() => expect(listPackageStudents).toHaveBeenCalled());

    await pickStudent("Sara");
    await userEvent.click(screen.getByTestId("package-advanced-toggle"));

    expect(
      screen.queryByText(arMessages.packages.form.carryOver),
    ).not.toBeInTheDocument();
  });

  it("offers carry-over once the student has a package behind them", async () => {
    renderForm({ studentsWithHistory: new Set(["s1"]) });
    await waitFor(() => expect(listPackageStudents).toHaveBeenCalled());

    await pickStudent("Sara");
    await userEvent.click(screen.getByTestId("package-advanced-toggle"));

    expect(screen.getByText(arMessages.packages.form.carryOver)).toBeInTheDocument();
  });

  it("pre-selects the student a deep link from their profile named", async () => {
    renderForm({ initialStudentId: "s2" });

    expect(await screen.findByTestId("package-switch-note")).toHaveTextContent("Omar");
  });
});
