import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { AccountingReportsHub } from "./accounting-reports-hub";
import { AccountingTreasuryHub } from "./accounting-treasury-hub";

/**
 * The two hub pages (docs/groups/01-ACCOUNTING.md): the Treasury holds accounts, receipts and
 * expenses as tabs; the Reports hold daily collections, income vs expenses and — only with group
 * classes — group collections. A link can land on a tab (`?tab=`), and switching writes it back.
 */

let params = new URLSearchParams();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => params,
  usePathname: () => "/accounting/treasury",
}));

const api = {
  getTreasury: vi.fn(),
  getReceipts: vi.fn(),
  getExpenses: vi.fn(),
  getDailyCollections: vi.fn(),
  getIncomeExpenses: vi.fn(),
  getAccountingGroups: vi.fn(),
};
vi.mock("@/lib/accounting-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accounting-api")>()),
  getTreasury: (...a: unknown[]) => api.getTreasury(...a),
  getReceipts: (...a: unknown[]) => api.getReceipts(...a),
  getExpenses: (...a: unknown[]) => api.getExpenses(...a),
  getDailyCollections: (...a: unknown[]) => api.getDailyCollections(...a),
  getIncomeExpenses: (...a: unknown[]) => api.getIncomeExpenses(...a),
  getAccountingGroups: (...a: unknown[]) => api.getAccountingGroups(...a),
}));

const ar = arMessages.accounting;
const owner = (capabilities = ["invoicing", "groups", "accounting"]) =>
  makeSession("ACADEMY_OWNER", { permissions: ["invoice.read", "invoice.mark_paid", "payout.read", "expense.manage", "cashbox.close"], capabilities });

beforeEach(() => {
  params = new URLSearchParams();
  replace.mockReset();
  Object.values(api).forEach((f) => f.mockReset());
  api.getTreasury.mockResolvedValue({ today: "2026-06-17", accounts: [], methods: [], unmapped_methods: [], month: { currencies: [] }, categories: [], can_manage: true, can_close: true, sees_salaries: true });
  api.getReceipts.mockResolvedValue({ from: "2026-06-01", to: "2026-06-17", receipts: [], totals: [], collectors: [], meta: { page: 1, per_page: 50, total: 0 }, can_void: true });
  api.getExpenses.mockResolvedValue({ from: "2026-06-01", to: "2026-06-17", expenses: [], by_category: [], totals: [], categories: [], accounts: [], can_manage: true, sees_salaries: true });
  api.getDailyCollections.mockResolvedValue({ from: "2026-06-04", to: "2026-06-17", days: [], totals: [], collectors: [] });
  api.getIncomeExpenses.mockResolvedValue({ year: 2026, months: [], categories: [], sees_salaries: true });
  api.getAccountingGroups.mockResolvedValue({ month: "2026-06", groups: [], totals: [], teachers: null, sees_teacher_cost: false });
});

describe("Treasury hub", () => {
  it("opens on the accounts, switches to receipts and expenses, and writes the tab to the address", async () => {
    render(withAuth(owner(), <AccountingTreasuryHub />));

    expect(await screen.findByTestId("accounting-treasury")).toBeTruthy();
    // One hero for the hub; the screens inside bring none of their own.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(ar.hub.treasury.title);

    await userEvent.click(screen.getByTestId("treasury-tab-receipts"));
    expect(await screen.findByTestId("receipts-register")).toBeTruthy();
    expect(replace).toHaveBeenLastCalledWith("/accounting/treasury?tab=receipts", { scroll: false });
    // Recording a payment is still one click away inside the tab.
    expect(screen.getByTestId("register-record")).toBeTruthy();

    await userEvent.click(screen.getByTestId("treasury-tab-expenses"));
    expect(await screen.findByTestId("accounting-expenses")).toBeTruthy();
    await waitFor(() => expect(api.getExpenses).toHaveBeenCalled());
  });

  it("lands on the tab a link asked for", async () => {
    params = new URLSearchParams("tab=expenses");
    render(withAuth(owner(), <AccountingTreasuryHub />));
    expect(await screen.findByTestId("accounting-expenses")).toBeTruthy();
    expect(screen.queryByTestId("accounting-treasury")).toBeNull();
  });
});

describe("Reports hub", () => {
  it("holds daily collections, income vs expenses and group collections", async () => {
    render(withAuth(owner(), <AccountingReportsHub />));

    expect(await screen.findByTestId("accounting-daily")).toBeTruthy();
    expect(screen.getByTestId("reports-tab-groups")).toBeTruthy();
    await userEvent.click(screen.getByTestId("reports-tab-income"));
    expect(await screen.findByTestId("accounting-income")).toBeTruthy();
    await userEvent.click(screen.getByTestId("reports-tab-groups"));
    expect(await screen.findByTestId("accounting-groups")).toBeTruthy();
  });

  it("has no group tab for a client without group classes — even when a link asks for it", async () => {
    params = new URLSearchParams("tab=groups");
    render(withAuth(owner(["invoicing", "accounting"]), <AccountingReportsHub />));

    expect(await screen.findByTestId("accounting-daily")).toBeTruthy();
    expect(screen.queryByTestId("reports-tab-groups")).toBeNull();
    expect(api.getAccountingGroups).not.toHaveBeenCalled();
  });
});
