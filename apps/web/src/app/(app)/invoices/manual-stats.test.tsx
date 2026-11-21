import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import arMessages from "../../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { InvoiceSummary } from "@/lib/api";
import { ManualStats } from "./screen";

/** The hand-made bills' header (Ahmed 2026-11-17): one card per currency instead of three tall lists. */

const ar = arMessages.invoices;

const summary: InvoiceSummary = {
  counts: { all: 101, OPEN: 15, CLOSED: 4, PAID: 70, PARTIALLY_PAID: 2 },
  money: [
    // Fully in: nothing owed, says so in words.
    { currency: "SGD", billed_minor: 7800, collected_minor: 7800, outstanding_minor: 0, due_minor: 0 },
    { currency: "EGP", billed_minor: 370000, collected_minor: 190000, outstanding_minor: 180000, due_minor: 180000 },
  ],
} as InvoiceSummary;

describe("ManualStats", () => {
  it("puts each currency's money on its own card, the ones still owed first", () => {
    render(withAuth(makeSession("ACADEMY_OWNER"), <ManualStats summary={summary} followUpCount={0} followUpOnly={false} onToggleFollowUp={() => {}} />));

    const cards = screen.getAllByTestId(/^currency-total-/);
    expect(cards.map((c) => c.dataset.testid)).toEqual(["currency-total-EGP", "currency-total-SGD"]);

    const egp = within(screen.getByTestId("currency-total-EGP"));
    expect(egp.getByText(ar.stats.outstanding)).toBeInTheDocument();
    expect(egp.getByText(ar.summaryCollected)).toBeInTheDocument();
    expect(egp.getByText(ar.stats.billed)).toBeInTheDocument();
    expect(screen.getByTestId("currency-total-EGP").textContent).toContain("١٬٨٠٠");

    expect(within(screen.getByTestId("currency-total-SGD")).getByText(ar.stats.settled)).toBeInTheDocument();
    // No chase box when nothing is past its date.
    expect(screen.queryByTestId("manual-follow-up-alert")).not.toBeInTheDocument();
  });

  it("shows the bills past their date and filters to them", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(withAuth(makeSession("ACADEMY_OWNER"), <ManualStats summary={summary} followUpCount={10} followUpOnly={false} onToggleFollowUp={onToggle} />));

    expect(screen.getByTestId("manual-follow-up-alert").textContent).toContain(ar.stats.followUp);
    await user.click(screen.getByTestId("manual-follow-up-toggle"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
