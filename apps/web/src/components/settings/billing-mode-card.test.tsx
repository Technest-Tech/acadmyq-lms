import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import type { BillingModeState, BillingPreview } from "@/lib/billing-mode-api";
import { makeSession, withAuth } from "@/test/auth";
import { BillingModeCard } from "./billing-mode-card";

/**
 * Settings → طريقة التحصيل: after the lessons (default) or monthly in advance. The choice is saved
 * explicitly, switching on says which month it starts with, and while billing in advance the card
 * shows what the next run bills and can run it.
 */

const getBillingMode = vi.fn();
const saveBillingMode = vi.fn();
const previewBilling = vi.fn();
const issueBillingNow = vi.fn();
vi.mock("@/lib/billing-mode-api", () => ({
  getBillingMode: () => getBillingMode(),
  saveBillingMode: (body: unknown) => saveBillingMode(body),
  previewBilling: () => previewBilling(),
  issueBillingNow: () => issueBillingNow(),
}));

const ar = arMessages.settings.billingMode;

const state = (over: Partial<BillingModeState["settings"]> = {}, rest: Partial<BillingModeState> = {}): BillingModeState => ({
  settings: { mode: "AFTER_LESSONS", issue_day: 27, due_day: 5, from: null, first_fee: null, whatsapp: false, ...over },
  available: true,
  next_period: null,
  issue_open: false,
  ...rest,
});

const preview: BillingPreview = {
  period: "2026-12-01",
  summary: { billed: 2, already: 0, no_price: 1, no_timetable: 0, deducted_lessons: 1, totals: [{ currency: "EGP", total_minor: 37500 }] },
  students: [
    { student_id: "s1", full_name: "آدم", currency: "EGP", skip: null, fee_minor: 20000, deducted_minor: 2500, charged_minor: 0, deferred: 0, total_minor: 17500, lines: [] },
    { student_id: "s2", full_name: "باسل", currency: "EGP", skip: null, fee_minor: 20000, deducted_minor: 0, charged_minor: 0, deferred: 0, total_minor: 20000, lines: [] },
    { student_id: "s3", full_name: "سيلين", currency: "EGP", skip: "NO_PRICE", fee_minor: null, deducted_minor: 0, charged_minor: 0, deferred: 0, total_minor: 0, lines: [] },
  ],
};

const owner = () => makeSession("ACADEMY_OWNER");

beforeEach(() => {
  vi.clearAllMocks();
  previewBilling.mockResolvedValue(preview);
});

describe("BillingModeCard", () => {
  it("opens on after-the-lessons, and switching on is saved only when asked, starting next month", async () => {
    getBillingMode.mockResolvedValue(state());
    const on = state(
      { mode: "PREPAID_MONTHLY", from: "2026-12-01", first_fee: "2026-12-01", issue_day: 25, due_day: 3, whatsapp: true },
      { next_period: "2026-12-01" },
    );
    saveBillingMode.mockResolvedValue(on);
    const user = userEvent.setup();
    render(withAuth(owner(), <BillingModeCard />));

    expect(await screen.findByTestId("billing-mode-AFTER_LESSONS")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("billing-save")).toBeDisabled();
    expect(screen.queryByTestId("billing-preview")).toBeNull();

    await user.click(screen.getByTestId("billing-mode-PREPAID_MONTHLY"));
    expect(screen.getByText(ar.rules)).toBeInTheDocument();
    expect(screen.getByTestId("billing-starts-with")).toBeInTheDocument();
    expect(saveBillingMode).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByTestId("billing-issue-day"), "25");
    await user.selectOptions(screen.getByTestId("billing-due-day"), "3");
    await user.click(screen.getByTestId("billing-whatsapp"));
    await user.click(screen.getByTestId("billing-save"));

    expect(saveBillingMode).toHaveBeenCalledWith({ mode: "PREPAID_MONTHLY", issue_day: 25, due_day: 3, whatsapp: true });
    // Saved: what December's run bills, the students it cannot bill a month for, and who pays what.
    expect(await screen.findByText("آدم")).toBeInTheDocument();
    expect(screen.getByTestId("billing-preview")).toBeInTheDocument();
    expect(screen.queryByText("سيلين")).toBeNull();
    expect(screen.queryByTestId("billing-starts-with")).toBeNull();
  });

  it("runs the month now from the issue day", async () => {
    getBillingMode.mockResolvedValue(
      state({ mode: "PREPAID_MONTHLY", from: "2026-12-01", first_fee: "2026-12-01" }, { next_period: "2026-12-01", issue_open: true }),
    );
    issueBillingNow.mockResolvedValue({ period: "2026-12-01", students: 2, invoices: ["i1", "i2"], errors: 0 });
    const user = userEvent.setup();
    render(withAuth(owner(), <BillingModeCard />));

    await screen.findByText("آدم");
    await user.click(screen.getByTestId("billing-issue-now"));
    expect(issueBillingNow).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("billing-issued")).toBeInTheDocument();
    expect(previewBilling).toHaveBeenCalledTimes(2);
  });

  it("says when the bills go out before the issue day, and is not offered to a centre", async () => {
    getBillingMode.mockResolvedValue(
      state({ mode: "PREPAID_MONTHLY", from: "2026-12-01", first_fee: "2026-12-01" }, { next_period: "2026-12-01", issue_open: false }),
    );
    const { unmount } = render(withAuth(owner(), <BillingModeCard />));
    await screen.findByText("آدم");
    expect(screen.queryByTestId("billing-issue-now")).toBeNull();
    unmount();

    getBillingMode.mockResolvedValue(state({}, { available: false }));
    render(withAuth(owner(), <BillingModeCard />));
    // It shows while it asks, then goes once the API says this academy cannot pick it.
    expect(screen.getByTestId("billing-mode-card")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("billing-mode-card")).toBeNull());
  });
});
