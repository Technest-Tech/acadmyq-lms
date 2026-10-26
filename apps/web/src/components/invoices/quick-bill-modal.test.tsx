import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { QuickBillModal } from "@/components/invoices/quick-bill-modal";

const listLessonPackages = vi.fn();
const createQuickBill = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listStudents: () =>
    Promise.resolve({
      rows: [{ id: "s1", full_name: "مسك", price_currency: "OMR" }],
      total: 1,
    }),
  listGuardians: () =>
    Promise.resolve({
      rows: [
        {
          id: "g1",
          full_name: "حسن محمود",
          currency: "SAR",
          children: [
            { id: "c1", full_name: "يوسف", status: "ACTIVE" },
            { id: "c2", full_name: "مريم", status: "ACTIVE" },
          ],
        },
      ],
      total: 1,
    }),
  getAcademyProfile: () => Promise.resolve({ academy: { default_currency: "OMR" } }),
  listLessonPackages: (...args: unknown[]) => listLessonPackages(...args),
  createQuickBill: (...args: unknown[]) => createQuickBill(...args),
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

describe("QuickBillModal — billing a family", () => {
  it("lists every child under the picked guardian and bills the guardian", async () => {
    listLessonPackages.mockResolvedValue({ packages: [] });
    createQuickBill.mockResolvedValue({ id: "inv-g", url: "https://x.test/i/tok" });

    renderModal();
    await userEvent.click(screen.getByTestId("quick-mode-guardian"));
    // A child's name finds the parent.
    await userEvent.click(await screen.findByTestId("quick-guardian"));
    await userEvent.type(screen.getByPlaceholderText(arMessages.invoices.quick.guardianSearch), "مريم");
    await userEvent.click(await screen.findByText("حسن محمود"));

    const box = await screen.findByTestId("quick-guardian-children");
    expect(box.textContent).toContain("يوسف");
    expect(box.textContent).toContain("مريم");
    // Every child's packages are checked for a bill already waiting.
    await waitFor(() => expect(listLessonPackages).toHaveBeenCalledWith({ student_id: "c2", scope: "due" }));
    expect(listLessonPackages).toHaveBeenCalledWith({ student_id: "c1", scope: "due" });
    // The family's own currency is pre-filled.
    expect((screen.getByTestId("quick-currency") as HTMLSelectElement).value).toBe("SAR");

    await userEvent.type(screen.getByTestId("quick-amount"), "40");
    await userEvent.type(screen.getByTestId("quick-description"), "كتب");
    await userEvent.click(screen.getByRole("button", { name: arMessages.invoices.quick.create }));

    await waitFor(() =>
      expect(createQuickBill).toHaveBeenCalledWith({
        amount_minor: 4000,
        currency: "SAR",
        description: "كتب",
        guardian_id: "g1",
      }),
    );
    expect(await screen.findByTestId("quick-bill-link")).toBeInTheDocument();
  });
});
