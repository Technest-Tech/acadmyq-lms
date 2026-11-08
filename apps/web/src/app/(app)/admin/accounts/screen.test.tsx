import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { AgreementFormModal } from "@/components/finance/agreement-form-modal";
import { ToastProvider } from "@/components/ui/toast";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../../../messages/en.json";
import { AccountsDuesScreen } from "./screen";

// Accounts (2026-11-08): the Dues screen is the owner's money to-do list, and the one agreement
// form turns "monthly / every 6 months / yearly at 15% off / one payment + yearly support /
// outright" into the payments the book will expect.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/accounts",
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getDues: vi.fn(),
  setClientAgreement: vi.fn(),
  createAccount: vi.fn(),
}));

import * as api from "@/lib/api";

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <AuthContext.Provider value={authValue(makeSession("SUPER_ADMIN", { permissions: ["platform.manage"] }))}>
      <ToastProvider>{node}</ToastProvider>
    </AuthContext.Provider>
  </NextIntlClientProvider>
);

const due = (over: Partial<api.OpenDue>): api.OpenDue => ({
  id: "i1",
  deal_id: "d1",
  seq: 1,
  due_on: "2026-11-01",
  amount_minor: 100000,
  remaining_minor: 100000,
  title: "Monthly subscription",
  service: "MANAGEMENT_SYSTEM",
  kind: "SUBSCRIPTION",
  billing_interval: "MONTHLY",
  currency: "EGP",
  client_id: "c-late",
  client_name: "Noor",
  academy_id: "a-late",
  academy_name: "Noor Academy",
  plan: "MONTHLY",
  phone: "+201000000001",
  pay_token: "tok",
  days_late: 7,
  ...over,
});

const dues = (over: Partial<api.DuesPayload> = {}): api.DuesPayload => ({
  today: "2026-11-08",
  totals: [
    { currency: "EGP", month_minor: 500000, year_minor: 0, total_minor: 900000, outstanding_minor: 300000, overdue_minor: 200000, upcoming_minor: 100000, mrr_minor: 250000, subscriptions: 3 },
  ],
  late: [due({}), due({ id: "i2", due_on: "2026-10-01", days_late: 38 })],
  week: [due({ id: "i3", client_id: "c-week", academy_id: null, academy_name: null, client_name: "Al-Huda (own server)", days_late: -3, due_on: "2026-11-11" })],
  month: [],
  proofs: [],
  trials: [],
  unagreed: [{ academy_id: "a-x", name: "Bright Steps", client_type: "MANAGEMENT", suggested_minor: 99900, currency: "EGP", interval: "MONTHLY" }],
  reminders: { enabled: true, ready: false, owner_digest: false },
  ...over,
});

describe("Accounts → Dues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getDues).mockResolvedValue(dues());
  });

  it("lists who is late as one row per client, who pays this week, and paying clients with no agreement", async () => {
    render(wrap(<AccountsDuesScreen />));

    const late = await screen.findByTestId("late-list");
    const rows = within(late).getAllByRole("listitem");
    expect(rows).toHaveLength(1); // two late cycles, one client
    expect(rows[0]).toHaveTextContent("Noor Academy");
    expect(rows[0]).toHaveTextContent("Monthly subscription × 2");
    expect(rows[0]).toHaveTextContent("38 days late");
    // The manual reminder carries the pay link.
    const remind = within(rows[0]!).getByRole("link", { name: /Remind/ });
    expect(decodeURIComponent(remind.getAttribute("href") ?? "")).toContain("/a/tok");

    // A client off our servers opens its own account page.
    const week = screen.getByTestId("week-list");
    expect(within(week).getByRole("link", { name: "Al-Huda (own server)" })).toHaveAttribute("href", "/admin/accounts/c-week");
    expect(within(week).getByText("In 3 days")).toBeInTheDocument();

    expect(screen.getByTestId("dues-unagreed")).toHaveTextContent("Bright Steps");
    // Reminders are not wired yet → the screen says so.
    expect(screen.getByTestId("reminders-off")).toBeInTheDocument();
  });

  it("sets an agreement for a paying client that has none, starting from its module price", async () => {
    const user = userEvent.setup();
    vi.mocked(api.setClientAgreement).mockResolvedValue({} as never);
    render(wrap(<AccountsDuesScreen />));

    await user.click(await screen.findByTestId("agree-a-x"));
    expect(screen.getByTestId("agr-monthly")).toHaveValue(999);
    await user.click(screen.getByTestId("agreement-save"));

    await waitFor(() => expect(api.setClientAgreement).toHaveBeenCalled());
    expect(vi.mocked(api.setClientAgreement).mock.calls[0]).toEqual([
      "a-x",
      expect.objectContaining({ plan: "MONTHLY", currency: "EGP", recurring: expect.objectContaining({ amount_minor: 99900, list_amount_minor: null }) }),
    ]);
  });

  it("says when nothing is due", async () => {
    vi.mocked(api.getDues).mockResolvedValue(dues({ late: [], week: [], unagreed: [], reminders: { enabled: true, ready: true, owner_digest: true } }));
    render(wrap(<AccountsDuesScreen />));
    expect(await screen.findByText(enMessages.accounts.dues.nothing)).toBeInTheDocument();
    expect(screen.queryByTestId("reminders-off")).toBeNull();
  });
});

describe("AgreementFormModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prices a yearly agreement from the monthly price and a discount, and keeps the saving on record", async () => {
    const user = userEvent.setup();
    vi.mocked(api.setClientAgreement).mockResolvedValue({} as never);
    const onSaved = vi.fn();
    render(
      wrap(
        <AgreementFormModal
          open
          target={{ kind: "academy", academyId: "a1", name: "Noor Academy" }}
          onClose={vi.fn()}
          onSaved={onSaved}
        />,
      ),
    );

    await user.click(screen.getByTestId("plan-YEARLY"));
    await user.type(screen.getByTestId("agr-monthly"), "1000");
    await user.type(screen.getByTestId("agr-discount"), "15");
    // 12 × 1,000 at 15% off.
    expect(screen.getByTestId("agr-cycle")).toHaveTextContent("10,200");
    expect(screen.getByTestId("agr-cycle")).toHaveTextContent("12,000");

    await user.click(screen.getByTestId("agreement-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(vi.mocked(api.setClientAgreement).mock.calls[0]![1]).toMatchObject({
      plan: "YEARLY",
      recurring: { amount_minor: 1_020_000, list_amount_minor: 1_200_000 },
    });
  });

  it("sells the system once with yearly support and server for a new client off our servers", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createAccount).mockResolvedValue({} as never);
    render(wrap(<AgreementFormModal open target={{ kind: "new" }} onClose={vi.fn()} onSaved={vi.fn()} />));

    await user.type(screen.getByLabelText(enMessages.accounts.agreement.clientName), "Al-Huda");
    await user.click(screen.getByTestId("plan-ONE_TIME_SUPPORT"));
    await user.type(screen.getByTestId("agr-onetime"), "30000");
    await user.type(screen.getByTestId("agr-support"), "5000");
    // The preview shows the purchase and the yearly renewals.
    expect(screen.getByTestId("agr-preview")).toHaveTextContent("System purchase");
    expect(screen.getByTestId("agr-preview")).toHaveTextContent("Yearly support & server");

    await user.click(screen.getByTestId("agreement-save"));
    await waitFor(() => expect(api.createAccount).toHaveBeenCalled());
    const input = vi.mocked(api.createAccount).mock.calls[0]![0];
    expect(input.name).toBe("Al-Huda");
    expect(input.agreement).toMatchObject({
      plan: "ONE_TIME_SUPPORT",
      one_time: { installments: [expect.objectContaining({ amount_minor: 3_000_000 })] },
      recurring: { amount_minor: 500_000 },
    });
  });

  it("refuses to save a monthly agreement with no price", async () => {
    const user = userEvent.setup();
    render(
      wrap(<AgreementFormModal open target={{ kind: "academy", academyId: "a1", name: "Noor" }} onClose={vi.fn()} onSaved={vi.fn()} />),
    );
    await user.click(screen.getByTestId("agreement-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent(enMessages.accounts.agreement.errors.price);
    expect(api.setClientAgreement).not.toHaveBeenCalled();
  });
});
