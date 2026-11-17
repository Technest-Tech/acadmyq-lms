import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSession, withAuth } from "@/test/auth";
import type { LessonPackageRow } from "@/lib/api";
import { PrepayModal } from "./prepay-modal";

/** Paying packages ahead for a family (Ahmed 2026-11-17): one payment, a line per child. */

const prepayPackages = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  prepayPackages: (input: unknown) => prepayPackages(input),
}));

function row(over: Partial<LessonPackageRow> = {}): LessonPackageRow {
  return {
    id: "p1",
    student_id: "s1",
    student_name: "يوسف",
    label: "8 × 45 د",
    status: "ACTIVE",
    bill_timing: "ON_START",
    minutes_total: 360,
    price_minor: 80000,
    currency: "EGP",
    outstanding_minor: 0,
    sequence_no: 3,
    next_terms: null,
    prepaid_blocks_left: 0,
    ...over,
  } as LessonPackageRow;
}

const session = () => makeSession("ACADEMY_OWNER", { permissions: ["package.manage", "invoice.mark_paid"] });

describe("PrepayModal", () => {
  beforeEach(() => {
    prepayPackages.mockReset();
    prepayPackages.mockResolvedValue({
      prepayments: [{ prepayment_id: "pp1", student_id: "s1", blocks: 3, block_price_minor: 80000, amount_minor: 240000, currency: "EGP", current_paid_minor: 0, current_currency: "EGP" }],
      totals: [{ currency: "EGP", amount_minor: 240000 }],
    });
  });

  it("pays a family's coming packages in one payment, the running bill included where it is owed", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(
      withAuth(
        session(),
        <PrepayModal
          rows={[
            row(),
            // Maryam's running block is still unpaid, and her next one renews in USD at 15.
            row({ id: "p2", student_id: "s2", student_name: "مريم", outstanding_minor: 50000, next_terms: { currency: "USD", price_minor: 1500 } }),
          ]}
          onClose={() => {}}
          onDone={onDone}
        />,
      ),
    );

    // Two packages each by default; one more for Yusuf.
    await user.click(screen.getByTestId("prepay-more-s1"));
    expect(screen.getByTestId("prepay-blocks-s1")).toHaveTextContent("3");
    expect(screen.getByTestId("prepay-current-s2")).toBeChecked();
    // Never summed across currencies: 3 × 800 + 500 EGP, and 2 × 15 USD.
    const total = screen.getByTestId("prepay-total").textContent ?? "";
    expect(total).toContain("٢٬٩٠٠");
    expect(total).toContain("٣٠");
    expect(total).toContain(" + ");

    await user.selectOptions(screen.getByTestId("prepay-method"), "BANK_TRANSFER");
    await user.click(screen.getByTestId("prepay-save"));

    await waitFor(() => expect(prepayPackages).toHaveBeenCalledTimes(1));
    expect(prepayPackages.mock.calls[0]?.[0]).toMatchObject({
      payment_method: "BANK_TRANSFER",
      students: [
        { student_id: "s1", blocks: 3, include_current: false },
        { student_id: "s2", blocks: 2, include_current: true },
      ],
    });
    expect(onDone).toHaveBeenCalled();
  });

  it("leaves out a child who is unticked, and a block billed at its end", async () => {
    const user = userEvent.setup();
    render(
      withAuth(
        session(),
        <PrepayModal
          rows={[row(), row({ id: "p2", student_id: "s2" }), row({ id: "p3", student_id: "s3", bill_timing: "ON_COMPLETION" })]}
          onClose={() => {}}
          onDone={() => {}}
        />,
      ),
    );

    expect(screen.queryByTestId("prepay-row-s3")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("prepay-on-s2"));
    await user.click(screen.getByTestId("prepay-save"));

    await waitFor(() => expect(prepayPackages).toHaveBeenCalledTimes(1));
    expect(prepayPackages.mock.calls[0]?.[0].students).toEqual([{ student_id: "s1", blocks: 2, include_current: false }]);
  });
});
