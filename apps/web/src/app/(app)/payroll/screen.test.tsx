import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { PayrollRange } from "@/lib/api";
import { PayrollScreen } from "./screen";

/**
 * The salaries page has one job now: what do I owe, to whom, for the period I choose. These tests
 * pin the two things that makes true — the window reaches the server as real dates, and the page
 * no longer leads with figures that are not salaries.
 */

const getPayrollRange = vi.fn();
const apiFetch = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getPayrollRange: (from: string, to: string) => getPayrollRange(from, to),
  apiFetch: (url: string) => apiFetch(url),
}));

const RANGE: PayrollRange = {
  from: "2026-09-01",
  to: "2026-09-02",
  currencies: [
    {
      currency: "EGP",
      teachers: 2,
      sessions: 9,
      minutes: 630,
      lessons_minor: 45000,
      rewards_minor: 2000,
      deductions_minor: 500,
      net_minor: 46500,
    },
  ],
  teachers: [
    {
      teacher_id: "t1",
      teacher_name: "Mona Adel",
      currency: "EGP",
      sessions: 6,
      minutes: 390,
      lessons_minor: 30000,
      rewards_minor: 2000,
      deductions_minor: 0,
      net_minor: 32000,
      has_open: true,
    },
  ],
};

function renderScreen() {
  return render(
    withAuth(
      makeSession("ACADEMY_OWNER", { permissions: ["payout.read", "payout.finalize"] }),
      <PayrollScreen />,
    ),
  );
}

beforeEach(() => {
  getPayrollRange.mockResolvedValue(RANGE);
  apiFetch.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
});

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

  it("narrows the statements list to the months the window touches", async () => {
    renderScreen();

    // A statement is a month, so the window reaches the list as month bounds, not as days.
    await waitFor(() => {
      const urls = apiFetch.mock.calls.map((c) => String(c[0]));
      expect(
        urls.some(
          (u) =>
            u.includes("period_from") &&
            decodeURIComponent(u).includes("2026-09") &&
            u.includes("period_to"),
        ),
      ).toBe(true);
    });
  });

  it("breaks the payable total into lessons, rewards and deductions", async () => {
    renderScreen();

    const card = await screen.findByTestId("salary-card-EGP");
    expect(within(card).getByText(arMessages.payroll.rangePayable)).toBeInTheDocument();
    expect(within(card).getByText(arMessages.payroll.rangeLessons)).toBeInTheDocument();
    expect(within(card).getByText(arMessages.payroll.rangeRewards)).toBeInTheDocument();
    expect(within(card).getByText(arMessages.payroll.rangeDeductions)).toBeInTheDocument();
  });

  it("lists each teacher's salary for the window", async () => {
    renderScreen();

    const table = await screen.findByTestId("salary-by-teacher");
    expect(within(table).getByText("Mona Adel")).toBeInTheDocument();
    // An open statement is flagged, because the figure can still move before payday.
    expect(within(table).getByText(arMessages.payroll.status.OPEN)).toBeInTheDocument();
  });

  it("no longer leads with revenue or student dues — they are not salaries", async () => {
    renderScreen();
    await screen.findByTestId("salary-card-EGP");

    // Both moved to Financial Statistics, where the rest of the revenue picture lives.
    expect(screen.queryByText(/الأرباح|Profit/)).not.toBeInTheDocument();
    expect(screen.queryByText(/المتأخرات المستحقة/)).not.toBeInTheDocument();
  });
});
