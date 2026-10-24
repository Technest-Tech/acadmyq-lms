import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { QuickBillModal } from "@/components/invoices/quick-bill-modal";

const listLessonPackages = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listStudents: () =>
    Promise.resolve({
      rows: [{ id: "s1", full_name: "مسك", price_currency: "OMR" }],
      total: 1,
    }),
  getAcademyProfile: () => Promise.resolve({ academy: { default_currency: "OMR" } }),
  listLessonPackages: (...args: unknown[]) => listLessonPackages(...args),
}));

function renderModal() {
  return render(
    withAuth(
      makeSession("ACADEMY_OWNER", {
        permissions: ["invoice.read", "invoice.create", "package.read"],
      }),
      <QuickBillModal open onClose={() => {}} onCreated={() => {}} onView={() => {}} />,
    ),
  );
}

async function pickStudent(name: string) {
  await userEvent.click(await screen.findByTestId("quick-student"));
  await userEvent.click(await screen.findByText(name));
}

describe("QuickBillModal — a package's own bill comes first", () => {
  it("says the student's package already has a bill waiting, and hands over that link instead", async () => {
    // Package #3 opened itself, paid up front, 13 OMR not yet paid.
    listLessonPackages.mockResolvedValue({
      packages: [
        {
          id: "p3",
          sequence_no: 3,
          invoice_id: "inv-3",
          invoice_token: "tok3",
          outstanding_minor: 1300,
          currency: "OMR",
          due: true,
        },
      ],
    });

    renderModal();
    await pickStudent("مسك");

    const note = await screen.findByTestId("quick-package-due");
    expect(listLessonPackages).toHaveBeenCalledWith({ student_id: "s1", scope: "due" });
    expect(note.textContent).toContain("3");

    await userEvent.click(screen.getByTestId("quick-use-package-bill"));

    // Straight to the link step, on the package's own bill — nothing new was created.
    expect(await screen.findByText(arMessages.invoices.quick.packageBillTitle)).toBeInTheDocument();
    expect(screen.getByText(arMessages.invoices.quick.packageBillDue)).toBeInTheDocument();
    expect(screen.getByTestId("quick-bill-link").textContent).toContain("tok3");
  });

  it("shows nothing extra for a student whose packages are all paid", async () => {
    listLessonPackages.mockResolvedValue({ packages: [] });

    renderModal();
    await pickStudent("مسك");

    await waitFor(() => expect(listLessonPackages).toHaveBeenCalled());
    expect(screen.queryByTestId("quick-package-due")).toBeNull();
  });
});
