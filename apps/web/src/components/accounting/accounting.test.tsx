import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { GroupAccounts, PayerAccount, ReceiptDetail } from "@/lib/accounting-api";
import type { GroupDetail } from "@/lib/groups-api";
import { CollectModal } from "./collect-modal";
import { GroupAccountsPanel } from "@/components/groups/group-accounts-panel";
import { MarkPaidModal } from "@/components/invoices/mark-paid-modal";

/**
 * Accounting (docs/groups/01-ACCOUNTING.md): the Collect screen ticks the charges, follows them with
 * the amount, previews exactly what the money pays (and what becomes credit), and records ONE
 * receipt; the group's sheet lists unpaid first and opens Collect on that family's open charges;
 * "mark paid" only becomes Collect for a client on receipts.
 */

const getPayerAccount = vi.fn();
const recordReceipt = vi.fn();
const getGroupAccounts = vi.fn();

vi.mock("@/lib/accounting-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accounting-api")>()),
  getPayerAccount: (p: unknown) => getPayerAccount(p),
  recordReceipt: (i: unknown) => recordReceipt(i),
  getGroupAccounts: (id: unknown, m: unknown) => getGroupAccounts(id, m),
}));

const ar = arMessages.accounting;
const WITH_ACCOUNTING = [
  "invoicing", "payroll", "groups", "accounting",
];

function line(id: string, period: string, amount: number, paid = 0, over: Partial<PayerAccount["lines"][number]> = {}) {
  return {
    id,
    invoice_id: `inv-${period}`,
    description: `English A1 — ${period}`,
    student_id: "s-adam",
    student_name: "Adam",
    group_id: "g1",
    group_name: "English A1",
    group_charge: "MONTHLY",
    date: `${period}-01`,
    period,
    amount_minor: amount,
    paid_minor: paid,
    remaining_minor: amount - paid,
    currency: "EGP",
    invoice_status: "OPEN",
    ...over,
  };
}

function account(lines = [line("l-may", "2026-05", 45000), line("l-jun", "2026-06", 45000, 20000)]): PayerAccount {
  return {
    payer: { kind: "GUARDIAN", id: "gd1", name: "Parent of two", phone: "+201001112223" },
    accounting: true,
    lines,
    balance: [{ currency: "EGP", due_minor: lines.reduce((s, l) => s + l.remaining_minor, 0), credit_minor: 0, balance_minor: 0 }],
    recent_receipts: [],
  };
}

function receipt(over: Partial<ReceiptDetail> = {}): ReceiptDetail {
  return {
    id: "r1",
    number: "R-000007",
    received_on: "2026-06-17",
    created_at: "2026-06-17T09:00:00Z",
    payer_name: "Parent of two",
    payer_kind: "GUARDIAN",
    guardian_id: "gd1",
    student_id: null,
    amount_minor: 70000,
    allocated_minor: 70000,
    currency: "EGP",
    method: "INSTAPAY",
    reference: null,
    source: "MANUAL",
    received_by_name: "Owner",
    voided: false,
    void_reason: null,
    groups: ["English A1"],
    note: null,
    has_proof: false,
    payer: { kind: "GUARDIAN", id: "gd1", name: "Parent of two", phone: "+201001112223" },
    public_url: "https://noor.academiq.test/rc/tok",
    unallocated_minor: 0,
    voided_at: null,
    voided_by_name: null,
    allocations: [],
    balance_after: [{ currency: "EGP", due_minor: 0, credit_minor: 0, balance_minor: 0 }],
    can_void: true,
    ...over,
  };
}

const owner = () =>
  makeSession("ACADEMY_OWNER", { permissions: ["invoice.read", "invoice.mark_paid", "group.read"], capabilities: WITH_ACCOUNTING });

beforeEach(() => {
  getPayerAccount.mockReset();
  recordReceipt.mockReset();
  getGroupAccounts.mockReset();
});

describe("Collect", () => {
  it("ticks every unpaid charge, follows them with the amount, and shows what the money pays", async () => {
    getPayerAccount.mockResolvedValue(account());
    render(withAuth(owner(), <CollectModal open target={{ guardian_id: "gd1" }} onClose={() => {}} />));

    const amount = (await screen.findByTestId("collect-amount")) as HTMLInputElement;
    // 450 for May + the 250 left on June.
    await waitFor(() => expect(amount.value).toBe("700"));

    const preview = screen.getByTestId("collect-preview");
    expect(within(preview).getByText("English A1 — 2026-05")).toBeTruthy();
    expect(within(preview).getByText("English A1 — 2026-06")).toBeTruthy();

    // Unticking June drops the amount to May's 450.
    await userEvent.click(screen.getByTestId("collect-line-l-jun"));
    await waitFor(() => expect(amount.value).toBe("450"));
  });

  it("keeps what is beyond every charge as credit, and records one receipt for it", async () => {
    getPayerAccount.mockResolvedValue(account([line("l-jun", "2026-06", 45000)]));
    recordReceipt.mockResolvedValue({ receipt: receipt({ amount_minor: 60000, unallocated_minor: 15000 }) });
    const onRecorded = vi.fn();
    render(withAuth(owner(), <CollectModal open target={{ guardian_id: "gd1" }} onClose={() => {}} onRecorded={onRecorded} />));

    const amount = (await screen.findByTestId("collect-amount")) as HTMLInputElement;
    await waitFor(() => expect(amount.value).toBe("450"));
    await userEvent.clear(amount);
    await userEvent.type(amount, "600");
    // 600 against a 450 charge: the 150 beyond it is kept as credit.
    const tail = ar.collect.becomesCredit.split("{amount}")[1]!.trim();
    expect(within(screen.getByTestId("collect-preview")).getByText((text) => text.includes(tail))).toBeTruthy();

    await userEvent.click(screen.getByTestId("collect-method-INSTAPAY"));
    // Anything but cash needs the transfer's picture before it can be saved.
    expect(screen.getByTestId("collect-submit")).toBeDisabled();
    await userEvent.upload(screen.getByTestId("collect-proof"), new File(["img"], "instapay.png", { type: "image/png" }));
    await userEvent.click(screen.getByTestId("collect-submit"));

    await waitFor(() => expect(recordReceipt).toHaveBeenCalledTimes(1));
    expect(recordReceipt.mock.calls[0]![0]).toMatchObject({
      guardian_id: "gd1",
      amount_minor: 60000,
      currency: "EGP",
      method: "INSTAPAY",
      line_ids: ["l-jun"],
      apply_rest: true,
    });

    // The receipt itself: its number, and the ways to hand it over.
    const done = await screen.findByTestId("collect-done");
    expect(within(done).getByText("R-000007")).toBeTruthy();
    expect(screen.getByTestId("collect-send")).toBeTruthy();
    expect(onRecorded).toHaveBeenCalled();
  });
});

describe("Group accounts", () => {
  const group = { id: "g1", name: "English A1", timezone: "Africa/Cairo", pricing: { currency: "EGP" } } as unknown as GroupDetail;

  function sheet(): GroupAccounts {
    const base = {
      member_status: "ACTIVE", joined_on: "2026-05-01", left_on: null, is_trial: false, currency: "EGP", charges: [], last_receipt: null,
    };
    return {
      month: "2026-06",
      group: { id: "g1", name: "English A1", billing_mode: "MONTHLY", price_minor: 45000, currency: "EGP" },
      rows: [
        { ...base, student_id: "s-c", student_name: "Celine", payer: { kind: "GUARDIAN", id: "gd2", name: "Celine’s mother", phone: null }, due_minor: 45000, paid_minor: 0, remaining_minor: 45000, arrears_minor: 45000, state: "UNPAID", open_line_ids: ["c-may", "c-jun"] },
        { ...base, student_id: "s-a", student_name: "Adam", payer: { kind: "GUARDIAN", id: "gd1", name: "Parent of two", phone: null }, due_minor: 45000, paid_minor: 45000, remaining_minor: 0, arrears_minor: 0, state: "PAID", open_line_ids: [],
          last_receipt: { id: "r1", number: "R-000001", received_on: "2026-06-17", method: "CASH" } },
      ],
      totals: [{ currency: "EGP", expected_minor: 90000, collected_minor: 45000, remaining_minor: 45000, arrears_minor: 45000, received_in_month_minor: 45000, paid: 1, partial: 0, unpaid: 1, rate: 0.5, teacher_cost_minor: null, net_minor: null }],
      sees_teacher_cost: false,
      can_collect: true,
    };
  }

  it("shows the collection rate, lists unpaid first, and collects with that family's open charges ticked", async () => {
    getGroupAccounts.mockResolvedValue(sheet());
    getPayerAccount.mockResolvedValue(account([line("c-may", "2026-05", 45000), line("c-jun", "2026-06", 45000)]));
    render(withAuth(owner(), <GroupAccountsPanel group={group} />));

    const table = await screen.findByTestId("accounts-table");
    expect(screen.getByText("50%")).toBeTruthy();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("Celine")).toBeTruthy();
    expect(within(rows[1]!).getByText("R-000001")).toBeTruthy();
    // Nothing to collect from a paid row.
    expect(screen.queryByTestId("collect-s-a")).toBeNull();

    // The filter narrows to the paid ones.
    await userEvent.click(screen.getByTestId("accounts-filter-PAID"));
    expect(within(screen.getByTestId("accounts-table")).queryByText("Celine")).toBeNull();
    await userEvent.click(screen.getByTestId("accounts-filter-ALL"));

    await userEvent.click(screen.getByTestId("collect-s-c"));
    await waitFor(() => expect(getPayerAccount).toHaveBeenCalledWith({ guardian_id: "gd2", student_id: null, invoice_id: undefined }));
    const field = (await screen.findByTestId("collect-amount")) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe("900"));
  });
});

describe("Mark paid", () => {
  const props = { open: true, invoiceId: "inv-1", totalMinor: 90000, currency: "EGP", onClose: () => {}, onSuccess: () => {} };

  it("is the classic form for a client without accounting", () => {
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["invoice.mark_paid"] }), <MarkPaidModal {...props} />));
    expect(document.getElementById("mark-paid-form")).not.toBeNull();
    expect(getPayerAccount).not.toHaveBeenCalled();
  });

  it("collects a receipt, the invoice's charges ticked, for a client on receipts", async () => {
    getPayerAccount.mockResolvedValue(account([line("l-other", "2026-05", 10000, 0, { invoice_id: "inv-0" }), line("l-1", "2026-06", 90000, 0, { invoice_id: "inv-1" })]));
    render(withAuth(owner(), <MarkPaidModal {...props} />));

    await waitFor(() => expect(getPayerAccount).toHaveBeenCalledWith({ guardian_id: undefined, student_id: undefined, invoice_id: "inv-1" }));
    const field = (await screen.findByTestId("collect-amount")) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe("900"));
    expect((screen.getByTestId("collect-line-l-1") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("collect-line-l-other") as HTMLInputElement).checked).toBe(false);
  });
});
