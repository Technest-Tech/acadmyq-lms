import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { StudentPackagePanel } from "@/components/packages/student-package-panel";
import { makeSession, withAuth } from "@/test/auth";
import { formatMoney } from "@/lib/money";
import { StudentMonthCard } from "./student-month-card";

/**
 * The Subscription tab's two new reads: the running month (taught vs quota, the bill, the family's
 * debt) and the package panel that is now the packages page's own card — with its buttons.
 */
const getStudentMonth = vi.fn();
const listLessonPackages = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getStudentMonth: (...a: unknown[]) => getStudentMonth(...a),
  listLessonPackages: (...a: unknown[]) => listLessonPackages(...a),
  listPackageStudents: () => Promise.resolve({ students: [] }),
}));

const ar = arMessages.students.subscription.month;
const egp = (minor: number) => formatMoney({ amount: minor, currency: "EGP" }, "ar");
const owner = () =>
  makeSession("ACADEMY_OWNER", {
    permissions: ["student.read", "package.read", "package.manage", "invoice.read"],
    capabilities: ["invoicing", "packages"],
  });

const month = (over: Record<string, unknown> = {}) => ({
  month: "2026-06",
  lessons: { taught: 3, taught_minutes: 120, cancelled: 1, upcoming: 2, unmarked: 1 },
  next_lesson_at: "2026-06-15T10:00:00+00:00",
  bill: { id: "i1", status: "OPEN", state: "PARTIAL", currency: "EGP", total_minor: 50000, own_minor: 40000, paid_minor: 10000, due_minor: 40000, shared: true, url: "https://x.test/i/tok" },
  family_due: [{ currency: "EGP", due_minor: 70000 }],
  ...over,
});

const pkg = (over: Record<string, unknown> = {}) => ({
  id: "p1", student_id: "s1", student_name: "Adam", label: "8 × 60 د — يونيو", sequence_no: 2, status: "ACTIVE", bill_timing: "ON_START",
  minutes_total: 480, carried_over_minutes: 0, minutes_sold: 480, minutes_consumed: 120, minutes_remaining: 360, minutes_overdrawn: 0,
  lesson_count: 2, upcoming_lesson_count: 3, next_lesson_at: null, percent_used: 25, price_minor: 160000, hourly_rate_minor: 20000, currency: "EGP",
  starts_on: "2026-06-01", expires_on: null, closed_at: null, closed_reason: null, invoice_id: "i9", invoice_status: "OPEN", invoice_token: "tok",
  invoice_total_minor: 160000, invoice_paid_minor: 0, outstanding_minor: 160000, paid_at: null, payment_method: null, payment_reason: null,
  payment_reference: null, payment_proof_url: null, overdraft_billed: false, overdraft_absorbed_into: null, absorbed_overdraft_minutes: 0,
  auto_renew: true, next_terms: null, opened_automatically: false, awaiting_next_package: false, gap: null, previous_unpaid: null,
  reminders_sent: 0, last_reminded_at: null, ...over,
});

beforeEach(() => {
  getStudentMonth.mockReset();
  listLessonPackages.mockReset();
});

describe("StudentMonthCard", () => {
  it("reads the month back: taught of the quota, what is left to mark, the bill and the family's debt", async () => {
    getStudentMonth.mockResolvedValue(month());
    render(withAuth(owner(), <StudentMonthCard studentId="s1" quota={8} />));

    expect(await screen.findByTestId("month-taught")).toHaveTextContent("3 من 8");
    const bill = screen.getByTestId("month-bill");
    // Money is matched on the raw text: formatMoney's non-breaking space does not survive normalising.
    expect(bill.textContent).toContain(egp(50000));
    expect(bill.textContent).toContain(ar.state.PARTIAL);
    expect(bill.textContent).toContain(egp(40000));
    expect(within(bill).getByRole("link", { name: new RegExp(ar.openBill) })).toHaveAttribute("href", "https://x.test/i/tok");
    expect(screen.getByTestId("month-family-due").textContent).toContain(egp(70000));
  });

  it("says nothing was billed yet, and nothing is owed, rather than showing zeroes", async () => {
    getStudentMonth.mockResolvedValue(month({ bill: null, family_due: [] }));
    render(withAuth(owner(), <StudentMonthCard studentId="s1" quota={null} />));

    expect(await screen.findByTestId("month-taught")).toHaveTextContent("3");
    expect(screen.getByTestId("month-bill")).toHaveTextContent(ar.noBill);
    expect(screen.getByTestId("month-family-due")).toHaveTextContent(ar.familyNothing);
  });
});

describe("StudentPackagePanel", () => {
  it("is the packages page's own card, and edits the package in place", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });
    render(withAuth(owner(), <StudentPackagePanel studentId="s1" />));

    const card = await screen.findByTestId("package-card");
    expect(within(card).getByTestId("package-number")).toHaveTextContent("2");

    // The edit lives behind the card's menu, as on /packages — and opens the same form here.
    await userEvent.click(within(card).getByTestId("package-card-menu"));
    await userEvent.click(await screen.findByTestId("edit-package"));
    expect(await screen.findByLabelText(arMessages.packages.form.lessons)).toHaveValue(8);
  });

  it("opens a package from the profile when none is open", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg({ status: "COMPLETED", outstanding_minor: 0, invoice_paid_minor: 160000, invoice_status: "PAID" })] });
    render(withAuth(owner(), <StudentPackagePanel studentId="s1" />));

    await userEvent.click(await screen.findByTestId("open-package-for-student"));
    expect(await screen.findByRole("dialog", { name: arMessages.packages.form.title })).toBeInTheDocument();
    // A settled block folds into the history line instead of a card.
    expect(screen.queryByTestId("package-card")).toBeNull();
    expect(screen.getByText(arMessages.packages.panel.history)).toBeInTheDocument();
  });
});
