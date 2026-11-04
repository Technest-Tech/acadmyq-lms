import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { SettleSubscriptionModal } from "@/components/accounting/settle-subscription";
import { subRow } from "@/components/subscriptions/test-fixtures";
import { formatMoney } from "@/lib/money";
import { makeSession, withAuth } from "@/test/auth";
import { CloseSubscriptionModal } from "./close-subscription-modal";

/**
 * Closing early (POST /subscriptions/{id}/close): the settlement preview from GET /settlement, the
 * three answers (or later), a refund's method and reference — and cancelling instead while nothing
 * happened. The family's account settles a PENDING one through the same route.
 */
const api = { getSubscriptionSettlement: vi.fn(), closeSubscription: vi.fn(), cancelSubscription: vi.fn() };
vi.mock("@/lib/subscriptions-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subscriptions-api")>()),
  getSubscriptionSettlement: (...a: unknown[]) => api.getSubscriptionSettlement(...a),
  closeSubscription: (...a: unknown[]) => api.closeSubscription(...a),
  cancelSubscription: (...a: unknown[]) => api.cancelSubscription(...a),
}));

const ar = arMessages.subscriptions;
const money = (minor: number) => formatMoney({ amount: minor, currency: "EGP" }, "ar");
const session = () => makeSession("ACADEMY_OWNER", { permissions: ["package.manage"], capabilities: ["centre", "accounting"] });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getSubscriptionSettlement.mockResolvedValue({ paid_minor: 72000, used_value_minor: 27000, owed_back_minor: 45000, currency: "EGP", can_refund: true });
  api.closeSubscription.mockResolvedValue({ subscription: subRow({ status: "CLOSED" }), settlement: { mode: "REFUND", amount_minor: 45000, currency: "EGP", expense_number: "E-000009" } });
});

describe("CloseSubscriptionModal", () => {
  it("previews what is owed back, refunds it with a method and a reference, and says what was done", async () => {
    const onDone = vi.fn();
    render(withAuth(session(), <CloseSubscriptionModal row={subRow()} onClose={() => {}} onDone={onDone} />));
    const fields = await screen.findByTestId("subscription-settlement");
    expect(api.getSubscriptionSettlement).toHaveBeenCalledWith("sub1");
    expect(fields.textContent).toContain(money(45000));
    expect(fields.textContent).toContain(money(27000));
    // Credit is the default; a refund asks how.
    expect(within(screen.getByTestId("subscription-settle-CREDIT")).getByRole("radio")).toBeChecked();
    await userEvent.click(within(screen.getByTestId("subscription-settle-REFUND")).getByRole("radio"));
    await userEvent.selectOptions(screen.getByTestId("subscription-refund-method"), "INSTAPAY");
    await userEvent.type(screen.getByTestId("subscription-refund-reference"), "TX-55");
    expect(screen.getByTestId("close-confirm")).toBeDisabled();
    await userEvent.type(screen.getByTestId("close-reason"), "moved away");
    await userEvent.click(screen.getByTestId("close-confirm"));
    await waitFor(() =>
      expect(api.closeSubscription).toHaveBeenCalledWith("sub1", { reason: "moved away", settlement: "REFUND", refund: { method: "INSTAPAY", reference: "TX-55", note: null } }),
    );
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining("E-000009"));
  });

  it("leaves the money waiting on the family's account when told to decide later", async () => {
    render(withAuth(session(), <CloseSubscriptionModal row={subRow()} onClose={() => {}} onDone={() => {}} />));
    await screen.findByTestId("subscription-settlement");
    await userEvent.click(within(screen.getByTestId("subscription-settle-LATER")).getByRole("radio"));
    await userEvent.type(screen.getByTestId("close-reason"), "pause");
    await userEvent.click(screen.getByTestId("close-confirm"));
    await waitFor(() => expect(api.closeSubscription).toHaveBeenCalledWith("sub1", { reason: "pause" }));
  });

  it("offers cancelling instead only while the API says the block is deletable, and voids it", async () => {
    api.getSubscriptionSettlement.mockResolvedValue({ paid_minor: 0, used_value_minor: 0, owed_back_minor: 0, currency: "EGP", can_refund: false });
    api.cancelSubscription.mockResolvedValue(undefined);
    const onDone = vi.fn();
    render(withAuth(session(), <CloseSubscriptionModal row={subRow({ deletable: true, lessons_used: 0, lessons_left: 8, invoice_paid_minor: 0, outstanding_minor: 72000 })} onClose={() => {}} onDone={onDone} />));
    await waitFor(() => expect(api.getSubscriptionSettlement).toHaveBeenCalled());
    expect(screen.queryByTestId("subscription-settlement")).toBeNull();
    await userEvent.type(screen.getByTestId("close-reason"), "wrong student");
    await userEvent.click(screen.getByTestId("close-cancel-confirm"));
    await waitFor(() => expect(api.cancelSubscription).toHaveBeenCalledWith("sub1", "wrong student"));
    expect(onDone).toHaveBeenCalledWith(ar.close.cancelled);
  });
});

describe("SettleSubscriptionModal (the family's account)", () => {
  it("settles a subscription closed waiting on the decision through its close route, with the settlement only", async () => {
    api.closeSubscription.mockResolvedValue({ subscription: subRow({ status: "CLOSED", settlement: "CREDIT" }), settlement: { mode: "CREDIT", amount_minor: 100000, currency: "EGP" } });
    const onDone = vi.fn();
    render(
      withAuth(
        session(),
        <SettleSubscriptionModal
          item={{ kind: "SUBSCRIPTION", subscription_id: "sub5", package_id: "sub5", student_id: "s2", student_name: "Bassel", label: "English", closed_on: "2026-06-10", settlement: "PENDING", unused_minutes: 0, lesson_minutes: null, price_minor: 160000, used_minor: 60000, paid_minor: 160000, owed_back_minor: 100000, currency: "EGP" }}
          canRefund
          onClose={() => {}}
          onDone={onDone}
        />,
      ),
    );
    expect((await screen.findByTestId("subscription-settlement")).textContent).toContain(money(100000));
    expect(screen.queryByTestId("subscription-settle-LATER")).toBeNull();
    await userEvent.click(screen.getByTestId("subscription-settle-confirm"));
    await waitFor(() => expect(api.closeSubscription).toHaveBeenCalledWith("sub5", { reason: "", settlement: "CREDIT" }));
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining(money(100000)));
  });
});
