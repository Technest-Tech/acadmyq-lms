import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { OpenPackageForm } from "./open-package-form";

/**
 * The currency is a FIELD, not a caption. The price, the derived hourly rate, the invoice and
 * every later overdraft are snapshotted in it and nothing downstream ever converts — so it has to
 * be chosen deliberately, with the student's own currency as the default rather than the ceiling.
 */

const listPackageStudents = vi.fn();
const openLessonPackage = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listPackageStudents: () => listPackageStudents(),
  openLessonPackage: (input: unknown) => openLessonPackage(input),
}));

function renderForm() {
  return render(
    withAuth(
      makeSession("ACADEMY_OWNER", { permissions: ["package.read", "package.manage"] }),
      <OpenPackageForm onSaved={() => {}} onCancel={() => {}} />,
    ),
  );
}

beforeEach(() => {
  listPackageStudents.mockResolvedValue({
    students: [
      {
        id: "s1",
        full_name: "Sara",
        currency: "USD",
        default_hourly_rate_minor: 2000,
        active_package_id: null,
        active_package_label: null,
      },
    ],
  });
  openLessonPackage.mockResolvedValue({ id: "p1", invoice_id: "i1", carried_over_minutes: 0 });
});

describe("OpenPackageForm", () => {
  it("offers a currency field and defaults it to the student's own", async () => {
    renderForm();
    await waitFor(() => expect(listPackageStudents).toHaveBeenCalled());

    expect(screen.getByText(arMessages.packages.form.currency)).toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByLabelText(arMessages.packages.form.student),
      "s1",
    );

    // Picking the student seeds the currency rather than leaving it blank.
    await waitFor(() => expect(screen.getByText("USD")).toBeInTheDocument());
  });

  it("keeps the suggested package total in step while a multi-digit hour count is typed", async () => {
    renderForm();
    await waitFor(() => expect(listPackageStudents).toHaveBeenCalled());

    await userEvent.selectOptions(
      screen.getByLabelText(arMessages.packages.form.student),
      "s1",
    );
    await userEvent.type(screen.getByLabelText(arMessages.packages.form.hours), "16");

    // 16 hours at the student's USD 20/hour is USD 320. The old `price !== ""` guard froze
    // the suggestion after the first digit and produced USD 20 total (USD 1.25/hour).
    await waitFor(() =>
      expect(screen.getByLabelText(arMessages.packages.form.price)).toHaveValue(320),
    );
    expect(screen.getByText(/US\$/)).toBeInTheDocument();
  });

  it("preserves a total the owner explicitly enters", async () => {
    renderForm();
    await waitFor(() => expect(listPackageStudents).toHaveBeenCalled());

    await userEvent.selectOptions(
      screen.getByLabelText(arMessages.packages.form.student),
      "s1",
    );
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

    await userEvent.selectOptions(
      screen.getByLabelText(arMessages.packages.form.student),
      "s1",
    );
    await userEvent.type(
      screen.getByLabelText(arMessages.packages.form.label),
      "10 hours",
    );
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
});
