import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import type { PayoutRow } from "@/lib/api";
import { PayoutTransferCell, transferState } from "./payout-transfer-cell";

const setPayoutTransferred = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  setPayoutTransferred: (id: string, value: boolean) => setPayoutTransferred(id, value),
}));

const ROW: PayoutRow = {
  id: "p1",
  teacher_id: "t1",
  teacher_name: "Abeer",
  period_month: 10,
  period_year: 2026,
  status: "FINALIZED",
  total_minor: 248000,
  currency: "EGP",
  finalized_at: "2026-11-03T00:00:00Z",
  created_at: "2026-10-01T00:00:00Z",
  transferred_at: null,
  transferred_minor: null,
  transferred_by_name: null,
  paid_out_minor: 0,
};

function renderCell(row: Partial<PayoutRow> = {}, canMark = true) {
  const onChanged = vi.fn();
  render(
    <NextIntlClientProvider locale="ar" messages={arMessages}>
      <PayoutTransferCell row={{ ...ROW, ...row }} canMark={canMark} onChanged={onChanged} />
    </NextIntlClientProvider>,
  );
  return onChanged;
}

beforeEach(() => {
  setPayoutTransferred.mockReset();
  setPayoutTransferred.mockResolvedValue({ transferred_at: "2026-11-03T10:00:00Z", transferred_minor: 248000 });
});

describe("PayoutTransferCell", () => {
  it("ticks a sealed statement and asks the list to reload", async () => {
    const onChanged = renderCell();

    expect(screen.getByText(arMessages.payroll.transferPending)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("transfer-p1"));

    expect(setPayoutTransferred).toHaveBeenCalledWith("p1", true);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.getByText(arMessages.payroll.transferDone)).toBeInTheDocument();
  });

  it("does not open the statement behind it", async () => {
    const rowClick = vi.fn();
    render(
      <NextIntlClientProvider locale="ar" messages={arMessages}>
        <div onClick={rowClick}>
          <PayoutTransferCell row={ROW} canMark onChanged={vi.fn()} />
        </div>
      </NextIntlClientProvider>,
    );

    await userEvent.click(screen.getByTestId("transfer-p1"));

    expect(rowClick).not.toHaveBeenCalled();
  });

  it("flicks back and says why when the server refuses", async () => {
    setPayoutTransferred.mockRejectedValue(new Error("nope"));
    const onChanged = renderCell();

    await userEvent.click(screen.getByTestId("transfer-p1"));

    expect(await screen.findByText(/nope/)).toBeInTheDocument();
    expect(screen.getByTestId("transfer-p1")).not.toBeChecked();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("shows the difference when a correction moved the salary after the tick", () => {
    renderCell({ transferred_at: "2026-11-03T10:00:00Z", transferred_minor: 248000, total_minor: 238000 });

    expect(screen.getByTestId("transfer-differs-p1")).toBeInTheDocument();
  });

  it("stays quiet about a difference when the tick still matches", () => {
    renderCell({ transferred_at: "2026-11-03T10:00:00Z", transferred_minor: 248000 });

    expect(screen.queryByTestId("transfer-differs-p1")).not.toBeInTheDocument();
  });

  it("is read only without the right", () => {
    renderCell({}, false);

    expect(screen.getByTestId("transfer-p1")).toBeDisabled();
  });

  it("has no switch once the treasury paid the whole salary", () => {
    renderCell({ paid_out_minor: 248000 });

    expect(screen.getByText(arMessages.payroll.transferTreasury)).toBeInTheDocument();
    expect(screen.queryByTestId("transfer-p1")).not.toBeInTheDocument();
  });

  it("keeps the switch when the treasury paid only part of it", () => {
    renderCell({ paid_out_minor: 100000 });

    expect(screen.getByTestId("transfer-p1")).toBeInTheDocument();
    expect(transferState({ ...ROW, paid_out_minor: 100000 })).toBe("PENDING");
  });

  it("offers nothing on a statement that owes nothing", () => {
    renderCell({ total_minor: 0 });

    expect(screen.queryByTestId("transfer-p1")).not.toBeInTheDocument();
    expect(transferState({ ...ROW, total_minor: 0 })).toBe("NOTHING_DUE");
  });
});
