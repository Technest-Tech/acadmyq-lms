import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSession, withAuth } from "@/test/auth";
import { PayoutDetailModal } from "./payout-detail-modal";

const apiFetch = vi.fn();
const deletePayoutStatement = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  deletePayoutStatement: (...a: unknown[]) => deletePayoutStatement(...a),
}));

const SEALED = {
  id: "p1",
  teacher_id: "t1",
  teacher_name: "Abeer",
  period_year: 2026,
  period_month: 10,
  status: "FINALIZED",
  finalized_at: "2026-11-03T01:30:00Z",
  total_minor: 90000,
  base_minor: 0,
  sessions_minor: 90000,
  rewards_minor: 0,
  deductions_minor: 0,
  currency: "EGP",
  notes: null,
  pay_type: "HOURLY",
};

function renderModal(payout: object, permissions = ["payout.read", "payout.adjust"]) {
  apiFetch.mockResolvedValue({ payout, lineItems: [], adjustments: [] });
  const onClose = vi.fn();
  const onMutated = vi.fn();
  render(withAuth(makeSession("ACADEMY_OWNER", { permissions }), <PayoutDetailModal payoutId="p1" onClose={onClose} onMutated={onMutated} />));
  return { onClose, onMutated };
}

describe("PayoutDetailModal on an old statement", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    deletePayoutStatement.mockReset();
  });

  it("offers recalculation and delete on a sealed statement nothing was paid from", async () => {
    renderModal({ ...SEALED, paid_out_minor: 0 });
    expect(await screen.findByTestId("reprice-payout")).toBeInTheDocument();
    expect(screen.getByTestId("delete-statement")).toBeInTheDocument();
    expect(screen.queryByTestId("payout-paid-out")).toBeNull();
  });

  it("deletes it after confirming, then closes", async () => {
    deletePayoutStatement.mockResolvedValue({ ok: true });
    const { onClose, onMutated } = renderModal({ ...SEALED, paid_out_minor: 0 });
    await userEvent.click(await screen.findByTestId("delete-statement"));
    expect(deletePayoutStatement).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("confirm-delete-statement"));
    await waitFor(() => expect(deletePayoutStatement).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onMutated).toHaveBeenCalled();
  });

  it("says why it is read-only once money was paid from the treasury", async () => {
    renderModal({ ...SEALED, paid_out_minor: 50000 });
    expect(await screen.findByTestId("payout-paid-out")).toBeInTheDocument();
    expect(screen.queryByTestId("reprice-payout")).toBeNull();
    expect(screen.queryByTestId("delete-statement")).toBeNull();
    // Its lessons can still be corrected: the difference carries.
    expect(screen.getByTestId("edit-salary-lessons")).toBeInTheDocument();
  });

  it("offers nothing to someone who cannot adjust pay", async () => {
    renderModal({ ...SEALED, paid_out_minor: 0 }, ["payout.read"]);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await screen.findAllByText("Abeer");
    expect(screen.queryByTestId("delete-statement")).toBeNull();
    expect(screen.queryByTestId("reprice-payout")).toBeNull();
  });
});
