import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { AccountingGroups, AccountingOverview, Arrears, ArrearsPayer, DailyCollections, Statement } from "@/lib/accounting-api";
import { AccountingArrearsScreen } from "./accounting-arrears";
import { AccountingDailyScreen } from "./accounting-daily";
import { AccountingGroupsScreen } from "./accounting-groups";
import { AccountingOverviewScreen } from "./accounting-overview";
import { AccountingStatementScreen } from "./accounting-statement";
import { AccountingGate } from "./accounting-ui";

/**
 * The Accounting section's pages (docs/groups/01-ACCOUNTING.md): they render what the API computed
 * (no money math here), reach the next page in one click, and are behind the accounting switch.
 */

let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => params,
  usePathname: () => "/accounting",
}));

const api = {
  getAccountingOverview: vi.fn(),
  getAccountingGroups: vi.fn(),
  getArrears: vi.fn(),
  remindPayer: vi.fn(),
  getStatement: vi.fn(),
  getDailyCollections: vi.fn(),
};
vi.mock("@/lib/accounting-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accounting-api")>()),
  getAccountingOverview: (...a: unknown[]) => api.getAccountingOverview(...a),
  getAccountingGroups: (...a: unknown[]) => api.getAccountingGroups(...a),
  getArrears: (...a: unknown[]) => api.getArrears(...a),
  remindPayer: (...a: unknown[]) => api.remindPayer(...a),
  getStatement: (...a: unknown[]) => api.getStatement(...a),
  getDailyCollections: (...a: unknown[]) => api.getDailyCollections(...a),
}));

const ar = arMessages.accounting;
const owner = (capabilities = ["invoicing", "groups", "accounting"]) =>
  makeSession("ACADEMY_OWNER", { permissions: ["invoice.read", "invoice.mark_paid", "invoice.send_link", "payout.read"], capabilities });

const aging = { d0_30: 25000, d31_60: 45000, d61_90: 0, d90_plus: 0 };

function payer(over: Partial<ArrearsPayer> = {}): ArrearsPayer {
  return {
    kind: "GUARDIAN",
    id: "gd1",
    name: "Parent of two",
    phone: "+201001112223",
    students: ["Bassel"],
    groups: ["English A1"],
    balances: [{ currency: "EGP", due_minor: 70000, overdue_minor: 45000, ...aging }],
    oldest_due: "2026-05-01",
    open_charges: 2,
    last_receipt: { id: "r2", number: "R-000002", received_on: "2026-06-17", amount_minor: 20000, currency: "EGP" },
    ...over,
  };
}

beforeEach(() => {
  params = new URLSearchParams();
  Object.values(api).forEach((f) => f.mockReset());
});

describe("the gate", () => {
  it("shows nothing of a page to a client without accounting", () => {
    render(withAuth(owner(["invoicing", "groups"]), <AccountingGate><p>secret</p></AccountingGate>));
    expect(screen.queryByText("secret")).toBeNull();
    expect(screen.getByText(ar.noAccess)).toBeTruthy();
  });
});

describe("Overview", () => {
  it("shows the month's KPIs, the aging and the biggest debtors", async () => {
    const data: AccountingOverview = {
      month: "2026-06",
      today: "2026-06-17",
      collected: [{ currency: "EGP", amount_minor: 110000, count: 2, today_minor: 110000, by_method: { CASH: 90000, INSTAPAY: 20000 }, by_collector: [{ id: "u1", name: "Owner Omar", source: "MANUAL", amount_minor: 110000, count: 2 }], by_day: [{ date: "2026-06-17", amount_minor: 110000 }] }],
      billed: [{ currency: "EGP", billed_minor: 135000, paid_minor: 65000, rate: 0.4815 }],
      owed: [{ currency: "EGP", due_minor: 160000, overdue_minor: 90000, payers: 2, ...aging, d31_60: 90000, d0_30: 70000 }],
      credit: [],
      top_debtors: [payer({ id: "gd2", name: "Celine’s mother" })],
      recent_receipts: [],
    };
    api.getAccountingOverview.mockResolvedValue(data);
    render(withAuth(owner(), <AccountingOverviewScreen />));

    expect(await screen.findByTestId("kpi-collected")).toBeTruthy();
    expect(screen.getByText("48%")).toBeTruthy();
    expect(screen.getByText("Owner Omar")).toBeTruthy();
    expect(within(screen.getByTestId("overview-debtors")).getByRole("link", { name: "Celine’s mother" })).toHaveAttribute("href", "/accounting/statement?guardian_id=gd2");
    expect(screen.getByRole("link", { name: new RegExp(ar.bucket.d31_60) })).toHaveAttribute("href", "/accounting/arrears?bucket=d31_60");
  });
});

describe("Group collections", () => {
  it("lists each group with its rate, cost and net, and opens its Accounts tab", async () => {
    const m = { currency: "EGP", expected_minor: 135000, collected_minor: 65000, remaining_minor: 70000, arrears_minor: 90000, received_in_month_minor: 110000, teacher_cost_minor: 30000, net_minor: 80000, rate: 0.4815, margin: 0.7273 };
    const data: AccountingGroups = {
      month: "2026-06",
      groups: [{ id: "g1", name: "English A1", level: "A1", status: "ACTIVE", teacher_name: "Miss Mona", billing_mode: "MONTHLY", price_minor: 45000, currency: "EGP", students: 3, money: [m] }],
      totals: [m],
      teachers: [{ ...m, teacher_id: "t1", teacher_name: "Miss Mona", groups: 1 }],
      sees_teacher_cost: true,
    };
    api.getAccountingGroups.mockResolvedValue(data);
    render(withAuth(owner(), <AccountingGroupsScreen />));

    const table = await screen.findByTestId("groups-table");
    expect(within(table).getByRole("link", { name: "English A1" })).toHaveAttribute("href", "/groups/g1?tab=accounts");
    expect(screen.getByTestId("groups-teachers")).toBeTruthy();
    expect(within(table).getAllByText("48%").length).toBeGreaterThan(0);
  });
});

describe("Arrears", () => {
  const data = (): Arrears => ({
    today: "2026-06-17",
    payers: [payer()],
    totals: [{ currency: "EGP", due_minor: 70000, overdue_minor: 45000, payers: 1, ...aging }],
    groups: [{ id: "g1", name: "English A1" }],
    can_collect: true,
    can_remind: true,
  });

  it("starts on the bucket a link asked for, and filters by bucket", async () => {
    params = new URLSearchParams("bucket=d31_60");
    api.getArrears.mockResolvedValue(data());
    render(withAuth(owner(), <AccountingArrearsScreen />));

    await screen.findByTestId("arrears-list");
    expect(api.getArrears).toHaveBeenCalledWith(expect.objectContaining({ bucket: "d31_60" }));
    await userEvent.click(screen.getByTestId("arrears-bucket-overdue"));
    await waitFor(() => expect(api.getArrears).toHaveBeenLastCalledWith(expect.objectContaining({ bucket: "overdue" })));
  });

  it("sends a WhatsApp reminder, opening WhatsApp when it is not sent automatically", async () => {
    api.getArrears.mockResolvedValue(data());
    api.remindPayer.mockResolvedValue({ phone: "+201001112223", message: "تذكير", transport: "link", sent: false });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(withAuth(owner(), <AccountingArrearsScreen />));

    const row = await screen.findByTestId("arrears-gd1");
    await userEvent.click(within(row).getByRole("button", { name: ar.arrears.remind }));
    await waitFor(() => expect(api.remindPayer).toHaveBeenCalledWith({ guardian_id: "gd1" }));
    expect(open).toHaveBeenCalledWith(expect.stringContaining("https://wa.me/201001112223"), "_blank", "noopener,noreferrer");
    expect(within(row).getByRole("link", { name: ar.arrears.statement })).toHaveAttribute("href", "/accounting/statement?guardian_id=gd1");
    open.mockRestore();
  });
});

describe("Statement", () => {
  it("shows the brought-forward balance, every entry with its running balance, and prints on its own", async () => {
    params = new URLSearchParams("guardian_id=gd1");
    const data: Statement = {
      payer: { kind: "GUARDIAN", id: "gd1", name: "Parent of two", phone: null },
      students: ["Adam", "Bassel"],
      from: "2026-06-01",
      to: "2026-06-30",
      currencies: [
        {
          currency: "EGP",
          opening_minor: 90000,
          charges_minor: 90000,
          receipts_minor: 110000,
          closing_minor: 70000,
          entries: [
            { date: "2026-06-01", kind: "CHARGE", id: "l1", description: "English A1 — June 2026", currency: "EGP", debit_minor: 45000, credit_minor: 0, paid_minor: 45000, balance_minor: 135000 },
            { date: "2026-06-17", kind: "RECEIPT", id: "r1", description: "R-000001", method: "CASH", currency: "EGP", debit_minor: 0, credit_minor: 90000, balance_minor: 45000 },
          ],
        },
      ],
      balance: [{ currency: "EGP", due_minor: 70000, credit_minor: 0, balance_minor: 70000 }],
    };
    api.getStatement.mockResolvedValue(data);
    render(withAuth(owner(), <AccountingStatementScreen />));

    const sheet = await screen.findByTestId("statement-sheet");
    expect(api.getStatement).toHaveBeenCalledWith({ guardian_id: "gd1", student_id: null }, expect.any(String), expect.any(String));
    expect(within(sheet).getByText(ar.statement.broughtForward)).toBeTruthy();
    expect(within(sheet).getByText("English A1 — June 2026")).toBeTruthy();
    expect(within(sheet).getByText(ar.statement.receiptNo.replace("{number}", "R-000001"))).toBeTruthy();
    expect(sheet).toHaveAttribute("data-print-area");
    expect(document.body.classList.contains("print-isolate")).toBe(true);
  });
});

describe("Daily collections", () => {
  it("lists every day of the window, money days by method and collector", async () => {
    const data: DailyCollections = {
      from: "2026-06-16",
      to: "2026-06-17",
      days: [
        { date: "2026-06-17", voided: 1, currencies: [{ currency: "EGP", amount_minor: 110000, count: 2, by_method: { CASH: 90000, INSTAPAY: 20000 }, by_collector: [{ id: "u1", name: "Owner Omar", source: "MANUAL", amount_minor: 110000, count: 2 }] }] },
        { date: "2026-06-16", voided: 0, currencies: [] },
      ],
      totals: [{ currency: "EGP", amount_minor: 110000, count: 2, by_method: { CASH: 90000, INSTAPAY: 20000 } }],
      collectors: [{ id: "u1", name: "Owner Omar" }],
    };
    api.getDailyCollections.mockResolvedValue(data);
    render(withAuth(owner(), <AccountingDailyScreen />));

    const table = await screen.findByTestId("daily-table");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText(ar.method.INSTAPAY)).toBeTruthy();
    expect(within(table).getByText(/Owner Omar/)).toBeTruthy();
    expect(within(table).getByText(ar.daily.voided.replace("{count}", "1"))).toBeTruthy();
  });
});
