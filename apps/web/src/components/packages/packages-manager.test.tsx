import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { formatHours } from "@/lib/time";
import type { LessonPackageRow, LessonPackageSummary } from "@/lib/api";
import { PackagesManager } from "./packages-manager";

/**
 * The screen is a read of the engine, so these tests pin the two things the UI is actually
 * responsible for: showing a balance that matches what the server sent, and putting the right
 * rows behind the "needs attention" cut — the same set the sidebar badge counts.
 */

const listLessonPackages = vi.fn();
const getLessonPackageSummary = vi.fn();
const syncLessonPackage = vi.fn();
const updateLessonPackage = vi.fn();
const sendInvoicePaymentLink = vi.fn();
const closeLessonPackage = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listLessonPackages: (...args: unknown[]) => listLessonPackages(...args),
  getLessonPackageSummary: () => getLessonPackageSummary(),
  syncLessonPackage: (id: string) => syncLessonPackage(id),
  updateLessonPackage: (id: string, input: unknown) =>
    updateLessonPackage(id, input),
  sendInvoicePaymentLink: (id: string) => sendInvoicePaymentLink(id),
  closeLessonPackage: (
    id: string,
    reason?: string,
    returnToMonthly?: boolean,
  ) => closeLessonPackage(id, reason, returnToMonthly),
  listPackageStudents: () => Promise.resolve({ students: [] }),
}));

function pkg(overrides: Partial<LessonPackageRow> = {}): LessonPackageRow {
  return {
    id: "p1",
    student_id: "s1",
    student_name: "Sara",
    label: "20 hours",
    sequence_no: 1,
    status: "ACTIVE",
    bill_timing: "ON_START",
    minutes_total: 1200,
    carried_over_minutes: 0,
    minutes_sold: 1200,
    minutes_consumed: 600,
    minutes_remaining: 600,
    minutes_overdrawn: 0,
    lesson_count: 10,
    upcoming_lesson_count: 4,
    next_lesson_at: "2026-09-08T10:00:00Z",
    percent_used: 50,
    price_minor: 400000,
    hourly_rate_minor: 20000,
    currency: "EGP",
    starts_on: "2026-09-01",
    expires_on: null,
    closed_at: null,
    closed_reason: null,
    invoice_id: "i1",
    invoice_status: "OPEN",
    invoice_token: "tok",
    invoice_total_minor: 400000,
    invoice_paid_minor: 400000,
    outstanding_minor: 0,
    payment_method: null,
    payment_reason: null,
    payment_reference: null,
    payment_proof_url: null,
    overdraft_billed: false,
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const summary: LessonPackageSummary = {
  active: 1,
  completed: 1,
  cancelled: 0,
  lowBalance: 0,
  needsBilling: 0,
  pendingOverdraft: 0,
  unpaid: 1,
  total: 1,
  financials: [
    {
      currency: "EGP",
      active_value_minor: 400000,
      completed_value_minor: 200000,
      collected_minor: 450000,
      outstanding_minor: 150000,
      completed_outstanding_minor: 150000,
    },
  ],
};

function renderManager(extraPermissions: string[] = []) {
  return render(
    withAuth(
      makeSession("ACADEMY_OWNER", {
        permissions: ["package.read", "package.manage", ...extraPermissions],
      }),
      <PackagesManager />,
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getLessonPackageSummary.mockResolvedValue(summary);
  updateLessonPackage.mockResolvedValue({
    ok: true,
    changed: ["price_minor"],
    invoice_id: "i1",
  });
  syncLessonPackage.mockResolvedValue({ imported: 2, skipped_locked: 0 });
  closeLessonPackage.mockResolvedValue({
    ok: true,
    invoice_id: "i1",
    returned_to_monthly: true,
  });
  sendInvoicePaymentLink.mockResolvedValue({
    phone: "+201001112222",
    message: "Pay here",
    url: "https://app.test/i/tok",
    transport: "WASENDER",
    sent: true,
  });
});

describe("PackagesManager", () => {
  it("renders the live balance in hours, not fractions", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [pkg({ minutes_consumed: 630, minutes_remaining: 570 })],
    });

    renderManager();

    // The screen opens on the work queue, and a half-used healthy package is not work — so the
    // whole record has to be asked for before this row exists at all.
    await userEvent.click(
      await screen.findByRole("button", {
        name: arMessages.packages.segments.all,
      }),
    );

    const card = await screen.findByTestId("package-card");
    // 570 minutes reads as 9h 30m — never "9.5h", and never a raw minute count. The harness
    // renders in Arabic, so this also pins the Arabic-Indic digits (R-LOC).
    expect(card.textContent).toContain(formatHours(570, "ar"));
    expect(card.textContent).not.toContain("570");
  });

  it("puts an overdrawn package in the attention cut and reports how far past it went", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          id: "p2",
          status: "COMPLETED",
          minutes_consumed: 1260,
          minutes_remaining: 0,
          minutes_overdrawn: 60,
          percent_used: 100,
          outstanding_minor: 400000,
          overdraft_billed: false,
        }),
      ],
    });

    renderManager();

    const card = await screen.findByTestId("package-card");
    expect(card.textContent).toContain(formatHours(60, "ar"));
    // Stranded overdraft on a paid-up-front package → the escape-hatch action is offered.
    expect(
      within(card).getByText(arMessages.packages.actions.billOverdraft),
    ).toBeInTheDocument();
  });

  it("hides a healthy package from the attention cut but shows it under All", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });

    renderManager();

    // Default cut is "needs attention", and a half-used, paid package is not that.
    expect(
      await screen.findByText(arMessages.packages.emptyAttention),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: arMessages.packages.segments.all }),
    );
    expect(await screen.findByTestId("package-card")).toBeInTheDocument();
  });

  it("shows lesson, date, package total and payment actions on the richer card", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });
    renderManager(["invoice.send_link"]);

    await userEvent.click(
      await screen.findByRole("button", {
        name: arMessages.packages.segments.all,
      }),
    );
    const card = await screen.findByTestId("package-card");

    expect(card).toHaveTextContent(arMessages.packages.card.totalHours);
    expect(card).toHaveTextContent(arMessages.packages.card.lessonsUsed);
    expect(card).toHaveTextContent(arMessages.packages.card.startDate);
    expect(
      within(card).getByText(arMessages.packages.actions.paymentLink),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(arMessages.packages.actions.sendPayment),
    ).toBeInTheDocument();
  });

  it("shows per-currency package finances and keeps finished and cancelled packages in history", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg(),
        pkg({ id: "p2", status: "COMPLETED", student_name: "Mona" }),
        pkg({ id: "p3", status: "CANCELLED", student_name: "Laila" }),
      ],
    });
    renderManager();

    expect(
      await screen.findByText(arMessages.packages.finance.completedValue),
    ).toBeInTheDocument();
    expect(
      screen.getByText(arMessages.packages.finance.collected),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", {
        name: arMessages.packages.segments.history,
      }),
    );
    expect(await screen.findAllByTestId("package-card")).toHaveLength(2);
    expect(
      screen.getByText(arMessages.packages.status.COMPLETED),
    ).toBeInTheDocument();
    expect(
      screen.getByText(arMessages.packages.status.CANCELLED),
    ).toBeInTheDocument();
  });

  it("opens invoice-style payment evidence fields from an unpaid package", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          outstanding_minor: 100000,
          invoice_paid_minor: 300000,
          invoice_status: "PARTIALLY_PAID",
        }),
      ],
    });
    renderManager(["invoice.mark_paid"]);

    await userEvent.click(
      await screen.findByRole("button", {
        name: arMessages.packages.segments.all,
      }),
    );
    await userEvent.click(
      within(await screen.findByTestId("package-card")).getByText(
        arMessages.packages.actions.markPaid,
      ),
    );
    expect(
      await screen.findByText(arMessages.invoices.markPaidTitle),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/مرجع المعاملة/)).toBeInTheDocument();
    expect(screen.getByLabelText(/إثبات الدفع/)).toBeInTheDocument();
  });

  it("syncs historical lessons into an existing active package", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });
    renderManager();

    await userEvent.click(
      await screen.findByRole("button", {
        name: arMessages.packages.segments.all,
      }),
    );
    await userEvent.click(
      within(await screen.findByTestId("package-card")).getByText(
        arMessages.packages.actions.syncLessons,
      ),
    );

    expect(syncLessonPackage).toHaveBeenCalledWith("p1");
    expect(await screen.findByRole("status")).toHaveTextContent("2");
  });

  // Editing is a correction of the terms, so the form opens seeded with what the package
  // currently says and sends hours (not minutes) back — the unit the academy sells in.
  it("corrects an open package's terms from the card", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });
    renderManager();

    await userEvent.click(
      await screen.findByRole("button", {
        name: arMessages.packages.segments.all,
      }),
    );
    await userEvent.click(
      within(await screen.findByTestId("package-card")).getByTestId(
        "edit-package",
      ),
    );

    const price = await screen.findByLabelText(arMessages.packages.form.price);
    expect(price).toHaveValue(4000);
    expect(screen.getByLabelText(arMessages.packages.form.hours)).toHaveValue(
      20,
    );

    await userEvent.clear(price);
    await userEvent.type(price, "3600");
    await userEvent.click(screen.getByTestId("save-package-edit"));

    expect(updateLessonPackage).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ hours: 20, price_minor: 360000 }),
    );
  });

  // The floor is what has already been taught: a package cannot be sold backwards, and the
  // form says so before the API has to.
  it("refuses to shrink a package to the hours already used", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });
    renderManager();

    await userEvent.click(
      await screen.findByRole("button", {
        name: arMessages.packages.segments.all,
      }),
    );
    await userEvent.click(
      within(await screen.findByTestId("package-card")).getByTestId(
        "edit-package",
      ),
    );

    const hours = await screen.findByLabelText(arMessages.packages.form.hours);
    await userEvent.clear(hours);
    await userEvent.type(hours, "10");

    expect(await screen.findByTestId("package-too-small")).toBeInTheDocument();
    expect(screen.getByTestId("save-package-edit")).toBeDisabled();
    expect(updateLessonPackage).not.toHaveBeenCalled();
  });

  /**
   * Closing is the one way back to the monthly clock — the exit that pairs with opening a package
   * putting a student on the hour clock. Both directions of the switch live on this screen, which
   * is the point: a billing mode that could be changed from two places is a billing mode that can
   * disagree with the packages themselves.
   */
  it("offers the way back to monthly billing when a package is closed, and leaves it off by default", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });

    renderManager();

    await userEvent.click(
      await screen.findByRole("button", {
        name: arMessages.packages.segments.all,
      }),
    );
    await userEvent.click(
      within(await screen.findByTestId("package-card")).getByTestId(
        "close-package",
      ),
    );

    const toggle = within(
      await screen.findByTestId("return-to-monthly"),
    ).getByRole("checkbox");
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);
    await userEvent.click(
      screen.getByRole("button", { name: arMessages.packages.close.confirm }),
    );

    expect(closeLessonPackage).toHaveBeenCalledWith("p1", undefined, true);
    expect(
      await screen.findByText(arMessages.packages.alerts.closedAndReturned),
    ).toBeInTheDocument();
  });
});
