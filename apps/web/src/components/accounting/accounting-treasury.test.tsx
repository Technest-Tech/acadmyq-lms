import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { AccountLedger, ExpensesPage, FamilyAccount, TreasuryState } from "@/lib/accounting-api";
import { formatMoney } from "@/lib/money";
import { AccountingExpensesScreen } from "./accounting-expenses";
import { AccountingTreasuryScreen } from "./accounting-treasury";
import { DiscountPresetsScreen } from "./discount-presets";
import { FamilyAccountsCard } from "./family-accounts-card";
import { TreasuryAccountScreen } from "./treasury-account";

/**
 * The treasury, the expenses and the family card (docs/groups/01-ACCOUNTING.md): they show what the
 * API computed, preview a count's short / over before it is saved, and the family card does not
 * exist — no request either — for an academy without accounting.
 */

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: nav.push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/accounting/treasury",
}));

const api = {
  getTreasury: vi.fn(),
  getAccountLedger: vi.fn(),
  getReceipt: vi.fn(),
  voidExpense: vi.fn(),
  voidTransfer: vi.fn(),
  reopenDay: vi.fn(),
  deleteCashAccount: vi.fn(),
  updateCashAccount: vi.fn(),
  createAdjustment: vi.fn(),
  updateExpenseAmount: vi.fn(),
  closeDay: vi.fn(),
  getExpenses: vi.fn(),
  createExpense: vi.fn(),
  createExpenseCategory: vi.fn(),
  getSalariesDue: vi.fn(),
  getFamilyAccount: vi.fn(),
  addFamilyNote: vi.fn(),
  addFamilyDiscount: vi.fn(),
  applyFamilyDiscountToExisting: vi.fn(),
  endFamilyDiscount: vi.fn(),
  setFamilyRenewalPolicy: vi.fn(),
  listDiscountPresets: vi.fn(),
  createDiscountPreset: vi.fn(),
  updateDiscountPreset: vi.fn(),
};
const getPayout = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getPayout: (...a: unknown[]) => getPayout(...a),
}));
vi.mock("@/lib/accounting-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accounting-api")>()),
  getTreasury: (...a: unknown[]) => api.getTreasury(...a),
  getAccountLedger: (...a: unknown[]) => api.getAccountLedger(...a),
  getReceipt: (...a: unknown[]) => api.getReceipt(...a),
  voidExpense: (...a: unknown[]) => api.voidExpense(...a),
  voidTransfer: (...a: unknown[]) => api.voidTransfer(...a),
  reopenDay: (...a: unknown[]) => api.reopenDay(...a),
  deleteCashAccount: (...a: unknown[]) => api.deleteCashAccount(...a),
  updateCashAccount: (...a: unknown[]) => api.updateCashAccount(...a),
  createAdjustment: (...a: unknown[]) => api.createAdjustment(...a),
  updateExpenseAmount: (...a: unknown[]) => api.updateExpenseAmount(...a),
  closeDay: (...a: unknown[]) => api.closeDay(...a),
  getExpenses: (...a: unknown[]) => api.getExpenses(...a),
  createExpense: (...a: unknown[]) => api.createExpense(...a),
  createExpenseCategory: (...a: unknown[]) => api.createExpenseCategory(...a),
  getSalariesDue: (...a: unknown[]) => api.getSalariesDue(...a),
  getFamilyAccount: (...a: unknown[]) => api.getFamilyAccount(...a),
  addFamilyNote: (...a: unknown[]) => api.addFamilyNote(...a),
  addFamilyDiscount: (...a: unknown[]) => api.addFamilyDiscount(...a),
  applyFamilyDiscountToExisting: (...a: unknown[]) => api.applyFamilyDiscountToExisting(...a),
  endFamilyDiscount: (...a: unknown[]) => api.endFamilyDiscount(...a),
  setFamilyRenewalPolicy: (...a: unknown[]) => api.setFamilyRenewalPolicy(...a),
  listDiscountPresets: (...a: unknown[]) => api.listDiscountPresets(...a),
  createDiscountPreset: (...a: unknown[]) => api.createDiscountPreset(...a),
  updateDiscountPreset: (...a: unknown[]) => api.updateDiscountPreset(...a),
}));

const ar = arMessages.accounting;
const owner = (capabilities = ["invoicing", "groups", "accounting"]) =>
  makeSession("ACADEMY_OWNER", { permissions: ["invoice.read", "invoice.mark_paid", "invoice.send_link", "payout.read", "expense.manage", "cashbox.close"], capabilities });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  getPayout.mockReset();
  nav.push.mockReset();
  api.listDiscountPresets.mockResolvedValue({ presets: [], can_manage: true });
});

function treasury(over: Partial<TreasuryState> = {}): TreasuryState {
  return {
    today: "2026-06-17",
    accounts: [
      { id: "a1", name: "Cash drawer", kind: "CASH", currency: "EGP", opening_balance_minor: 50000, opening_on: "2026-06-01", is_active: true, balance_minor: 80000, today_in_minor: 30000, today_out_minor: 0, last_closing: null, closed_today: false, has_history: true },
      { id: "a2", name: "Bank", kind: "BANK", currency: "EGP", opening_balance_minor: 0, opening_on: "2026-06-01", is_active: true, balance_minor: 20000, today_in_minor: 0, today_out_minor: 0, last_closing: null, closed_today: false, has_history: true },
    ],
    methods: [{ method: "CASH", currency: "EGP", cash_account_id: "a1" }],
    unmapped_methods: [{ method: "WALLET", currency: "EGP" }],
    month: { currencies: [{ currency: "EGP", in_minor: 55000, out_minor: 15000, net_minor: 40000 }] },
    categories: [],
    can_manage: true,
    can_close: true,
    sees_salaries: true,
    ...over,
  };
}

describe("Treasury", () => {
  it("asks to set up the first account when there is none", async () => {
    api.getTreasury.mockResolvedValue(treasury({ accounts: [], methods: [], unmapped_methods: [] }));
    render(withAuth(owner(), <AccountingTreasuryScreen />));
    expect(await screen.findByTestId("treasury-empty")).toBeTruthy();
    expect(screen.getByText(ar.treasury.setupTitle)).toBeTruthy();
  });

  it("shows each account, warns about an unmapped method, and previews a count's shortage before closing", async () => {
    api.getTreasury.mockResolvedValue(treasury());
    api.closeDay.mockResolvedValue({ id: "c1", expected_minor: 80000, counted_minor: 75000, difference_minor: -5000 });
    render(withAuth(owner(), <AccountingTreasuryScreen />));

    const accounts = await screen.findByTestId("treasury-accounts");
    expect(within(accounts).getByText("Cash drawer")).toBeTruthy();
    // The warning names the method money arrives by with no account to take it.
    expect(screen.getByText(ar.treasury.unmapped.replace("{methods}", `${ar.method.WALLET} (EGP)`))).toBeTruthy();

    await userEvent.click(screen.getByTestId("close-a1"));
    const counted = screen.getByTestId("close-counted") as HTMLInputElement;
    expect(counted.value).toBe("800");
    expect(screen.getByTestId("close-diff").textContent).toBe(ar.treasury.matches);
    await userEvent.clear(counted);
    await userEvent.type(counted, "750");
    expect(screen.getByTestId("close-diff").textContent).toContain(ar.treasury.shortBy.split("{")[0]!.trim());

    await userEvent.click(screen.getByTestId("close-confirm"));
    await waitFor(() => expect(api.closeDay).toHaveBeenCalledWith({ cash_account_id: "a1", counted_minor: 75000, note: "" }));
  });

  it("opens each account on its own page", async () => {
    api.getTreasury.mockResolvedValue(treasury());
    render(withAuth(owner(), <AccountingTreasuryScreen />));
    expect((await screen.findByTestId("open-a1")).getAttribute("href")).toBe("/accounting/treasury/a1");
  });
});

const egp = (minor: number) => formatMoney({ amount: minor, currency: "EGP" }, "ar");

function ledger(over: Partial<AccountLedger> = {}): AccountLedger {
  return {
    account: { id: "a1", name: "Cash drawer", kind: "CASH", currency: "EGP", opening_on: "2026-06-01", opening_balance_minor: 50000 },
    from: "2026-06-01",
    to: "2026-06-17",
    opening_minor: 50000,
    entries: [
      { kind: "RECEIPT", id: "r1", date: "2026-06-02", label: "R-000001", party: "Parent of two", guardian_id: "g1", method: "CASH", in_minor: 30000, out_minor: 0, balance_minor: 80000 },
      { kind: "EXPENSE", id: "e1", date: "2026-06-03", label: "E-000001", party: "Landlord", category: "الإيجار", category_key: "rent", has_attachment: false, by: "Owner Omar", in_minor: 0, out_minor: 10000, balance_minor: 70000 },
      { kind: "EXPENSE", id: "e2", date: "2026-06-04", label: "E-000002", party: "Print shop", category: "طباعة", category_key: "printing", has_attachment: false, by: "Owner Omar", in_minor: 0, out_minor: 5000, balance_minor: 65000 },
      { kind: "TRANSFER_OUT", id: "t1", date: "2026-06-05", label: "Bank", from_name: "Cash drawer", to_name: "Bank", description: "To the bank", by: "Owner Omar", in_minor: 0, out_minor: 20000, balance_minor: 45000 },
    ],
    closing_minor: 45000,
    ...over,
  };
}

describe("Treasury account page", () => {
  it("puts the opening balance on top, money in beside money out, and opens a line's detail", async () => {
    api.getTreasury.mockResolvedValue(treasury());
    api.getAccountLedger.mockResolvedValue(ledger());
    api.getReceipt.mockReturnValue(new Promise(() => {}));
    api.voidExpense.mockResolvedValue({ ok: true });
    render(withAuth(owner(), <TreasuryAccountScreen accountId="a1" />));

    // The period starts the day the account opened, so the tile is its opening balance.
    const opening = await screen.findByTestId("account-opening");
    expect(opening.textContent).toContain(ar.treasury.account.opening);
    expect(opening.textContent).toContain(egp(50000));
    expect(screen.getByTestId("account-collected").textContent).toContain(egp(30000));
    expect(screen.getByTestId("account-spent").textContent).toContain(egp(15000));
    expect(screen.getByTestId("account-closing").textContent).toContain(egp(45000));

    // A transfer moves the balance but is neither side's total: it sits apart under "out".
    const inSide = screen.getByTestId("account-in");
    const outSide = screen.getByTestId("account-out");
    expect(within(inSide).getByText("Parent of two")).toBeTruthy();
    expect(within(outSide).getByText("Landlord")).toBeTruthy();
    expect(within(outSide).getByText(ar.treasury.account.moves)).toBeTruthy();
    expect(within(inSide).queryByText("Landlord")).toBeNull();

    // A category chip narrows the spent side.
    await userEvent.click(within(screen.getByTestId("account-categories")).getByRole("button", { name: /طباعة/ }));
    expect(within(outSide).queryByText("Landlord")).toBeNull();
    expect(within(outSide).getByText("Print shop")).toBeTruthy();
    await userEvent.click(within(screen.getByTestId("account-categories")).getByRole("button", { name: ar.expenses.allCategories }));

    // A receipt opens the receipt itself.
    await userEvent.click(screen.getByTestId("entry-r1"));
    await waitFor(() => expect(api.getReceipt).toHaveBeenCalledWith("r1"));

    // An expense opens its detail, and is voided right there with a reason.
    await userEvent.click(screen.getByTestId("entry-e1"));
    const detail = await screen.findByTestId("entry-detail");
    expect(within(detail).getByText("Owner Omar")).toBeTruthy();
    await userEvent.click(screen.getByTestId("entry-act"));
    expect(screen.getByTestId("entry-act-confirm")).toBeDisabled();
    await userEvent.type(screen.getByTestId("entry-reason"), "Paid twice");
    await userEvent.click(screen.getByTestId("entry-act-confirm"));
    await waitFor(() => expect(api.voidExpense).toHaveBeenCalledWith("e1", "Paid twice"));
  });

  it("calls a later period's first figure the balance brought forward, and asks for last month", async () => {
    api.getTreasury.mockResolvedValue(treasury());
    api.getAccountLedger.mockResolvedValue(ledger({ from: "2026-06-10", opening_minor: 70000 }));
    render(withAuth(owner(), <TreasuryAccountScreen accountId="a1" />));

    const opening = await screen.findByTestId("account-opening");
    expect(opening.textContent).toContain(ar.treasury.account.openingPeriod);
    expect(opening.textContent).toContain(egp(70000));

    await userEvent.click(screen.getByTestId("period-lastMonth"));
    await waitFor(() => expect(api.getAccountLedger).toHaveBeenLastCalledWith("a1", expect.stringMatching(/-01$/), expect.any(String)));
  });

  it("deletes an account that never held anything, and asks to empty one that did first", async () => {
    const accounts = treasury().accounts;
    api.getTreasury.mockResolvedValue(treasury({ accounts: [{ ...accounts[0]!, has_history: false, balance_minor: 0 }, accounts[1]!] }));
    api.getAccountLedger.mockResolvedValue(ledger({ entries: [], closing_minor: 0, opening_minor: 0 }));
    api.deleteCashAccount.mockResolvedValue({ deleted: true, stopped: false });
    const { unmount } = render(withAuth(owner(), <TreasuryAccountScreen accountId="a1" />));

    await userEvent.click(await screen.findByTestId("account-delete"));
    expect(screen.getByTestId("delete-account").textContent).toContain(ar.treasury.account.deleteForGood);
    await userEvent.click(screen.getByTestId("delete-account-confirm"));
    await waitFor(() => expect(api.deleteCashAccount).toHaveBeenCalledWith("a1"));
    expect(nav.push).toHaveBeenCalledWith("/accounting/treasury");
    unmount();

    // The drawer holds 800 and has history: no button, only the way to empty it.
    api.getTreasury.mockResolvedValue(treasury());
    api.getAccountLedger.mockResolvedValue(ledger());
    render(withAuth(owner(), <TreasuryAccountScreen accountId="a1" />));
    await userEvent.click(await screen.findByTestId("account-delete"));
    expect(screen.getByTestId("delete-account").textContent).toContain(egp(80000));
    expect(screen.queryByTestId("delete-account-confirm")).toBeNull();
  });

  it("adjusts the balance to what is really there, with a reason", async () => {
    api.getTreasury.mockResolvedValue(treasury());
    api.getAccountLedger.mockResolvedValue(ledger());
    api.createAdjustment.mockResolvedValue({ id: "adj1", expected_minor: 80000, actual_minor: 75000, amount_minor: -5000 });
    render(withAuth(owner(), <TreasuryAccountScreen accountId="a1" />));

    await userEvent.click(await screen.findByTestId("account-adjust"));
    const actual = screen.getByTestId("adjust-actual") as HTMLInputElement;
    expect(actual.value).toBe("800");
    // Nothing to adjust yet, and never without a reason.
    expect(screen.getByTestId("adjust-confirm")).toBeDisabled();
    await userEvent.clear(actual);
    await userEvent.type(actual, "750");
    expect(screen.getByTestId("adjust-diff").textContent).toContain(ar.treasury.shortBy.split("{")[0]!.trim());
    expect(screen.getByTestId("adjust-confirm")).toBeDisabled();
    await userEvent.type(screen.getByTestId("adjust-reason"), "Counted at noon");
    await userEvent.click(screen.getByTestId("adjust-confirm"));
    await waitFor(() => expect(api.createAdjustment).toHaveBeenCalledWith({ cash_account_id: "a1", actual_minor: 75000, reason: "Counted at noon" }));
  });

  it("corrects an expense's amount from its detail, and locks the opening once a day is counted", async () => {
    const accounts = treasury().accounts;
    api.getTreasury.mockResolvedValue(treasury({ accounts: [{ ...accounts[0]!, last_closing: { day: "2026-06-16", difference_minor: 0 } }, accounts[1]!] }));
    api.getAccountLedger.mockResolvedValue(ledger());
    api.updateExpenseAmount.mockResolvedValue({ ok: true });
    render(withAuth(owner(), <TreasuryAccountScreen accountId="a1" />));

    await userEvent.click(await screen.findByTestId("entry-e1"));
    await userEvent.click(screen.getByTestId("entry-edit"));
    const amount = screen.getByTestId("entry-amount") as HTMLInputElement;
    expect(amount.value).toBe("100");
    await userEvent.clear(amount);
    await userEvent.type(amount, "120");
    await userEvent.click(screen.getByTestId("entry-edit-save"));
    await waitFor(() => expect(api.updateExpenseAmount).toHaveBeenCalledWith("e1", 12000));

    await userEvent.click(await screen.findByTestId("account-edit"));
    expect(screen.getByTestId("edit-account-opening")).toBeDisabled();
    expect(screen.getByText(ar.treasury.account.openingLocked)).toBeTruthy();
  });

  it("says so when the account does not exist", async () => {
    api.getTreasury.mockResolvedValue(treasury());
    api.getAccountLedger.mockRejectedValue(new Error("404"));
    render(withAuth(owner(), <TreasuryAccountScreen accountId="nope" />));
    expect(await screen.findByText(ar.treasury.account.notFound)).toBeTruthy();
  });
});

function expensesPage(): ExpensesPage {
  return {
    from: "2026-06-01",
    to: "2026-06-17",
    expenses: [],
    by_category: [],
    totals: [],
    categories: [
      { id: "k1", key: "teacher_salaries", name: "رواتب المعلمين", is_active: true },
      { id: "k2", key: "rent", name: "الإيجار", is_active: true },
    ],
    accounts: [{ id: "a1", name: "Cash drawer", kind: "CASH", currency: "EGP" }],
    can_manage: true,
    sees_salaries: true,
  };
}

describe("Expenses", () => {
  it("records an expense from the chosen account", async () => {
    api.getExpenses.mockResolvedValue(expensesPage());
    api.createExpense.mockResolvedValue({ id: "e1", number: "E-000001" });
    render(withAuth(owner(), <AccountingExpensesScreen />));

    await userEvent.click(await screen.findByTestId("expense-new"));
    const form = screen.getByTestId("expense-form");
    // Salaries are paid against a statement, never as a free expense.
    expect(within(form).queryByRole("option", { name: "رواتب المعلمين" })).toBeNull();
    await userEvent.type(screen.getByTestId("expense-amount"), "200");
    await userEvent.click(screen.getByTestId("expense-save"));

    await waitFor(() => expect(api.createExpense).toHaveBeenCalledWith(expect.objectContaining({ category_id: "k2", cash_account_id: "a1", amount_minor: 20000 })));
  });

  it("lets the desk name a new category right in the form, and files the expense under it", async () => {
    api.getExpenses.mockResolvedValue(expensesPage());
    api.createExpenseCategory.mockResolvedValue({ id: "k-new" });
    api.createExpense.mockResolvedValue({ id: "e2", number: "E-000002" });
    render(withAuth(owner(), <AccountingExpensesScreen />));

    await userEvent.click(await screen.findByTestId("expense-new"));
    await userEvent.selectOptions(screen.getByTestId("expense-category"), "__new__");
    expect(screen.getByTestId("expense-save")).toBeDisabled();
    await userEvent.type(screen.getByTestId("expense-new-category"), "Cleaning");
    await userEvent.type(screen.getByTestId("expense-amount"), "80");
    await userEvent.click(screen.getByTestId("expense-save"));

    await waitFor(() => expect(api.createExpenseCategory).toHaveBeenCalledWith("Cleaning"));
    await waitFor(() => expect(api.createExpense).toHaveBeenCalledWith(expect.objectContaining({ category_id: "k-new", amount_minor: 8000 })));
  });

  it("finds a teacher's statement by name and shows what is behind the figure before paying it", async () => {
    api.getExpenses.mockResolvedValue(expensesPage());
    api.getSalariesDue.mockResolvedValue({
      salaries: [
        { payout_id: "p1", teacher_id: "t1", teacher_name: "Miss Mona", period: "2026-05", lines: 12, total_minor: 180000, paid_minor: 0, remaining_minor: 180000, currency: "EGP" },
        { payout_id: "p2", teacher_id: "t2", teacher_name: "Mr Ali", period: "2026-05", lines: 4, total_minor: 60000, paid_minor: 0, remaining_minor: 60000, currency: "EGP" },
      ],
    });
    getPayout.mockResolvedValue({
      payout: { id: "p1", sessions_minor: 190000, rewards_minor: 0, deductions_minor: 10000, total_minor: 180000 },
      lineItems: [{ id: "li1", session_date: "2026-05-04", student_name: "Adam", group_name: null, description: null, amount_minor: 15000, currency: "EGP" }],
      adjustments: [],
    });
    render(withAuth(owner(), <AccountingExpensesScreen />));

    await userEvent.click(await screen.findByTestId("expense-salary"));
    await userEvent.type(await screen.findByTestId("salary-search"), "mona");
    expect(screen.queryByTestId("salary-p2")).toBeNull();
    await userEvent.click(screen.getByTestId("salary-p1"));
    expect(await screen.findByTestId("salary-summary")).toBeTruthy();
    expect(getPayout).toHaveBeenCalledWith("p1");
    expect(screen.getByTestId("salary-lines").textContent).toContain("Adam");
  });
});

function family(): FamilyAccount {
  return {
    family: { id: "gd1", name: "Parent of two", phone: null },
    today: "2026-06-17",
    balance: [{ currency: "EGP", due_minor: 130000, credit_minor: 0, balance_minor: 130000, overdue_minor: 40000 }],
    paid_this_year: [{ currency: "EGP", amount_minor: 50000 }],
    last_receipt: null,
    next_follow_up: { date: "2026-06-18", body: "Will pay Thursday" },
    children: [
      { id: "s1", name: "Adam", status: "REGULAR", groups: [{ id: "g1", name: "English A1", teacher_name: "Miss Mona", billing_mode: "MONTHLY", price_minor: 45000, currency: "EGP", joined_on: "2026-05-01" }], private: null, due: [{ currency: "EGP", due_minor: 45000 }] },
      { id: "s2", name: "Bassel", status: "REGULAR", groups: [], private: { plan_label: "8 lessons", price_minor: 10000, currency: "EGP", price_basis: "PER_SESSION", teachers: ["Mr Ali"] }, due: [] },
    ],
    charges: [
      { id: "l1", invoice_id: "i1", source: "GROUP", group_name: "English A1", description: "English A1 — June 2026", student_id: "s1", student_name: "Adam", date: "2026-06-01", period: "2026-06", amount_minor: 40500, list_amount_minor: 45000, discount_minor: 4500, discount_label: "Sibling", paid_minor: 0, remaining_minor: 40500, currency: "EGP", payer_kind: "GUARDIAN", payer_id: "gd1" },
      { id: "l2", invoice_id: "i1", source: "PRIVATE", group_name: null, description: "Lesson 2026-06-02", student_id: "s2", student_name: "Bassel", date: "2026-06-02", period: "2026-06", amount_minor: 10000, list_amount_minor: null, discount_minor: 0, discount_label: null, paid_minor: 0, remaining_minor: 10000, currency: "EGP", payer_kind: "GUARDIAN", payer_id: "gd1" },
    ],
    discounts: [{ id: "d1", kind: "PERCENT", value: 1000, label: "Sibling", scope: "ALL", student_id: null, student_name: null, class_group_id: null, group_name: null, starts_on: "2026-06-01", ends_on: null, active: true, by: "Owner" }],
    timeline: [{ kind: "NOTE", at: "2026-06-17T10:00:00Z", date: "2026-06-17", id: "n1", body: "Will pay Thursday", follow_up_on: "2026-06-18", by: "Owner", mine: true }],
    can_collect: true,
    can_remind: true,
    can_note: true,
  };
}

describe("Family card", () => {
  it("does not exist — and asks nothing — for an academy without accounting", () => {
    const { container } = render(withAuth(owner(["invoicing", "groups"]), <FamilyAccountsCard guardianId="gd1" />));
    expect(container.querySelector('[data-testid="family-accounts"]')).toBeNull();
    expect(api.getFamilyAccount).not.toHaveBeenCalled();
  });

  it("shows what the family owes, its children's enrolment, and keeps notes", async () => {
    api.getFamilyAccount.mockResolvedValue(family());
    api.addFamilyNote.mockResolvedValue({ id: "n2" });
    render(withAuth(owner(), <FamilyAccountsCard guardianId="gd1" />));

    expect(await screen.findByTestId("family-accounts")).toBeTruthy();
    expect(within(screen.getByTestId("family-child-s1")).getByRole("link", { name: "English A1" })).toHaveAttribute("href", "/groups/g1?tab=accounts");
    expect(within(screen.getByTestId("family-child-s2")).getByText(ar.family.privateLessons)).toBeTruthy();

    // Both sources are on the account: filter to private lessons only.
    await userEvent.click(screen.getByTestId("family-source-PRIVATE"));
    expect(within(screen.getByTestId("family-charges")).queryByText("English A1 — June 2026")).toBeNull();
    expect(within(screen.getByTestId("family-charges")).getByText("Lesson 2026-06-02")).toBeTruthy();

    const form = screen.getByTestId("family-note-form");
    await userEvent.type(within(form).getByPlaceholderText(ar.family.notePlaceholder), "Called the father");
    await userEvent.click(within(form).getByRole("button", { name: ar.family.addNote }));
    await waitFor(() => expect(api.addFamilyNote).toHaveBeenCalledWith("gd1", "Called the father", null));
  });

  it("shows the family's discounts, what each charge was before its discount, and records a new one", async () => {
    api.getFamilyAccount.mockResolvedValue(family());
    api.addFamilyDiscount.mockResolvedValue({ id: "d2" });
    render(withAuth(owner(), <FamilyAccountsCard guardianId="gd1" />));

    const panel = await screen.findByTestId("family-discounts");
    expect(within(panel).getByText(/Sibling/)).toBeTruthy();
    expect(within(panel).getByText(/10%/)).toBeTruthy();
    // The charge says it was 450 before the 45 off.
    await userEvent.click(screen.getByTestId("family-source-ALL"));
    expect(screen.getByTestId("charge-discount-l1").textContent).toContain(ar.family.wasPrice.split("{list}")[0]!.trim());

    await userEvent.click(screen.getByTestId("discount-add"));
    await userEvent.selectOptions(screen.getByTestId("discount-kind"), "FIXED");
    await userEvent.type(screen.getByTestId("discount-value"), "50");
    await userEvent.type(screen.getByTestId("discount-label"), "Scholarship");
    await userEvent.selectOptions(screen.getByTestId("discount-student"), "s1");
    await userEvent.selectOptions(screen.getByTestId("discount-scope"), "GROUP");
    await userEvent.click(screen.getByTestId("discount-save"));
    // A fixed amount goes up in minor units; a percentage would go as a whole percent.
    await waitFor(() => expect(api.addFamilyDiscount).toHaveBeenCalledWith("gd1", { kind: "FIXED", value: 5000, label: "Scholarship", scope: "GROUP", student_id: "s1", class_group_id: null, apply_to_existing: true }));

    await userEvent.click(screen.getByTestId("discount-end-d1"));
    await waitFor(() => expect(api.endFamilyDiscount).toHaveBeenCalledWith("gd1", "d1"));
  });

  it("takes a discount off the charges already billed — by default for a new one, on demand for an old one", async () => {
    api.getFamilyAccount.mockResolvedValue(family());
    api.addFamilyDiscount.mockResolvedValue({ id: "d2", applied: { lines: 3, discount_minor: 13500 } });
    api.applyFamilyDiscountToExisting.mockResolvedValue({ applied: { lines: 0, discount_minor: 0 } });
    render(withAuth(owner(), <FamilyAccountsCard guardianId="gd1" />));

    await userEvent.click(await screen.findByTestId("discount-add"));
    expect(screen.getByTestId("discount-apply-existing")).toBeChecked();
    await userEvent.type(screen.getByTestId("discount-value"), "10");
    await userEvent.type(screen.getByTestId("discount-label"), "Sibling");
    await userEvent.click(screen.getByTestId("discount-save"));
    await waitFor(() => expect(api.addFamilyDiscount).toHaveBeenCalledWith("gd1", expect.objectContaining({ kind: "PERCENT", value: 10, apply_to_existing: true })));
    // The notice says how many charges moved.
    expect(await screen.findByText(/3/)).toBeTruthy();

    // Unticked, nothing already billed moves.
    await userEvent.click(await screen.findByTestId("discount-add"));
    await userEvent.click(screen.getByTestId("discount-apply-existing"));
    await userEvent.type(screen.getByTestId("discount-value"), "5");
    await userEvent.type(screen.getByTestId("discount-label"), "Late");
    await userEvent.click(screen.getByTestId("discount-save"));
    await waitFor(() => expect(api.addFamilyDiscount).toHaveBeenLastCalledWith("gd1", expect.objectContaining({ apply_to_existing: false })));

    // An existing discount is applied from its row.
    await userEvent.click(screen.getByTestId("discount-apply-d1"));
    await waitFor(() => expect(api.applyFamilyDiscountToExisting).toHaveBeenCalledWith("gd1", "d1"));
    expect(await screen.findByText(ar.family.discountNothingToApply)).toBeTruthy();
  });

  it("switches the family to pay first, and back", async () => {
    api.getFamilyAccount.mockResolvedValue(family());
    api.setFamilyRenewalPolicy.mockResolvedValue({ policy: "PAY_FIRST" });
    render(withAuth(owner(), <FamilyAccountsCard guardianId="gd1" />));

    const control = await screen.findByTestId("renewal-policy");
    expect(within(control).getByTestId("renewal-FREE")).toHaveAttribute("aria-checked", "true");
    expect(control.textContent).toContain(ar.renewal.freeHint);
    api.getFamilyAccount.mockResolvedValue({ ...family(), family: { ...family().family, renewal_policy: "PAY_FIRST" } });
    await userEvent.click(within(control).getByTestId("renewal-PAY_FIRST"));
    await waitFor(() => expect(api.setFamilyRenewalPolicy).toHaveBeenCalledWith("gd1", "PAY_FIRST"));
    await waitFor(() => expect(within(screen.getByTestId("renewal-policy")).getByTestId("renewal-PAY_FIRST")).toHaveAttribute("aria-checked", "true"));
  });
});

const preset = (over: Record<string, unknown> = {}) => ({ id: "p1", name: "Sibling", kind: "PERCENT", value: 1000, notes: null, is_active: true, uses: 0, by: "Owner", ...over });

describe("Discount presets", () => {
  it("lets the family card pick a preset, which fills the form and is sent as the preset", async () => {
    api.getFamilyAccount.mockResolvedValue(family());
    api.listDiscountPresets.mockResolvedValue({ presets: [preset(), preset({ id: "p2", name: "Old one", is_active: false })], can_manage: true });
    api.addFamilyDiscount.mockResolvedValue({ id: "d3" });
    render(withAuth(owner(), <FamilyAccountsCard guardianId="gd1" />));

    await userEvent.click(await screen.findByTestId("discount-add"));
    const pick = await screen.findByTestId("discount-preset");
    // A retired preset is not offered.
    expect(within(pick).queryByRole("option", { name: /Old one/ })).toBeNull();
    await userEvent.selectOptions(pick, "p1");
    expect(screen.getByTestId("discount-value")).toHaveValue("10");
    expect(screen.getByTestId("discount-label")).toHaveValue("Sibling");
    expect(screen.getByTestId("discount-kind")).toBeDisabled();
    await userEvent.click(screen.getByTestId("discount-save"));
    await waitFor(() => expect(api.addFamilyDiscount).toHaveBeenCalledWith("gd1", { preset_id: "p1", scope: "ALL", student_id: null, class_group_id: null, apply_to_existing: true }));
  });

  it("offers the picker even with no presets yet, and saves a typed discount as a preset on the way", async () => {
    api.getFamilyAccount.mockResolvedValue(family());
    api.listDiscountPresets.mockResolvedValue({ presets: [], can_manage: true });
    api.createDiscountPreset.mockResolvedValue({ preset: preset({ id: "p9", name: "Early payment", kind: "PERCENT", value: 500 }) });
    api.addFamilyDiscount.mockResolvedValue({ id: "d4" });
    render(withAuth(owner(), <FamilyAccountsCard guardianId="gd1" />));

    await userEvent.click(await screen.findByTestId("discount-add"));
    const pick = await screen.findByTestId("discount-preset");
    expect(within(pick).getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText(ar.family.noPresets)).toBeTruthy();
    expect(screen.getByTestId("discount-manage-presets")).toHaveAttribute("href", "/accounting/treasury?tab=discounts");

    await userEvent.type(screen.getByTestId("discount-value"), "5");
    await userEvent.type(screen.getByTestId("discount-label"), "Early payment");
    await userEvent.click(screen.getByTestId("discount-save-preset"));
    await userEvent.click(screen.getByTestId("discount-save"));
    await waitFor(() => expect(api.createDiscountPreset).toHaveBeenCalledWith({ name: "Early payment", kind: "PERCENT", value: 5 }));
    await waitFor(() => expect(api.addFamilyDiscount).toHaveBeenCalledWith("gd1", { preset_id: "p9", scope: "ALL", student_id: null, class_group_id: null, apply_to_existing: true }));
  });

  it("lists the presets, adds one in whole percent, and retires one", async () => {
    api.listDiscountPresets.mockResolvedValue({ presets: [preset({ uses: 2 })], can_manage: true });
    api.createDiscountPreset.mockResolvedValue({ preset: preset({ id: "p3", name: "Scholarship", kind: "FIXED", value: 20000 }) });
    api.updateDiscountPreset.mockResolvedValue({ preset: preset({ is_active: false }) });
    render(withAuth(owner(), <DiscountPresetsScreen />));

    const row = await screen.findByTestId("preset-p1");
    expect(row.textContent).toContain("10%");
    await userEvent.click(screen.getByTestId("preset-add"));
    await userEvent.type(screen.getByTestId("preset-name"), "Scholarship");
    await userEvent.selectOptions(screen.getByTestId("preset-kind"), "FIXED");
    await userEvent.type(screen.getByTestId("preset-value"), "200");
    await userEvent.click(screen.getByTestId("preset-save"));
    await waitFor(() => expect(api.createDiscountPreset).toHaveBeenCalledWith({ name: "Scholarship", kind: "FIXED", value: 20000, notes: null }));

    await userEvent.click(screen.getByTestId("preset-toggle-p1"));
    await waitFor(() => expect(api.updateDiscountPreset).toHaveBeenCalledWith("p1", { is_active: false }));
  });

  it("shows the list without the editing buttons to whoever may not manage it", async () => {
    api.listDiscountPresets.mockResolvedValue({ presets: [preset()], can_manage: false });
    render(withAuth(owner(), <DiscountPresetsScreen />));
    await screen.findByTestId("preset-p1");
    expect(screen.queryByTestId("preset-add")).toBeNull();
    expect(screen.queryByTestId("preset-edit-p1")).toBeNull();
  });
});
