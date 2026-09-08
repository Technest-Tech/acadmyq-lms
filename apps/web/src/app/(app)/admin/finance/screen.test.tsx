import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import enMessages from "../../../../../messages/en.json";
import { FinanceOverviewScreen } from "./screen";

// Super Admin → Finance overview: the owner's income book at a glance. What is asserted is the
// contract with the ledger — money is rendered per currency straight from the payload, the
// upcoming list names the client and the overdue state, and an empty book still shows tiles.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/admin/finance",
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getFinanceOverview: vi.fn(),
  listFinanceClientOptions: vi.fn().mockResolvedValue({ clients: [] }),
}));

import * as api from "@/lib/api";

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <ToastProvider>{node}</ToastProvider>
  </NextIntlClientProvider>
);

const overview = (
  over: Partial<api.FinanceOverview> = {},
): api.FinanceOverview => ({
  today: "2026-09-10",
  totals: [
    {
      currency: "EGP",
      month_minor: 150000,
      year_minor: 1200000,
      total_minor: 3400000,
      outstanding_minor: 300000,
      overdue_minor: 200000,
      upcoming_minor: 100000,
      mrr_minor: 100000,
      subscriptions: 1,
    },
  ],
  counts: {
    clients: 2,
    active_deals: 3,
    active_subscriptions: 1,
    overdue_deals: 1,
  },
  by_service: [
    { service: "COURSE_SITE", currency: "EGP", amount_minor: 1200000 },
  ],
  monthly: [{ month: "2026-09", currency: "EGP", amount_minor: 150000 }],
  upcoming: [
    {
      id: "i1",
      deal_id: "d1",
      due_on: "2026-09-01",
      amount_minor: 200000,
      remaining_minor: 200000,
      title: "Course site",
      service: "COURSE_SITE",
      kind: "ONE_TIME",
      currency: "EGP",
      client_name: "Azhary Academy",
      overdue: true,
    },
  ],
  recent_payments: [
    {
      id: "p1",
      deal_id: "d1",
      paid_on: "2026-09-05",
      amount_minor: 150000,
      method: "INSTAPAY",
      reference: null,
      note: null,
      created_at: "2026-09-05T10:00:00Z",
      deal_title: "Course site",
      service: "COURSE_SITE",
      kind: "ONE_TIME",
      currency: "EGP",
      client_id: "c1",
      client_name: "Azhary Academy",
      month: "2026-09",
    },
  ],
  ...over,
});

describe("FinanceOverviewScreen", () => {
  it("renders the ledger's per-currency figures, the overdue due and the recent payment", async () => {
    vi.mocked(api.getFinanceOverview).mockResolvedValue(overview());

    render(wrap(<FinanceOverviewScreen />));

    await waitFor(() =>
      expect(screen.getByTestId("finance-tile-month")).toHaveTextContent(
        "1,500",
      ),
    );
    expect(screen.getByText("Received this year")).toBeInTheDocument();
    // Outstanding tile carries the overdue slice as its sub line.
    expect(screen.getByText("EGP 2,000 overdue")).toBeInTheDocument();

    const upcoming = screen.getByTestId("finance-upcoming");
    expect(upcoming).toHaveTextContent("Azhary Academy");
    expect(upcoming).toHaveTextContent("9 days ago");

    const recent = screen.getByTestId("finance-recent");
    expect(recent).toHaveTextContent("+EGP 1,500");
    expect(recent).toHaveTextContent("InstaPay");
  });

  it("still shows a row of zero tiles for an empty book", async () => {
    vi.mocked(api.getFinanceOverview).mockResolvedValue(
      overview({
        totals: [],
        counts: {
          clients: 0,
          active_deals: 0,
          active_subscriptions: 0,
          overdue_deals: 0,
        },
        by_service: [],
        monthly: [],
        upcoming: [],
        recent_payments: [],
      }),
    );

    render(wrap(<FinanceOverviewScreen />));

    await waitFor(() =>
      expect(screen.getByTestId("finance-tile-month")).toHaveTextContent(
        "EGP 0",
      ),
    );
    expect(screen.getByText("Nothing due.")).toBeInTheDocument();
    expect(screen.getByText("No payments recorded yet.")).toBeInTheDocument();
  });
});
