import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { PayoutRow, PayrollRange, PayrollRangeTeacher } from "@/lib/api";
import { PayrollScreen } from "./screen";

/**
 * The salaries page has one job: what do I owe, to whom, for the period I choose — and it answers it
 * with ONE list of teachers (Ahmed 2026-11-22: the two teacher sections should be one). These tests
 * pin that the window reaches the server as real dates, that each teacher appears once with their
 * statements on the same row, and that the page does not lead with figures that are not salaries.
 */

const getPayrollRange = vi.fn();
const apiFetch = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getPayrollRange: (from: string, to: string) => getPayrollRange(from, to),
  apiFetch: (url: string) => apiFetch(url),
}));

function statement(overrides: Partial<PayoutRow> = {}): PayoutRow {
  return {
    id: "p1",
    teacher_id: "t1",
    teacher_name: "Mona Adel",
    period_month: 9,
    period_year: 2026,
    status: "OPEN",
    total_minor: 32000,
    currency: "EGP",
    finalized_at: null,
    created_at: "2026-09-01T00:00:00Z",
    transferred_at: null,
    transferred_minor: null,
    transferred_by_name: null,
    paid_out_minor: 0,
    ...overrides,
  };
}

const MONA: PayrollRangeTeacher = {
  teacher_id: "t1",
  teacher_name: "Mona Adel",
  currency: "EGP",
  sessions: 6,
  minutes: 390,
  base_minor: 0,
  lessons_minor: 30000,
  rewards_minor: 2000,
  deductions_minor: 0,
  net_minor: 32000,
  has_open: true,
  statements: [statement()],
};

const RANGE: PayrollRange = {
  from: "2026-09-01",
  to: "2026-09-02",
  currencies: [
    {
      currency: "EGP",
      teachers: 2,
      sessions: 9,
      minutes: 630,
      base_minor: 0,
      lessons_minor: 45000,
      rewards_minor: 2000,
      deductions_minor: 500,
      net_minor: 46500,
    },
  ],
  teachers: [MONA],
};

function renderScreen(permissions = ["payout.read", "payout.finalize", "payout.adjust"]) {
  return render(
    withAuth(makeSession("ACADEMY_OWNER", { permissions }), <PayrollScreen />),
  );
}

beforeEach(() => {
  getPayrollRange.mockReset();
  apiFetch.mockReset();
  getPayrollRange.mockResolvedValue(RANGE);
  apiFetch.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
});

const rows = (table: HTMLElement) => within(table).getAllByTestId(/^salary-row-/);

describe("PayrollScreen (salary period)", () => {
  it("asks the server for the exact window the owner picked", async () => {
    renderScreen();
    await waitFor(() => expect(getPayrollRange).toHaveBeenCalled());

    await userEvent.clear(screen.getByTestId("range-from"));
    await userEvent.type(screen.getByTestId("range-from"), "2026-08-10");
    await userEvent.clear(screen.getByTestId("range-to"));
    await userEvent.type(screen.getByTestId("range-to"), "2026-08-24");

    await waitFor(() =>
      expect(getPayrollRange).toHaveBeenLastCalledWith("2026-08-10", "2026-08-24"),
    );
  });

  it("shows what the window costs as coloured cards: total, lessons, rewards, deductions", async () => {
    renderScreen();

    const payable = await screen.findByTestId("payroll-stat-payable");
    expect(within(payable).getByText(arMessages.payroll.rangePayable)).toBeInTheDocument();
    expect(within(screen.getByTestId("payroll-stat-lessons")).getByText(arMessages.payroll.rangeLessons)).toBeInTheDocument();
    expect(within(screen.getByTestId("payroll-stat-rewards")).getByText(arMessages.payroll.rangeRewards)).toBeInTheDocument();
    expect(within(screen.getByTestId("payroll-stat-deductions")).getByText(arMessages.payroll.rangeDeductions)).toBeInTheDocument();
  });

  it("lists each teacher ONCE, with the month's statement, its transfer switch and its button on the same row", async () => {
    renderScreen();

    const table = await screen.findByTestId("salary-by-teacher");
    expect(rows(table)).toHaveLength(1);
    const row = within(table).getByTestId("salary-row-t1");
    expect(within(row).getByText("Mona Adel")).toBeInTheDocument();
    expect(within(row).getByText("09/2026")).toBeInTheDocument();
    expect(within(row).getByText(arMessages.payroll.status.OPEN)).toBeInTheDocument();
    expect(within(row).getByTestId("transfer-p1")).toBeInTheDocument();
    expect(within(row).getByTestId("open-statement-p1")).toBeInTheDocument();
    // The statement total IS the row's payable here, so it is not printed a second time.
    expect(within(row).queryByTestId("statement-total-p1")).toBeNull();

    // No second list of the same teachers: the owner's page never asks for the statements list.
    expect(apiFetch.mock.calls.map((c) => String(c[0])).some((u) => u.startsWith("/api/payouts?"))).toBe(false);
  });

  it("puts both months on the teacher's one row when the window crosses a month", async () => {
    getPayrollRange.mockResolvedValue({
      ...RANGE,
      teachers: [
        {
          ...MONA,
          statements: [
            statement({ id: "p-aug", period_month: 8, status: "FINALIZED", finalized_at: "2026-09-03T00:00:00Z" }),
            statement({ id: "p-sep", period_month: 9 }),
          ],
        },
      ],
    });
    renderScreen();

    const table = await screen.findByTestId("salary-by-teacher");
    expect(rows(table)).toHaveLength(1);
    const row = within(table).getByTestId("salary-row-t1");
    expect(within(row).getByText("08/2026")).toBeInTheDocument();
    expect(within(row).getByText("09/2026")).toBeInTheDocument();
    expect(within(row).getByTestId("transfer-p-aug")).toBeInTheDocument();
    expect(within(row).getByTestId("transfer-p-sep")).toBeInTheDocument();
    // Each month says what it holds, since the row's payable is the window's, not either month's.
    expect(within(row).getByTestId("statement-total-p-aug")).toBeInTheDocument();
    expect(within(row).getByTestId("statement-total-p-sep")).toBeInTheDocument();
  });

  it("opens the month's statement from its button", async () => {
    apiFetch.mockImplementation((url: string) =>
      url.startsWith("/api/payouts/p1") ? new Promise(() => {}) : Promise.resolve({ rows: [], total: 0, page: 1, pageSize: 20 }),
    );
    renderScreen();

    const table = await screen.findByTestId("salary-by-teacher");
    await userEvent.click(within(table).getByTestId("open-statement-p1"));
    await waitFor(() =>
      expect(apiFetch.mock.calls.map((c) => String(c[0]))).toContain("/api/payouts/p1"),
    );
  });

  it("filters to the teachers still waiting for their money", async () => {
    getPayrollRange.mockResolvedValue({
      ...RANGE,
      teachers: [
        MONA,
        {
          ...MONA,
          teacher_id: "t2",
          teacher_name: "Sara Ali",
          statements: [statement({ id: "p2", teacher_id: "t2", transferred_at: "2026-09-02T10:00:00Z", transferred_minor: 32000 })],
        },
      ],
    });
    renderScreen();

    const table = await screen.findByTestId("salary-by-teacher");
    expect(rows(table)).toHaveLength(2);

    await userEvent.click(screen.getByTestId("transfer-view-PENDING"));
    await waitFor(() => expect(rows(table)).toHaveLength(1));
    expect(within(table).getByText("Mona Adel")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("transfer-view-DONE"));
    await waitFor(() => expect(within(table).getByText("Sara Ali")).toBeInTheDocument());
    expect(rows(table)).toHaveLength(1);

    // The card counts teachers paid out of teachers owed.
    expect(screen.getByTestId("payroll-stat-transfer")).toHaveTextContent(/(1|١) من (2|٢)/);
  });

  it("opens on the stat cards, with no hero banner and no finalize button", async () => {
    renderScreen();
    await screen.findByTestId("payroll-stat-payable");
    expect(screen.queryByText(arMessages.payroll.subtitle)).not.toBeInTheDocument();
    // Months seal themselves on the 3rd; the page no longer offers to do it by hand.
    expect(screen.queryByTestId("finalize-period")).toBeNull();
  });

  it("shows the period shortcuts as badges, with the one the dates match applied", async () => {
    renderScreen();
    await screen.findByTestId("payroll-stat-payable");
    expect(screen.getByTestId("range-preset-thisMonth")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("range-preset-lastMonth")).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(screen.getByTestId("range-preset-lastMonth"));
    expect(screen.getByTestId("range-preset-lastMonth")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("range-preset-thisMonth")).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the cards at '—' and says the period is empty where the table goes", async () => {
    getPayrollRange.mockResolvedValue({ ...RANGE, currencies: [], teachers: [] });
    renderScreen();

    expect(await screen.findByTestId("salary-empty")).toHaveTextContent(arMessages.payroll.rangeEmpty);
    expect(screen.getByTestId("payroll-stat-payable")).toHaveTextContent("—");
    // The table itself stays, headers and all — the empty period is a line inside it.
    const table = screen.getByTestId("salary-by-teacher");
    expect(within(table).getByText(arMessages.payroll.colTeacher)).toBeInTheDocument();
    expect(within(table).getByText(arMessages.payroll.rangePayable)).toBeInTheDocument();
  });

  it("says the salaries failed to load instead of calling the period empty", async () => {
    getPayrollRange.mockRejectedValue(new Error("boom"));
    renderScreen();

    expect(await screen.findByText(arMessages.payroll.loadError)).toBeInTheDocument();
    // The table stays, but it does not claim the period has no lessons.
    expect(screen.getByTestId("salary-empty")).not.toHaveTextContent(arMessages.payroll.rangeEmpty);
  });

  it("no longer leads with revenue or student dues — they are not salaries", async () => {
    renderScreen();
    await screen.findByTestId("payroll-stat-payable");

    // Both moved to Financial Statistics, where the rest of the revenue picture lives.
    expect(screen.queryByText(/الأرباح|Profit/)).not.toBeInTheDocument();
    expect(screen.queryByText(/المتأخرات المستحقة/)).not.toBeInTheDocument();
  });

  it("narrows the salaries by teacher name, Arabic-forgiving (Lingo 2026-11-15)", async () => {
    getPayrollRange.mockResolvedValue({
      ...RANGE,
      teachers: [
        MONA,
        { ...MONA, teacher_id: "t2", teacher_name: "أحمد سامي", net_minor: 10000, statements: [] },
      ],
    });
    renderScreen();
    const table = await screen.findByTestId("salary-by-teacher");
    await waitFor(() => expect(rows(table)).toHaveLength(2));
    await userEvent.type(screen.getByTestId("salary-search"), "احمد");
    await waitFor(() => expect(rows(table)).toHaveLength(1));
    expect(within(table).getByText("أحمد سامي")).toBeInTheDocument();
  });
});

describe("PayrollScreen (a teacher's own statements)", () => {
  it("narrows a teacher's statements to the months the window touches", async () => {
    render(
      withAuth(makeSession("TEACHER", { permissions: ["payout.read_own"] }), <PayrollScreen />),
    );

    // A statement is a month, so the window reaches the list as month bounds, not as days.
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    await waitFor(() => {
      const urls = apiFetch.mock.calls.map((c) => decodeURIComponent(String(c[0])));
      expect(
        urls.some((u) => u.startsWith("/api/me/payouts") && u.includes("period_from") && u.includes(thisMonth)),
      ).toBe(true);
    });
    // The academy-wide window is the owner's only.
    expect(getPayrollRange).not.toHaveBeenCalled();
  });
});
