import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { formatMoney } from "@/lib/money";
import { AccountingArrearsScreen } from "./accounting-arrears";
import { AccountingExpensesScreen } from "./accounting-expenses";
import { AccountingGroupsScreen } from "./accounting-groups";
import { AccountingIncomeScreen } from "./accounting-income";
import { AccountingPrivateScreen } from "./accounting-private";
import { AccountingReportsHub } from "./accounting-reports-hub";

/**
 * "How much did we make?" (docs/groups/01-ACCOUNTING.md): profit next to the cash that moved, one figure
 * across currencies at today's rate, private lessons as a report of their own, what was spent on a group,
 * and every list out to Excel with money as real numbers.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/accounting/reports",
}));

const api = {
  getIncomeExpenses: vi.fn(),
  getAccountingRates: vi.fn(),
  getAccountingPrivate: vi.fn(),
  getAccountingGroups: vi.fn(),
  getDailyCollections: vi.fn(),
  getExpenses: vi.fn(),
  createExpense: vi.fn(),
  getArrears: vi.fn(),
};
vi.mock("@/lib/accounting-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accounting-api")>()),
  getIncomeExpenses: (...a: unknown[]) => api.getIncomeExpenses(...a),
  getAccountingRates: (...a: unknown[]) => api.getAccountingRates(...a),
  getAccountingPrivate: (...a: unknown[]) => api.getAccountingPrivate(...a),
  getAccountingGroups: (...a: unknown[]) => api.getAccountingGroups(...a),
  getDailyCollections: (...a: unknown[]) => api.getDailyCollections(...a),
  getExpenses: (...a: unknown[]) => api.getExpenses(...a),
  createExpense: (...a: unknown[]) => api.createExpense(...a),
  getArrears: (...a: unknown[]) => api.getArrears(...a),
}));

const listGroups = vi.fn();
vi.mock("@/lib/groups-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/groups-api")>()),
  listGroups: (...a: unknown[]) => listGroups(...a),
}));

const download = vi.fn();
vi.mock("@/lib/accounting-export", () => ({
  downloadAccountingSheet: (...a: unknown[]) => download(...a),
}));

const ar = arMessages.accounting;
const owner = (capabilities = ["invoicing", "groups", "accounting"]) =>
  makeSession("ACADEMY_OWNER", { permissions: ["invoice.read", "invoice.mark_paid", "payout.read", "expense.manage", "cashbox.close"], capabilities });
const egp = (amount: number) => formatMoney({ amount, currency: "EGP" }, "ar");

const month = (name: string, currencies: unknown[]) => ({ month: name, currencies });
const egpRow = { currency: "EGP", in_minor: 100000, out_minor: 60000, net_minor: 40000, salaries_earned_minor: 30000, salaries_paid_minor: 50000, profit_minor: 60000 };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  listGroups.mockReset();
  download.mockReset();
  download.mockResolvedValue(undefined);
  api.getIncomeExpenses.mockResolvedValue({ year: 2026, months: [month("2026-06", [egpRow])], categories: [], sees_salaries: true });
  api.getAccountingRates.mockResolvedValue({ home: "EGP", available: true, stale: false, as_of: 1, rates: [{ currency: "USD", to_home: 50 }] });
  api.getAccountingPrivate.mockResolvedValue({ month: "2026-06", rows: [], totals: [], teachers: null, sees_teacher_cost: false });
  api.getAccountingGroups.mockResolvedValue({ month: "2026-06", groups: [], totals: [], teachers: null, sees_teacher_cost: false });
  api.getDailyCollections.mockResolvedValue({ from: "2026-06-04", to: "2026-06-17", days: [], totals: [], collectors: [] });
  listGroups.mockResolvedValue({ groups: [{ id: "g1", name: "English A1" }], counts: {} });
});

describe("Income report", () => {
  it("leads with profit for whoever reads pay, and keeps the cash that moved beside it", async () => {
    render(withAuth(owner(), <AccountingIncomeScreen />));

    expect(await screen.findByText(ar.income.totalProfit)).toBeTruthy();
    expect(screen.queryByText(ar.income.totalNet)).toBeNull();
    const table = screen.getByTestId("income-table");
    expect(within(table).getByText(ar.income.profit)).toBeTruthy();
    expect(table.textContent).toContain(egp(60000));
    // One currency: nothing to convert, so the rates are never asked for.
    expect(api.getAccountingRates).not.toHaveBeenCalled();
  });

  it("reads as it always did for whoever may not see pay", async () => {
    api.getIncomeExpenses.mockResolvedValue({
      year: 2026,
      months: [month("2026-06", [{ currency: "EGP", in_minor: 100000, out_minor: 10000, net_minor: 90000, salaries_earned_minor: null, salaries_paid_minor: null, profit_minor: null }])],
      categories: [],
      sees_salaries: false,
    });
    render(withAuth(owner(), <AccountingIncomeScreen />));

    expect(await screen.findByText(ar.income.totalNet)).toBeTruthy();
    expect(screen.queryByText(ar.income.totalProfit)).toBeNull();
    expect(within(screen.getByTestId("income-table")).queryByText(ar.income.profit)).toBeNull();
  });

  it("adds several currencies up at today's rate, marked as approximate", async () => {
    api.getIncomeExpenses.mockResolvedValue({
      year: 2026,
      months: [month("2026-06", [egpRow, { currency: "USD", in_minor: 1000, out_minor: 0, net_minor: 1000, salaries_earned_minor: 0, salaries_paid_minor: 0, profit_minor: 1000 }])],
      categories: [],
      sees_salaries: true,
    });
    render(withAuth(owner(), <AccountingIncomeScreen />));

    await userEvent.click(await screen.findByTestId("income-all-currencies"));
    // 600 EGP profit + 10 USD at 50 = 1,100 EGP.
    expect(screen.getByTestId("income-table").textContent).toContain(egp(110000));
    expect(screen.getByText(ar.income.convertedHint)).toBeTruthy();
  });

  it("names a currency it has no rate for instead of adding it up silently", async () => {
    api.getIncomeExpenses.mockResolvedValue({
      year: 2026,
      months: [month("2026-06", [egpRow, { currency: "OMR", in_minor: 1000, out_minor: 0, net_minor: 1000, salaries_earned_minor: 0, salaries_paid_minor: 0, profit_minor: 1000 }])],
      categories: [],
      sees_salaries: true,
    });
    render(withAuth(owner(), <AccountingIncomeScreen />));

    await userEvent.click(await screen.findByTestId("income-all-currencies"));
    expect(screen.getByText(ar.income.missingRates.replace("{currencies}", "OMR"))).toBeTruthy();
  });

  it("stays per currency when the rates cannot be had", async () => {
    api.getAccountingRates.mockRejectedValue(new Error("down"));
    api.getIncomeExpenses.mockResolvedValue({
      year: 2026,
      months: [month("2026-06", [egpRow, { currency: "USD", in_minor: 1000, out_minor: 0, net_minor: 1000, salaries_earned_minor: 0, salaries_paid_minor: 0, profit_minor: 1000 }])],
      categories: [],
      sees_salaries: true,
    });
    render(withAuth(owner(), <AccountingIncomeScreen />));

    await screen.findByText(ar.income.totalProfit);
    await waitFor(() => expect(api.getAccountingRates).toHaveBeenCalled());
    expect(screen.queryByTestId("income-all-currencies")).toBeNull();
  });
});

describe("Private lessons report", () => {
  const row = {
    student_id: "s1", student_name: "Dina", teacher_id: "t1", teacher_name: "Miss Mona", currency: "EGP", expected_minor: 100000, collected_minor: 60000,
    remaining_minor: 40000, arrears_minor: 0, received_in_month_minor: 60000, expenses_minor: 0, teacher_cost_minor: 15000, net_minor: 45000, rate: 0.6, margin: 0.75,
  };

  it("is a tab of the reports, for a client with no groups too", async () => {
    render(withAuth(owner(["invoicing", "accounting"]), <AccountingReportsHub />));

    await userEvent.click(await screen.findByTestId("reports-tab-private"));
    expect(await screen.findByTestId("accounting-private")).toBeTruthy();
    expect(screen.queryByTestId("reports-tab-groups")).toBeNull();
  });

  it("shows each student under their teacher, and each teacher whole", async () => {
    api.getAccountingPrivate.mockResolvedValue({
      month: "2026-06",
      rows: [row],
      totals: [{ ...row }],
      teachers: [{ teacher_id: "t1", teacher_name: "Miss Mona", currency: "EGP", students: 1, private_received_minor: 60000, groups_received_minor: 45000, received_in_month_minor: 105000, expenses_minor: 0, teacher_cost_minor: 15000, net_minor: 90000 }],
      sees_teacher_cost: true,
    });
    render(withAuth(owner(), <AccountingPrivateScreen />));

    const table = await screen.findByTestId("private-table");
    expect(within(table).getByText("Dina")).toBeTruthy();
    expect(table.textContent).toContain(egp(45000));
    const teachers = screen.getByTestId("private-teachers");
    expect(teachers.textContent).toContain(egp(45000));
    expect(teachers.textContent).toContain(egp(90000));
  });

  it("hides the teacher's cost without pay rights", async () => {
    api.getAccountingPrivate.mockResolvedValue({ month: "2026-06", rows: [{ ...row, teacher_cost_minor: null, net_minor: null, margin: null }], totals: [], teachers: null, sees_teacher_cost: false });
    render(withAuth(owner(), <AccountingPrivateScreen />));

    const table = await screen.findByTestId("private-table");
    expect(within(table).queryByText(ar.groupsPage.col.cost)).toBeNull();
    expect(screen.queryByTestId("private-teachers")).toBeNull();
  });
});

describe("What was spent on a group", () => {
  const page = {
    from: "2026-06-01", to: "2026-06-17", by_category: [], totals: [], can_manage: true, sees_salaries: true,
    expenses: [{ id: "e1", number: "E-000001", spent_on: "2026-06-10", category_id: "k1", category: "كتب", category_key: null, amount_minor: 5000, currency: "EGP", cash_account_id: "a1", account: "Drawer", payee: null, description: null, has_attachment: false, payout_id: null, class_group_id: "g1", group_name: "English A1", created_by_name: null, voided: false, void_reason: null }],
    categories: [{ id: "k1", key: null, name: "كتب", is_active: true }],
    accounts: [{ id: "a1", name: "Drawer", currency: "EGP" }],
  };

  it("names the group on a new expense, and shows it on the list", async () => {
    api.getExpenses.mockResolvedValue(page);
    api.createExpense.mockResolvedValue({ id: "e2", number: "E-000002" });
    render(withAuth(owner(), <AccountingExpensesScreen />));

    expect((await screen.findAllByText("English A1")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByTestId("expense-new"));
    await userEvent.selectOptions(await screen.findByTestId("expense-group"), "g1");
    await userEvent.type(screen.getByTestId("expense-amount"), "50");
    await userEvent.click(screen.getByTestId("expense-save"));

    await waitFor(() => expect(api.createExpense).toHaveBeenCalledWith(expect.objectContaining({ class_group_id: "g1", amount_minor: 5000 })));
  });

  it("offers no group to a client without group classes", async () => {
    api.getExpenses.mockResolvedValue(page);
    render(withAuth(owner(["invoicing", "accounting"]), <AccountingExpensesScreen />));

    await userEvent.click(await screen.findByTestId("expense-new"));
    await screen.findByTestId("expense-form");
    expect(listGroups).not.toHaveBeenCalled();
    expect(screen.queryByTestId("expense-group")).toBeNull();
  });

  it("adds an expenses column to the group report only when something was spent", async () => {
    const money = { currency: "EGP", expected_minor: 45000, collected_minor: 45000, remaining_minor: 0, arrears_minor: 0, received_in_month_minor: 45000, teacher_cost_minor: 10000, net_minor: 35000, rate: 1, margin: 0.8 };
    const group = { id: "g1", name: "English A1", level: null, status: "ACTIVE", teacher_name: "Miss Mona", billing_mode: "MONTHLY", price_minor: 45000, currency: "EGP", students: 3 };
    api.getAccountingGroups.mockResolvedValue({ month: "2026-06", groups: [{ ...group, money: [{ ...money, expenses_minor: 0 }] }], totals: [], teachers: null, sees_teacher_cost: true });
    const { unmount } = render(withAuth(owner(), <AccountingGroupsScreen />));
    expect(within(await screen.findByTestId("groups-table")).queryByText(ar.groupsPage.col.expenses)).toBeNull();
    unmount();

    api.getAccountingGroups.mockResolvedValue({ month: "2026-06", groups: [{ ...group, money: [{ ...money, expenses_minor: 5000, net_minor: 30000 }] }], totals: [], teachers: null, sees_teacher_cost: true });
    render(withAuth(owner(), <AccountingGroupsScreen />));
    const table = await screen.findByTestId("groups-table");
    expect(within(table).getByText(ar.groupsPage.col.expenses)).toBeTruthy();
    expect(table.textContent).toContain(egp(5000));
  });
});

describe("Excel", () => {
  it("exports the arrears with money in minor units for the sheet to scale, one row per currency", async () => {
    api.getArrears.mockResolvedValue({
      today: "2026-06-17",
      payers: [{
        kind: "GUARDIAN", id: "g1", name: "Parent", phone: "+2010", students: ["Adam"], groups: ["English A1"], oldest_due: "2026-05-01", open_charges: 2, last_receipt: null,
        balances: [
          { currency: "EGP", due_minor: 45000, overdue_minor: 45000, d0_30: 0, d31_60: 45000, d61_90: 0, d90_plus: 0 },
          { currency: "USD", due_minor: 1000, overdue_minor: 0, d0_30: 1000, d31_60: 0, d61_90: 0, d90_plus: 0 },
        ],
      }],
      totals: [], groups: [], can_collect: true, can_remind: true,
    });
    render(withAuth(owner(), <AccountingArrearsScreen />));

    await userEvent.click(await screen.findByTestId("export-arrears"));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const sheet = download.mock.calls[0]![0] as { rows: { balance: { currency: string } }[]; columns: { kind?: string; value: (r: unknown) => unknown }[]; rightToLeft: boolean; fileName: string };
    expect(sheet.rows.map((r) => r.balance.currency)).toEqual(["EGP", "USD"]);
    expect(sheet.rightToLeft).toBe(true);
    const amount = sheet.columns.find((c) => c.kind === "money")!;
    expect(amount.value(sheet.rows[0])).toBe(45000);
  });

  it("offers nothing when there is nothing to export", async () => {
    render(withAuth(owner(), <AccountingPrivateScreen />));
    await screen.findByText(ar.privatePage.empty);
    expect(screen.queryByTestId(/^export-/)).toBeNull();
  });

  it("says so when the file could not be made", async () => {
    download.mockRejectedValue(new Error("no"));
    render(withAuth(owner(), <AccountingIncomeScreen />));

    await userEvent.click(await screen.findByTestId(/^export-income/));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(ar.exportFailed)).toBeTruthy();
  });
});
